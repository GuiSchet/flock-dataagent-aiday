import { formatNumber, pluralize } from "@/lib/data/format";
import type { NumberFormat, ResultRow, ResultSet } from "@/lib/data/types";

/**
 * Respuestas exactas sobre el resultado que está en pantalla.
 *
 * El agente de voz no hace aritmética ni lee números de un gráfico: pide acá el máximo, el
 * total o el valor de una categoría, y recibe **cadenas ya formateadas en es-AR** para
 * leerlas tal cual. Es la parte hablada del principio III.
 *
 * Este módulo es puro y no toca el catálogo de datos (que lee los CSV con `node:fs`), así
 * que corre en el navegador: `queryCurrentChart` contesta sin ir al servidor.
 */

/** Lo que hace falta saber del resultado para leerlo en voz. Lo arma el servidor. */
export interface ResultMeta {
  metricLabel: string;
  unit: string;
  format: NumberFormat;
  /**
   * Si sumar los valores de las categorías da algo con sentido. Un conteo sí; un promedio
   * o un porcentaje sobre el grupo, no: "la edad promedio total" sería un número inventado.
   */
  additive: boolean;
  /** Dimensión del eje. Null en un KPI. */
  labelKey: string | null;
  labelName: string | null;
  /** Columnas con valores: la métrica, o una por serie cuando hay segunda dimensión. */
  valueKeys: string[];
}

interface Cell {
  label: string;
  series: string | null;
  value: number;
}

/** "31 personas", "1 persona", "8,50 puntos", "12,5 %". */
export function formatValue(value: number | null, meta: Pick<ResultMeta, "unit" | "format">): string {
  const text = formatNumber(value, meta.format);
  if (value === null || meta.format === "percent" || meta.unit === "%") return text;
  // Las unidades del catálogo son plurales regulares ("personas", "años", "registros"):
  // el agente lee esto en voz, y "1 registros" se nota.
  const unit = text === "1" && meta.unit.endsWith("s") ? meta.unit.slice(0, -1) : meta.unit;
  return `${text} ${unit}`;
}

function cells(result: ResultSet, meta: ResultMeta): Cell[] {
  const out: Cell[] = [];
  for (const row of result.rows) {
    const label = meta.labelKey ? String(row[meta.labelKey] ?? "") : meta.metricLabel;
    for (const key of meta.valueKeys) {
      const value = row[key];
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      out.push({ label, series: meta.valueKeys.length > 1 ? key : null, value });
    }
  }
  return out;
}

function cellLabel(cell: Cell): string {
  return cell.series ? `${cell.label} · ${cell.series}` : cell.label;
}

/** Sin tildes ni mayúsculas: "banco nandu" encuentra "Banco Ñandú". */
export function foldText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function extreme(list: Cell[], pick: (a: Cell, b: Cell) => boolean): Cell | null {
  return list.reduce<Cell | null>((best, c) => (best === null || pick(c, best) ? c : best), null);
}

/**
 * Los números que resumen el resultado. Son los que puede mostrar un `KpiTile` que acompaña
 * a un gráfico, atado a `{"$state": "/stats"}`.
 *
 * Existen porque un KpiTile atado a `/rows` muestra la primera fila, y encima de un gráfico
 * de barras eso es la categoría más grande, no un total: un "Total de personas" diría 53 en
 * vez de 79. El número sería real, pero el rótulo lo volvería falso.
 *
 * `total` y `avg` sólo existen si la métrica es sumable. Sumar edades promedio da un número
 * que no significa nada, así que queda `null` y la validación no deja usarlo.
 */
export interface ResultStats {
  total: number | null;
  max: number | null;
  min: number | null;
  /** Promedio por categoría (o por celda, con series). */
  avg: number | null;
  /** Cantidad de categorías del eje. */
  count: number;
}

export function resultStats(result: ResultSet, meta: ResultMeta): ResultStats {
  const values = cells(result, meta).map((c) => c.value);
  if (values.length === 0) return { total: null, max: null, min: null, avg: null, count: result.rowCount };
  const total = values.reduce((sum, v) => sum + v, 0);
  return {
    total: meta.additive ? total : null,
    max: Math.max(...values),
    min: Math.min(...values),
    avg: meta.additive ? total / values.length : null,
    count: result.rowCount,
  };
}

/** Las claves de `/stats` que tienen valor: las únicas que un KpiTile puede usar. */
export function availableStats(stats: ResultStats): string[] {
  return Object.entries(stats)
    .filter(([, value]) => value !== null)
    .map(([key]) => key);
}

/**
 * La línea que `proposeVisualization` le devuelve al agente para que empiece a hablar
 * mientras el gráfico se dibuja: "6 valores de región. El más alto: CABA con 31 personas…".
 */
export function summarize(result: ResultSet, meta: ResultMeta): string {
  if (result.rowCount === 0) return "Ningún registro cumple con esos filtros.";

  const all = cells(result, meta);
  if (all.length === 0) return `No hay dato de ${meta.metricLabel.toLowerCase()} para ese corte.`;

  if (!meta.labelKey) {
    return `${meta.metricLabel}: ${formatValue(all[0]!.value, meta)}.`;
  }

  const max = extreme(all, (a, b) => a.value > b.value)!;
  const min = extreme(all, (a, b) => a.value < b.value)!;
  const dim = (meta.labelName ?? "categoría").toLowerCase();
  const head =
    meta.valueKeys.length > 1
      ? `${pluralize(result.rowCount, "valor", "valores")} de ${dim}, en ${meta.valueKeys.length} series.`
      : `${pluralize(result.rowCount, "valor", "valores")} de ${dim}.`;

  if (max === min || all.length === 1) {
    return `${head} ${cellLabel(max)}: ${formatValue(max.value, meta)}.`;
  }
  return `${head} El más alto: ${cellLabel(max)} con ${formatValue(max.value, meta)}. El más bajo: ${cellLabel(min)} con ${formatValue(min.value, meta)}.`;
}

export interface Answer {
  label?: string;
  formatted: string;
}

export interface ChartAnswers {
  answerable: boolean;
  answers: {
    value?: Answer;
    max?: Answer;
    min?: Answer;
    total?: Answer;
    avg?: Answer;
    point?: Answer[];
  };
  /** Cuando `highlight` no coincidió con ninguna categoría. */
  notFound?: string;
  /** De dónde salen los datos, para "¿de dónde sale esto?" (FR-016). */
  provenance?: {
    fuente: string;
    metrica: string;
    registros: string;
    /** Qué quedó agrupado en "Otros" para que el gráfico se lea, o null. */
    recorte: string | null;
  };
  rows: Array<Record<string, string>>;
  context: string;
  reason?: string;
}

/** Filas que se le leen al agente como contexto. Más que esto no se dice en voz. */
const MAX_ROWS = 15;

/**
 * Todo lo que se puede contestar sobre el gráfico vigente, de una vez.
 *
 * El agente elige qué leer según la pregunta; acá no se interpreta lenguaje natural. Lo
 * único que se usa de la pregunta es `highlight`, la categoría puntual que mencionó.
 */
export function answerFromResult(
  result: ResultSet | null,
  meta: ResultMeta | null,
  context: string,
  highlight?: string,
): ChartAnswers {
  if (!result || !meta) {
    return {
      answerable: false,
      answers: {},
      rows: [],
      context,
      reason: "No hay ningún gráfico en pantalla todavía.",
    };
  }

  const all = cells(result, meta);
  if (all.length === 0) {
    return {
      answerable: false,
      answers: {},
      rows: [],
      context,
      reason: "El gráfico en pantalla no tiene valores: ningún registro cumple con los filtros.",
    };
  }

  const answers: ChartAnswers["answers"] = {};

  if (!meta.labelKey) {
    answers.value = { label: meta.metricLabel, formatted: formatValue(all[0]!.value, meta) };
  } else {
    const max = extreme(all, (a, b) => a.value > b.value)!;
    const min = extreme(all, (a, b) => a.value < b.value)!;
    answers.max = { label: cellLabel(max), formatted: formatValue(max.value, meta) };
    answers.min = { label: cellLabel(min), formatted: formatValue(min.value, meta) };

    if (meta.additive) {
      const total = all.reduce((sum, c) => sum + c.value, 0);
      answers.total = { formatted: formatValue(total, meta) };
      answers.avg = {
        label: `promedio por ${cellLabelKind(meta)}`,
        formatted: formatValue(total / all.length, { ...meta, format: "decimal1" }),
      };
    }
  }

  let notFound: string | undefined;
  if (highlight && meta.labelKey) {
    const wanted = foldText(highlight);
    const hits = all.filter(
      (c) => foldText(c.label) === wanted || (c.series !== null && foldText(c.series) === wanted),
    );
    if (hits.length > 0) {
      answers.point = hits.map((c) => ({ label: cellLabel(c), formatted: formatValue(c.value, meta) }));
    } else {
      notFound = highlight;
    }
  }

  const { domainLabel, metricLabel, rowsMatched, rowsTotal, collapsed } = result.provenance;
  return {
    answerable: true,
    answers,
    ...(notFound ? { notFound } : {}),
    provenance: {
      fuente: domainLabel,
      metrica: metricLabel,
      registros: `${formatNumber(rowsMatched, "integer")} de ${formatNumber(rowsTotal, "integer")} registros`,
      recorte:
        collapsed.length > 0
          ? `${pluralize(collapsed.length, "categoría agrupada", "categorías agrupadas")} en "Otros" para que el gráfico se lea`
          : null,
    },
    rows: result.rows.slice(0, MAX_ROWS).map((row) => readableRow(row, meta)),
    context,
  };
}

function cellLabelKind(meta: ResultMeta): string {
  return meta.valueKeys.length > 1 ? "celda" : (meta.labelName ?? "categoría").toLowerCase();
}

function readableRow(row: ResultRow, meta: ResultMeta): Record<string, string> {
  const out: Record<string, string> = {};
  if (meta.labelKey) out[meta.labelName ?? meta.labelKey] = String(row[meta.labelKey] ?? "");
  for (const key of meta.valueKeys) {
    const value = row[key];
    out[meta.valueKeys.length > 1 ? key : meta.metricLabel] = formatValue(
      typeof value === "number" ? value : null,
      meta,
    );
  }
  return out;
}
