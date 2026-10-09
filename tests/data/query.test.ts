import { describe, expect, it } from "vitest";
import { runQuery, QueryError, SUPPORT_KEY } from "@/lib/data/query";
import { getCatalogSummary, getDomain } from "@/lib/data/catalog";
import { OTHERS_LABEL } from "@/lib/data/grouping";

const sum = (rows: Array<Record<string, unknown>>, key: string) =>
  rows.reduce((acc, r) => acc + Number(r[key] ?? 0), 0);

const ACTIVOS = { field: "activo", op: "eq" as const, value: "Sí" };

describe("KPI sin agrupamiento", () => {
  it("cuenta 79 personas activas", () => {
    const rs = runQuery({ domain: "nomina", metric: "headcount_activo", groupBy: [] });
    expect(rs.rows).toHaveLength(1);
    expect(rs.rows[0]?.headcount_activo).toBe(79);
    expect(rs.provenance.rowsTotal).toBe(124);
  });

  it("el % de mujeres activas es 24 de 79", () => {
    const rs = runQuery({ domain: "nomina", metric: "pct_mujeres", groupBy: [], filters: [ACTIVOS] });
    expect(Number(rs.rows[0]?.pct_mujeres)).toBeCloseTo((24 / 79) * 100, 6);
  });

  it("el attrition de 12 meses se lee en el último mes", () => {
    const rs = runQuery({
      domain: "movimientos",
      metric: "attrition_12m",
      groupBy: [],
      filters: [{ field: "mes", op: "eq", value: "2026-08" }],
    });
    const value = Number(rs.rows[0]?.attrition_12m);
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(100);
  });

  it("no advierte cobertura baja si la métrica tiene dato en la mayoría de las filas", () => {
    // El attrition de 12 meses no existe los primeros 11 meses de la serie: cobertura 75 %.
    const rs = runQuery({ domain: "movimientos", metric: "attrition_12m", groupBy: [] });
    expect(rs.provenance.warnings).toEqual([]);
  });
});

describe("agrupamiento simple", () => {
  it("reparte las 79 personas activas entre regiones sin perder ninguna", () => {
    const rs = runQuery({ domain: "nomina", metric: "headcount_activo", groupBy: ["region"] });
    expect(sum(rs.rows, "headcount_activo")).toBe(79);
    expect(rs.dimensionKeys).toEqual(["region"]);
    expect(rs.metricKey).toBe("headcount_activo");
  });

  it("cuenta las personas activas por área", () => {
    const rs = runQuery({ domain: "nomina", metric: "headcount_activo", groupBy: ["area"] });
    expect(rs.rows).toEqual([
      { area: "Operación", headcount_activo: 53, [SUPPORT_KEY]: 80 },
      { area: "Estructura", headcount_activo: 19, [SUPPORT_KEY]: 23 },
      { area: "I+D", headcount_activo: 7, [SUPPORT_KEY]: 10 },
    ]);
  });

  it("no muestra un 'Sin dato' que no suma nada", () => {
    // Los 11 sin área son egresados: contando activos, ese grupo vale cero.
    const rs = runQuery({ domain: "nomina", metric: "headcount_activo", groupBy: ["area"] });
    expect(rs.rows.map((r) => r.area)).not.toContain("Sin dato");
  });

  it("ordena las categóricas de mayor a menor por defecto", () => {
    const rs = runQuery({ domain: "nomina", metric: "headcount_activo", groupBy: ["proyecto"] });
    const values = rs.rows.filter((r) => r.proyecto !== OTHERS_LABEL).map((r) => Number(r.headcount_activo));
    expect(values).toEqual([...values].sort((a, b) => b - a));
  });

  it("ordena las ordinales en su orden natural, con lo que no es un nivel al final", () => {
    const rs = runQuery({ domain: "nomina", metric: "headcount_activo", groupBy: ["seniority"], filters: [ACTIVOS] });
    expect(rs.rows.map((r) => [r.seniority, r.headcount_activo])).toEqual([
      ["Trainee", 1],
      ["Junior", 12],
      ["Semi Senior", 21],
      ["Senior", 14],
      ["No aplica", 21],
      ["Sin dato", 10],
    ]);

    const edades = runQuery({ domain: "nomina", metric: "headcount", groupBy: ["rango_edad"] });
    const labels = edades.rows.map((r) => String(r.rango_edad)).filter((l) => l !== "Sin dato");
    expect(labels[0]).toBe("Menos de 25");
    expect(labels.at(-1)).toBe("45 o más");
  });

  it("ordena las temporales cronológicamente por defecto", () => {
    const rs = runQuery({ domain: "nomina", metric: "headcount", groupBy: ["mes_ingreso"] });
    const labels = rs.rows.map((r) => String(r.mes_ingreso));
    // formatLabel convierte "2021-07" en "julio 2021", pero el orden viene del ISO.
    expect(labels[0]).toMatch(/20(1|2)\d/);
    expect(rs.provenance.groupBy).toEqual(["mes_ingreso"]);
  });

  it("el share suma 100 %", () => {
    const rs = runQuery({ domain: "nomina", metric: "pct_del_total", groupBy: ["area"], filters: [ACTIVOS] });
    expect(sum(rs.rows, "pct_del_total")).toBeCloseTo(100, 6);
  });

  it("el ratio de activos queda entre 0 y 100 en cada grupo", () => {
    const rs = runQuery({ domain: "nomina", metric: "pct_activos", groupBy: ["region"] });
    for (const r of rs.rows) {
      expect(Number(r.pct_activos)).toBeGreaterThanOrEqual(0);
      expect(Number(r.pct_activos)).toBeLessThanOrEqual(100);
    }
  });
});

describe("dos dimensiones", () => {
  it("convierte la segunda dimensión en columnas de serie", () => {
    const rs = runQuery({ domain: "nomina", metric: "headcount", groupBy: ["region", "activo"] });
    expect(rs.seriesKeys.sort()).toEqual(["No", "Sí"]);
    // Cada fila trae una columna por serie, que es lo que Recharts necesita para apilar.
    for (const row of rs.rows) {
      expect(row).toHaveProperty("Sí");
      expect(row).toHaveProperty("No");
    }
  });

  it("descarta las series que quedaron vacías en todas las filas", () => {
    const rs = runQuery({ domain: "nomina", metric: "headcount_activo", groupBy: ["area", "genero"] });
    expect(rs.seriesKeys).toEqual(["Femenino", "Masculino"]);
  });
});

describe("filtros", () => {
  it("filtra por igualdad", () => {
    const rs = runQuery({
      domain: "nomina",
      metric: "headcount",
      groupBy: ["seniority"],
      filters: [{ field: "area", op: "eq", value: "Operación" }],
    });
    expect(rs.provenance.rowsMatched).toBe(80);
  });

  it("acumula varios filtros con AND", () => {
    const rs = runQuery({
      domain: "nomina",
      metric: "headcount",
      groupBy: [],
      filters: [ACTIVOS, { field: "genero", op: "eq", value: "Femenino" }],
    });
    expect(rs.rows[0]?.headcount).toBe(24);
  });

  it("devuelve un resultado vacío explicado, no un error", () => {
    const rs = runQuery({
      domain: "movimientos",
      metric: "ingresos",
      groupBy: ["mes"],
      filters: [{ field: "mes", op: "gte", value: "2030-01" }],
    });
    expect(rs.rows).toHaveLength(0);
    expect(rs.provenance.warnings.join(" ")).toMatch(/Ningún registro/i);
  });

  it("soporta `in` para varios valores", () => {
    const rs = runQuery({
      domain: "nomina",
      metric: "headcount_activo",
      groupBy: [],
      filters: [{ field: "area", op: "in", value: ["Estructura", "I+D"] }],
    });
    expect(rs.rows[0]?.headcount_activo).toBe(26); // 19 + 7
  });

  it("filtra rangos de meses", () => {
    const rs = runQuery({
      domain: "movimientos",
      metric: "egresos",
      groupBy: [],
      filters: [{ field: "mes", op: "between", value: ["2023-01", "2023-12"] }],
    });
    expect(rs.rows[0]?.egresos).toBe(10);
  });
});

describe("sin umbral de grupo", () => {
  it("muestra los grupos chicos tal cual", () => {
    const rs = runQuery({ domain: "nomina", metric: "headcount", groupBy: ["genero"] });
    expect(rs.rows.find((r) => r.genero === "No binario")?.headcount).toBe(3);
    expect(rs.rows.map((r) => String(r.genero))).not.toContain(OTHERS_LABEL);
    expect(sum(rs.rows, "headcount")).toBe(124);
  });

  it("devuelve el dato de un puesto que ocupa una sola persona", () => {
    const rs = runQuery({
      domain: "nomina",
      metric: "antiguedad_prom",
      groupBy: [],
      filters: [{ field: "posicion", op: "eq", value: "Chief Technology Officer" }],
    });
    expect(rs.provenance.rowsMatched).toBe(1);
    expect(rs.rows[0]?.antiguedad_prom).toBe(1.1);
  });

  it("los cruces de dos dimensiones muestran sus celdas aunque sean chicas", () => {
    const rs = runQuery({ domain: "nomina", metric: "headcount", groupBy: ["area", "genero"], filters: [ACTIVOS] });
    expect(rs.rows.find((r) => r.area === "I+D")).toMatchObject({ Femenino: 3, Masculino: 4 });
    expect(rs.provenance.warnings).toEqual([]);
  });

  it("un promedio en 'Otros' se recalcula sobre las personas, no se suman promedios", () => {
    const rs = runQuery({ domain: "nomina", metric: "edad_prom", groupBy: ["posicion"], filters: [ACTIVOS], limit: 4 });
    const otros = rs.rows.find((r) => r.posicion === OTHERS_LABEL);
    expect(otros).toBeDefined();
    // Una edad promedio de un grupo de personas adultas, no la suma de varios promedios.
    expect(Number(otros!.edad_prom)).toBeGreaterThan(18);
    expect(Number(otros!.edad_prom)).toBeLessThan(70);
  });

  it("nunca hay nombres: ni en las filas ni como dimensión", () => {
    const keys = new Set(getDomain("nomina").rows.flatMap((r) => Object.keys(r)));
    for (const k of keys) expect(k).not.toMatch(/nombre|apellido|correo|mail|cuil/i);
  });
});

describe("alta cardinalidad", () => {
  it("recorta el mes de ingreso sin plegar el tiempo", () => {
    const rs = runQuery({ domain: "nomina", metric: "headcount", groupBy: ["mes_ingreso"] });
    expect(rs.rows.map((r) => String(r.mes_ingreso))).not.toContain(OTHERS_LABEL);
  });

  it("recorta una categórica con muchos valores a un top legible con Otros", () => {
    const rs = runQuery({ domain: "nomina", metric: "headcount", groupBy: ["tech_principal"], limit: 4 });
    const labels = rs.rows.map((r) => String(r.tech_principal));
    expect(labels.length).toBe(5); // 4 + "Otros"
    // Un solo "Otros": el del recorte.
    expect(labels.filter((l) => l === OTHERS_LABEL)).toHaveLength(1);
    expect(sum(rs.rows, "headcount")).toBe(124);
  });
});

describe("errores de consulta", () => {
  it("rechaza una métrica inexistente y sugiere las que hay", () => {
    expect(() => runQuery({ domain: "nomina", metric: "salario", groupBy: ["area"] })).toThrowError(QueryError);

    try {
      runQuery({ domain: "nomina", metric: "salario", groupBy: ["area"] });
    } catch (e) {
      expect((e as QueryError).suggestion).toMatch(/Personas activas/);
    }
  });

  it("rechaza una dimensión inexistente", () => {
    expect(() => runQuery({ domain: "nomina", metric: "headcount", groupBy: ["salario"] })).toThrowError(/no existe/i);
  });

  it("no se puede agrupar por una columna PII: no está en el catálogo", () => {
    for (const field of ["nombre", "apellido", "correo", "cuil", "telefono", "direccion", "referente"]) {
      expect(() => runQuery({ domain: "nomina", metric: "headcount", groupBy: [field] })).toThrowError(/no existe/i);
    }
  });
});

describe("catálogo expuesto al agente", () => {
  const summary = getCatalogSummary();

  it("no filtra las filas de datos al agente", () => {
    const json = JSON.stringify(summary);
    expect(json).not.toMatch(/"rows"/);
    // Ni rastro de una persona concreta.
    expect(json).not.toMatch(/@flockit\.com\.ar/);
  });

  it("calcula cobertura y cardinalidad desde los datos reales", () => {
    const nomina = summary.domains.find((d) => d.id === "nomina");
    const region = nomina?.dimensions.find((d) => d.id === "region");
    expect(region?.cardinality).toBeLessThanOrEqual(6);
    expect(region?.coverage).toBe(1); // "Sin dato" también es un valor

    const ingles = nomina?.dimensions.find((d) => d.id === "nivel_ingles");
    expect(ingles?.coverage).toBeCloseTo(36 / 124, 2);
  });

  it("enumera los valores de una ordinal en su orden natural", () => {
    const nomina = summary.domains.find((d) => d.id === "nomina");
    expect(nomina?.dimensions.find((d) => d.id === "seniority")?.values).toEqual([
      "Trainee",
      "Junior",
      "Semi Senior",
      "Senior",
      "No aplica",
    ]);
  });

  it("declara los salarios como no disponibles, con alternativa", () => {
    const entry = summary.unavailable.find((u) => /Salario/.test(u.field));
    expect(entry).toBeDefined();
    expect(entry?.suggestion).toBe("seniority");
  });

  it("los dos dominios traen la cantidad de filas correcta", () => {
    expect(getDomain("nomina").rowCount).toBe(124);
    expect(getDomain("movimientos").rowCount).toBe(44); // enero 2023 a agosto 2026
  });
});

describe("eje del tiempo", () => {
  it("el mes de ingreso queda mensual, sin generalizar ni plegar", () => {
    const rs = runQuery({ domain: "nomina", metric: "headcount", groupBy: ["mes_ingreso"] });
    expect(rs.rows.map((r) => String(r.mes_ingreso))).not.toContain(OTHERS_LABEL);
    expect(rs.rows[0]?.mes_ingreso).toBe("octubre 2020");
    expect(rs.provenance.warnings.join(" ")).not.toMatch(/Agrupé por/);
    expect(sum(rs.rows, "headcount")).toBe(124);
  });

  it("para verlo por año está el año de ingreso", () => {
    const rs = runQuery({ domain: "nomina", metric: "headcount", groupBy: ["anio_ingreso"] });
    expect(rs.rows.map((r) => [r.anio_ingreso, r.headcount])).toEqual([
      ["2020", 4], ["2021", 21], ["2022", 25], ["2023", 29], ["2024", 20], ["2025", 15], ["2026", 10],
    ]);
  });

  it("mantiene el orden cronológico, no el alfabético", () => {
    const rs = runQuery({ domain: "nomina", metric: "headcount", groupBy: ["mes_ingreso"] });
    const years = rs.rows
      .map((r) => String(r.mes_ingreso).match(/(\d{4})/)?.[1])
      .filter(Boolean)
      .map(Number);
    // Si ordenara por la etiqueta formateada, "agosto 2022" iría antes que "julio 2021".
    expect(years).toEqual([...years].sort((a, b) => a - b));
  });

  it("movimientos queda mes a mes", () => {
    const rs = runQuery({ domain: "movimientos", metric: "ingresos", groupBy: ["mes"] });
    expect(rs.rows.length).toBe(44);
  });
});
