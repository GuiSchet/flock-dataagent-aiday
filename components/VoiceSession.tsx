"use client";

import * as React from "react";
import {
  ConversationProvider,
  useConversationControls,
  useConversationStatus,
  type DisconnectionDetails,
} from "@elevenlabs/react";

/**
 * La sesión de voz con ElevenLabs, por WebRTC.
 *
 * Escrito contra `@elevenlabs/react` 1.15 (contracts/voice-session.md): el provider es
 * obligatorio, `startSession()` devuelve `void` y el estado se lee con los hooks
 * granulares. Nada del patrón 0.5.x de vistaenergy.
 *
 * La regla que ordena todo lo de acá: **una caída nunca saca al usuario de la pantalla ni
 * borra el gráfico**. Los errores se muestran con su motivo y un reintento, y el resto de
 * la interfaz sigue en pie.
 */

export type VoiceProblem =
  | { kind: "mic"; message: string }
  | { kind: "token"; message: string }
  | { kind: "connection"; message: string };

export type VoicePhase = "idle" | "starting" | "connected" | "ended";

interface VoiceValue {
  phase: VoicePhase;
  problem: VoiceProblem | null;
  /** Se cortó por un error y hay un reintento automático en camino (T103). */
  reconnecting: boolean;
  start: () => void;
  stop: () => void;
}

/**
 * Reintentos automáticos cuando la conexión se cae por un error: a los 3 s y a los 8 s.
 * Después queda el botón. No se reintenta si el agente cortó a propósito (silencio largo o
 * duración máxima): eso quiere decir que la persona se fue.
 */
const RETRY_DELAYS_MS = [3000, 8000];

const VoiceContext = React.createContext<VoiceValue | null>(null);

export function useVoice(): VoiceValue {
  const value = React.useContext(VoiceContext);
  if (!value) throw new Error("useVoice necesita estar dentro de <VoiceSession>.");
  return value;
}

/** Eventos de la conversación que el resto de la app escucha sin tocar el provider. */
export interface VoiceEvents {
  onInterruption?: () => void;
  onAgentToolRequest?: (toolName: string) => void;
  /** La persona terminó de hablar: llegó su transcripción. Es el origen de la latencia. */
  onUserTurn?: () => void;
  onConnected?: () => void;
  /** La sesión se cayó por un error (no porque el agente o la persona la cerraron). */
  onDropped?: () => void;
}

type Listener = React.RefObject<VoiceEvents>;
const VoiceEventsContext = React.createContext<Set<Listener> | null>(null);

/**
 * Suscribe a eventos de la conversación. Puede haber varios suscriptores (la pantalla mira
 * los tools, la sesión mide la latencia), y cada uno ve siempre sus callbacks más nuevos.
 */
export function useVoiceEvents(events: VoiceEvents) {
  const listeners = React.useContext(VoiceEventsContext);
  const latest = React.useRef(events);
  React.useEffect(() => {
    latest.current = events;
  });
  React.useEffect(() => {
    if (!listeners) return;
    listeners.add(latest);
    return () => {
      listeners.delete(latest);
    };
  }, [listeners]);
}

export function VoiceSession({ children }: { children: React.ReactNode }) {
  const [isMuted, setIsMuted] = React.useState(false);
  const [disconnect, setDisconnect] = React.useState<DisconnectionDetails | null>(null);
  const [listeners] = React.useState(() => new Set<Listener>());
  const emit = (fn: (events: VoiceEvents) => void) => listeners.forEach((l) => fn(l.current));
  const clearDisconnect = React.useCallback(() => setDisconnect(null), []);

  return (
    <ConversationProvider
      connectionType="webrtc"
      isMuted={isMuted}
      onMutedChange={setIsMuted}
      onConnect={({ conversationId }) => {
        setDisconnect(null);
        emit((e) => e.onConnected?.());
        // El id sirve para buscar la conversación en ElevenLabs y ver qué parámetros
        // mandó el agente en cada tool call.
        console.info("[voz] Conectado. conversation_id:", conversationId);
      }}
      onDisconnect={(raw) => {
        const details = classifyDisconnect(raw);
        console.info("[voz] Desconectado:", describeDisconnect(raw));
        setDisconnect(details);
        if (details.reason === "error") emit((e) => e.onDropped?.());
      }}
      onError={(message, context) => console.error("[voz] Error:", message, context)}
      // La transcripción no se muestra: la pantalla exhibe lo que el agente entendió, no lo
      // que se dijo. Queda en consola para diagnóstico.
      onMessage={({ role, message }) => {
        console.debug(`[voz] ${role}:`, message);
        if (role === "user") emit((e) => e.onUserTurn?.());
      }}
      onInterruption={() => emit((e) => e.onInterruption?.())}
      onAgentToolRequest={({ tool_name }) => emit((e) => e.onAgentToolRequest?.(tool_name))}
      onUnhandledClientToolCall={(call) =>
        // Un tool que el agente llama y el navegador no tiene registrado: los nombres de
        // elevenlabs/tools.ts y de VoiceTools.tsx no coinciden.
        console.error("[voz] Tool sin handler:", call.tool_name, call.parameters)
      }
    >
      <VoiceEventsContext.Provider value={listeners}>
        <VoiceLifecycle disconnect={disconnect} clearDisconnect={clearDisconnect}>
          {children}
        </VoiceLifecycle>
      </VoiceEventsContext.Provider>
    </ConversationProvider>
  );
}

function VoiceLifecycle({
  children,
  disconnect,
  clearDisconnect,
}: {
  children: React.ReactNode;
  disconnect: DisconnectionDetails | null;
  clearDisconnect: () => void;
}) {
  const { startSession, endSession } = useConversationControls();
  const { status, message } = useConversationStatus();
  const [starting, setStarting] = React.useState(false);
  const [problem, setProblem] = React.useState<VoiceProblem | null>(null);
  const [reconnecting, setReconnecting] = React.useState(false);
  // Cada `stop()` abre una generación nueva. Un arranque que empezó antes (esperando el
  // micrófono o el token, o una reconexión programada) ve que cambió y no abre la sesión:
  // si no, "Terminar" durante una reconexión volvería a conectar a los pocos segundos.
  const generation = React.useRef(0);

  const start = React.useCallback(async () => {
    const mine = generation.current;
    setProblem(null);
    clearDisconnect();
    setStarting(true);

    // 1. Permiso de micrófono ANTES del token: si lo deniegan, no se quema un token.
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // 2. Cerrar el stream de prueba. Si queda abierto, el indicador de micrófono del
      //    navegador sigue prendido con un stream huérfano.
      stream.getTracks().forEach((track) => track.stop());
    } catch (error) {
      setStarting(false);
      setProblem({ kind: "mic", message: micMessage(error) });
      return;
    }

    // 3. Token efímero. La clave de ElevenLabs no sale del servidor.
    let token: string;
    try {
      const response = await fetch("/api/conversation-token", { cache: "no-store" });
      const body = (await response.json()) as { token?: string; message?: string };
      if (!response.ok || !body.token) {
        throw new Error(body.message ?? "No se pudo abrir la sesión de voz.");
      }
      token = body.token;
    } catch (error) {
      setStarting(false);
      setProblem({
        kind: "token",
        message: error instanceof Error ? error.message : "No se pudo abrir la sesión de voz.",
      });
      return;
    }

    if (generation.current !== mine) return;

    // 4. Abrir la sesión. Devuelve void: el resultado llega por onConnect / onError.
    startSession({ conversationToken: token });
    setStarting(false);
  }, [startSession, clearDisconnect]);

  const stop = React.useCallback(() => {
    generation.current += 1;
    setStarting(false);
    setReconnecting(false);
    endSession();
  }, [endSession]);

  // Reconexión: se cuenta en un ref (sólo lo tocan los callbacks) y se muestra con estado.
  const retries = React.useRef(0);
  useVoiceEvents({
    onConnected: () => {
      retries.current = 0;
      setReconnecting(false);
    },
    onDropped: () => {
      const delay = RETRY_DELAYS_MS[retries.current];
      if (delay === undefined) {
        setReconnecting(false);
        return;
      }
      retries.current += 1;
      setReconnecting(true);
      const mine = generation.current;
      window.setTimeout(() => {
        if (generation.current === mine) void start();
      }, delay);
    },
  });

  // El SDK reporta la caída con su texto técnico ("LiveKit connection state changed to
  // disconnected"): sirve para diagnosticar, no para quien está usando la app.
  const technical = status === "error" ? message : disconnect?.reason === "error" ? disconnect.message : null;
  React.useEffect(() => {
    if (technical) console.warn("[voz] Detalle de la caída:", technical);
  }, [technical]);

  const lost = status === "error" || disconnect?.reason === "error";
  const connectionProblem = React.useMemo<VoiceProblem | null>(
    () =>
      lost
        ? {
            kind: "connection",
            message: "Se cortó la conexión de voz. Hacé clic en Reintentar para seguir; lo que está en pantalla no se pierde.",
          }
        : null,
    [lost],
  );

  const phase: VoicePhase =
    status === "connected"
      ? "connected"
      : starting || status === "connecting"
        ? "starting"
        : disconnect?.reason === "agent"
          ? "ended"
          : "idle";

  const value = React.useMemo<VoiceValue>(
    () => ({
      phase,
      problem: problem ?? connectionProblem,
      reconnecting,
      start: () => void start(),
      stop,
    }),
    [phase, problem, connectionProblem, reconnecting, start, stop],
  );

  return <VoiceContext.Provider value={value}>{children}</VoiceContext.Provider>;
}

/**
 * Los motivos de LiveKit (`DisconnectReason`) que no son que el agente terminó la charla,
 * sino que se cayó la conexión: la señalización se cerró, venció un timeout o fallaron los
 * medios. Los números son los del protocolo de LiveKit.
 */
const CONNECTION_DROPS: Record<string, string> = {
  "6": "STATE_MISMATCH",
  "7": "JOIN_FAILURE",
  "9": "SIGNAL_CLOSE",
  "14": "CONNECTION_TIMEOUT",
  "15": "MEDIA_FAILURE",
};

const LIVEKIT_REASONS: Record<string, string> = {
  "0": "UNKNOWN_REASON",
  "1": "CLIENT_INITIATED",
  "3": "SERVER_SHUTDOWN",
  "4": "PARTICIPANT_REMOVED",
  "5": "ROOM_DELETED",
  "10": "ROOM_CLOSED",
  "16": "AGENT_ERROR",
  ...CONNECTION_DROPS,
};

/**
 * El SDK de ElevenLabs informa cualquier desconexión de la sala de LiveKit como `agent`,
 * aunque haya sido una caída de la señalización (en consola, "error reading from signal
 * stream"). Con eso la pantalla decía "la conversación terminó" y no reintentaba. Acá una
 * caída de conexión vuelve a ser un error, que es lo que dispara el reintento.
 */
function classifyDisconnect(details: DisconnectionDetails): DisconnectionDetails {
  if (details.reason !== "agent") return details;
  const livekit = details.context?.reason;
  if (livekit === undefined || !(livekit in CONNECTION_DROPS)) return details;
  return {
    reason: "error",
    message: `LiveKit ${CONNECTION_DROPS[livekit]}`,
    context: details.context ?? { type: "close" },
  };
}

/** Para diagnosticar: el motivo de ElevenLabs y, si lo hay, el de LiveKit por nombre. */
function describeDisconnect(details: DisconnectionDetails): string {
  if (details.reason === "user") return "user";
  const livekit = details.context?.reason;
  const parts: string[] = [details.reason];
  if (livekit !== undefined) parts.push(`LiveKit ${LIVEKIT_REASONS[livekit] ?? livekit}`);
  if (details.closeCode !== undefined) parts.push(`código ${details.closeCode}`);
  if (details.reason === "error") parts.push(details.message);
  return parts.join(" · ");
}

function micMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "El navegador no me dejó usar el micrófono. Habilitalo desde el candado de la barra de direcciones y probá de nuevo.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return "No encuentro ningún micrófono conectado.";
  }
  if (name === "NotReadableError") {
    return "El micrófono está en uso por otra aplicación.";
  }
  return "No pude acceder al micrófono.";
}
