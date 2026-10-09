/**
 * La paleta de series de datos. Único lugar del proyecto donde se decide un color de dato.
 *
 * Todo son referencias `var(--*)` a los tokens de Flock, no valores. Dos consecuencias
 * buenas: el tema oscuro funciona solo (los tokens cambian en `html.dark` y los gráficos
 * se repintan sin una línea de lógica), y SC-007 —cero colores fuera de los tokens— es
 * verificable con un grep.
 *
 * SVG resuelve `var(--x)` en `fill` y `stroke`, así que Recharts recibe estas cadenas
 * tal cual.
 *
 * ## Por qué solo hay siete
 *
 * El design system de Flock tiene siete colores cromáticamente distinguibles entre sí
 * (los cuatro de marca más los tres de estado con matiz propio). Inventar un octavo para
 * cubrir una serie extra viola el principio IV. Así que el límite es real: una
 * visualización no puede mostrar más de siete series a la vez, y el motor de consulta
 * pliega el excedente en "Otros". Es una restricción honesta, no una omisión.
 */

/** Orden pensado para que dos series contiguas nunca compartan matiz. */
export const SERIES_PALETTE = [
  "var(--brand)",             // púrpura de marca
  "var(--accent)",            // naranja
  "var(--state-done-bar)",    // verde
  "var(--brand-2)",           // púrpura brillante
  "var(--state-blocked-bar)", // rosa
  "var(--brand-dark)",        // púrpura oscuro
  "var(--state-pending-bar)", // gris
] as const;

export const MAX_SERIES = SERIES_PALETTE.length;

/** Color de la serie `index`. Cicla si se pasa, pero el catálogo no debería dejar. */
export function seriesColor(index: number): string {
  return SERIES_PALETTE[index % SERIES_PALETTE.length]!;
}

/** Una sola serie usa el púrpura de marca; no tiene sentido "elegir" color. */
export const SINGLE_SERIES_COLOR = SERIES_PALETTE[0];

/** Color del grupo residual. Gris a propósito: "Otros" no compite con los datos reales. */
export const OTHERS_COLOR = "var(--state-pending-bar)";

/** Tokens que consumen los ejes, la grilla y los tooltips. */
export const CHART_CHROME = {
  grid: "var(--border)",
  axis: "var(--border-strong)",
  axisLabel: "var(--text-faint)",
  tickLabel: "var(--text-soft)",
  tooltipBg: "var(--panel)",
  tooltipBorder: "var(--border-strong)",
  tooltipText: "var(--text)",
} as const;
