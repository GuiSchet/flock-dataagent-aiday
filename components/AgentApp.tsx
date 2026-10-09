"use client";

import * as React from "react";
import { AnimatePresence, motion } from "motion/react";
import { useConversationInput, useConversationMode } from "@elevenlabs/react";
import { AppHeader } from "@/components/AppHeader";
import { Dashboard } from "@/components/Dashboard";
import { GeneratedView } from "@/components/GeneratedView";
import { IntentRibbon } from "@/components/IntentRibbon";
import { SkeletonChart } from "@/components/SkeletonChart";
import { StageIndicator } from "@/components/StageIndicator";
import { useRotatingExample } from "@/components/useRotatingExample";
import { VoiceOrb } from "@/components/VoiceOrb";
import { useVoice, useVoiceEvents, VoiceSession, type VoicePhase } from "@/components/VoiceSession";
import { VoiceTools } from "@/components/VoiceTools";
import { SessionProvider, useSession } from "@/contexts/SessionContext";
import { STAGES, type Stage } from "@/lib/conversation/stages";
import type { Dashboard as DashboardData } from "@/lib/dashboard/tablero";
import type { DataOverview } from "@/lib/data/overview";
import { usePrefersReducedMotion } from "@/lib/viz/components/ChartFrame";
import { parseHighlight } from "@/lib/viz/components/highlight";
import { primaryChartType } from "@/lib/viz/schema";

/**
 * La pantalla del producto, pensada para un navegador de escritorio.
 *
 * Tiene dos modos:
 * - **Tablero** (sin conversación y sin nada en pantalla): qué es esto, los indicadores fijos
 *   de la nómina y qué más se puede preguntar.
 * - **Conversación** (con la sesión abierta, o con un gráfico en pantalla aunque la voz se
 *   haya cortado): lo que el agente entendió, el gráfico grande y, abajo, el dock de voz.
 *
 * Los gráficos del tablero son fijos. Cualquier otro se pide hablando: no hay selector,
 * formulario ni botón que arme una visualización (principio I).
 */
interface AgentAppProps {
  examples: string[];
  overview: DataOverview;
  dashboard: DashboardData;
}

export function AgentApp(props: AgentAppProps) {
  return (
    <VoiceSession>
      <SessionProvider>
        <VoiceTools />
        <AgentScreen {...props} />
      </SessionProvider>
    </VoiceSession>
  );
}

function AgentScreen({ examples, overview, dashboard }: AgentAppProps) {
  const voice = useVoice();
  const { isSpeaking } = useConversationMode();
  const { isMuted, setMuted } = useConversationInput();
  const { state, streaming, tools, markSkeleton, reset } = useSession();

  useVoiceEvents({
    // El agente decidió usar un tool: ya entendió el pedido y lo está traduciendo.
    onAgentToolRequest: () => {
      if (state.stage === "idle") tools.setStage("interpreting");
    },
  });

  const stage = displayStage(state.stage, streaming !== null, voice.phase, isSpeaking);
  const connected = voice.phase === "connected";

  // Qué se ve, en orden de prioridad:
  // 1. el gráfico que se está materializando, apenas tiene algún dato (al refinar con las
  //    mismas columnas es el gráfico anterior interpolando hacia el nuevo);
  // 2. si se compone desde cero y todavía no llegó nada, el esqueleto del gráfico que viene;
  // 3. el último gráfico terminado, o la escucha.
  const composing = state.pending?.resolved ?? null;
  const shown = streaming ?? (composing ? null : state.view);

  const valueKeys = state.current?.meta.valueKeys;
  const highlight = React.useMemo(
    () => parseHighlight(state.highlight, valueKeys && valueKeys.length > 1 ? valueKeys : []),
    [state.highlight, valueKeys],
  );

  // Hay conversación si la sesión está abierta o si queda algo de ella en pantalla. Cuando el
  // agente corta, el gráfico se queda: en una PC no hay otra persona esperando el turno.
  const inConversation = connected || shown !== null || composing !== null || state.current !== null;

  // Volver al tablero es cortar la voz y borrar lo que había.
  const { stop, start } = voice;
  const backToDashboard = React.useCallback(() => {
    stop();
    reset();
  }, [stop, reset]);

  const talk = React.useCallback(() => {
    if (voice.phase !== "starting" && voice.phase !== "connected") start();
  }, [voice.phase, start]);

  const onOrbPress = () => {
    if (connected) setMuted(!isMuted);
    else talk();
  };

  const reduced = usePrefersReducedMotion();
  const swap = {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    transition: { duration: reduced ? 0.12 : 0.2 },
  };

  const orb = (size: "lg" | "md") => (
    <VoiceOrb
      size={size}
      stage={stage}
      isSpeaking={isSpeaking}
      isMuted={isMuted}
      connected={connected}
      onPress={onOrbPress}
    />
  );

  // El modo conversación: lo entendido, avisos y lo que se está dibujando. Es un elemento y no
  // un componente anidado: un componente definido acá tendría otra identidad en cada render y
  // remontaría el gráfico, que perdería la interpolación de Recharts.
  const conversation = (
    <div data-stage-view className="flex w-full flex-col gap-4 py-6">
      <IntentRibbon description={state.current?.description ?? null} />

      {state.notice ? (
        <p className="type-body" role="status" style={{ color: "var(--state-blocked-fg)" }}>
          {state.notice}
        </p>
      ) : null}

      <AnimatePresence mode="wait">
        {shown ? (
          <motion.div
            // La key es el tipo del gráfico principal. Mientras no cambia, el gráfico en
            // curso y el terminado son la misma instancia y Recharts interpola los datos
            // (FR-021). Si cambia —barras a torta—, fundido cruzado en vez de un salto (T045).
            key={`view:${primaryChartType(shown.spec) ?? "vista"}`}
            className="w-full"
            initial={{ opacity: 0, scale: 0.985 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.985 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
          >
            <GeneratedView spec={shown.spec} rows={shown.rows} stats={shown.stats} highlight={highlight} />
          </motion.div>
        ) : composing ? (
          <motion.div
            // Un esqueleto por pedido: si llega otro antes de terminar, se remonta y mide
            // su propio primer píxel.
            key={`skeleton:${composing.description}:${composing.intent.chartType}`}
            className="w-full"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <SkeletonChart
              chartType={composing.intent.chartType}
              title={composing.intent.title}
              subtitle={composing.subtitle}
              onShown={markSkeleton}
            />
          </motion.div>
        ) : (
          <ListeningPrompt key="escucha" stage={stage} examples={examples} overview={overview} />
        )}
      </AnimatePresence>
    </div>
  );

  return (
    <div className="flex min-h-dvh w-full flex-col">
      <AppHeader
        mode={inConversation ? "conversation" : "home"}
        cutoff={overview.cutoff}
        onTalk={talk}
        onBack={backToDashboard}
        starting={voice.phase === "starting"}
      />

      {/* El lugar de la barra de desplazamiento queda reservado: si aparece y desaparece, el
          ancho del gráfico cambia, Recharts reinicia la animación a mitad de camino y las
          etiquetas de valor, que espera al final de la animación para mostrar, pueden no
          volver. */}
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-6 [scrollbar-gutter:stable]">
        <AnimatePresence mode="wait" initial={false}>
          {inConversation ? (
            <motion.div key="conversacion" className="flex w-full flex-1 flex-col" {...swap}>
              {conversation}
            </motion.div>
          ) : (
            <motion.div key="tablero" className="w-full" {...swap}>
              <Dashboard
                dashboard={dashboard}
                overview={overview}
                examples={examples}
                voice={
                  <>
                    {orb("lg")}
                    <VoiceStatus isSpeaking={isSpeaking} />
                  </>
                }
              />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {inConversation ? (
        // El dock de voz: siempre visible abajo, aunque el gráfico obligue a desplazar.
        <footer
          className="sticky bottom-0 z-10 w-full border-t"
          style={{ background: "var(--brand-softer)", borderColor: "var(--border)" }}
        >
          <div className="mx-auto flex w-full max-w-7xl items-center justify-center gap-5 px-6 py-3">
            {orb("md")}
            {/* Alto reservado: el indicador aparece y desaparece en cada turno y el dock no
                tiene que saltar. */}
            <div className="flex min-h-[44px] min-w-[280px] items-center">
              {stage !== "idle" ? <StageIndicator stage={stage} /> : <VoiceStatus isSpeaking={isSpeaking} />}
            </div>
          </div>
        </footer>
      ) : null}
    </div>
  );
}

/**
 * La etapa que se muestra combina dos fuentes: la tubería (consultando, componiendo) y la
 * voz (escuchando). La tubería manda mientras trabaja; si no, escucha quien tiene la sesión
 * abierta y no está hablando.
 */
function displayStage(
  pipeline: Stage,
  hasStreamingContent: boolean,
  phase: VoicePhase,
  isSpeaking: boolean,
): Stage {
  // Apenas hay algo del spec que se puede montar, deja de ser "armando" y pasa a "dibujando".
  if (pipeline === "composing" && hasStreamingContent) return "rendering";
  if (pipeline !== "idle") return pipeline;
  return phase === "connected" && !isSpeaking ? "listening" : "idle";
}

function VoiceStatus({ isSpeaking }: { isSpeaking: boolean }) {
  const { phase, problem, reconnecting, start } = useVoice();

  if (reconnecting) {
    return (
      <p className="type-body" role="status" style={{ color: "var(--text-soft)" }}>
        Se cortó la conexión de voz. Reconectando…
      </p>
    );
  }

  if (problem) {
    return (
      <div className="flex max-w-[46ch] flex-col items-center gap-2.5 text-center" role="alert">
        <p className="type-body" style={{ color: "var(--state-blocked-fg)" }}>
          {problem.message}
        </p>
        {/* Botón primario del design system §5: blanco sobre marca. */}
        <button
          type="button"
          onClick={start}
          className="rounded-button px-4 py-[9px] text-[13px] font-semibold"
          style={{ background: "var(--brand)", color: "var(--text-on-brand)" }}
        >
          Reintentar
        </button>
      </div>
    );
  }

  const hint: Record<VoicePhase, string | null> = {
    idle: "Hacé clic para hablar",
    starting: "Conectando…",
    connected: isSpeaking ? "Te está respondiendo" : null,
    ended: "La conversación terminó. Hacé clic en el micrófono para seguir.",
  };

  return hint[phase] ? (
    <p className="type-body" style={{ color: "var(--text-soft)" }}>
      {hint[phase]}
    </p>
  ) : null;
}

/**
 * Conversación abierta y todavía sin gráfico: qué está pasando y, si se está escuchando, un
 * recordatorio de sobre qué se puede preguntar.
 */
function ListeningPrompt({ stage, examples, overview }: { stage: Stage; examples: string[]; overview: DataOverview }) {
  const reduced = usePrefersReducedMotion();
  const example = useRotatingExample(examples);
  // Mientras la tubería trabaja, el titular dice la etapa; escuchando, se muestran ejemplos.
  const resting = stage === "idle" || stage === "listening";
  const topics = overview.topics.map((t) => t.title.toLowerCase());
  const topicsText = topics.length > 1 ? `${topics.slice(0, -1).join(", ")} y ${topics.at(-1)}` : topics.join("");

  return (
    <motion.div
      className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center"
      initial={{ opacity: 0, y: reduced ? 0 : 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: reduced ? 0 : -10 }}
    >
      <h1 className="type-display max-w-[24ch]" style={{ color: "var(--text)" }}>
        {STAGES[stage].label}
      </h1>
      {resting ? (
        <>
          <p className="type-body max-w-[52ch]" style={{ color: "var(--text-soft)" }}>
            Podés preguntar por {topicsText}. Si falta algo para dibujarlo, te lo pregunto antes.
          </p>
          {example ? (
            <p className="flex min-h-[28px] flex-wrap items-baseline justify-center gap-x-2" aria-live="off">
              <span className="type-body" style={{ color: "var(--text-soft)" }}>
                Por ejemplo:
              </span>
              <AnimatePresence mode="wait">
                <motion.span
                  key={example}
                  className="type-card"
                  style={{ color: "var(--brand)" }}
                  initial={{ opacity: 0, y: reduced ? 0 : 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: reduced ? 0 : -6 }}
                  transition={{ duration: reduced ? 0.12 : 0.3 }}
                >
                  “{example}”
                </motion.span>
              </AnimatePresence>
            </p>
          ) : null}
        </>
      ) : null}
    </motion.div>
  );
}
