"use client";

import * as React from "react";

/**
 * La categoría que el agente está nombrando en voz (T061).
 *
 * Cuando alguien pregunta "¿cuánto tiene Banco Ñandú?", `queryCurrentChart` encuentra la
 * categoría y los gráficos atenúan las demás mientras el agente contesta. No pasa por el
 * spec ni por el modelo: es estado de la sesión que el `GeneratedView` expone por contexto, así
 * que no hay nada que el modelo pueda inventar ni que la validación tenga que revisar.
 */

export interface Highlight {
  /** Etiqueta de la categoría del eje, tal como está en las filas. */
  category: string | null;
  /** Nombre de la serie, cuando hay segunda dimensión. */
  series: string | null;
}

const HighlightContext = React.createContext<Highlight | null>(null);

export const HighlightProvider = HighlightContext.Provider;

export function useHighlight(): Highlight | null {
  return React.useContext(HighlightContext);
}

/**
 * De la etiqueta que devuelve `answerFromResult` a categoría y serie: "CABA · Femenino" es la
 * categoría CABA en la serie Femenino; "CABA" sola es sólo la categoría.
 */
export function parseHighlight(label: string | null, seriesNames: string[] = []): Highlight | null {
  if (!label) return null;
  const [first, second] = label.split(" · ");
  if (second !== undefined) return { category: first ?? null, series: second };
  // Una etiqueta suelta puede ser una serie ("Femenino") o una categoría ("CABA").
  return seriesNames.includes(label) ? { category: null, series: label } : { category: label, series: null };
}

/** Opacidad para una marca del gráfico según lo resaltado. Sin resaltado, todo entero. */
export function highlightOpacity(highlight: Highlight | null, category: unknown, series?: string): number {
  if (!highlight) return 1;
  if (highlight.series && series !== undefined && series !== highlight.series) return 0.25;
  if (highlight.category && String(category) !== highlight.category) return 0.25;
  return 1;
}
