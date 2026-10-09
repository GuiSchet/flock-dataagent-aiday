import { answerFromResult } from "./answers";
import { undo, type History } from "./history";
import type { Resolution, Resolved, ResolveRequest } from "./resolve";
import type { Stage } from "./stages";

/**
 * Los cinco client tools del agente de voz (contracts/voice-tools.md).
 *
 * Son funciones comunes sobre una interfaz de sesión, sin React: `VoiceTools.tsx` las
 * registra y `SessionContext` implementa la interfaz. Así se pueden leer de corrido, en el
 * orden en que las llama el agente, y probar sin montar nada.
 *
 * Reglas que valen para las cinco:
 *
 * - **Ninguna espera a un modelo.** `expects_response` traba la conversación hasta que el
 *   tool responde. `proposeVisualization` y `refineVisualization` devuelven apenas termina
 *   la consulta —milisegundos— y la composición del spec sigue en segundo plano.
 * - **Ninguna lanza.** Si un handler lanza, el SDK le manda al agente un error opaco. Acá
 *   todo error vuelve como `status: "error"` con un mensaje que se puede decir en voz.
 * - **Devuelven la cadena ya serializada**, que es el tipo que declara el SDK.
 */

/** Lo que los handlers necesitan de la sesión. */
export interface ToolSession {
  /** El resultado que está en pantalla, o el que se está dibujando. */
  current(): Resolved | null;
  history(): History;
  setStage(stage: Stage): void;
  /** Muestra un resultado resuelto: lo apila (o reemplaza la pila) y dispara la composición. */
  show(resolved: Resolved, nextHistory?: History): void;
  /** Resalta en el gráfico la categoría que el agente está nombrando (T061), o nada. */
  highlight(label: string | null): void;
}

export interface ToolDeps {
  resolve(request: ResolveRequest): Promise<Resolution>;
  catalog(): Promise<unknown>;
}

/** El `fetch` real contra las rutas de la app. */
export const httpDeps: ToolDeps = {
  async resolve(request) {
    const response = await fetch("/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    // 422 es un pedido que no se puede cumplir y trae su explicación: no es una falla.
    if (response.ok || response.status === 422) return (await response.json()) as Resolution;
    throw new Error(`/api/query respondió ${response.status}`);
  },
  async catalog() {
    const response = await fetch("/api/catalog");
    if (!response.ok) throw new Error(`/api/catalog respondió ${response.status}`);
    return response.json();
  },
};

type Params = Record<string, unknown>;
export type ToolHandler = (params: Params) => Promise<string>;

const reply = (payload: unknown) => JSON.stringify(payload);

const rejected = (r: { message: string; suggestion?: string }) =>
  reply({ status: "error", message: r.message, ...(r.suggestion ? { suggestion: r.suggestion } : {}) });

/**
 * Lo que el agente dice apenas vuelve el tool, mientras el gráfico se dibuja. Incluye la
 * procedencia exacta de lo que va a quedar en pantalla: sin ella, ante "¿de dónde salen estos
 * datos?" el agente contestaba con el total del catálogo que tiene en el prompt, que con un
 * filtro activo ya no es lo que se ve (FR-016).
 */
function rendered(r: Resolved, extra: Record<string, unknown> = {}) {
  const { domainLabel, rowsMatched, rowsTotal } = r.result.provenance;
  return reply({
    status: "rendered",
    rowCount: r.result.rowCount,
    summary: r.summary,
    warnings: r.warnings,
    assumptions: r.intent.assumptions,
    provenance: {
      fuente: domainLabel,
      registros: `${rowsMatched} de ${rowsTotal} registros`,
      filtros: r.subtitle ?? "ninguno",
    },
    ...extra,
  });
}

/** Un error de red o de programación, dicho de forma que el agente pueda repetirlo. */
function failure(tool: string, error: unknown) {
  console.error(`[tool] ${tool} falló:`, error);
  return reply({
    status: "error",
    message: "No pude conectarme con los datos en este momento.",
    suggestion: "Pedile a la persona que lo intente de nuevo en unos segundos.",
  });
}

/**
 * Traza de cada llamada: lo que mandó el agente y lo que se le devolvió. Sirvió para el
 * spike de T083 (¿llena bien el array de `filters`?) y la lee el banco de pruebas por voz
 * para distinguir un pedido dibujado de uno rechazado.
 */
function traced(tool: ToolName, handler: ToolHandler): ToolHandler {
  return async (params) => {
    console.info(`[tool] ${tool}`, JSON.stringify(params));
    const out = await handler(params);
    console.info(`[tool] ${tool} →`, out.slice(0, 600));
    return out;
  };
}

/** Tienen que coincidir exactamente con los de `elevenlabs/tools.ts`. */
export type ToolName =
  | "getDataCatalog"
  | "proposeVisualization"
  | "refineVisualization"
  | "undoVisualization"
  | "queryCurrentChart";

export function createToolHandlers(
  session: ToolSession,
  deps: ToolDeps = httpDeps,
): Record<ToolName, ToolHandler> {
  const handlers: Record<ToolName, ToolHandler> = {
    async getDataCatalog() {
      try {
        return reply(await deps.catalog());
      } catch (error) {
        return failure("getDataCatalog", error);
      }
    },

    async proposeVisualization(params) {
      session.setStage("querying");
      try {
        const r = await deps.resolve({ mode: "propose", params });
        if (!r.ok) {
          session.setStage("idle");
          return rejected(r);
        }
        // Sin await: la composición corre sola y el agente ya puede hablar (D13).
        session.show(r);
        return rendered(r);
      } catch (error) {
        session.setStage("idle");
        return failure("proposeVisualization", error);
      }
    },

    async refineVisualization(params) {
      const base = session.current();
      if (!base) {
        return rejected({
          message: "Todavía no hay ningún gráfico en pantalla para modificar.",
          suggestion: "Generá uno nuevo con proposeVisualization.",
        });
      }
      session.setStage("querying");
      try {
        const r = await deps.resolve({ mode: "refine", params, base: base.intent });
        if (!r.ok) {
          session.setStage("idle");
          return rejected(r);
        }
        session.show(r);
        return rendered(r, { changed: r.changed, now: r.description });
      } catch (error) {
        session.setStage("idle");
        return failure("refineVisualization", error);
      }
    },

    async undoVisualization() {
      const step = undo(session.history());
      if (step.status === "at_start") {
        // Sin el mensaje, el agente leía "at_start" como "no hay nada en pantalla" y lo decía,
        // con el gráfico ahí delante.
        const current = session.current();
        return reply({
          status: "at_start",
          message: current
            ? "Ya estás en el primer gráfico de esta conversación: no hay uno anterior. El que está en pantalla sigue ahí."
            : "Todavía no hay ningún gráfico en pantalla.",
          ...(current ? { now: current.description } : {}),
        });
      }

      session.setStage("querying");
      try {
        // Volver atrás re-ejecuta el intent anterior: el gráfico que aparece es coherente
        // con los datos, no una foto vieja.
        const r = await deps.resolve({ mode: "resolve", intent: step.intent });
        if (!r.ok) {
          session.setStage("idle");
          return rejected(r);
        }
        session.show(r, step.history);
        return rendered(r, { now: r.description });
      } catch (error) {
        session.setStage("idle");
        return failure("undoVisualization", error);
      }
    },

    async queryCurrentChart(params) {
      try {
        const current = session.current();
        const highlight = typeof params.highlight === "string" && params.highlight.trim() !== ""
          ? params.highlight
          : undefined;
        const answer = answerFromResult(
          current?.result ?? null,
          current?.meta ?? null,
          current?.description ?? "",
          highlight,
        );
        session.highlight(answer.answers.point?.[0]?.label ?? null);
        return reply(answer);
      } catch (error) {
        return failure("queryCurrentChart", error);
      }
    },
  };

  return Object.fromEntries(
    Object.entries(handlers).map(([name, handler]) => [name, traced(name as ToolName, handler)]),
  ) as Record<ToolName, ToolHandler>;
}
