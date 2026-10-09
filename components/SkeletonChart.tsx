"use client";

import * as React from "react";
import { motion } from "motion/react";
import type { ChartType } from "@/lib/conversation/intent";
import { usePrefersReducedMotion } from "@/lib/viz/components/ChartFrame";

/**
 * El esqueleto del gráfico que se está componiendo (T050).
 *
 * El tipo de gráfico y el título se conocen apenas vuelve la consulta —milisegundos después
 * del tool—, mucho antes de que el modelo emita el primer parche. Así el primer píxel no
 * depende del modelo (SC-004): aparece el marco con el título real, después los ejes,
 * después la silueta del tipo de gráfico que viene, y queda latiendo hasta que llega el
 * gráfico de verdad (SC-005).
 *
 * Con reduced motion no hay loop ni escalonado: el esqueleto aparece con un fundido y el
 * indicador de etapa sigue diciendo qué pasa (FR-022).
 */

interface SkeletonChartProps {
  chartType: ChartType;
  title: string;
  subtitle: string | null;
  /** Se llama una vez, cuando el esqueleto ya está en pantalla. Mide el primer píxel. */
  onShown?: () => void;
}

const BLOCK = { background: "var(--surface)" } as const;
const MARK = { background: "var(--brand-soft)" } as const;

export function SkeletonChart({ chartType, title, subtitle, onShown }: SkeletonChartProps) {
  const reduced = usePrefersReducedMotion();
  // Una sola vez por esqueleto: el primer píxel se mide cuando aparece, no en cada render.
  const shown = React.useRef(onShown);
  React.useEffect(() => {
    shown.current?.();
  }, []);

  // Cada capa entra después de la anterior; con reduced motion, todas juntas.
  const layer = (step: number) =>
    reduced
      ? { initial: { opacity: 0 }, animate: { opacity: 1 }, transition: { duration: 0.2 } }
      : { initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.3, delay: step * 0.15 } };
  // El latido de la silueta: lo que cubre SC-005 cuando el modelo tarda.
  const pulse = reduced
    ? {}
    : { animate: { opacity: [0.55, 1, 0.55] }, transition: { duration: 1.4, repeat: Infinity, ease: "easeInOut" as const } };

  return (
    <section className="flex w-full flex-col gap-4.5" aria-busy="true" aria-label={`Armando: ${title}`}>
      <motion.header className="flex flex-col gap-1" {...layer(0)}>
        <h2 className="type-section" style={{ color: "var(--text)" }}>
          {title}
        </h2>
        {subtitle ? (
          <p className="type-secondary" style={{ color: "var(--text-soft)" }}>
            {subtitle}
          </p>
        ) : null}
      </motion.header>

      <motion.div className="panel flex w-full flex-col gap-3.5 p-5.5" {...layer(1)}>
        <div className="h-[18px] w-[38%] rounded-input" style={BLOCK} />
        <motion.div className="relative h-[var(--chart-body-h)] w-full" {...layer(2)}>
          <motion.div className="h-full w-full" {...pulse}>
            <Silhouette chartType={chartType} />
          </motion.div>
        </motion.div>
      </motion.div>
    </section>
  );
}

/** La forma del gráfico que viene, sin ningún dato: largos y alturas fijas, no reales. */
function Silhouette({ chartType }: { chartType: ChartType }) {
  switch (chartType) {
    case "kpi":
      return (
        <div className="flex h-full items-center justify-center">
          <div className="flex w-[280px] flex-col gap-3 rounded-card p-5" style={BLOCK}>
            <div className="h-[12px] w-[40%] rounded-input" style={MARK} />
            <div className="h-[32px] w-[60%] rounded-input" style={MARK} />
          </div>
        </div>
      );
    case "pie":
    case "donut":
      return (
        <div className="flex h-full items-center justify-center">
          <div
            className="aspect-square h-[80%] rounded-[50%]"
            style={{
              background: chartType === "donut"
                ? "radial-gradient(circle, var(--panel) 52%, var(--brand-soft) 53%)"
                : "var(--brand-soft)",
            }}
          />
        </div>
      );
    case "line":
    case "area":
    case "scatter":
      return (
        <svg viewBox="0 0 400 160" preserveAspectRatio="none" className="h-full w-full" aria-hidden>
          <path d="M0 150 H400" stroke="var(--border-strong)" strokeWidth="1" fill="none" />
          {chartType === "scatter" ? (
            [40, 90, 130, 180, 230, 270, 320, 360].map((x, i) => (
              <circle key={x} cx={x} cy={[110, 80, 95, 60, 70, 40, 55, 30][i]} r="6" fill="var(--brand-soft)" />
            ))
          ) : (
            <path
              d="M0 120 C60 100 90 60 140 80 S230 40 280 60 S360 20 400 30"
              stroke="var(--brand-soft)"
              strokeWidth="6"
              fill={chartType === "area" ? "var(--surface)" : "none"}
              strokeLinecap="round"
            />
          )}
        </svg>
      );
    case "table":
      return (
        <div className="flex h-full flex-col gap-2.5 pt-1">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex gap-4">
              <div className="h-[14px] flex-1 rounded-input" style={BLOCK} />
              <div className="h-[14px] w-[18%] rounded-input" style={i === 0 ? BLOCK : MARK} />
            </div>
          ))}
        </div>
      );
    default:
      // Barras (simples, agrupadas, apiladas y combinadas): la silueta las muestra horizontales.
      return (
        <div className="flex h-full flex-col justify-around py-1">
          {[92, 78, 64, 55, 41, 30, 18].map((width, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="h-[10px] w-[16%] rounded-input" style={BLOCK} />
              <div className="h-[14px] rounded-input" style={{ ...MARK, width: `${width * 0.78}%` }} />
            </div>
          ))}
        </div>
      );
  }
}
