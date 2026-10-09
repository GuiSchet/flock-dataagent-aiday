import { findDimension, findMetric, getDomain } from "./catalog";
import { formatLabel } from "./format";
import { applyTopN, OTHERS_LABEL } from "./grouping";
import type {
  Cell,
  Dimension,
  DomainId,
  Filter,
  Metric,
  ResultRow,
  ResultSet,
  Row,
  SortSpec,
} from "./types";

/**
 * El motor determinístico.
 *
 * Este módulo es el único lugar del sistema donde se produce un número que después se
 * muestra. El LLM decide la *forma* de la consulta; acá se ejecuta. Esa separación es lo
 * que vuelve estructural el principio III de la constitución.
 */

/** Clave interna con la cantidad de filas de origen que respalda cada grupo. */
export const SUPPORT_KEY = "_filas";

/** Por encima de esto, una dimensión categórica se recorta a top-N + "Otros". */
const DEFAULT_CATEGORY_LIMIT = 12;

/** Por debajo de esto, la métrica se considera poco confiable y se advierte. */
const LOW_COVERAGE = 0.5;

export interface QueryRequest {
  domain: DomainId;
  metric: string;
  groupBy: string[];
  filters?: Filter[];
  sort?: SortSpec | null;
  limit?: number | null;
}

export class QueryError extends Error {
  constructor(
    message: string,
    /** Qué ofrecerle al usuario en su lugar. El agente lo dice en voz. */
    readonly suggestion?: string,
  ) {
    super(message);
    this.name = "QueryError";
  }
}

// ---------------------------------------------------------------------------
// Filtros
// ---------------------------------------------------------------------------

function matches(row: Row, filter: Filter): boolean {
  // Una columna ausente y una columna vacía son lo mismo para un filtro: sin dato.
  const cell: Cell = row[filter.field] ?? null;
  const { op, value } = filter;

  if (op === "eq") return cell === value;
  if (op === "neq") return cell !== value;

  if (op === "in" || op === "nin") {
    const list = Array.isArray(value) ? value : [value];
    const hit = list.some((v) => v === cell);
    return op === "in" ? hit : !hit;
  }

  if (op === "contains") {
    if (cell === null) return false;
    return String(cell).toLowerCase().includes(String(value).toLowerCase());
  }

  // Comparaciones de orden. Funcionan sobre números y sobre fechas ISO, que ordenan
  // lexicográficamente por construcción.
  if (cell === null) return false;

  if (op === "between") {
    const bounds = Array.isArray(value) ? value : [value, value];
    const lo = bounds[0] ?? null;
    const hi = bounds[1] ?? lo;
    return compare(cell, lo) >= 0 && compare(cell, hi) <= 0;
  }

  const scalar = Array.isArray(value) ? (value[0] ?? null) : value;
  if (op === "gte") return compare(cell, scalar) >= 0;
  if (op === "lte") return compare(cell, scalar) <= 0;

  return true;
}

function compare(a: Cell, b: Cell): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "es-AR");
}

function applyFilters(rows: Row[], filters: Filter[]): Row[] {
  if (filters.length === 0) return rows;
  return rows.filter((row) => filters.every((f) => matches(row, f)));
}

// ---------------------------------------------------------------------------
// Agregación
// ---------------------------------------------------------------------------

/** Calcula el valor de la métrica para un conjunto de filas ya agrupado. */
function aggregate(rows: Row[], metric: Metric, totalForShare: number): number | null {
  const scoped = metric.filter ? rows.filter((r) => matches(r, metric.filter!)) : rows;

  switch (metric.agg) {
    case "count":
      return scoped.length;

    case "countDistinct": {
      const values = scoped
        .map((r) => r[metric.field!])
        .filter((v): v is Exclude<Cell, null> => v !== null && v !== undefined);
      return new Set(values.map(String)).size;
    }

    case "sum":
    case "avg": {
      const nums = scoped
        .map((r) => r[metric.field!])
        .filter((v): v is number => typeof v === "number");
      if (nums.length === 0) return null;
      const total = nums.reduce((a, b) => a + b, 0);
      return metric.agg === "sum" ? total : total / nums.length;
    }

    case "share":
      return totalForShare === 0 ? null : (scoped.length / totalForShare) * 100;

    case "ratio":
      return rows.length === 0 ? null : (scoped.length / rows.length) * 100;
  }
}

function groupRows(rows: Row[], field: string): Map<string, Row[]> {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const raw = row[field];
    const key = raw === null || raw === undefined ? "" : String(raw);
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Orden
// ---------------------------------------------------------------------------

function defaultSort(dimension: Dimension): SortSpec {
  // Una serie temporal se lee cronológicamente y una ordinal (seniority, rangos) en su orden
  // natural; una categórica, de mayor a menor.
  return dimension.kind === "temporal" || dimension.order
    ? { by: "dimension", dir: "asc" }
    : { by: "metric", dir: "desc" };
}

/**
 * Posición de un valor en el orden natural de la dimensión. Lo que no está en el orden
 * ("Otros", sin dato) va al final.
 */
function rankOf(dimension: Dimension, value: Cell): number {
  if (!dimension.order) return 0;
  const i = dimension.order.indexOf(String(value ?? ""));
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
}

function compareByDimension(dimension: Dimension, a: Cell, b: Cell): number {
  // "Sin dato" y "Otros" no son valores de la escala: siempre al final, en cualquier sentido.
  return rankOf(dimension, a) - rankOf(dimension, b) || compare(a, b);
}

function sortRows(
  rows: ResultRow[],
  sort: SortSpec,
  dimension: Dimension,
  sortValueKey: string,
): ResultRow[] {
  const dir = sort.dir === "asc" ? 1 : -1;
  // "Otros" y "sin dato" son residuos, no categorías que compiten: van al final aunque
  // sumen más que alguna de verdad.
  const residual = (row: ResultRow) => {
    const label = row[dimension.id];
    return label === OTHERS_LABEL ? 2 : label === "" || label === null || label === undefined ? 1 : 0;
  };
  return [...rows].sort((a, b) => {
    const tail = residual(a) - residual(b);
    if (tail !== 0 && dimension.kind === "categorical") return tail;
    if (sort.by === "metric") {
      return (Number(a[sortValueKey] ?? 0) - Number(b[sortValueKey] ?? 0)) * dir;
    }
    return compareByDimension(dimension, a[dimension.id] ?? null, b[dimension.id] ?? null) * dir;
  });
}

/** Valores de una dimensión en su orden de lectura, con "sin dato" al final. */
function orderedValues(dimension: Dimension, values: Iterable<string>): string[] {
  return [...values].sort((a, b) => {
    if (a === "" || b === "") return a === b ? 0 : a === "" ? 1 : -1;
    return compareByDimension(dimension, a, b);
  });
}

// ---------------------------------------------------------------------------
// Ejecución
// ---------------------------------------------------------------------------

export function runQuery(request: QueryRequest): ResultSet {
  const domain = getDomain(request.domain);
  const metric = findMetric(request.domain, request.metric);

  if (!metric) {
    const available = domain.metrics.map((m) => m.label).join(", ");
    throw new QueryError(
      `La métrica "${request.metric}" no existe en ${domain.label}.`,
      `Las disponibles son: ${available}.`,
    );
  }

  const groupBy = request.groupBy.slice(0, 2);
  const dimensions: Dimension[] = [];
  for (const id of groupBy) {
    const dim = findDimension(request.domain, id);
    if (!dim) {
      const available = domain.dimensions.map((d) => d.label).join(", ");
      throw new QueryError(
        `La dimensión "${id}" no existe en ${domain.label}.`,
        `Se puede cortar por: ${available}.`,
      );
    }
    dimensions.push(dim);
  }

  const filters = request.filters ?? [];
  for (const f of filters) {
    if (!findDimension(request.domain, f.field) && !findMetric(request.domain, f.field)) {
      throw new QueryError(
        `No se puede filtrar por "${f.field}": ese campo no existe en ${domain.label}.`,
      );
    }
  }

  const filtered = applyFilters(domain.rows, filters);
  const warnings: string[] = [];

  if (metric.coverage < LOW_COVERAGE) {
    const pct = Math.round(metric.coverage * 100);
    warnings.push(
      `${metric.label} solo tiene dato en el ${pct} % de los registros, así que el resultado se apoya en pocos casos.`,
    );
  }

  const provenanceBase = {
    domain: domain.id,
    domainLabel: domain.label,
    metric: metric.id,
    metricLabel: metric.label,
    groupBy,
    filters,
    rowsMatched: filtered.length,
    rowsTotal: domain.rowCount,
  };

  if (filtered.length === 0) {
    return {
      rows: [],
      dimensionKeys: groupBy,
      metricKey: metric.id,
      seriesKeys: [],
      rowCount: 0,
      provenance: {
        ...provenanceBase,
        collapsed: [],
        warnings: [...warnings, "Ningún registro cumple con esos filtros."],
      },
    };
  }

  // --- Sin agrupamiento: un solo número (KPI) ---
  if (dimensions.length === 0) {
    const value = aggregate(filtered, metric, filtered.length);
    return {
      rows: [{ [metric.id]: value, [SUPPORT_KEY]: filtered.length }],
      dimensionKeys: [],
      metricKey: metric.id,
      seriesKeys: [],
      rowCount: 1,
      provenance: { ...provenanceBase, collapsed: [], warnings },
    };
  }

  const primary = dimensions[0]!;
  const series = dimensions[1];

  const groups = groupRows(filtered, primary.id);

  // En una serie temporal, "sin fecha" no es un momento: las filas sin dato no tienen
  // dónde ir en el eje. Se excluyen del gráfico y se informan aparte, en vez de aparecer
  // como una barra "Sin dato" que descoloca toda la escala (las personas activas no tienen
  // fecha de egreso, y así es como una serie de bajas arrancaba con toda la dotación).
  let withoutPeriod = 0;
  if (primary.kind === "temporal") {
    withoutPeriod = groups.get("")?.length ?? 0;
    groups.delete("");
    if (withoutPeriod > 0) {
      warnings.push(
        `${withoutPeriod} registro(s) no tienen ${primary.label.toLowerCase()} y quedaron fuera del gráfico.`,
      );
    }
  }

  const denominatorForShare = filtered.length;

  // Segunda dimensión: cada valor se vuelve una columna, que es la forma que Recharts
  // necesita para barras apiladas/agrupadas y para líneas multi-serie.
  const seriesValues: string[] = [];
  if (series) {
    const found = new Set<string>();
    for (const row of filtered) {
      const raw = row[series.id];
      found.add(raw === null || raw === undefined ? "" : String(raw));
    }
    seriesValues.push(...orderedValues(series, found));
  }
  const seriesKeys = seriesValues.map(formatLabel);

  // Las etiquetas se guardan CRUDAS hasta el final. Formatearlas antes rompería el
  // orden cronológico: "2021-07" ordena bien, "julio 2021" ordena alfabéticamente y
  // deja una serie temporal hecha un desastre.
  const buildRow = (key: string, source: Row[]): ResultRow => {
    const out: ResultRow = { [primary.id]: key, [SUPPORT_KEY]: source.length };
    if (!series) {
      out[metric.id] = aggregate(source, metric, denominatorForShare);
      return out;
    }
    const bySeries = groupRows(source, series.id);
    seriesValues.forEach((raw, i) => {
      out[seriesKeys[i]!] = aggregate(bySeries.get(raw) ?? [], metric, denominatorForShare);
    });
    return out;
  };

  // Las filas de origen de cada fila del resultado. Cuando el top-N pliega varios grupos
  // en "Otros", el valor se recalcula sobre la unión: sumar promedios o porcentajes daría
  // un número que no describe a nadie.
  const sources = new Map<string, Row[]>(groups);
  const merge = (label: string, keys: string[]): ResultRow => {
    const union = keys.flatMap((k) => sources.get(k) ?? []);
    sources.set(label, union);
    return buildRow(label, union);
  };

  let rows = [...groups.entries()].map(([key, source]) => buildRow(key, source));

  // Un "Sin dato" que no suma nada es ruido: pasa cuando la métrica tiene su propio filtro
  // (los egresados sin área, al contar personas activas por área).
  const isBlank = (row: ResultRow, keys: string[]) =>
    keys.every((k) => row[k] === null || row[k] === undefined || row[k] === 0);
  rows = rows.filter(
    (row) => row[primary.id] !== "" || !isBlank(row, series ? seriesKeys : [metric.id]),
  );

  const valueKeys = series ? seriesKeys : [metric.id];
  const sortValueKey = series ? SUPPORT_KEY : metric.id;

  const sort = request.sort ?? defaultSort(primary);
  rows = sortRows(rows, sort, primary, sortValueKey);

  // --- Legibilidad: top-N para dimensiones categóricas de cardinalidad alta ---
  //
  // NUNCA sobre una dimensión temporal: plegar meses en "Otros" produce una serie de
  // tiempo con un pico sin sentido al final, y una línea con un hueco en el medio no
  // dice nada. Una serie larga se lee bien; una serie mutilada, no.
  const canCollapse = primary.kind === "categorical";
  const limit = canCollapse
    ? (request.limit ?? (primary.cardinality > DEFAULT_CATEGORY_LIMIT ? DEFAULT_CATEGORY_LIMIT : null))
    : null;
  let collapsed: string[] = [];
  if (limit !== null && rows.length > limit) {
    const result = applyTopN(rows, {
      labelKey: primary.id,
      sortKey: sortValueKey,
      valueKeys,
      limit,
    });
    collapsed = result.collapsed;
    rows = result.rows.map((row) =>
      row[primary.id] === OTHERS_LABEL ? merge(OTHERS_LABEL, collapsed) : row,
    );
    warnings.push(
      `Se muestran los ${limit} principales por ${metric.label}; el resto quedó agrupado en "Otros".`,
    );
    // El top-N reordena por valor; se restaura el orden pedido.
    rows = sortRows(rows, sort, primary, sortValueKey);
  }

  // Una serie que quedó en cero o vacía en todas las filas no dice nada y ocupa un color.
  const visibleSeries = seriesKeys.filter((key) => rows.some((row) => !isBlank(row, [key])));
  if (visibleSeries.length < seriesKeys.length) {
    const dropped = new Set(seriesKeys.filter((key) => !visibleSeries.includes(key)));
    rows = rows.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => !dropped.has(key))));
  }

  // Recién ahora las etiquetas se vuelven legibles: "2021-07" → "julio 2021".
  const labelled = rows.map((row) => ({
    ...row,
    [primary.id]: formatLabel(row[primary.id]),
  }));

  return {
    rows: labelled,
    dimensionKeys: [primary.id],
    metricKey: metric.id,
    seriesKeys: visibleSeries,
    rowCount: labelled.length,
    provenance: {
      ...provenanceBase,
      collapsed: collapsed.map(formatLabel),
      warnings,
    },
  };
}
