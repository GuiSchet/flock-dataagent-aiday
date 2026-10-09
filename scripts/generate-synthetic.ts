import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";

/**
 * Genera la nómina sintética que lee la app.
 *
 *     npm run data:synthetic
 *
 * Ninguna fila sale de una persona real: las distribuciones están inventadas y los clientes
 * son ficticios. El esquema es el mismo que espera `lib/data/ingest.ts`, con las mismas
 * desprolijidades que tendría una planilla de RR.HH. cargada a mano (grafías distintas de un
 * mismo valor, "N/A", celdas vacías), para que el saneamiento de `normalize.ts` tenga trabajo.
 *
 * La semilla es fija: correrlo dos veces escribe los mismos archivos, y las cifras de los
 * tests no se mueven salvo que cambie este script.
 *
 * Salidas (en `data/`, versionadas):
 * - `nomina.csv`: una fila por persona, UTF-8, fechas ISO y punto decimal.
 * - `meta.json`: fuente, fecha de corte y conteos.
 * - `control-attrition-2023-2024.csv`: la serie mensual de dotación, ingresos y bajas,
 *   contada acá por separado. Sólo la usan los tests, para contrastar el dominio de
 *   movimientos que la app calcula de la nómina.
 *
 * Y una fuera del repo: `.cache/nombres.json`, nombres inventados para que el banco de voz
 * verifique que el agente nunca nombra a nadie. Nunca la lee la app.
 */

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, "data");

const SEED = 20261009;
const PEOPLE = 124;
const CUTOFF = "2026-09-24";

// ---------------------------------------------------------------------------
// Azar reproducible
// ---------------------------------------------------------------------------

/** mulberry32: chico, rápido y con la misma secuencia en cualquier máquina. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const random = mulberry32(SEED);

function chance(p: number): boolean {
  return random() < p;
}

function int(min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(random() * items.length)]!;
}

/** Elige con pesos: `[["CABA", 30], ["GBA", 28], …]`. */
function weighted<T>(options: ReadonlyArray<readonly [T, number]>): T {
  const total = options.reduce((acc, [, w]) => acc + w, 0);
  let r = random() * total;
  for (const [value, w] of options) {
    r -= w;
    if (r < 0) return value;
  }
  return options.at(-1)![0];
}

// ---------------------------------------------------------------------------
// Fechas
// ---------------------------------------------------------------------------

const DAY = 86_400_000;

function toDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  return isoDate(new Date(toDate(iso).getTime() + days * DAY));
}

function daysBetween(from: string, to: string): number {
  return Math.round((toDate(to).getTime() - toDate(from).getTime()) / DAY);
}

/** Antigüedad en años con un decimal, truncada como hacía la planilla (`ROUNDDOWN`). */
function tenureYears(from: string, to: string): number {
  return Math.max(0, Math.floor((daysBetween(from, to) / 365.25) * 10) / 10);
}

// ---------------------------------------------------------------------------
// Dominios inventados
// ---------------------------------------------------------------------------

/** Ingresos por año. Suman `PEOPLE`. */
const HIRES_BY_YEAR: Array<[number, number]> = [
  [2020, 4],
  [2021, 21],
  [2022, 25],
  [2023, 29],
  [2024, 20],
  [2025, 15],
  [2026, 10],
];

/** Clientes ficticios. "Aseg. Tero" es la misma cuenta cargada con otra grafía. */
const CLIENTS: Array<[string, number]> = [
  ["Aseguradora Tero", 30],
  ["Aseg. Tero", 4],
  ["Banco Ñandú", 14],
  ["Retail Calafate", 10],
  ["Energía Puelche", 7],
  ["Agro Pehuén", 5],
  ["Logística Ombú", 4],
  ["Salud Jacarandá", 3],
];

const GBA = [
  "Avellaneda", "Lanús", "Lanus", "Quilmes", "Bernal", "Lomas de Zamora", "Banfield", "Adrogué",
  "Morón", "Haedo", "Ramos Mejía", "San Justo", "Tigre", "San Isidro", "Vicente López",
  "Pilar", "Escobar", "La Plata", "Merlo", "Tres de Febrero",
];
const INTERIOR = ["Córdoba", "Santa Fe", "Rosario", "Mendoza", "Tucumán", "Salta", "Neuquén", "Entre Ríos", "Chubut", "Misiones"];
const ABROAD = ["Uruguay", "Chile", "España", "México"];

const EXIT_REASONS: Array<[string, number]> = [
  ["Mejora salarial y/o beneficios", 11],
  ["Mejores posibilidades de desarrollo profesional", 9],
  ["Razones personales (viajar, estudiar, motivos familiares, etc)", 6],
  ["Baja performance (despido)", 4],
  ["Problemas actitudinales (despido)", 1],
  ["Sin asignación (despido)", 2],
  ["Pasa a nómina del cliente", 3],
  ["Pasa a Nimbus Labs", 2],
  ["No le gustaba el proyecto", 1],
];

type Area = "Operación" | "Estructura" | "I+D";

interface Role {
  posicion: string;
  /** Tiene escalafón técnico (Trainee a Senior) y tecnología principal. */
  tecnico: boolean;
  techs?: readonly string[];
}

const ROLES: Record<Area, Array<[Role, number]>> = {
  Operación: [
    [{ posicion: "Software Engineering", tecnico: true, techs: ["Java", "Java", ".NET", ".NET / Angular", "Angular", "Angular ", "React", "NodeJs", "NodeJS", "Python", "PL/SQL Oracle"] }, 52],
    [{ posicion: "QA Analyst", tecnico: true, techs: ["QA", "QA, Automation"] }, 7],
    [{ posicion: "Functional Analyst", tecnico: true, techs: ["N/A", "Data"] }, 6],
    [{ posicion: "Software Architect", tecnico: true, techs: ["Java", ".NET", "AWS"] }, 3],
    [{ posicion: "Devops", tecnico: true, techs: ["AWS", "DevOps"] }, 2],
    [{ posicion: "Data Lead", tecnico: true, techs: ["Datos", "PowerBI"] }, 1],
    [{ posicion: "UX/UI Designer", tecnico: true, techs: ["Figma"] }, 2],
    [{ posicion: "Product Owner", tecnico: false, techs: ["PO", "N/A"] }, 2],
    [{ posicion: "Scrum Master", tecnico: false, techs: ["Scrum Master"] }, 2],
    [{ posicion: "Team Manager", tecnico: false, techs: ["Team Manager", "N/A", ""] }, 7],
  ],
  Estructura: [
    [{ posicion: "People & Culture Partner", tecnico: false }, 3],
    [{ posicion: "People", tecnico: false }, 2],
    [{ posicion: "Business Development Manager", tecnico: false, techs: ["Business Development"] }, 4],
    [{ posicion: "Business Development Intern", tecnico: false }, 2],
    [{ posicion: "Business Manager", tecnico: false }, 2],
    [{ posicion: "Pre Sales Engineer", tecnico: false }, 1],
    [{ posicion: "IT Support", tecnico: true, techs: ["N/A"] }, 1],
    [{ posicion: "Infraestructura", tecnico: true, techs: ["AWS"] }, 1],
    [{ posicion: "Engineering Manager", tecnico: false }, 1],
  ],
  "I+D": [
    [{ posicion: "I+D Analyst", tecnico: true, techs: ["Python", "Python", "Data", "React"] }, 8],
    [{ posicion: "Innovation Manager", tecnico: false }, 1],
  ],
};

const SENIORITY: Array<[string, number]> = [
  ["Trainee", 3],
  ["Junior", 5],
  ["Junior inicial", 2],
  ["Junior medio", 6],
  ["Junio medio", 1],
  ["Junior avanzado", 3],
  ["Semi Senior", 22],
  ["Semi Senior inicial", 4],
  ["Semi Senior avanzado", 2],
  ["Senior", 14],
  ["Senior medio", 2],
];

const ENGLISH = ["A1", "A2", "B1", "B1", "B2", "B2", "B2", "C1", "C1", "C2"];

/** Nombres inventados, sólo para `.cache/nombres.json`. */
const FIRST_NAMES = [
  "Abril", "Agustín", "Ailén", "Bautista", "Bruno", "Camila", "Candela", "Ciro", "Delfina", "Emilia",
  "Facundo", "Florencia", "Gael", "Guadalupe", "Ignacio", "Isabella", "Joaquín", "Julieta", "Lautaro", "Lola",
  "Lucas", "Malena", "Mateo", "Micaela", "Nahuel", "Olivia", "Renata", "Santino", "Thiago", "Valentina",
];
const LAST_NAMES = [
  "Acevedo", "Bianchi", "Castelli", "Domínguez", "Echeverría", "Ferreyra", "Gallardo", "Herrera", "Iturbe", "Juárez",
  "Kessler", "Lucero", "Medina", "Navarro", "Ocampo", "Paz", "Quiroga", "Rinaldi", "Sosa", "Toledo",
  "Urquiza", "Villalba", "Weiss", "Zalazar",
];

// ---------------------------------------------------------------------------
// Personas
// ---------------------------------------------------------------------------

/** Las columnas que se escriben, en orden: las mismas que lee `normalizeNomina()`. */
const COLUMNS = [
  "activo",
  "sexo",
  "region",
  "amba",
  "hijes",
  "ingreso",
  "egreso",
  "motivo_egreso",
  "edad",
  "antiguedad_anios",
  "area",
  "posicion",
  "categoria",
  "tech_principal",
  "proyecto",
  "ingles",
  "entrevistador",
  "es_champion",
  "flock_talent",
  "buddy",
] as const;

type Person = Record<(typeof COLUMNS)[number], string | number | null>;

/** La movilidad de la serie empieza en enero 2023: antes no hay egresos en la nómina. */
const FIRST_EXIT = "2023-01-01";

function hireDate(year: number): string {
  // 2020 arranca en el último trimestre; 2026 llega hasta un mes antes del corte.
  const from = year === 2020 ? `${year}-10-01` : `${year}-01-01`;
  const to = year === 2026 ? addDays(CUTOFF, -30) : `${year}-12-31`;
  return addDays(from, int(0, daysBetween(from, to)));
}

/**
 * Si se fue, cuándo. Nadie se va antes de los tres meses ni antes de que arranque la serie,
 * ni en el mes del corte: así la dotación al cierre de la serie es la de hoy.
 */
function exitDate(ingreso: string): string | null {
  const earliest = [addDays(ingreso, 90), FIRST_EXIT].sort().at(-1)!;
  const latest = addDays(`${CUTOFF.slice(0, 7)}-01`, -1);
  if (earliest >= latest) return null;
  const tenureAtCutoff = daysBetween(ingreso, CUTOFF) / 365.25;
  if (!chance(Math.min(0.5, 0.08 + tenureAtCutoff * 0.07))) return null;
  return addDays(earliest, int(0, daysBetween(earliest, latest)));
}

function region(incompleto: boolean): { region: string; amba: string } {
  const zone = weighted([
    ["CABA", 30],
    ["GBA", 29],
    ["AMBA", 4],
    ["Buenos Aires", 7],
    ["Interior", 20],
    ["Exterior", 6],
    ["", incompleto ? 8 : 0],
  ] as const);
  switch (zone) {
    case "CABA":
    case "AMBA":
      return { region: zone, amba: "0" };
    case "GBA":
      return { region: `GBA, ${pick(GBA)}`, amba: "0" };
    case "Buenos Aires":
      return { region: zone, amba: chance(0.5) ? "0" : "1" };
    case "Interior":
      return { region: pick(INTERIOR), amba: "1" };
    case "Exterior":
      return { region: pick(ABROAD), amba: "1" };
    default:
      return { region: "", amba: chance(0.5) ? "" : "0" };
  }
}

function yesNo(pYes: number, pBlank = 0): string {
  if (chance(pBlank)) return "";
  return chance(pYes) ? "Si" : "No";
}

/**
 * Como en una planilla real, los legajos incompletos son los de quienes ya se fueron: a
 * nadie le actualizan el área ni el proyecto después de la baja. Las personas activas
 * tienen siempre área, puesto, zona y género.
 */
function person(ingreso: string): Person {
  const egreso = exitDate(ingreso);
  const incompleto = egreso !== null;
  const area = weighted<Area | "">([
    ["Operación", 66],
    ["Estructura", 17],
    ["I+D", 9],
    ["", incompleto ? 20 : 0],
  ]);
  const role = area === "" ? (chance(0.5) ? null : weighted(ROLES["Operación"])) : weighted(ROLES[area]);
  const techs = role?.techs ?? ["N/A", ""];

  let categoria = "";
  if (role?.tecnico) categoria = chance(0.9) ? weighted(SENIORITY) : "";
  else if (role) categoria = chance(0.85) ? "N/A" : "";

  let proyecto = "";
  if (area === "I+D") proyecto = "I+D";
  else if (area === "Estructura") proyecto = !incompleto || chance(0.5) ? "Interno" : "";
  else if (role) proyecto = !incompleto || chance(0.8) ? weighted(CLIENTS) : "";

  const { region: r, amba } = region(incompleto);
  const edad = chance(0.05) ? null : Math.min(58, Math.max(22, Math.round(21 + random() * 16 + random() * random() * 22)));

  return {
    activo: egreso ? "No" : "Si",
    sexo: weighted([
      ["M", 70],
      ["F", 28],
      ["N", incompleto ? 2 : 0],
      ["", incompleto ? 3 : 0],
    ] as const),
    region: r,
    amba,
    hijes: chance(0.05) ? "" : chance(0.35) ? "Sí" : "No",
    ingreso,
    egreso,
    motivo_egreso: egreso ? weighted(EXIT_REASONS) : null,
    edad,
    antiguedad_anios: tenureYears(ingreso, egreso ?? CUTOFF),
    area,
    posicion: role?.posicion ?? null,
    categoria,
    tech_principal: role ? pick(techs) : chance(0.5) ? "N/A" : "",
    proyecto,
    ingles: chance(0.32) ? pick(ENGLISH) : "",
    entrevistador: yesNo(0.2),
    es_champion: yesNo(0.08),
    flock_talent: yesNo(0.15, 0.3),
    buddy: yesNo(0.25, 0.3),
  };
}

/**
 * Los únicos de su rol: una persona en la dirección de tecnología y otra en la de operaciones,
 * para que exista el caso de un corte que deja a una sola persona.
 */
function executives(): Person[] {
  const base = (posicion: string, ingreso: string, edad: number): Person => ({
    activo: "Si",
    sexo: posicion.includes("Technology") ? "F" : "M",
    region: "CABA",
    amba: "0",
    hijes: "Sí",
    ingreso,
    egreso: null,
    motivo_egreso: null,
    edad,
    antiguedad_anios: tenureYears(ingreso, CUTOFF),
    area: "Estructura",
    posicion,
    categoria: "N/A",
    tech_principal: "N/A",
    proyecto: "Interno",
    ingles: "C1",
    entrevistador: "Si",
    es_champion: "No",
    flock_talent: "",
    buddy: "",
  });
  return [base("Chief Technology Officer", "2025-07-14", 41), base("Chief Operating Officer", "2021-03-08", 45)];
}

// ---------------------------------------------------------------------------
// Control de movimientos
// ---------------------------------------------------------------------------

interface ControlMonth {
  mes: string;
  headcount_inicio: number;
  ingresos: number;
  bajas: number;
}

function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/**
 * Enero 2023 a octubre 2024, contado persona por persona: quiénes estaban el día 1, quiénes
 * entraron y quiénes se fueron en el mes. Es otra implementación de lo que hace
 * `buildMovimientos`, y por eso sirve de control.
 */
function controlSeries(people: Person[]): ControlMonth[] {
  const months: ControlMonth[] = [];
  for (let mes = "2023-01"; mes <= "2024-10"; mes = nextMonth(mes)) {
    const start = `${mes}-01`;
    const end = `${nextMonth(mes)}-01`;
    let headcount = 0;
    let ingresos = 0;
    let bajas = 0;
    for (const p of people) {
      const ingreso = String(p.ingreso);
      const egreso = p.egreso === null ? null : String(p.egreso);
      if (ingreso < start && (egreso === null || egreso >= start)) headcount++;
      if (ingreso >= start && ingreso < end) ingresos++;
      if (egreso !== null && egreso >= start && egreso < end) bajas++;
    }
    months.push({ mes, headcount_inicio: headcount, ingresos, bajas });
  }
  return months;
}

// ---------------------------------------------------------------------------

function main() {
  const execs = executives();
  const people: Person[] = [...execs];
  for (const [year, count] of HIRES_BY_YEAR) {
    // Los dos directivos ya ocupan su lugar en el año en que entraron.
    const taken = execs.filter((e) => String(e.ingreso).startsWith(String(year))).length;
    for (let i = 0; i < count - taken; i++) people.push(person(hireDate(year)));
  }
  if (people.length !== PEOPLE) throw new Error(`Se generaron ${people.length} personas, no ${PEOPLE}.`);

  const key = (r: Person) => COLUMNS.map((c) => String(r[c] ?? "")).join("|");
  people.sort((a, b) => key(a).localeCompare(key(b)));

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(OUT_DIR, "nomina.csv"),
    Papa.unparse({ fields: [...COLUMNS], data: people.map((r) => COLUMNS.map((c) => r[c] ?? "")) }) + "\n",
  );

  const control = controlSeries(people);
  fs.writeFileSync(path.join(OUT_DIR, "control-attrition-2023-2024.csv"), Papa.unparse(control) + "\n");

  const activas = people.filter((p) => p.activo === "Si").length;
  const meta = {
    fuente: "Nómina sintética",
    hojas: [],
    fechaCorte: CUTOFF,
    personas: people.length,
    activas,
    egresadas: people.length - activas,
  };
  fs.writeFileSync(path.join(OUT_DIR, "meta.json"), JSON.stringify(meta, null, 2) + "\n");

  const nombres = people.map(() => ({ nombre: pick(FIRST_NAMES), apellido: pick(LAST_NAMES) }));
  const cacheDir = path.join(ROOT, ".cache");
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, "nombres.json"), JSON.stringify(nombres));

  console.log(`Semilla:         ${SEED}`);
  console.log(`Fecha de corte:  ${meta.fechaCorte}`);
  console.log(`Personas:        ${meta.personas} (${meta.activas} activas, ${meta.egresadas} egresadas)`);
  console.log(`Control:         ${control.length} meses (${control[0]?.mes} a ${control.at(-1)?.mes})`);
  console.log(`Escrito:         data/nomina.csv, data/meta.json, data/control-attrition-2023-2024.csv, .cache/nombres.json`);
}

main();
