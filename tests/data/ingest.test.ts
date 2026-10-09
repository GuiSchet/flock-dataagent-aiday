import { describe, expect, it } from "vitest";
import { __testing, normalizeNomina, NOMINA_PII } from "@/lib/data/normalize";
import { FILES, readCsv, readMeta } from "@/lib/data/ingest";

/**
 * Estos tests existen por SC-002: todo número que la app muestre tiene que ser
 * reproducible contando a mano sobre el CSV. Las cifras de acá salen de la nómina sintética
 * (`npm run data:synthetic`, semilla fija, corte al 24/09/2026); si un cambio de
 * normalización o del generador las mueve, es una regresión silenciosa que hay que ver acá y
 * no en una demo.
 */

const count = (rows: Array<Record<string, unknown>>, key: string) => {
  const m = new Map<string, number>();
  for (const r of rows) {
    const v = r[key] === null || r[key] === undefined ? "∅" : String(r[key]);
    m.set(v, (m.get(v) ?? 0) + 1);
  }
  return m;
};

describe("archivos de data/", () => {
  it("deja escrita la fecha de corte y los conteos de la fuente", () => {
    expect(readMeta()).toMatchObject({
      fuente: "Nómina sintética",
      fechaCorte: "2026-09-24",
      personas: 124,
      activas: 79,
      egresadas: 45,
    });
  });

  it("el CSV sólo tiene las columnas de la whitelist: ningún dato personal", () => {
    const columns = Object.keys(readCsv(FILES.nomina)[0] ?? {});
    expect(columns).toEqual([
      "activo", "sexo", "region", "amba", "hijes", "ingreso", "egreso", "motivo_egreso",
      "edad", "antiguedad_anios", "area", "posicion", "categoria", "tech_principal",
      "proyecto", "ingles", "entrevistador", "es_champion", "flock_talent", "buddy",
    ]);
    for (const k of columns) {
      expect(k).not.toMatch(/correo|mail|apellido|nombre|cuil|dni|direcci|tel[eé]fono|emergencia|nacimiento|referente|^(co_?)?champion$/i);
    }
  });

  it("las fechas quedan en ISO y los decimales con punto", () => {
    const raw = readCsv(FILES.nomina);
    for (const r of raw) {
      expect(r.ingreso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (r.egreso) expect(r.egreso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.antiguedad_anios).toMatch(/^\d+(\.\d)?$/);
    }
  });
});

describe("ingesta de nómina", () => {
  const rows = normalizeNomina();

  it("lee las 124 personas", () => {
    expect(rows.length).toBe(124);
  });

  it("cuenta 79 activos y 45 egresados, y el estado coincide con la fecha de egreso", () => {
    const c = count(rows, "activo");
    expect(c.get("Sí")).toBe(79);
    expect(c.get("No")).toBe(45);
    for (const r of rows) expect(r.activo === "No").toBe(r.egreso !== null);
  });

  it("colapsa las variantes de región a un puñado de zonas", () => {
    const c = count(rows, "region");
    expect(c.size).toBeLessThanOrEqual(6);
    expect(c.get("CABA")).toBe(46);
    // Todas las personas quedan clasificadas: nadie se pierde en la normalización.
    expect([...c.values()].reduce((a, b) => a + b, 0)).toBe(124);
  });

  it("toma el corte AMBA de su columna propia", () => {
    const c = count(rows, "zona_amba");
    expect(c.get("AMBA")).toBe(84);
    expect(c.get("Fuera de AMBA")).toBe(39);
  });

  it("normaliza género a etiquetas legibles", () => {
    const c = count(rows, "genero");
    expect(c.get("Masculino")).toBe(88);
    expect(c.get("Femenino")).toBe(33);
    expect(c.get("No binario")).toBe(3);
  });

  it("calcula edad y antigüedad contra la fecha de corte", () => {
    expect(rows.filter((r) => typeof r.edad === "number").length).toBe(121);
    const withTenure = rows.filter((r) => typeof r.antiguedad_anios === "number");
    expect(withTenure.length).toBe(124);
    for (const r of withTenure) {
      expect(r.antiguedad_anios).toBeGreaterThanOrEqual(0);
      expect(r.antiguedad_anios).toBeLessThan(10);
    }
  });

  it("deriva mes de ingreso para todas las personas", () => {
    const withMonth = rows.filter((r) => typeof r.mes_ingreso === "string");
    expect(withMonth.length).toBe(124);
    expect(String(rows[0]?.mes_ingreso)).toMatch(/^\d{4}-\d{2}$/);
  });

  it("registra los 45 motivos de egreso solo en quienes se fueron", () => {
    const conMotivo = rows.filter((r) => r.motivo_egreso !== null);
    expect(conMotivo.length).toBe(45);
    for (const r of conMotivo) expect(r.activo).toBe("No");
  });

  it("área de las personas activas", () => {
    const activos = rows.filter((r) => r.activo === "Sí");
    const c = count(activos, "area");
    expect(c.get("Operación")).toBe(53);
    expect(c.get("Estructura")).toBe(19);
    expect(c.get("I+D")).toBe(7);
  });

  it("agrupa la categoría en niveles de seniority", () => {
    const activos = rows.filter((r) => r.activo === "Sí");
    const c = count(activos, "seniority");
    expect(c.get("Trainee")).toBe(1);
    expect(c.get("Junior")).toBe(12);
    expect(c.get("Semi Senior")).toBe(21);
    expect(c.get("Senior")).toBe(14);
    expect(c.get("No aplica")).toBe(21);
  });

  it("NINGUNA columna PII sobrevive a la normalización", () => {
    const keys = new Set(Object.keys(rows[0] ?? {}));
    for (const pii of NOMINA_PII) expect(keys.has(pii)).toBe(false);
    for (const k of keys) {
      expect(k).not.toMatch(/correo|mail|apellido|nombre|cuil|direcci|tel[eé]fono|emergencia|nacimiento|referente/i);
    }
  });
});

describe("normalizadores", () => {
  const { seniorityOf, roleFamilyOf, techOf, projectOf, englishOf } = __testing;

  it("seniority: se queda el nivel, corrige el tipeo y separa 'no aplica' de 'sin dato'", () => {
    expect(seniorityOf("Semi Senior inicial")).toBe("Semi Senior");
    expect(seniorityOf("Junio medio")).toBe("Junior");
    expect(seniorityOf("Senior medio")).toBe("Senior");
    expect(seniorityOf("Trainee")).toBe("Trainee");
    expect(seniorityOf("N/A")).toBe("No aplica");
    expect(seniorityOf(null)).toBeNull();
  });

  it("rol: la posición va a su familia", () => {
    expect(roleFamilyOf("Software Engineering")).toBe("Ingeniería de software");
    expect(roleFamilyOf("Chief Technology Officer")).toBe("Gestión y dirección");
    expect(roleFamilyOf("People & Culture Partner")).toBe("People");
    expect(roleFamilyOf("Business Development Intern")).toBe("Comercial");
  });

  it("tecnología: unifica la grafía y descarta lo que no es una tecnología", () => {
    expect(techOf("NodeJs")).toBe("Node.js");
    expect(techOf("NodeJS")).toBe("Node.js");
    expect(techOf(".NET / Angular")).toBe(".NET");
    expect(techOf("PLSQL Oracle")).toBe("Oracle PL/SQL");
    expect(techOf("Scrum Master")).toBeNull();
    expect(techOf("N/A")).toBeNull();
  });

  it("proyecto e inglés", () => {
    expect(projectOf("Aseg. Tero")).toBe("Aseguradora Tero");
    expect(projectOf("Aseguradora Tero")).toBe("Aseguradora Tero");
    expect(englishOf("B2+")).toBe("Intermedio (B)");
    expect(englishOf("A3")).toBe("Básico (A)");
  });
});
