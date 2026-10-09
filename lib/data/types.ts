/**
 * Tipos del motor de datos.
 *
 * El catálogo que se arma con estos tipos es lo único que el agente de voz ve del corpus:
 * si una columna no está acá, no existe para el modelo. Es así como el principio III
 * ("datos reales, cero alucinación") y la regla de PII se vuelven estructurales en vez de
 * depender del prompt.
 */

export const DOMAIN_IDS = ["nomina", "movimientos"] as const;

export type DomainId = (typeof DOMAIN_IDS)[number];

/** Valor de celda ya normalizado. */
export type Cell = string | number | null;

export type Row = Record<string, Cell>;

export type DimensionKind = "categorical" | "temporal";

/** De qué período es cada valor de una dimensión temporal: `2024-03`, `2024-Q1` o `2024`. */
export type TimeGrain = "month" | "quarter" | "year";

export interface Dimension {
  id: string;
  label: string;
  kind: DimensionKind;
  /** Descripción para el prompt del LLM: qué significa y cuándo usarla. */
  description: string;
  /** Cantidad de valores distintos, calculada sobre los datos reales. */
  cardinality: number;
  /** Proporción de filas con dato (0–1). El agente advierte si es baja. */
  coverage: number;
  /** Valores posibles. Se omite cuando la cardinalidad es alta. */
  values?: string[];
  /**
   * Orden natural de una dimensión ordinal (seniority, rangos de edad). Si está, el motor
   * ordena por acá en vez de por el valor de la métrica.
   */
  order?: string[];
  /** Sólo en temporales. Si falta, la dimensión es mensual. */
  grain?: TimeGrain;
}

/**
 * - `count`          filas del grupo (después del filtro de la métrica)
 * - `countDistinct`  valores distintos de `field` en el grupo
 * - `sum` / `avg`    sobre `field`
 * - `share`          % que el grupo representa del total de todos los grupos
 * - `ratio`          % de filas del grupo que pasan `filter`, sobre el total del grupo
 */
export type Aggregation =
  | "count"
  | "countDistinct"
  | "sum"
  | "avg"
  | "share"
  | "ratio";

export type NumberFormat =
  | "integer"
  | "decimal1"
  | "decimal2"
  | "percent";

export interface Metric {
  id: string;
  label: string;
  agg: Aggregation;
  /** Columna sobre la que agrega. `count` y `share` no la necesitan. */
  field?: string;
  /**
   * Filtro propio de la métrica. En `count` restringe qué se cuenta (headcount_activo
   * cuenta solo activos); en `ratio` define el numerador.
   */
  filter?: Filter;
  unit: string;
  format: NumberFormat;
  coverage: number;
  description: string;
}

export interface UnavailableField {
  field: string;
  reason: string;
  /** Qué ofrecer en su lugar cuando el usuario la pide. */
  suggestion?: string;
  /** Datos personales: no es que falten, es que nunca se exponen (principio III). */
  personal?: boolean;
}

export interface Domain {
  id: DomainId;
  label: string;
  description: string;
  rowCount: number;
  rows: Row[];
  dimensions: Dimension[];
  metrics: Metric[];
  unavailable: UnavailableField[];
}

export type FilterOp =
  | "eq"
  | "neq"
  | "in"
  | "nin"
  | "gte"
  | "lte"
  | "between"
  | "contains";

export interface Filter {
  field: string;
  op: FilterOp;
  value: string | number | Array<string | number> | null;
}

export interface SortSpec {
  by: "metric" | "dimension";
  dir: "asc" | "desc";
}

/** Una fila del resultado: las dimensiones agrupadas más el valor de la métrica. */
export type ResultRow = Record<string, Cell>;

export interface Provenance {
  domain: DomainId;
  domainLabel: string;
  metric: string;
  metricLabel: string;
  groupBy: string[];
  filters: Filter[];
  /** Filas del dataset que sobrevivieron a los filtros. */
  rowsMatched: number;
  /** Total de filas del dominio. */
  rowsTotal: number;
  /** Grupos plegados en "Otros" por alta cardinalidad. */
  collapsed: string[];
  /** Advertencias que el agente debe enunciar (cobertura baja, recortes, etc.). */
  warnings: string[];
}

export interface ResultSet {
  rows: ResultRow[];
  /** Claves de dimensión presentes en cada fila, en orden. */
  dimensionKeys: string[];
  /** Clave de la métrica en cada fila. */
  metricKey: string;
  /** Series cuando hay una segunda dimensión (para stacked/grouped/multi-línea). */
  seriesKeys: string[];
  rowCount: number;
  provenance: Provenance;
}
