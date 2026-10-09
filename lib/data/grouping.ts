import type { ResultRow } from "./types";

/**
 * El grupo residual de un gráfico.
 *
 * No es privacidad: es legibilidad. Una dimensión con muchos valores (la posición exacta, la
 * tecnología) se recorta a sus principales y el resto va a "Otros", porque un gráfico de 25
 * barras no se lee.
 */

export const OTHERS_LABEL = "Otros";

/** Pliega en "Otros" todo lo que exceda el top-N. */
export function applyTopN(
  rows: ResultRow[],
  options: { labelKey: string; sortKey: string; valueKeys: string[]; limit: number },
): { rows: ResultRow[]; collapsed: string[] } {
  const { labelKey, sortKey, valueKeys, limit } = options;
  if (rows.length <= limit) return { rows, collapsed: [] };

  const ranked = [...rows].sort((a, b) => Number(b[sortKey] ?? 0) - Number(a[sortKey] ?? 0));
  const top = ranked.slice(0, limit);
  const rest = ranked.slice(limit);

  const others: ResultRow = { [labelKey]: OTHERS_LABEL };
  for (const key of valueKeys) {
    others[key] = rest.reduce((acc, r) => acc + Number(r[key] ?? 0), 0);
  }

  return {
    rows: [...top, others],
    collapsed: rest.map((r) => String(r[labelKey] ?? "")),
  };
}
