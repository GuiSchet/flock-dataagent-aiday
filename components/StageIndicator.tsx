"use client";

import { AnimatePresence, motion } from "motion/react";
import { STAGES, STAGE_SEQUENCE, stageIndex, type Stage } from "@/lib/conversation/stages";
import { usePrefersReducedMotion } from "@/lib/viz/components/ChartFrame";

/**
 * La etapa de la espera: una etiqueta y una barra fina de progreso.
 *
 * La regla que gobierna este componente (SC-005): ningún estado visual puede quedar
 * estático más de 400 ms. Por eso, además de avanzar entre etapas, la barra tiene un brillo
 * que la recorre en loop DENTRO de cada etapa: si el modelo tarda seis segundos componiendo,
 * se sigue viendo que algo pasa.
 *
 * Con reduced motion no hay loop: la barra avanza por etapa y la etiqueta cambia con un
 * fundido. El feedback de etapa se conserva, que es lo que pide FR-022.
 */

export function StageIndicator({ stage }: { stage: Stage }) {
  const reduced = usePrefersReducedMotion();
  if (stage === "idle") return null;

  const progress = (stageIndex(stage) + 1) / STAGE_SEQUENCE.length;

  return (
    <motion.div
      className="flex items-center gap-3.5"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
    >
      <div
        className="relative h-1 w-[160px] overflow-hidden rounded-pill"
        style={{ background: "var(--border-strong)" }}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        aria-valuetext={STAGES[stage].label}
      >
        <div
          className="h-full rounded-pill"
          style={{ width: `${progress * 100}%`, background: "var(--brand)", transition: "width .35s ease" }}
        />
        {reduced ? null : (
          // El brillo que recorre la barra: es lo que cubre SC-005 cuando una etapa se estira.
          <motion.div
            className="absolute inset-y-0 w-1/3 rounded-pill"
            style={{ background: "var(--brand-2)", opacity: 0.55 }}
            animate={{ x: ["-120%", "320%"] }}
            transition={{ duration: 1.3, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
      </div>

      <AnimatePresence mode="wait">
        <motion.p
          key={stage}
          className="type-body"
          style={{ color: "var(--text-soft)" }}
          initial={{ opacity: 0, y: reduced ? 0 : 3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: reduced ? 0 : -3 }}
          transition={{ duration: 0.18 }}
        >
          {STAGES[stage].label}
        </motion.p>
      </AnimatePresence>
    </motion.div>
  );
}
