"use client";

import * as React from "react";
import { motion } from "motion/react";
import { CHART_CHROME } from "../palette";
import { formatNumber } from "@/lib/data/format";
import type { NumberFormat } from "@/lib/data/types";

/**
 * El marco común de todo gráfico y las piezas de cromo compartidas.
 *
 * Centralizar acá el título, los ejes, la grilla, el tooltip y el estado vacío es lo que
 * hace que FR-008 se cumpla siempre: un gráfico nuevo hereda toda la riqueza sin que nadie
 * tenga que acordarse de agregarla.
 */

interface ChartFrameProps {
  title: string;
  subtitle?: string | null;
  /** Se muestra en vez del gráfico cuando no hay filas. */
  isEmpty: boolean;
  emptyMessage: string;
  children: React.ReactNode;
}

export function ChartFrame({
  title,
  subtitle,
  isEmpty,
  emptyMessage,
  children,
}: ChartFrameProps) {
  return (
    <motion.figure
      // El panel va sobre --panel, nunca sobre el tinte del canvas: la regla de
      // separación de capas del design system.
      className="panel flex w-full flex-col gap-3.5 p-5.5"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      layout
    >
      <figcaption className="flex flex-col gap-1">
        <h3 className="type-card text-[color:var(--text)]">{title}</h3>
        {subtitle ? (
          <p className="type-secondary text-[color:var(--text-soft)]">{subtitle}</p>
        ) : null}
      </figcaption>

      {isEmpty ? (
        <EmptyState message={emptyMessage} />
      ) : (
        // `relative` para que un gráfico pueda superponer algo encima (el total en el
        // centro de una dona, por ejemplo).
        // El alto lo decide el contenedor con `--chart-body-h` (globals.css): grande cuando
        // el gráfico es el foco de la conversación, compacto en las tarjetas del tablero.
        <div className="relative h-[var(--chart-body-h)] w-full">{children}</div>
      )}
    </motion.figure>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div
      className="flex h-[var(--chart-body-h)] w-full flex-col items-center justify-center gap-3 rounded-card border border-dashed"
      style={{ borderColor: "var(--border-strong)", background: "var(--surface)" }}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-10 w-10"
        style={{ color: "var(--text-faint)" }}
        aria-hidden
      >
        <path d="M3 3v18h18" />
        <path d="M7 15l3-3 3 3 4-5" opacity=".45" />
      </svg>
      <p className="type-secondary max-w-[32ch] text-center" style={{ color: "var(--text-soft)" }}>
        {message}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cromo compartido de Recharts
// ---------------------------------------------------------------------------

/** Config común de los ejes. Los colores salen de tokens, nunca de un hex. */
export const axisProps = {
  stroke: CHART_CHROME.axis,
  tick: { fill: CHART_CHROME.tickLabel, fontSize: 12 },
  tickLine: false,
  axisLine: { stroke: CHART_CHROME.axis },
} as const;

export const axisLabelStyle = {
  fill: CHART_CHROME.axisLabel,
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: "0.7px",
} as const;

/** Grilla en línea fina y continua: punteada se lee como proyección o umbral, no como escala. */
export const gridProps = {
  stroke: CHART_CHROME.grid,
  vertical: false,
} as const;

/**
 * La leyenda va ARRIBA, no abajo.
 *
 * Abajo pelea con el rótulo del eje horizontal: en un gráfico de barras horizontales el
 * eje de valores queda abajo, y su rótulo y la leyenda se superponen unos píxeles pase lo
 * que pase con los márgenes. Arriba no hay nada que estorbe, y leer qué es cada serie
 * antes de mirar el gráfico es además el orden natural.
 */
export const legendProps = {
  verticalAlign: "top" as const,
  align: "right" as const,
  height: 26,
  wrapperStyle: { fontSize: 13, color: CHART_CHROME.tickLabel },
  iconType: "circle" as const,
  iconSize: 8,
  // El texto va en tinta de texto, no en el color de la serie: la identidad la da el punto
  // de color de al lado, y un rótulo naranja o verde sobre blanco se lee mal.
  formatter: (value: unknown) => <span style={{ color: CHART_CHROME.tickLabel }}>{String(value ?? "")}</span>,
};

/** Margen superior: con leyenda arriba hace falta lugar para ella. */
export const topMargin = (legend: boolean) => (legend ? 34 : 16);

/**
 * Margen inferior y alto del eje horizontal. El lugar del rótulo sólo se reserva si hay
 * rótulo: en las tarjetas del tablero el título ya dice qué es el eje, y el hueco vacío
 * debajo de las fechas se leía como un error.
 */
export const bottomMargin = (axisLabel: string) => (axisLabel.trim() ? 28 : 6);
export const xAxisHeight = (axisLabel: string) => (axisLabel.trim() ? 48 : 30);

/**
 * Lo que Recharts entrega por entrada del tooltip. Los campos van como `unknown` a
 * propósito: en Recharts 3 un `value` puede ser número, texto o un array (en los
 * gráficos de rango), y el parámetro es contravariante — aceptar de más es lo que hace
 * que esta función encaje donde la librería la espera.
 */
interface TooltipEntry {
  name?: unknown;
  value?: unknown;
  color?: string;
  dataKey?: unknown;
}

/**
 * Tooltip propio en vez del de Recharts: el de fábrica no respeta los tokens ni el
 * formato es-AR, y los números tienen que salir en mono con tabular-nums.
 */
export function makeTooltipContent(format: NumberFormat, unit?: string | null) {
  return function TooltipContent({
    active,
    payload,
    label,
  }: {
    active?: boolean;
    // Recharts entrega el payload como readonly; aceptarlo tal cual evita una copia.
    payload?: readonly TooltipEntry[];
    label?: string | number;
  }) {
    if (!active || !payload || payload.length === 0) return null;

    return (
      <div
        className="rounded-input px-3 py-2 shadow-overlay"
        style={{
          background: CHART_CHROME.tooltipBg,
          border: `1px solid ${CHART_CHROME.tooltipBorder}`,
          color: CHART_CHROME.tooltipText,
        }}
      >
        <p className="type-label mb-1.5" style={{ color: "var(--text-faint)" }}>
          {String(label ?? "")}
        </p>
        <ul className="flex flex-col gap-1">
          {payload.map((entry, i) => (
            <li key={i} className="flex items-center gap-2 text-[12.5px]">
              <span
                aria-hidden
                className="inline-block h-2 w-2 shrink-0 rounded-[50%]"
                style={{ background: entry.color }}
              />
              <span style={{ color: "var(--text-soft)" }}>{String(entry.name ?? "")}</span>
              <span className="text-mono ml-auto font-bold" style={{ color: "var(--text)" }}>
                {formatNumber(toNumber(entry.value), format)}
                {unit ? ` ${unit}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  };
}

export function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Formatea los ticks del eje Y con el formato de la primera serie. */
export function tickFormatter(format: NumberFormat) {
  return (value: unknown) => formatNumber(toNumber(value), format);
}

/**
 * Recharts anima sola cuando cambia `data` y el componente no se remonta. Esta duración
 * es la que usan todos los gráficos, para que un refinamiento hablado se vea como una
 * transición de estado y no como un gráfico nuevo (FR-021).
 */
export const ANIMATION_MS = 520;

/**
 * Cada serie entra un poco después de la anterior (T052): con varias series juntas, el
 * gráfico se lee como algo que se arma y no como algo que aparece de golpe.
 */
export const SERIES_STAGGER_MS = 120;

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * Con reduced motion la animación se apaga, pero el gráfico sigue apareciendo.
 *
 * Va con `useSyncExternalStore` y no con `useState` + `useEffect`: la media query es
 * estado externo al árbol de React, y leerla dentro de un efecto provoca un render en
 * cascada en cada montaje. El snapshot de servidor es `false` porque en el servidor no
 * hay forma de saberlo — la primera pintura anima, y si el sistema pide lo contrario se
 * corrige al hidratar.
 */
export function usePrefersReducedMotion(): boolean {
  return React.useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION).matches,
    () => false,
  );
}
