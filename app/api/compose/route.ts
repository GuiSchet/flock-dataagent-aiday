import { createOpenAI } from "@ai-sdk/openai";
import { buildUserPrompt } from "@json-render/core";
import { createTextStreamResponse, streamText } from "ai";
import { requireSession } from "@/lib/auth/session";
import { buildComposePrompt, type ComposeContext } from "@/lib/viz/schema";

/**
 * Etapa 3: componer la visualización.
 *
 * El modelo recibe la *forma* del resultado —qué columnas hay y qué significan— y devuelve
 * un spec de json-render. **Nunca recibe los valores**: las filas se quedan del lado del
 * cliente y entran al render por el `StateProvider`. Por eso, aunque quisiera, no puede
 * transcribir ni inventar un número (principio III).
 *
 * El formato de salida no es negociable: `useUIStream` espera **JSONL de JSON Patches**
 * separados por saltos de línea, en texto plano. Nada de SSE, nada de prosa. De eso se
 * encarga `buildComposePrompt()`, que pide `mode: "standalone"`.
 */

export const dynamic = "force-dynamic";

interface ComposeBody {
  prompt?: string;
  context?: ComposeContext;
  currentSpec?: unknown;
}

/**
 * Describe el resultado sin exponer un solo valor.
 *
 * Es la diferencia entre "el modelo sabe qué columnas graficar" y "el modelo vio los
 * datos". Lo primero es necesario; lo segundo es lo que la constitución prohíbe.
 */
function describeShape(context: ComposeContext): string {
  const lines: string[] = [];

  lines.push(`Filas del resultado: ${context.rowCount ?? 0}`);
  if (context.chartType) lines.push(`Tipo de gráfico pedido: ${context.chartType}`);
  if (context.title) lines.push(`Título: ${context.title}`);
  if (context.subtitle) lines.push(`Subtítulo: ${context.subtitle}`);
  if (context.provenance) lines.push(`Procedencia (texto del Provenance): ${context.provenance}`);

  if (context.columns?.length) {
    lines.push("", "Columnas disponibles en los datos (usá estos nombres EXACTOS):");
    for (const c of context.columns) {
      const fmt = c.format ? `, formato ${c.format}` : "";
      const unit = c.unit ? `, en ${c.unit}` : "";
      lines.push(`  - "${c.key}" — ${c.label} (${c.kind}${fmt}${unit})`);
    }
  }

  if (context.stats?.length) {
    lines.push("", 'Resumen del resultado en {"$state": "/stats"} (sólo para KpiTile; valueKey EXACTO):');
    for (const c of context.stats) {
      const fmt = c.format ? `, formato ${c.format}` : "";
      const unit = c.unit ? `, en ${c.unit}` : "";
      lines.push(`  - "${c.key}" — ${c.label}${fmt}${unit}`);
    }
  }

  if (context.warnings?.length) {
    lines.push(
      "",
      "Advertencias que DEBEN aparecer en un Callout con tone=warning, arriba del gráfico:",
      ...context.warnings.map((w) => `  - ${w}`),
    );
  }

  return lines.join("\n");
}

export async function POST(request: Request) {
  const denied = await requireSession(request);
  if (denied) return denied;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("[componer] Falta OPENAI_API_KEY");
    return Response.json(
      { error: "config", message: "Falta configurar OPENAI_API_KEY en .env.local." },
      { status: 500 },
    );
  }

  let body: ComposeBody;
  try {
    body = (await request.json()) as ComposeBody;
  } catch {
    return Response.json(
      { error: "bad_request", message: "El cuerpo del pedido no es JSON válido." },
      { status: 400 },
    );
  }

  const context = body.context ?? {};
  const openai = createOpenAI({ apiKey });
  const model = process.env.OPENAI_MODEL ?? "gpt-5.6-luna";
  const reasoningEffort = process.env.OPENAI_REASONING_EFFORT ?? defaultReasoningEffort(model);

  // `buildUserPrompt` se encarga del modo de edición: si viene un spec anterior, le pide al
  // modelo parches sobre ese spec en vez de uno nuevo desde cero.
  const userPrompt = buildUserPrompt({
    prompt: [body.prompt ?? "", "", describeShape(context)].join("\n"),
    currentSpec: (body.currentSpec ?? null) as Parameters<typeof buildUserPrompt>[0]["currentSpec"],
  });

  const result = streamText({
    model: openai(model),
    // En AI SDK v7 `system` quedó deprecado a favor de `instructions`.
    instructions: buildComposePrompt(),
    prompt: userPrompt,
    // Si el usuario habla encima, el cliente corta la conexión y esto se cancela solo.
    abortSignal: request.signal,
    // Los errores se manejan abajo, sobre el stream; esto sólo evita el log por defecto.
    onError: () => {},
    // Sin esto, un modelo de razonamiento "piensa" antes de emitir el primer parche. Medido
    // sobre este prompt: gpt-5 tarda 41,6 s hasta el primer token con su esfuerzo por
    // defecto y 1,5 s con "minimal"; gpt-5.6-luna, 4,3 s contra 1,1 s con "none"
    // (research.md D14).
    ...(reasoningEffort
      ? { providerOptions: { openai: { reasoningEffort, textVerbosity: "low" } } }
      : {}),
  });

  // Se espera al primer fragmento de texto antes de responder. `textStream` descarta los
  // errores del proveedor: con una clave inválida o sin cuota, el cliente recibía un 200
  // con cuerpo vacío, lo tomaba como un spec inválido y gastaba el reintento sin saber por
  // qué. Así, una falla antes del primer token vuelve como error HTTP con su motivo.
  const parts = result.stream[Symbol.asyncIterator]();
  let head = "";
  for (;;) {
    const next = await parts.next();
    if (next.done) break;
    if (next.value.type === "error") return upstreamError(next.value.error);
    if (next.value.type === "text-delta") {
      head = next.value.text;
      break;
    }
  }

  const stream = new ReadableStream<string>({
    start(controller) {
      if (head) controller.enqueue(head);
    },
    // `pull` tiene que encolar algo, cerrar o fallar antes de volver: si vuelve sin hacer
    // nada, el stream no lo llama de nuevo y el lector queda esperando para siempre. El SDK
    // intercala partes que no son texto (inicio y fin de paso, metadatos), así que se avanza
    // hasta la próxima que importe. Sin este bucle la composición se congelaba después del
    // primer fragmento y tardaba minutos.
    async pull(controller) {
      for (;;) {
        const next = await parts.next();
        if (next.done) return controller.close();
        if (next.value.type === "text-delta") return controller.enqueue(next.value.text);
        if (next.value.type === "error") {
          console.error("[componer] El proveedor falló a mitad del stream:", next.value.error);
          return controller.error(next.value.error);
        }
      }
    },
    async cancel() {
      await parts.return?.();
    },
  });

  return createTextStreamResponse({ stream });
}

/**
 * El esfuerzo de razonamiento más bajo que admite cada familia. Componer el spec no pide
 * razonar: pide seguir un catálogo, y cada segundo de "pensar" es un segundo de espera.
 *
 * - gpt-5 (el original, y sus -mini y -nano): "minimal"; no admite "none".
 * - gpt-5.1 a gpt-5.6: "none".
 * - gpt-6: "low"; no se puede apagar del todo.
 * - gpt-4.x: no razonan y no aceptan la opción.
 */
function defaultReasoningEffort(model: string): string | null {
  if (model.startsWith("gpt-6")) return "low";
  if (!model.startsWith("gpt-5")) return null;
  return /^gpt-5(-mini|-nano)?(-\d{4}-\d{2}-\d{2})?$/.test(model) ? "minimal" : "none";
}

/** Una falla del proveedor, con un mensaje que `useUIStream` le pasa a `onError`. */
function upstreamError(error: unknown) {
  const status = (error as { statusCode?: number } | null)?.statusCode;
  console.error("[componer] El proveedor rechazó el pedido:", status, error);
  const message =
    status === 401
      ? "OpenAI rechazó la clave: revisá OPENAI_API_KEY en .env.local."
      : status === 429
        ? "OpenAI no tiene cuota disponible en este momento."
        : "El compositor no respondió.";
  return Response.json({ error: "upstream", message }, { status: 502 });
}
