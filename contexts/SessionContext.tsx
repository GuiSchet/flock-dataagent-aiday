"use client";

import * as React from "react";
import { useUIStream } from "@json-render/react";
import { useConversationControls } from "@elevenlabs/react";
import { useVoiceEvents } from "@/components/VoiceSession";
import { availableStats, type ResultStats } from "@/lib/conversation/answers";
import { EMPTY_HISTORY, push, type History } from "@/lib/conversation/history";
import type { Resolved } from "@/lib/conversation/resolve";
import type { Stage } from "@/lib/conversation/stages";
import type { ToolSession } from "@/lib/conversation/tools";
import type { ResultRow } from "@/lib/data/types";
import {
  formatIssues,
  harmonizeHeadings,
  hasVisualContent,
  renderableSubset,
  stripModelState,
  validateVizSpec,
  type ValidationContext,
  type VizSpec,
} from "@/lib/viz/schema";

/**
 * El estado de la sesión: qué se pidió, qué datos salieron y qué se está dibujando.
 *
 * Hay dos cosas que parecen una y no lo son:
 *
 * - `current` es el resultado vigente para la conversación: sobre él se refina y se
 *   pregunta. Cambia apenas vuelve la consulta, en milisegundos.
 * - `view` es lo que está en pantalla: un spec **ya validado** junto con las filas para las
 *   que se compuso. Cambia recién cuando termina la composición, o nunca si el spec falla.
 *
 * Mantenerlos separados es lo que permite que el agente hable mientras el gráfico se
 * dibuja (D13), y que un spec inválido deje el gráfico anterior intacto (principio II)
 * volviendo `current` y la pila a como estaban.
 */

export interface View {
  spec: VizSpec;
  rows: ResultRow[];
  stats: ResultStats;
}

interface Pending {
  resolved: Resolved;
  attempt: 1 | 2;
  /** A dónde volver si la composición falla. */
  rollback: { history: History; current: Resolved | null };
}

interface SessionState {
  history: History;
  current: Resolved | null;
  view: View | null;
  pending: Pending | null;
  /** Etapa de la tubería. Escuchar y hablar los aporta la sesión de voz. */
  stage: Stage;
  /** Aviso visible cuando algo no se pudo dibujar. */
  notice: string | null;
  /** La categoría que el agente está nombrando en voz (T061). */
  highlight: string | null;
}

const INITIAL: SessionState = {
  history: EMPTY_HISTORY,
  current: null,
  view: null,
  pending: null,
  stage: "idle",
  notice: null,
  highlight: null,
};

interface SessionValue {
  state: SessionState;
  /**
   * Lo que se está materializando: los elementos del spec parcial que ya validan, en cuanto
   * alguno muestra datos. Mientras tanto es null y la pantalla muestra el esqueleto.
   */
  streaming: View | null;
  tools: ToolSession;
  /** El esqueleto ya está en pantalla: cuenta como primer píxel (SC-004). */
  markSkeleton: () => void;
  /**
   * Vuelve todo a cero: pila, gráfico, ribbon, avisos. Es lo que pasa entre una persona y la
   * siguiente (T102): nadie tiene que encontrarse el gráfico que pidió otro.
   */
  reset: () => void;
}

const SessionContext = React.createContext<SessionValue | null>(null);

export function useSession(): SessionValue {
  const value = React.useContext(SessionContext);
  if (!value) throw new Error("useSession necesita estar dentro de <SessionProvider>.");
  return value;
}

interface Latency {
  /** Fin del turno de la persona, o el momento del tool si la transcripción no llegó antes. */
  origin: number;
  fromTurn: boolean;
  /** Apareció el esqueleto del gráfico que viene. */
  skeleton: number | null;
  /** Apareció el primer elemento con datos. */
  element: number | null;
}

/**
 * Una línea por gráfico con su latencia, para SC-004: algo dibujado en menos de 2 s desde el
 * fin del turno, y completo en menos de 6. El banco de pruebas por voz la lee de la consola.
 */
function logLatency(
  latencyRef: React.RefObject<Latency | null>,
  vista: string,
  extra: Record<string, unknown> = {},
) {
  const latency = latencyRef.current;
  if (!latency) return;
  const now = performance.now();
  const since = (t: number | null) => (t === null ? null : Math.round(t - latency.origin));
  const painted = [latency.skeleton, latency.element].filter((t): t is number => t !== null);
  console.info(
    "[latencia]",
    JSON.stringify({
      vista,
      desde: latency.fromTurn ? "fin del turno" : "tool",
      // Lo primero que se dibujó del gráfico nuevo, sea el esqueleto o un elemento real.
      primerPixel: painted.length > 0 ? since(Math.min(...painted)) : null,
      esqueleto: since(latency.skeleton),
      primerElemento: since(latency.element),
      completo: Math.round(now - latency.origin),
      ...extra,
    }),
  );
  latencyRef.current = null;
}

/** Cuánto dura el resaltado de una categoría nombrada en voz. */
const HIGHLIGHT_MS = 8000;

/** Prefijo de los avisos que la app le manda al agente como mensaje. Ver agent.config.ts. */
const APP_NOTICE = "[aviso de la app, no lo dijo la persona]";

/** Lo que la validación necesita del resultado: cuántas filas y qué hay en `/stats`. */
function validationContext(resolved: Resolved): ValidationContext {
  return { rowCount: resolved.result.rowCount, stats: availableStats(resolved.stats) };
}

/** Mismas columnas = el spec anterior sirve de base y Recharts interpola en vez de remontar. */
function sameColumns(a: Resolved | null, b: Resolved): boolean {
  const keys = (r: Resolved) => (r.shape.columns ?? []).map((c) => c.key).join("|");
  return a !== null && keys(a) === keys(b);
}

function composePrompt(resolved: Resolved, issues?: string): string {
  const lines = [`Armá la vista "${resolved.intent.title}": ${resolved.description}.`];
  if (resolved.intent.assumptions.length > 0) {
    lines.push(`Decisiones ya tomadas: ${resolved.intent.assumptions.join("; ")}.`);
  }
  if (issues) {
    lines.push(
      "",
      "El intento anterior se rechazó por estos problemas. Corregilos todos:",
      issues,
    );
  }
  return lines.join("\n");
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const { sendUserMessage } = useConversationControls();

  // Los handlers de los tools leen de acá, no del estado de React: dos tool calls seguidos
  // no pueden esperar a un re-render para ver lo que dejó el anterior.
  const ref = React.useRef<SessionState>(INITIAL);
  const [state, setState] = React.useState<SessionState>(INITIAL);
  const update = React.useCallback((fn: (s: SessionState) => SessionState) => {
    ref.current = fn(ref.current);
    setState(ref.current);
  }, []);

  // SC-004 se mide desde el fin del turno hablado: la transcripción de la persona. Si el tool
  // llega antes que la transcripción, el origen es el tool y la línea lo dice.
  const lastTurnRef = React.useRef<number | null>(null);
  const latencyRef = React.useRef<Latency | null>(null);
  useVoiceEvents({
    onUserTurn: () => {
      lastTurnRef.current = performance.now();
    },
  });

  /**
   * La composición falló del todo: se conserva el gráfico anterior, se deshace el paso en
   * la pila y el agente lo dice en voz (principio II: degradar con gracia, nunca romper).
   */
  const giveUp = React.useCallback(
    (reason: string) => {
      const pending = ref.current.pending;
      if (!pending) return;
      console.warn("[componer] Se descarta la visualización:", reason);
      logLatency(latencyRef, pending.resolved.description, { fallo: true });
      update((s) => ({
        ...s,
        history: pending.rollback.history,
        current: pending.rollback.current,
        pending: null,
        stage: "idle",
        notice: pending.rollback.current
          ? "No pude dibujar ese gráfico. Dejé el anterior."
          : "No pude dibujar ese gráfico.",
      }));
      // Por qué un mensaje y no `sendContextualUpdate`: el tool ya devolvió "dibujado" (D13) y
      // el agente probablemente dijo "listo". Un contextual update no lo hace hablar, así que
      // la persona se quedaba con un "listo" falso. El mensaje sí: si el agente está
      // hablando, lo interrumpe y lo corrige. Va marcado para que el agente no lo tome como
      // algo que dijo la persona (regla en elevenlabs/agent.config.ts), y la transcripción no
      // se muestra en pantalla, así que no ensucia nada visible (voice-session.md).
      try {
        sendUserMessage(
          `${APP_NOTICE} El gráfico de "${pending.resolved.description}" no se pudo dibujar${
            pending.rollback.current
              ? ` y quedó en pantalla el anterior (${pending.rollback.current.description})`
              : ""
          }. Decíselo a la persona en una frase, corregí lo que hayas dicho sobre ese gráfico y ofrecé intentarlo de otra forma.`,
        );
      } catch {
        // La sesión de voz se cayó mientras se componía: el aviso queda en pantalla.
      }
    },
    [update, sendUserMessage],
  );

  const sendRef = React.useRef<ReturnType<typeof useUIStream>["send"] | null>(null);

  const stream = useUIStream({
    api: "/api/compose",
    onComplete: (spec) => {
      const pending = ref.current.pending;
      if (!pending) return;

      const outcome = validateVizSpec(spec, validationContext(pending.resolved));
      if (outcome.ok) {
        // No son errores: la validación corrigió algo sola y lo deja registrado.
        for (const warning of outcome.warnings) console.info("[componer]", warning);
        logLatency(latencyRef, pending.resolved.description);
        update((s) => ({
          ...s,
          view: {
            spec: harmonizeHeadings(stripModelState(outcome.spec), pending.resolved.shape),
            rows: pending.resolved.result.rows,
            stats: pending.resolved.stats,
          },
          pending: null,
          stage: "idle",
          notice: null,
        }));
        return;
      }

      const issues = formatIssues(outcome.issues);
      console.warn("[componer] Spec inválido, intento", pending.attempt, "\n" + issues);

      if (pending.attempt === 1) {
        // Un reintento, con los problemas en el prompt y desde cero: parchear sobre un spec
        // inválido arrastraría el error.
        update((s) => ({ ...s, pending: { ...pending, attempt: 2 } }));
        void sendRef.current?.(composePrompt(pending.resolved, issues), { ...pending.resolved.shape });
        return;
      }

      giveUp("el reintento tampoco validó");
    },
    onError: (error) => giveUp(error.message),
  });

  // Los tools tienen que ser estables —el SDK los registra una vez— y `send` puede cambiar
  // de identidad. Se lee a través de un ref.
  React.useEffect(() => {
    sendRef.current = stream.send;
  });

  const tools = React.useMemo<ToolSession>(
    () => ({
      current: () => ref.current.current,
      history: () => ref.current.history,
      setStage: (stage) => update((s) => ({ ...s, stage })),
      highlight: (label) => update((s) => ({ ...s, highlight: label })),
      show: (resolved, nextHistory) => {
        latencyRef.current = {
          origin: lastTurnRef.current ?? performance.now(),
          fromTurn: lastTurnRef.current !== null,
          skeleton: null,
          element: null,
        };
        lastTurnRef.current = null;
        const s = ref.current;
        // Si había otra composición en curso, nunca llegó a pantalla: se la saltea en la
        // pila para que "volvé atrás" vuelva a lo que la persona vio de verdad.
        const settled = s.pending ? s.pending.rollback : { history: s.history, current: s.current };
        // Con las mismas columnas, el spec en pantalla sirve de base: el modelo emite
        // parches sobre él, las claves de los elementos se conservan y Recharts interpola
        // los datos nuevos en vez de remontar el gráfico (FR-021).
        const base = s.view && sameColumns(settled.current, resolved) ? s.view.spec : null;

        update((prev) => ({
          ...prev,
          history: nextHistory ?? push(settled.history, resolved.intent),
          current: resolved,
          pending: { resolved, attempt: 1, rollback: settled },
          stage: "composing",
          notice: null,
          highlight: null,
        }));

        // `send` aborta la composición anterior si la había. No se espera: el tool ya
        // devolvió y el agente está hablando.
        void sendRef.current?.(composePrompt(resolved), {
          ...resolved.shape,
          ...(base ? { previousSpec: base } : {}),
        });
      },
    }),
    [update],
  );

  const pending = state.pending;
  const streaming = React.useMemo<View | null>(() => {
    if (!pending) return null;
    const { resolved } = pending;
    const spec = renderableSubset(stream.spec, validationContext(resolved));
    return spec && hasVisualContent(spec)
      ? { spec: harmonizeHeadings(spec, resolved.shape), rows: resolved.result.rows, stats: resolved.stats }
      : null;
  }, [pending, stream.spec]);

  // Primer elemento con datos del gráfico nuevo montado en pantalla.
  React.useEffect(() => {
    const latency = latencyRef.current;
    if (streaming && latency && latency.element === null) latency.element = performance.now();
  }, [streaming]);

  // El resaltado acompaña la respuesta hablada y después se apaga solo.
  const highlighted = state.highlight;
  React.useEffect(() => {
    if (!highlighted) return;
    const id = window.setTimeout(() => {
      update((s) => (s.highlight === highlighted ? { ...s, highlight: null } : s));
    }, HIGHLIGHT_MS);
    return () => window.clearTimeout(id);
  }, [highlighted, update]);

  const { clear: clearStream } = stream;
  const reset = React.useCallback(() => {
    // Una composición que siga en vuelo llega sin `pending` y se ignora (ver onComplete).
    clearStream();
    latencyRef.current = null;
    lastTurnRef.current = null;
    update(() => INITIAL);
  }, [clearStream, update]);

  const markSkeleton = React.useCallback(() => {
    const latency = latencyRef.current;
    if (latency && latency.skeleton === null) latency.skeleton = performance.now();
  }, []);

  const value = React.useMemo<SessionValue>(
    () => ({ state, streaming, tools, markSkeleton, reset }),
    [state, streaming, tools, markSkeleton, reset],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
