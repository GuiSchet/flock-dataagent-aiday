import { z } from "zod";
import { findDimension, findMetric, getDomain } from "@/lib/data/catalog";
import { formatLabel } from "@/lib/data/format";
import { MAX_SERIES } from "@/lib/viz/palette";
import { DOMAIN_IDS, type DomainId, type Filter, type FilterOp, type SortSpec } from "@/lib/data/types";

/**
 * La intención de visualización: el límite entre lo que un modelo decide y lo que el motor
 * calcula.
 *
 * Quien la produce es el agente de voz de ElevenLabs — el schema de abajo es literalmente
 * el de los parámetros del client tool `proposeVisualization`. No hay una llamada aparte a
 * un LLM para interpretar lo hablado: el tool call ya *es* la intención, estructurada.
 *
 * Lo que llega del agente se aplana un poco respecto de la forma interna, porque un agente
 * de voz llena mejor campos simples que objetos anidados. Acá se normaliza.
 */

// ---------------------------------------------------------------------------
// Lo que manda el agente
// ---------------------------------------------------------------------------

export const FILTER_OPS = [
  "eq", "neq", "in", "nin", "gte", "lte", "between", "contains",
] as const;

export const CHART_TYPES = [
  "bar", "barGrouped", "barStacked", "line", "area",
  "pie", "donut", "scatter", "composed", "kpi", "table",
] as const;

export type ChartType = (typeof CHART_TYPES)[number];

/** Operadores que admiten varios valores separados por coma. */
const MULTI_VALUE_OPS = new Set<FilterOp>(["in", "nin", "between"]);

// Las descripciones no son decorativas: ElevenLabs exige una en cada campo, y es lo único
// que el agente lee para saber cómo llenarlo. Los límites que su dialecto de JSON Schema no
// admite (`max`, `min`) se enuncian acá; los sigue haciendo cumplir este mismo Zod.
//
// Los campos se declaran SIN defaults y los defaults se agregan aparte, sólo en el schema de
// `proposeVisualization`. En Zod 4 un `.default()` se aplica aunque el campo esté envuelto en
// `.partial()`, así que un delta derivado del schema completo llegaría con `groupBy: []`,
// `sortBy: "default"` y `limit: null` rellenados, y cada refinamiento borraría el corte y el
// orden que el usuario ya había elegido.
const fields = {
  domain: z
    .enum(DOMAIN_IDS)
    .describe(
      "El dominio de datos: 'nomina' (las personas: estructura, perfil, tecnología y egresos con su motivo) o 'movimientos' (la evolución mes a mes de la dotación: ingresos, egresos y attrition).",
    ),
  metric: z.string().describe("Id de la métrica a medir, tal como lo devuelve getDataCatalog."),
  groupBy: z
    .array(z.string().describe("Id de una dimensión, tal como lo devuelve getDataCatalog."))
    .max(2)
    .describe(
      "Dimensiones por las que se corta, como máximo dos: la primera es el eje y la segunda las series. Vacío si el resultado es un número solo.",
    ),
  filters: z
    .array(
      z.object({
        field: z.string().describe("Id de la dimensión por la que se filtra, tal como lo devuelve getDataCatalog."),
        op: z
          .enum(FILTER_OPS)
          .describe(
            "Operador: eq (igual), neq (distinto), in / nin (está / no está en la lista), gte (mayor o igual), lte (menor o igual), between (entre dos valores), contains (contiene el texto).",
          ),
        // String aunque represente varios valores: un agente de voz llena peor un array
        // de tipos mezclados que una lista separada por comas.
        value: z
          .string()
          .describe(
            "Valor del filtro, con la grafía que devuelve getDataCatalog. Los meses van como AAAA-MM (por ejemplo 2024-03). Para in, nin y between, varios valores separados por coma (between: 'desde,hasta'). Vacío para sacar un filtro que ya estaba.",
          ),
      }),
    )
    .describe("Filtros a aplicar. Vacío si no hay ninguno."),
  sortBy: z
    .enum(["metric", "dimension", "default"])
    .describe(
      "Por qué ordenar: 'metric' (por el valor), 'dimension' (alfabético o cronológico) o 'default' (que decida el motor según el tipo de dimensión).",
    ),
  sortDir: z.enum(["asc", "desc"]).describe("Sentido del orden. Por defecto 'desc'."),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .nullable()
    .describe("Cuántas categorías mostrar como máximo, entre 1 y 50. Null o ausente para mostrarlas todas."),
  chartType: z
    .enum(CHART_TYPES)
    .describe(
      "Tipo de gráfico. kpi para un número solo, sin corte; pie y donut con exactamente una dimensión; barGrouped, barStacked y composed con exactamente dos.",
    ),
  title: z.string().describe("Título corto del gráfico, en español."),
  assumptions: z
    .array(z.string().describe("Una decisión, en una frase corta."))
    .describe(
      "Decisiones cosméticas que tomaste sin preguntar (orden, tipo de gráfico, cuántos mostrar), para que el usuario sepa leer el gráfico.",
    ),
};

export const AgentIntentSchema = z.object({
  ...fields,
  groupBy: fields.groupBy.default([]),
  filters: fields.filters.default([]),
  sortBy: fields.sortBy.default("default"),
  sortDir: fields.sortDir.default("desc"),
  limit: fields.limit.default(null),
  assumptions: fields.assumptions.default([]),
});

export type AgentIntent = z.infer<typeof AgentIntentSchema>;

/** Los mismos campos, todos opcionales y sin defaults: lo que manda `refineVisualization`. */
export const AgentIntentDeltaSchema = z.object(fields).partial();

export type AgentIntentDelta = z.infer<typeof AgentIntentDeltaSchema>;

// ---------------------------------------------------------------------------
// La forma interna
// ---------------------------------------------------------------------------

export interface VizIntent {
  domain: DomainId;
  metric: string;
  groupBy: string[];
  filters: Filter[];
  sort: SortSpec | null;
  limit: number | null;
  chartType: ChartType;
  title: string;
  assumptions: string[];
}

/** `"8,5"` y `"8.5"` dan 8.5; `"Argentina"` se queda como está. */
function coerce(raw: string): string | number {
  const trimmed = raw.trim();
  if (trimmed === "") return trimmed;
  const asNumber = Number(trimmed.replace(",", "."));
  return Number.isFinite(asNumber) && /^-?[\d.,]+$/.test(trimmed) ? asNumber : trimmed;
}

function normalizeFilter(raw: { field: string; op: FilterOp; value: string }): Filter {
  if (MULTI_VALUE_OPS.has(raw.op)) {
    const parts = raw.value
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v !== "");
    return { field: raw.field, op: raw.op, value: parts.map(coerce) };
  }
  return { field: raw.field, op: raw.op, value: coerce(raw.value) };
}

export function normalizeAgentIntent(agent: AgentIntent): VizIntent {
  return {
    domain: agent.domain,
    metric: agent.metric,
    groupBy: agent.groupBy,
    filters: agent.filters.map(normalizeFilter),
    // "default" significa "que decida el motor según el tipo de dimensión": una serie
    // temporal se lee cronológicamente y una categórica de mayor a menor.
    sort: agent.sortBy === "default" ? null : { by: agent.sortBy, dir: agent.sortDir },
    limit: agent.limit,
    chartType: agent.chartType,
    title: agent.title,
    assumptions: agent.assumptions,
  };
}

// ---------------------------------------------------------------------------
// Validación semántica
// ---------------------------------------------------------------------------

export interface IntentIssue {
  message: string;
  /** Qué ofrecerle al usuario en su lugar. El agente lo dice en voz. */
  suggestion?: string;
}

/**
 * Las reglas que ningún schema puede expresar, porque dependen de los datos.
 *
 * Es la red de seguridad de que el agente obedeció su prompt. La repregunta vive allá —el
 * agente no llama al tool hasta tener lo que necesita—, pero si igual llama con algo
 * incompleto o inventado, acá se corta: nunca se dibuja sobre una suposición silenciosa.
 */
export function validateIntent(intent: VizIntent): IntentIssue[] {
  const issues: IntentIssue[] = [];
  const domain = getDomain(intent.domain);

  // 1. La métrica existe.
  const metric = findMetric(intent.domain, intent.metric);
  if (!metric) {
    issues.push({
      message: `La métrica "${intent.metric}" no existe en ${domain.label}.`,
      suggestion: `Las disponibles son: ${domain.metrics.map((m) => m.label).join(", ")}.`,
    });
  }

  // 2. Las dimensiones del corte existen.
  const dims = intent.groupBy.map((id) => findDimension(intent.domain, id));
  intent.groupBy.forEach((id, i) => {
    if (!dims[i]) {
      issues.push({
        message: `No se puede cortar por "${id}": esa dimensión no existe en ${domain.label}.`,
        suggestion: `Se puede cortar por: ${domain.dimensions.map((d) => d.label).join(", ")}.`,
      });
    }
  });

  // Los campos de los filtros también.
  for (const f of intent.filters) {
    if (!findDimension(intent.domain, f.field)) {
      issues.push({
        message: `No se puede filtrar por "${f.field}": ese campo no existe en ${domain.label}.`,
        suggestion: `Se puede filtrar por: ${domain.dimensions.map((d) => d.label).join(", ")}.`,
      });
    }
  }

  const n = intent.groupBy.length;

  // 3. Sin corte, es un número solo.
  if (n === 0 && intent.chartType !== "kpi") {
    issues.push({
      message: "Sin ninguna dimensión de corte el resultado es un solo número.",
      suggestion: "Usá chartType 'kpi', o agregá una dimensión para cortar.",
    });
  }

  // 4. Torta y dona: una sola dimensión.
  if ((intent.chartType === "pie" || intent.chartType === "donut") && n !== 1) {
    issues.push({
      message: "Una torta muestra la composición de un total: necesita exactamente una dimensión.",
      suggestion: n > 1 ? "Con dos dimensiones usá barras apiladas." : "Agregá la dimensión de corte.",
    });
  }

  // 5. Apiladas, agrupadas y combinadas: dos.
  if (["barStacked", "barGrouped", "composed"].includes(intent.chartType) && n !== 2) {
    issues.push({
      message: `Un gráfico ${intent.chartType} compara series: necesita dos dimensiones.`,
      suggestion: "Agregá la segunda dimensión, o usá barras simples.",
    });
  }

  // 6. La paleta de Flock distingue siete series y no se inventan colores.
  const series = dims[1];
  if (series && series.cardinality > MAX_SERIES) {
    issues.push({
      message: `"${series.label}" tiene ${series.cardinality} valores y la paleta distingue ${MAX_SERIES} series.`,
      suggestion: `Filtrá ${series.label.toLowerCase()} o usá esa dimensión como eje en vez de como serie.`,
    });
  }

  return issues;
}

/** Cobertura baja: no invalida, pero el agente tiene que avisarlo (regla 7). */
export function coverageWarning(intent: VizIntent): string | null {
  const metric = findMetric(intent.domain, intent.metric);
  if (!metric || metric.coverage >= 0.5) return null;
  return `${metric.label} solo tiene dato en el ${Math.round(metric.coverage * 100)} % de los registros.`;
}

// ---------------------------------------------------------------------------
// Refinamiento
// ---------------------------------------------------------------------------

/**
 * Aplica un delta sobre el intent vigente.
 *
 * La regla que importa es la de los filtros: se acumulan **por campo**. "Sacá los
 * inactivos" seguido de "quedate con Argentina" tiene que dar las dos condiciones, no la
 * última. Eso es lo que hace que una cadena de refinamientos hablados conserve el estado
 * (SC-006) en vez de resetearse en cada vuelta.
 */
export function mergeIntent(current: VizIntent, delta: AgentIntentDelta): VizIntent {
  const next: VizIntent = { ...current };

  if (delta.domain !== undefined) next.domain = delta.domain;
  if (delta.metric !== undefined) next.metric = delta.metric;
  if (delta.groupBy !== undefined) next.groupBy = delta.groupBy;
  if (delta.limit !== undefined) next.limit = delta.limit;
  if (delta.chartType !== undefined) next.chartType = delta.chartType;
  if (delta.title !== undefined) next.title = delta.title;
  if (delta.assumptions !== undefined) next.assumptions = delta.assumptions;

  if (delta.sortBy !== undefined) {
    next.sort =
      delta.sortBy === "default"
        ? null
        : { by: delta.sortBy, dir: delta.sortDir ?? current.sort?.dir ?? "desc" };
  } else if (delta.sortDir !== undefined && current.sort) {
    next.sort = { ...current.sort, dir: delta.sortDir };
  }

  if (delta.filters !== undefined) {
    const byField = new Map(current.filters.map((f) => [f.field, f]));
    for (const raw of delta.filters) {
      // Valor vacío = sacá este filtro. Es como se deshace "quedate con Argentina".
      if (raw.value.trim() === "") byField.delete(raw.field);
      else byField.set(raw.field, normalizeFilter(raw));
    }
    next.filters = [...byField.values()];
  }

  // Si cambió el dominio, los filtros y el corte del anterior no significan nada.
  if (delta.domain !== undefined && delta.domain !== current.domain) {
    next.filters = delta.filters?.map(normalizeFilter) ?? [];
    next.groupBy = delta.groupBy ?? [];
  }

  return next;
}

/** Qué campos cambiaron, para que el agente lo confirme en voz. */
export function changedFields(before: VizIntent, after: VizIntent): string[] {
  const changed: string[] = [];
  const keys = ["domain", "metric", "groupBy", "filters", "sort", "limit", "chartType"] as const;
  for (const key of keys) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changed.push(key);
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Descripción
// ---------------------------------------------------------------------------

const OP_LABEL: Record<FilterOp, string> = {
  eq: "=", neq: "≠", in: "∈", nin: "∉",
  gte: "≥", lte: "≤", between: "entre", contains: "contiene",
};

/**
 * Una línea con lo que el agente entendió: "personas activas · por región · sólo activos".
 *
 * Es lo que muestra el `IntentRibbon`. La decisión de producto es exhibir la
 * interpretación, no la transcripción: confirma que el agente entendió bien sin convertir
 * la app en un chat.
 */
export function describeIntent(intent: VizIntent): string {
  const metric = findMetric(intent.domain, intent.metric);
  const parts: string[] = [metric?.label ?? intent.metric];

  if (intent.groupBy.length > 0) {
    const labels = intent.groupBy.map(
      (id) => findDimension(intent.domain, id)?.label.toLowerCase() ?? id,
    );
    parts.push(`por ${labels.join(" y ")}`);
  }

  parts.push(...filterPhrases(intent));
  return parts.join(" · ");
}

/**
 * Sólo los filtros activos: "país: Argentina · activo: Sí". Es el subtítulo del gráfico,
 * que le muestra al usuario el estado acumulado de sus refinamientos (T046).
 */
export function describeFilters(intent: VizIntent): string | null {
  const phrases = filterPhrases(intent);
  return phrases.length > 0 ? phrases.join(" · ") : null;
}

function filterPhrases(intent: VizIntent): string[] {
  return intent.filters.map((f) => {
    const label = findDimension(intent.domain, f.field)?.label.toLowerCase() ?? f.field;
    const value = Array.isArray(f.value)
      ? f.value.map((v) => formatLabel(v)).join(", ")
      : formatLabel(f.value);
    return f.op === "eq" ? `${label}: ${value}` : `${label} ${OP_LABEL[f.op]} ${value}`;
  });
}
