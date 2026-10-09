import { FILES, readCsv } from "./ingest";
import type { Row } from "./types";

/**
 * Saneamiento de la nómina.
 *
 * Los datos personales identificables no llegan acá: el CSV trae sólo una whitelist de
 * columnas, y nada de lo que identifica a alguien (nombre, correo, CUIL, domicilio, teléfono,
 * fecha de nacimiento, referentes) existe en `data/`. Acá se limpian los valores crudos
 * (grafías, tipeos, "N/A", como los cargaría RR.HH. a mano) y se agrupan en categorías que se
 * puedan graficar.
 */

/** `aaaa-mm-dd` → `aaaa-mm`. */
function monthOf(isoDate: string | null): string | null {
  return isoDate ? isoDate.slice(0, 7) : null;
}

function parseIsoDate(value: string): string | null {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? value.trim() : null;
}

/** Números con punto decimal, como los escribe el import (`"5.3"` → `5.3`). */
function parseNumber(value: string): number | null {
  const cleaned = value.trim();
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function clean(value: string | undefined): string | null {
  const v = (value ?? "").replace(/\s+/g, " ").trim();
  return v === "" ? null : v;
}

/** "N/A" en la planilla quiere decir que el campo no aplica al rol, no un valor. */
function isNotApplicable(value: string): boolean {
  return /^n\/?a$/i.test(value) || value === "-";
}

function yesNo(value: string | undefined): string | null {
  const v = clean(value);
  if (v === null) return null;
  if (/^s[ií]$/i.test(v)) return "Sí";
  if (/^no$/i.test(v)) return "No";
  return null;
}

/**
 * Las variantes crudas de `Región` ("CABA", "GBA, Quilmes", "Córdoba"…) colapsan a cinco zonas.
 *
 * El corte AMBA / fuera de AMBA no se deduce de acá: la planilla ya trae una columna
 * propia para eso, que es la autoritativa.
 */
function normalizeRegion(value: string): string {
  const v = value.trim();
  if (v === "") return "Sin dato";
  if (/^CABA$/i.test(v)) return "CABA";
  if (/^GBA\b/i.test(v) || /^AMBA$/i.test(v)) return "GBA";
  if (/^Buenos Aires$/i.test(v)) return "Buenos Aires";
  if (/^(Chile|España|Italia|Uruguay|Brasil|México|Mexico)$/i.test(v)) return "Exterior";
  return "Interior";
}

export const AGE_BANDS = ["Menos de 25", "25 a 29", "30 a 34", "35 a 39", "40 a 44", "45 o más"];

function ageBand(age: number | null): string | null {
  if (age === null) return null;
  if (age < 25) return AGE_BANDS[0]!;
  if (age < 30) return AGE_BANDS[1]!;
  if (age < 35) return AGE_BANDS[2]!;
  if (age < 40) return AGE_BANDS[3]!;
  if (age < 45) return AGE_BANDS[4]!;
  return AGE_BANDS[5]!;
}

export const TENURE_BANDS = ["Menos de 1 año", "1 a 2 años", "2 a 3 años", "3 a 5 años", "5 años o más"];

function tenureBand(years: number | null): string | null {
  if (years === null) return null;
  if (years < 1) return TENURE_BANDS[0]!;
  if (years < 2) return TENURE_BANDS[1]!;
  if (years < 3) return TENURE_BANDS[2]!;
  if (years < 5) return TENURE_BANDS[3]!;
  return TENURE_BANDS[4]!;
}

const GENERO: Record<string, string> = {
  M: "Masculino",
  F: "Femenino",
  N: "No binario",
};

export const SENIORITY_ORDER = ["Trainee", "Junior", "Semi Senior", "Senior", "No aplica"];

/**
 * `Categoría` mezcla el nivel con su tramo ("Semi Senior inicial", "Junior avanzado") y trae
 * errores de tipeo ("Junio medio"). Se queda el nivel: el tramo parte cada nivel en grupos
 * de una o dos personas y el gráfico deja de leerse. "N/A" son los roles sin escalafón técnico
 * (gestión, comercial, People), y se distingue de no tener dato.
 */
function seniorityOf(value: string | null): string | null {
  if (value === null) return null;
  if (isNotApplicable(value)) return "No aplica";
  if (/^trainee/i.test(value)) return "Trainee";
  if (/^semi\s*-?\s*senior|^ssr/i.test(value)) return "Semi Senior";
  if (/^senior|^sr\b/i.test(value)) return "Senior";
  if (/^juni?o|^jr\b/i.test(value)) return "Junior";
  return null;
}

/** Familias de rol: la posición exacta tiene 25 valores, demasiados para una vista general. */
const ROLE_FAMILIES: Array<[RegExp, string]> = [
  [/^(software engineering|software architect|devops|infraestructura|it support|data lead)$/i, "Ingeniería de software"],
  [/^qa\b/i, "QA"],
  [/^(functional analyst|product owner|scrum master|ux\/ui designer)$/i, "Producto y análisis"],
  [/^(i\+d analyst|innovation manager)$/i, "I+D"],
  [/^(team manager|engineering manager|business manager|chief .+ officer)$/i, "Gestión y dirección"],
  [/^(business development .+|pre sales engineer)$/i, "Comercial"],
  [/^people\b/i, "People"],
];

function roleFamilyOf(value: string | null): string | null {
  if (value === null) return null;
  for (const [pattern, family] of ROLE_FAMILIES) {
    if (pattern.test(value)) return family;
  }
  return "Otros roles";
}

/**
 * `Tech Principal` es texto libre: "Angular " y "Angular", "NodeJs" y "NodeJS", ".NET /
 * Angular". Se unifica la grafía y se deja la primera tecnología. Los roles que no son
 * técnicos cargaron su función ("Scrum Master", "Business Development") o "N/A": eso no es
 * una tecnología y queda sin dato.
 */
function techOf(value: string | null): string | null {
  if (value === null || isNotApplicable(value)) return null;
  if (/^(business development|scrum master|team manager|po|cx|project tracking system)$/i.test(value)) {
    return null;
  }
  if (/^\.net/i.test(value)) return ".NET";
  if (/^node/i.test(value)) return "Node.js";
  if (/oracle|pl\/?sql/i.test(value)) return "Oracle PL/SQL";
  if (/^(data|datos)$/i.test(value)) return "Datos";
  if (/^qa\b/i.test(value)) return "QA";
  return value.split(/\s*[,/]\s*/)[0] ?? value;
}

/** "Aseg. Tero" es Aseguradora Tero: la misma cuenta cargada con otra grafía. */
function projectOf(value: string | null): string | null {
  if (value === null || isNotApplicable(value)) return null;
  if (/^aseg(\.|uradora)?\s*tero$/i.test(value)) return "Aseguradora Tero";
  return value;
}

/**
 * Los motivos de egreso vienen como las opciones del formulario de RR.HH., con aclaraciones
 * entre paréntesis ("Razones personales (viajar, estudiar, motivos familiares, etc)") que no
 * entran en el eje de un gráfico. Se acortan conservando lo que distingue a cada uno; un
 * motivo nuevo que no esté acá pasa tal cual.
 */
const EXIT_REASONS: Array<[RegExp, string]> = [
  [/^mejora salarial/i, "Mejora salarial o de beneficios"],
  [/desarrollo profesional/i, "Desarrollo profesional"],
  [/^razones personales/i, "Razones personales"],
  [/^baja performance/i, "Despido por performance"],
  [/^problemas actitudinales/i, "Despido por actitud"],
  [/^sin asignaci[oó]n/i, "Despido por falta de asignación"],
  [/^pasa a n[oó]mina del cliente/i, "Pasó a la nómina del cliente"],
];

function exitReasonOf(value: string | null): string | null {
  if (value === null) return null;
  for (const [pattern, label] of EXIT_REASONS) {
    if (pattern.test(value)) return label;
  }
  // "Pasa a Nimbus Labs": se fue a trabajar a esa empresa. Se conserva a dónde.
  return value.replace(/^pasa a /i, "Pasó a ");
}

export const ENGLISH_ORDER = ["Básico (A)", "Intermedio (B)", "Avanzado (C)"];

/** Nivel de inglés del marco europeo, agrupado por letra. */
function englishOf(value: string | null): string | null {
  if (value === null) return null;
  const letter = value.trim().charAt(0).toUpperCase();
  if (letter === "A") return ENGLISH_ORDER[0]!;
  if (letter === "B") return ENGLISH_ORDER[1]!;
  if (letter === "C") return ENGLISH_ORDER[2]!;
  return null;
}

// ---------------------------------------------------------------------------
// Nómina
// ---------------------------------------------------------------------------

/**
 * Columnas de una planilla de RR.HH. que NUNCA llegan a la app. El CSV sólo tiene su
 * whitelist; la lista queda para que un test verifique que no aparecen en ningún lado.
 */
export const NOMINA_PII = [
  "Correo corporativo",
  "Apellido",
  "Nombre",
  "Fecha de Nacimiento",
  "Cumpleaños",
  "CUIL",
  "Dirección",
  "Teléfono",
  "Emergencia",
  "Edades hijos a 07/2026",
  "Referente proyecto",
  "Champion",
  "Co champion",
] as const;

export function normalizeNomina(): Row[] {
  return readCsv(FILES.nomina).map((r) => {
    const ingreso = parseIsoDate(r["ingreso"] ?? "");
    const egreso = parseIsoDate(r["egreso"] ?? "");
    const edad = parseNumber(r["edad"] ?? "");
    const antiguedad = parseNumber(r["antiguedad_anios"] ?? "");
    const amba = (r["amba"] ?? "").trim();
    const area = clean(r["area"]);

    return {
      activo: yesNo(r["activo"]) === "Sí" ? "Sí" : "No",
      genero: GENERO[(r["sexo"] ?? "").trim().toUpperCase()] ?? null,
      region: normalizeRegion(r["region"] ?? ""),
      zona_amba: amba === "0" ? "AMBA" : amba === "1" ? "Fuera de AMBA" : null,
      hijes: yesNo(r["hijes"]),
      motivo_egreso: exitReasonOf(clean(r["motivo_egreso"])),
      ingreso,
      egreso,
      mes_ingreso: monthOf(ingreso),
      mes_egreso: monthOf(egreso),
      anio_ingreso: ingreso ? ingreso.slice(0, 4) : null,
      anio_egreso: egreso ? egreso.slice(0, 4) : null,
      edad,
      rango_edad: ageBand(edad),
      antiguedad_anios: antiguedad,
      rango_antiguedad: tenureBand(antiguedad),
      area: area === null || isNotApplicable(area) ? null : area,
      posicion: clean(r["posicion"]),
      rol: roleFamilyOf(clean(r["posicion"])),
      seniority: seniorityOf(clean(r["categoria"])),
      tech_principal: techOf(clean(r["tech_principal"])),
      proyecto: projectOf(clean(r["proyecto"])),
      nivel_ingles: englishOf(clean(r["ingles"])),
      entrevistador: yesNo(r["entrevistador"]),
      es_champion: yesNo(r["es_champion"]),
      flock_talent: yesNo(r["flock_talent"]),
      buddy: yesNo(r["buddy"]),
    } satisfies Row;
  });
}

export const __testing = {
  parseNumber,
  normalizeRegion,
  ageBand,
  tenureBand,
  seniorityOf,
  roleFamilyOf,
  techOf,
  projectOf,
  englishOf,
  exitReasonOf,
};
