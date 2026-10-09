import { readMeta, type SourceMeta } from "./ingest";
import { buildMovimientos } from "./movimientos";
import {
  AGE_BANDS,
  ENGLISH_ORDER,
  normalizeNomina,
  SENIORITY_ORDER,
  TENURE_BANDS,
} from "./normalize";
import type {
  Dimension,
  Domain,
  DomainId,
  Metric,
  Row,
  UnavailableField,
} from "./types";

/**
 * El catálogo: lo único que el agente de voz sabe del corpus.
 *
 * Las descripciones no son documentación decorativa — van al prompt del LLM, así que
 * tienen que decir cuándo conviene usar cada campo, no solo qué es. La cardinalidad y la
 * cobertura se calculan sobre los datos reales en vez de hardcodearse: si se reimporta la
 * nómina, el agente se entera.
 */

/** Definición estática; cardinalidad y cobertura se completan desde los datos. */
type DimensionSpec = Omit<Dimension, "cardinality" | "coverage" | "values">;
type MetricSpec = Omit<Metric, "coverage">;

/** Por encima de esto no se enumeran los valores en el prompt (ocuparía demasiado). */
const MAX_ENUMERATED_VALUES = 15;

// ---------------------------------------------------------------------------
// Nómina
// ---------------------------------------------------------------------------

const NOMINA_DIMENSIONS: DimensionSpec[] = [
  {
    id: "activo",
    label: "Estado",
    kind: "categorical",
    description: "Si la persona sigue en la empresa (Sí) o ya egresó (No).",
  },
  {
    id: "area",
    label: "Área",
    kind: "categorical",
    description:
      "Área de la empresa: Operación, Estructura o I+D. Es el corte más general de la estructura.",
  },
  {
    id: "rol",
    label: "Rol",
    kind: "categorical",
    description:
      "Familia de rol, que agrupa la posición: Ingeniería de software, QA, Producto y análisis, I+D, Gestión y dirección, Comercial, People. Para una vista general de la estructura, preferir esto sobre la posición exacta.",
  },
  {
    id: "posicion",
    label: "Posición",
    kind: "categorical",
    description:
      "El puesto exacto (Software Engineering, Team Manager, Chief Technology Officer…). Tiene muchos valores y varios son de una sola persona: para un gráfico conviene limitar a los principales o filtrar.",
  },
  {
    id: "seniority",
    label: "Seniority",
    kind: "categorical",
    order: SENIORITY_ORDER,
    description:
      "Nivel: Trainee, Junior, Semi Senior, Senior. 'No aplica' son los roles sin escalafón técnico (gestión, comercial, People). Se ordena de menor a mayor.",
  },
  {
    id: "tech_principal",
    label: "Tecnología principal",
    kind: "categorical",
    description:
      "La tecnología principal de cada persona técnica: Java, .NET, Angular, QA, etc. Los roles no técnicos no tienen dato y aparecen como 'Sin dato'.",
  },
  {
    id: "proyecto",
    label: "Proyecto",
    kind: "categorical",
    description:
      "El proyecto o cliente en el que trabaja la persona (el último, para quienes egresaron): Aseguradora Tero, Banco Ñandú, Retail Calafate, I+D, Interno, etc. Para la foto de hoy, filtrar activos.",
  },
  {
    id: "nivel_ingles",
    label: "Nivel de inglés",
    kind: "categorical",
    order: ENGLISH_ORDER,
    description:
      "Nivel de inglés agrupado: Básico (A), Intermedio (B), Avanzado (C). ATENCIÓN: solo un tercio de la nómina lo tiene cargado; avisarlo siempre.",
  },
  {
    id: "genero",
    label: "Género",
    kind: "categorical",
    description: "Masculino, Femenino o No binario.",
  },
  {
    id: "region",
    label: "Región",
    kind: "categorical",
    description:
      "Zona de residencia normalizada: CABA, GBA, Buenos Aires, Interior, Exterior.",
  },
  {
    id: "zona_amba",
    label: "AMBA / Fuera de AMBA",
    kind: "categorical",
    description:
      "Corte autoritativo entre quienes viven en AMBA y quienes no. Preferir esto sobre region cuando la pregunta es si alguien está o no en el área metropolitana.",
  },
  {
    id: "hijes",
    label: "Tiene hijes",
    kind: "categorical",
    description: "Si la persona tiene hijes.",
  },
  {
    id: "rango_edad",
    label: "Rango etario",
    kind: "categorical",
    order: AGE_BANDS,
    description: "Tramos de edad. Usar esto en vez de la edad exacta para agrupar.",
  },
  {
    id: "rango_antiguedad",
    label: "Rango de antigüedad",
    kind: "categorical",
    order: TENURE_BANDS,
    description: "Tramos de antigüedad en la empresa.",
  },
  {
    id: "motivo_egreso",
    label: "Motivo de egreso",
    kind: "categorical",
    description:
      "Por qué se fue cada persona. Solo tiene dato en quienes egresaron; usarlo implica mirar únicamente egresos.",
  },
  {
    id: "entrevistador",
    label: "Es entrevistador",
    kind: "categorical",
    description: "Si la persona participa como entrevistadora en los procesos de selección.",
  },
  {
    id: "es_champion",
    label: "Es champion",
    kind: "categorical",
    description: "Si la persona cumple el rol de champion de otros flockers.",
  },
  {
    id: "flock_talent",
    label: "Flock Talent",
    kind: "categorical",
    description: "Si la persona participa del programa Flock Talent.",
  },
  {
    id: "buddy",
    label: "Es buddy",
    kind: "categorical",
    description: "Si la persona tiene el rol de buddy.",
  },
  {
    id: "mes_ingreso",
    label: "Mes de ingreso",
    kind: "temporal",
    description: "Mes en que la persona entró. Es la dimensión para graficar altas de personas con sus atributos.",
  },
  {
    id: "anio_ingreso",
    label: "Año de ingreso",
    kind: "temporal",
    grain: "year",
    description: "Año en que la persona entró. Para ver las altas por año, o cortarlas por área, rol o seniority.",
  },
  {
    id: "mes_egreso",
    label: "Mes de egreso",
    kind: "temporal",
    description:
      "Mes en que la persona se fue. Solo tiene dato en egresados. Para la evolución de bajas y el attrition en el tiempo, preferir el dominio movimientos.",
  },
  {
    id: "anio_egreso",
    label: "Año de egreso",
    kind: "temporal",
    grain: "year",
    description: "Año en que la persona se fue. Solo tiene dato en egresados; sirve para cortar las bajas por año y por motivo, área o rol.",
  },
];

const NOMINA_METRICS: MetricSpec[] = [
  {
    id: "headcount",
    label: "Personas",
    agg: "count",
    unit: "personas",
    format: "integer",
    description: "Cantidad total de personas, activas y egresadas.",
  },
  {
    id: "headcount_activo",
    label: "Personas activas",
    agg: "count",
    filter: { field: "activo", op: "eq", value: "Sí" },
    unit: "personas",
    format: "integer",
    description:
      "Cantidad de personas que siguen en la empresa. Es la métrica por defecto cuando alguien pregunta por la dotación.",
  },
  {
    id: "egresos",
    label: "Egresos",
    agg: "count",
    filter: { field: "activo", op: "eq", value: "No" },
    unit: "personas",
    format: "integer",
    description: "Cantidad de personas que se fueron. Combinar con motivo_egreso, área o rol.",
  },
  {
    id: "antiguedad_prom",
    label: "Antigüedad promedio",
    agg: "avg",
    field: "antiguedad_anios",
    unit: "años",
    format: "decimal1",
    description: "Promedio de años en la empresa (hasta el egreso, para quienes se fueron).",
  },
  {
    id: "edad_prom",
    label: "Edad promedio",
    agg: "avg",
    field: "edad",
    unit: "años",
    format: "decimal1",
    description: "Promedio de edad.",
  },
  {
    id: "pct_activos",
    label: "% de activos",
    agg: "ratio",
    filter: { field: "activo", op: "eq", value: "Sí" },
    unit: "%",
    format: "percent",
    description:
      "Qué proporción de cada grupo sigue activa. Sirve para comparar retención entre áreas, roles o rangos.",
  },
  {
    id: "pct_mujeres",
    label: "% de mujeres",
    agg: "ratio",
    filter: { field: "genero", op: "eq", value: "Femenino" },
    unit: "%",
    format: "percent",
    description:
      "Qué proporción de cada grupo son mujeres. Es la métrica de diversidad de género; para la foto de hoy, filtrar activos.",
  },
  {
    id: "pct_del_total",
    label: "% del total",
    agg: "share",
    unit: "%",
    format: "percent",
    description: "Qué porcentaje del total representa cada grupo. Ideal para tortas.",
  },
];

const NOMINA_UNAVAILABLE: UnavailableField[] = [
  {
    field:
      "Nombre, apellido, correo, CUIL, dirección, teléfono, contacto de emergencia, fecha de nacimiento, referentes y champions asignados",
    reason:
      "No existen en los datos, así que no hay consulta que los traiga: nunca se puede decir quién es alguien por nombre y apellido.",
    personal: true,
  },
  {
    field: "Salario, bonos, bandas salariales",
    reason: "No se importan: son datos sensibles por persona y no están en la nómina.",
    suggestion: "seniority",
  },
];

// ---------------------------------------------------------------------------
// Movimientos
// ---------------------------------------------------------------------------

const MOVIMIENTOS_DIMENSIONS: DimensionSpec[] = [
  {
    id: "mes",
    label: "Mes",
    kind: "temporal",
    grain: "month",
    description: "Cada mes desde enero 2023 hasta el último mes completo. Es el corte por defecto para ver la evolución.",
  },
  {
    id: "trimestre",
    label: "Trimestre",
    kind: "temporal",
    grain: "quarter",
    description: "Trimestre calendario. Para ver la tendencia con menos ruido que por mes.",
  },
  {
    id: "anio",
    label: "Año",
    kind: "temporal",
    grain: "year",
    description: "Año calendario. Para comparar años completos.",
  },
];

const MOVIMIENTOS_METRICS: MetricSpec[] = [
  {
    id: "dotacion",
    label: "Dotación",
    agg: "avg",
    field: "dotacion_fin",
    unit: "personas",
    format: "integer",
    description:
      "Personas en la empresa al cierre del mes. Por trimestre o año es el promedio de los cierres mensuales. Es la métrica para '¿cómo evolucionó la dotación?'.",
  },
  {
    id: "ingresos",
    label: "Ingresos",
    agg: "sum",
    field: "ingresos",
    unit: "personas",
    format: "integer",
    description: "Personas que entraron en el período.",
  },
  {
    id: "egresos",
    label: "Egresos",
    agg: "sum",
    field: "egresos",
    unit: "personas",
    format: "integer",
    description: "Personas que se fueron en el período.",
  },
  {
    id: "attrition",
    label: "Attrition mensual",
    agg: "avg",
    field: "attrition_pct",
    unit: "%",
    format: "percent",
    description:
      "Bajas del mes sobre la dotación promedio del mes. Por trimestre o año es el promedio mensual. RR.HH. espera entre 0 % y 5 % mensual; lo ideal es 0 %.",
  },
  {
    id: "attrition_12m",
    label: "Attrition de 12 meses",
    agg: "avg",
    field: "attrition_12m",
    unit: "%",
    format: "percent",
    description:
      "Bajas de los últimos 12 meses sobre la dotación promedio de esos 12 meses, calculado a cada mes. Usar por mes; es el número para '¿cuánto attrition tuvimos en el último año?'. Existe desde diciembre 2023.",
  },
  {
    id: "desercion",
    label: "Deserción",
    agg: "avg",
    field: "desercion_pct",
    unit: "%",
    format: "percent",
    description:
      "Bajas del mes sobre la dotación al inicio del mes. Parecida al attrition; RR.HH. espera entre 0 % y 5 %.",
  },
  {
    id: "rotacion",
    label: "Rotación",
    agg: "avg",
    field: "rotacion_pct",
    unit: "%",
    format: "percent",
    description:
      "Bajas menos ingresos, sobre la dotación al inicio del mes. Negativa quiere decir que la dotación creció, que es lo esperado; cero también es una situación sana.",
  },
];

const MOVIMIENTOS_UNAVAILABLE: UnavailableField[] = [
  {
    field: "Movimientos anteriores a 2023",
    reason: "La nómina no tiene los egresos anteriores a 2023, así que la serie arranca en enero 2023.",
    suggestion: "mes",
  },
  {
    field: "Movimientos por área, rol o motivo",
    reason: "Este dominio son totales mensuales. Los egresos por área, rol o motivo están en la nómina.",
    suggestion: "egresos",
  },
];

// ---------------------------------------------------------------------------
// Armado del catálogo
// ---------------------------------------------------------------------------

function buildDimension(spec: DimensionSpec, rows: Row[]): Dimension {
  const present = rows.filter((r) => r[spec.id] !== null && r[spec.id] !== undefined);
  const distinct = new Set(present.map((r) => String(r[spec.id])));
  const rank = (v: string) => {
    const i = spec.order?.indexOf(v) ?? -1;
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  const values = [...distinct].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, "es-AR"));

  return {
    ...spec,
    cardinality: distinct.size,
    coverage: rows.length === 0 ? 0 : present.length / rows.length,
    ...(values.length <= MAX_ENUMERATED_VALUES ? { values } : {}),
  };
}

function buildMetric(spec: MetricSpec, rows: Row[]): Metric {
  // La cobertura de una métrica es la de la columna que agrega. Para conteos, todas las
  // filas cuentan, así que es 1.
  let coverage = 1;
  if (spec.field) {
    const present = rows.filter(
      (r) => r[spec.field!] !== null && r[spec.field!] !== undefined,
    );
    coverage = rows.length === 0 ? 0 : present.length / rows.length;
  }
  return { ...spec, coverage };
}

function buildDomain(
  id: DomainId,
  label: string,
  description: string,
  rows: Row[],
  dimensions: DimensionSpec[],
  metrics: MetricSpec[],
  unavailable: UnavailableField[],
): Domain {
  return {
    id,
    label,
    description,
    rowCount: rows.length,
    rows,
    dimensions: dimensions.map((d) => buildDimension(d, rows)),
    metrics: metrics.map((m) => buildMetric(m, rows)),
    unavailable,
  };
}

// Los datos no cambian mientras el proceso vive, así que se normalizan una sola vez.
let cache: Record<DomainId, Domain> | null = null;
let metaCache: SourceMeta | null = null;

/** De dónde salen los datos y hasta cuándo valen. */
export function getSourceMeta(): SourceMeta {
  metaCache ??= readMeta();
  return metaCache;
}

export function getDomains(): Record<DomainId, Domain> {
  if (!cache) {
    const nomina = normalizeNomina();
    cache = {
      nomina: buildDomain(
        "nomina",
        "Nómina",
        "Una nómina sintética con la forma de la de Flock (personas y clientes inventados), activas y egresadas: dotación, estructura (área, rol, posición, seniority, proyecto), tecnología e inglés, perfil (edad, género, región, hijes) y egresos con su motivo. No tiene nombres ni datos de contacto de nadie.",
        nomina,
        NOMINA_DIMENSIONS,
        NOMINA_METRICS,
        NOMINA_UNAVAILABLE,
      ),
      movimientos: buildDomain(
        "movimientos",
        "Movimientos",
        "La evolución mensual de la dotación desde enero 2023: dotación, ingresos, egresos, attrition, deserción y rotación. Es el dominio para las preguntas de tendencia en el tiempo.",
        buildMovimientos(nomina, getSourceMeta().fechaCorte),
        MOVIMIENTOS_DIMENSIONS,
        MOVIMIENTOS_METRICS,
        MOVIMIENTOS_UNAVAILABLE,
      ),
    };
  }
  return cache;
}

export function getDomain(id: DomainId): Domain {
  const domain = getDomains()[id];
  if (!domain) throw new Error(`Dominio desconocido: ${id}`);
  return domain;
}

export function findDimension(domainId: DomainId, id: string): Dimension | undefined {
  return getDomain(domainId).dimensions.find((d) => d.id === id);
}

export function findMetric(domainId: DomainId, id: string): Metric | undefined {
  return getDomain(domainId).metrics.find((m) => m.id === id);
}

/**
 * La vista del catálogo que se le manda al agente y al prompt: sin las filas.
 * Mandar `rows` sería exactamente lo que el principio III prohíbe.
 */
export function getCatalogSummary() {
  const domains = Object.values(getDomains());
  return {
    domains: domains.map((d) => ({
      id: d.id,
      label: d.label,
      description: d.description,
      rowCount: d.rowCount,
      dimensions: d.dimensions.map(({ id, label, kind, description, cardinality, coverage, values }) => ({
        id, label, kind, description,
        cardinality,
        coverage: Number(coverage.toFixed(2)),
        ...(values ? { values } : {}),
      })),
      metrics: d.metrics.map(({ id, label, unit, format, description, coverage }) => ({
        id, label, unit, format, description,
        coverage: Number(coverage.toFixed(2)),
      })),
    })),
    unavailable: domains.flatMap((d) =>
      d.unavailable.map((u) => ({ domain: d.id, ...u })),
    ),
  };
}

/** Sólo para tests: descarta la caché para releer los datos. */
export function __resetCatalogCache() {
  cache = null;
  metaCache = null;
}
