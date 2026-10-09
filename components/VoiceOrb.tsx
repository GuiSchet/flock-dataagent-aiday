"use client";

import { motion } from "motion/react";
import type { Stage } from "@/lib/conversation/stages";
import { usePrefersReducedMotion } from "@/lib/viz/components/ChartFrame";

/**
 * El orbe: el control de la voz, y el que dice de un vistazo qué está pasando con la
 * conversación. Grande en la portada, donde invita a hablar; mediano en el dock de la
 * conversación, donde acompaña al gráfico sin competir con él.
 *
 * Reposo, escucha y trabajo tienen animaciones distintas a propósito. Si todo latiera
 * igual, el usuario no sabría si el agente lo está escuchando o si está pensando.
 */

interface VoiceOrbProps {
  stage: Stage;
  /** El agente está hablando. */
  isSpeaking: boolean;
  /** El micrófono está silenciado. */
  isMuted: boolean;
  /** Hay sesión de voz abierta. Sin sesión, hacer clic la abre; con sesión, silencia. */
  connected: boolean;
  onPress: () => void;
  size?: "lg" | "md";
}

const SIZES = {
  lg: { wrapper: "h-32 w-32", button: "h-24 w-24", icon: "h-9 w-9" },
  md: { wrapper: "h-[88px] w-[88px]", button: "h-[72px] w-[72px]", icon: "h-7 w-7" },
} as const;

export function VoiceOrb({ stage, isSpeaking, isMuted, connected, onPress, size = "lg" }: VoiceOrbProps) {
  const dims = SIZES[size];
  // Con reduced motion no late ni respira (FR-022): escuchar se marca con un anillo fijo y
  // el resto del estado lo sigue diciendo el indicador de etapa.
  const reduced = usePrefersReducedMotion();
  const listening = stage === "listening" && !isMuted;
  const working = !reduced && stage !== "idle" && stage !== "listening";
  const speaking = !reduced && isSpeaking;

  return (
    <div className={`relative flex shrink-0 items-center justify-center ${dims.wrapper}`}>
      {/* Ondas de escucha: solo cuando el micrófono está abierto de verdad. */}
      {listening && reduced ? (
        <span className="absolute rounded-[50%]" style={{ border: "1.5px solid var(--brand)", inset: 4 }} />
      ) : null}
      {listening && !reduced
        ? [0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="absolute rounded-[50%]"
              style={{ border: "1.5px solid var(--brand)", inset: 0 }}
              initial={{ scale: 0.72, opacity: 0.55 }}
              animate={{ scale: 1.25, opacity: 0 }}
              transition={{ duration: 2.1, repeat: Infinity, delay: i * 0.7, ease: "easeOut" }}
            />
          ))
        : null}

      <motion.button
        type="button"
        onClick={onPress}
        aria-label={
          !connected ? "Empezar a hablar" : isMuted ? "Activar micrófono" : "Silenciar micrófono"
        }
        aria-pressed={connected ? isMuted : undefined}
        className={`relative flex items-center justify-center rounded-[50%] shadow-overlay ${dims.button}`}
        style={{ background: "var(--stat-gradient)", color: "var(--text-on-brand)" }}
        animate={
          working
            ? // Trabajando: respiración lenta y continua, para que nunca quede quieto.
              { scale: [1, 1.045, 1], filter: ["brightness(1)", "brightness(1.1)", "brightness(1)"] }
            : speaking
              ? // Hablando: pulso corto, al ritmo de la voz.
                { scale: [1, 1.08, 1] }
              : { scale: 1 }
        }
        transition={
          working
            ? { duration: 2.2, repeat: Infinity, ease: "easeInOut" }
            : speaking
              ? { duration: 0.6, repeat: Infinity, ease: "easeInOut" }
              : { duration: 0.3 }
        }
        whileTap={{ scale: 0.96 }}
      >
        {isMuted ? <MicOffIcon className={dims.icon} /> : <MicIcon className={dims.icon} animated={listening && !reduced} />}
      </motion.button>
    </div>
  );
}

function MicIcon({ animated, className }: { animated: boolean; className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <motion.rect
        x="9" y="3" width="6" height="11" rx="3"
        animate={animated ? { opacity: [1, 0.65, 1] } : { opacity: 1 }}
        transition={{ duration: 1.6, repeat: animated ? Infinity : 0 }}
      />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </svg>
  );
}

function MicOffIcon({ className }: { className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M9 9v-.5a3 3 0 0 1 6 0V11" />
      <path d="M15 14.5a3 3 0 0 1-6-.5v-3" />
      <path d="M5 11a7 7 0 0 0 10.5 6.05" />
      <path d="M19 11a7 7 0 0 0-.2-1.6" />
      <path d="M12 18v3" />
      <path d="M3 3l18 18" />
    </svg>
  );
}
