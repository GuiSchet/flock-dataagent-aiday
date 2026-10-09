import { z } from "zod";
import { findDimension, findMetric } from "@/lib/data/catalog";
import { QueryError, runQuery } from "@/lib/data/query";
import { DOMAIN_IDS, type Dimension, type Filter, type ResultSet, type TimeGrain } from "@/lib/data/types";
import type { ComposeContext } from "@/lib/viz/schema";
import {
  availableStats,
  foldText,
  resultStats,
  summarize,
  type ResultMeta,
  type ResultStats,
} from "./answers";
import {
  AgentIntentDeltaSchema,
  AgentIntentSchema,
  CHART_TYPES,
  FILTER_OPS,
  changedFields,
  describeFilters,
  describeIntent,
  mergeIntent,
  normalizeAgentIntent,
  validateIntent,
  type VizIntent,
} from "./intent";

/**
 * De lo que dijo el agente a filas listas para dibujar, del lado del servidor.
 *
 * El handler del client tool corre en el navegador, pero la validación no puede: el
 * catálogo de datos se arma leyendo `data/` con `node:fs`. Así que el handler reenvía los
 * parámetros crudos del agente y todo lo que depende del catálogo pasa acá: el parseo con
 * el Zod, el merge de un refinamiento, la validación semántica, la consulta y las
 * descripciones que se muestran y se dicen.
 *
 * El navegador guarda los `VizIntent` que salen de acá como dato opaco, y cuando los
 * devuelve —para refinar o para volver atrás— se vuelven a parsear: no se confía en nada
 * que haya cruzado la red.
 */

// ---------------------------------------------------------------------------
// Entrada
// ---------------------------------------------------------------------------

const CellValue = z.union([z.string(), z.number()]);

/** El `VizIntent` interno, para revalidar lo que vuelve del navegador. */
const VizIntentSchema = z.object({
  domain: z.enum(DOMAIN_IDS),
  metric: z.string(),
  groupBy: z.array(z.string()).max(2),
  filters: z.array(
    z.object({
      field: z.string(),
      op: z.enum(FILTER_OPS),
      value: z.union([CellValue, z.array(CellValue), z.null()]),
    }),
  ),
  sort: z.object({ by: z.enum(["metric", "dimension"]), dir: z.enum(["asc", "desc"]) }).nullable(),
  limit: z.number().int().min(1).max(50).nullable(),
  chartType: z.enum(CHART_TYPES),
  title: z.string(),
  assumptions: z.array(z.string()),
});

export type ResolveRequest =
  | { mode: "propose"; params: unknown }
  | { mode: "refine"; params: unknown; base: unknown }
  /** Re-ejecutar un intent que ya se resolvió antes: es como se vuelve atrás. */
  | { mode: "resolve"; intent: unknown };

// ---------------------------------------------------------------------------
// Salida
// ---------------------------------------------------------------------------

export interface Resolved {
  ok: true;
  intent: VizIntent;
  result: ResultSet;
  meta: ResultMeta;
  /** Lo que el agente entendió, en una línea: lo muestra el `IntentRibbon`. */
  description: string;
  /** Los filtros activos, o null si no hay. */
  subtitle: string | null;
  /** Lo que el agente dice apenas vuelve el tool, mientras el gráfico se dibuja. */
  summary: string;
  /** Los números que resumen el resultado, para los KpiTile (`/stats` del estado). */
  stats: ResultStats;
  /** Qué cambió respecto del intent anterior, en un refinamiento. */
  changed: string[];
  warnings: string[];
  /** La forma del resultado, sin valores, para el compositor. */
  shape: ComposeContext;
}

export interface Rejected {
  ok: false;
  message: string;
  suggestion?: string;
}

export type Resolution = Resolved | Rejected;

// ---------------------------------------------------------------------------
// Resolución
// ---------------------------------------------------------------------------

export function resolveVisualization(request: ResolveRequest): Resolution {
  const built = buildIntent(request);
  if (!built.ok) return built;

  const canonical = canonicalizeFilters(built.intent);
  if (!canonical.ok) return canonical;
  const intent = canonical.intent;

  const issues = validateIntent(intent);
  if (issues.length > 0) {
    const suggestions = [...new Set(issues.map((i) => i.suggestion).filter(Boolean))];
    return {
      ok: false,
      message: issues.map((i) => i.message).join(" "),
      ...(suggestions.length > 0 ? { suggestion: suggestions.join(" ") } : {}),
    };
  }

  let result: ResultSet;
  try {
    result = runQuery({
      domain: intent.domain,
      metric: intent.metric,
      groupBy: intent.groupBy,
      filters: intent.filters,
      sort: intent.sort,
      limit: intent.limit,
    });
  } catch (error) {
    if (error instanceof QueryError) {
      return {
        ok: false,
        message: error.message,
        ...(error.suggestion ? { suggestion: error.suggestion } : {}),
      };
    }
    throw error;
  }

  const subtitle = describeFilters(intent);

  // Principio III: un filtro sin resultados es un error que el agente explica, no un
  // gráfico vacío que el usuario tiene que interpretar.
  if (result.rowCount === 0) {
    return {
      ok: false,
      message: "Ningún registro cumple con esos filtros.",
      suggestion: subtitle
        ? `Los filtros activos son: ${subtitle}. Sacá o cambiá alguno.`
        : "Probá con otro corte.",
    };
  }

  const meta = buildMeta(intent, result);
  const stats = resultStats(result, meta);
  const warnings = result.provenance.warnings;

  return {
    ok: true,
    intent,
    result,
    meta,
    description: describeIntent(intent),
    subtitle,
    summary: summarize(result, meta),
    stats,
    changed: built.base ? changedFields(built.base, intent) : [],
    warnings,
    shape: buildShape(intent, result, meta, stats, subtitle),
  };
}

type Built = { ok: true; intent: VizIntent; base: VizIntent | null } | Rejected;

function buildIntent(request: ResolveRequest): Built {
  if (request.mode === "propose") {
    const parsed = AgentIntentSchema.safeParse(request.params);
    if (!parsed.success) return invalidParams(parsed.error);
    return { ok: true, intent: normalizeAgentIntent(parsed.data), base: null };
  }

  if (request.mode === "refine") {
    const base = VizIntentSchema.safeParse(request.base);
    if (!base.success) {
      return {
        ok: false,
        message: "No hay un gráfico en pantalla para modificar.",
        suggestion: "Generá uno nuevo con proposeVisualization.",
      };
    }
    const delta = AgentIntentDeltaSchema.safeParse(request.params);
    if (!delta.success) return invalidParams(delta.error);
    return { ok: true, intent: mergeIntent(base.data, delta.data), base: base.data };
  }

  const intent = VizIntentSchema.safeParse(request.intent);
  if (!intent.success) {
    return { ok: false, message: "El gráfico anterior no se pudo recuperar." };
  }
  return { ok: true, intent: intent.data, base: null };
}

function invalidParams(error: z.ZodError): Rejected {
  const detail = error.issues
    .map((i) => `${i.path.join(".") || "parámetros"}: ${i.message}`)
    .join("; ");
  return {
    ok: false,
    message: `Los parámetros del pedido no son válidos (${detail}).`,
    suggestion: "Revisá los ids de dominio, métrica y dimensiones con getDataCatalog.",
  };
}

// ---------------------------------------------------------------------------
// Valores de filtro
// ---------------------------------------------------------------------------

const MESES: Record<string, string> = {
  enero: "01", febrero: "02", marzo: "03", abril: "04", mayo: "05", junio: "06", julio: "07",
  agosto: "08", septiembre: "09", setiembre: "09", octubre: "10", noviembre: "11", diciembre: "12",
};

/**
 * Un mes dicho de cualquier forma razonable → `AAAA-MM`, que es como está en las filas.
 * "marzo 2024", "03/2024", "2024-3" y "2024-03" dan lo mismo. Un año solo queda como año:
 * lo expande `canonicalizeTemporal` según el operador.
 */
function toIsoMonth(raw: string): string | null {
  const text = foldText(raw).replace(/\s+de\s+/g, " ");
  let m = text.match(/^(\d{4})-(\d{1,2})$/);
  if (m) return `${m[1]}-${m[2]!.padStart(2, "0")}`;
  m = text.match(/^(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[2]}-${m[1]!.padStart(2, "0")}`;
  m = text.match(/^([a-z]+)\s+(\d{4})$/);
  if (m && MESES[m[1]!]) return `${m[2]}-${MESES[m[1]!]}`;
  if (/^\d{4}$/.test(text)) return text;
  return null;
}

/**
 * Los valores que dice una persona no vienen con la grafía del CSV: "mexico", "si",
 * "banco nandu". Si no se corrigen, un filtro `eq` da cero filas en silencio y el
 * gráfico queda vacío sin que nadie sepa por qué. Acá se llevan a la forma canónica, y lo
 * que no corresponde a ningún valor real se rechaza diciendo cuáles hay.
 */
function canonicalizeFilters(intent: VizIntent): { ok: true; intent: VizIntent } | Rejected {
  const filters: Filter[] = [];

  for (const filter of intent.filters) {
    const dim = findDimension(intent.domain, filter.field);
    // Un campo inexistente lo reporta validateIntent, con la lista de los que sí hay.
    if (!dim || filter.value === null || filter.op === "contains") {
      filters.push(filter);
      continue;
    }

    const outcome =
      dim.kind === "temporal" ? canonicalizeTemporal(filter, dim) : canonicalizeCategorical(filter, dim);
    if (!outcome.ok) return outcome;
    filters.push(outcome.filter);
  }

  return { ok: true, intent: { ...intent, filters } };
}

type FilterOutcome = { ok: true; filter: Filter } | Rejected;

function canonicalizeCategorical(filter: Filter, dim: Dimension): FilterOutcome {
  // Sin la lista de valores (cardinalidad alta) no hay contra qué corregir.
  if (!dim.values) return { ok: true, filter };

  const byFolded = new Map(dim.values.map((v) => [foldText(v), v]));
  const list = Array.isArray(filter.value) ? filter.value : [filter.value!];
  const canonical: string[] = [];

  for (const raw of list) {
    const hit = byFolded.get(foldText(String(raw)));
    if (!hit) {
      return {
        ok: false,
        message: `"${raw}" no es un valor de ${dim.label}.`,
        suggestion: `Los valores posibles son: ${dim.values.join(", ")}.`,
      };
    }
    canonical.push(hit);
  }

  return {
    ok: true,
    filter: { ...filter, value: Array.isArray(filter.value) ? canonical : canonical[0]! },
  };
}

/**
 * Un trimestre dicho de cualquier forma razonable → `AAAA-Qn`. "2024-Q1", "Q1 2024" y "1T
 * 2024" dan lo mismo; un mes se lleva a su trimestre. Un año solo queda como año.
 */
function toIsoQuarter(raw: string): string | null {
  const text = foldText(raw).replace(/\s+de\s+/g, " ");
  let m = text.match(/^(\d{4})\s*-?\s*[qt]([1-4])$/);
  if (m) return `${m[1]}-Q${m[2]}`;
  m = text.match(/^(?:[qt]([1-4])|([1-4])\s*[qt])\s*(\d{4})$/);
  if (m) return `${m[3]}-Q${m[1] ?? m[2]}`;
  const month = toIsoMonth(raw);
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    const [y, mo] = month.split("-").map(Number) as [number, number];
    return `${y}-Q${Math.floor((mo - 1) / 3) + 1}`;
  }
  return month;
}

const PERIOD_FORMAT: Record<TimeGrain, { parse: (raw: string) => string | null; hint: string; first: string; last: string }> = {
  month: { parse: toIsoMonth, hint: "Los meses van como AAAA-MM, por ejemplo 2024-03.", first: "-01", last: "-12" },
  quarter: { parse: toIsoQuarter, hint: "Los trimestres van como AAAA-Qn, por ejemplo 2024-Q1.", first: "-Q1", last: "-Q4" },
  year: {
    parse: (raw) => foldText(raw).match(/(\d{4})/)?.[1] ?? null,
    hint: "Los años van con cuatro cifras, por ejemplo 2024.",
    first: "",
    last: "",
  },
};

function canonicalizeTemporal(filter: Filter, dim: Dimension): FilterOutcome {
  const grain = dim.grain ?? "month";
  const format = PERIOD_FORMAT[grain];
  const list = Array.isArray(filter.value) ? filter.value : [filter.value!];
  const periods: string[] = [];

  for (const raw of list) {
    const iso = format.parse(String(raw));
    if (!iso) {
      return {
        ok: false,
        message: `"${raw}" no es un período que se pueda usar para filtrar ${dim.label.toLowerCase()}.`,
        suggestion: format.hint,
      };
    }
    periods.push(iso);
  }

  // Un año dicho sobre una dimensión más fina es un rango: de su primer a su último período.
  const isYear = (v: string) => grain !== "year" && /^\d{4}$/.test(v);
  const from = (v: string) => (isYear(v) ? `${v}${format.first}` : v);
  const to = (v: string) => (isYear(v) ? `${v}${format.last}` : v);

  switch (filter.op) {
    case "gte":
      return { ok: true, filter: { ...filter, value: from(periods[0]!) } };
    case "lte":
      return { ok: true, filter: { ...filter, value: to(periods[0]!) } };
    case "between": {
      const lo = periods[0]!;
      const hi = periods[1] ?? lo;
      return { ok: true, filter: { ...filter, value: [from(lo), to(hi)] } };
    }
    case "eq":
      // "Los que entraron en 2024" es un rango, no un mes llamado "2024".
      if (isYear(periods[0]!)) {
        return { ok: true, filter: { ...filter, op: "between", value: [from(periods[0]!), to(periods[0]!)] } };
      }
      return { ok: true, filter: { ...filter, value: periods[0]! } };
    default:
      return { ok: true, filter: { ...filter, value: Array.isArray(filter.value) ? periods : periods[0]! } };
  }
}

// ---------------------------------------------------------------------------
// Descripciones del resultado
// ---------------------------------------------------------------------------

/** Agregaciones cuya suma entre categorías significa algo. */
const ADDITIVE = new Set(["count", "sum", "share"]);

export function buildMeta(intent: Pick<VizIntent, "domain" | "metric">, result: ResultSet): ResultMeta {
  // validateIntent ya garantizó que la métrica y las dimensiones existen.
  const metric = findMetric(intent.domain, intent.metric)!;
  const primaryId = result.dimensionKeys[0];
  const primary = primaryId ? findDimension(intent.domain, primaryId) : undefined;

  return {
    metricLabel: metric.label,
    unit: metric.unit,
    format: metric.format,
    additive: ADDITIVE.has(metric.agg),
    labelKey: primary?.id ?? null,
    labelName: primary?.label ?? null,
    valueKeys: result.seriesKeys.length > 0 ? result.seriesKeys : [result.metricKey],
  };
}

/**
 * La forma del resultado para el compositor: qué columnas hay y qué significan.
 *
 * Nunca los valores. Los nombres de serie sí viajan —son etiquetas de categoría, y el
 * modelo necesita saber qué claves referenciar—, pero ningún número.
 */
function buildShape(
  intent: VizIntent,
  result: ResultSet,
  meta: ResultMeta,
  stats: ResultStats,
  subtitle: string | null,
): ComposeContext {
  const columns: NonNullable<ComposeContext["columns"]> = [];

  if (meta.labelKey) {
    columns.push({ key: meta.labelKey, label: meta.labelName ?? meta.labelKey, kind: "dimension" });
  }

  const seriesDim = intent.groupBy[1] ? findDimension(intent.domain, intent.groupBy[1]) : undefined;
  for (const key of meta.valueKeys) {
    columns.push({
      key,
      label: seriesDim ? `${meta.metricLabel} · ${seriesDim.label}: ${key}` : meta.metricLabel,
      kind: "metric",
      format: meta.format,
      unit: meta.unit,
    });
  }

  const { domainLabel, rowsMatched, rowsTotal } = result.provenance;
  const provenance = [`${domainLabel} · ${rowsMatched} de ${rowsTotal} registros`, subtitle]
    .filter(Boolean)
    .join(" · ");

  // Qué hay en `/stats`, sin los valores. Sólo las claves que existen: un total de una
  // métrica que no se suma no se ofrece.
  const metric = meta.metricLabel.toLowerCase();
  const dimension = (meta.labelName ?? "categorías").toLowerCase();
  const STATS_LABEL: Record<string, string> = {
    total: `Total de ${metric}, sumando todas las categorías`,
    max: `El valor más alto de ${metric} entre las categorías`,
    min: `El valor más bajo de ${metric} entre las categorías`,
    avg: `Promedio de ${metric} por categoría`,
    count: `Cantidad de valores de ${dimension} en el gráfico`,
  };
  const statsColumns = availableStats(stats).map((key) => ({
    key,
    label: STATS_LABEL[key] ?? key,
    kind: "metric" as const,
    format: key === "count" ? "integer" : key === "avg" ? "decimal1" : meta.format,
    ...(key === "count" ? {} : { unit: meta.unit }),
  }));

  return {
    columns,
    stats: statsColumns,
    rowCount: result.rowCount,
    chartType: intent.chartType,
    title: intent.title,
    subtitle,
    provenance,
    warnings: result.provenance.warnings,
  };
}
