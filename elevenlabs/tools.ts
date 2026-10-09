import { z } from "zod";
import { AgentIntentDeltaSchema, AgentIntentSchema } from "@/lib/conversation/intent";

/**
 * Las definiciones de los cinco client tools.
 *
 * Los parámetros de `proposeVisualization` y `refineVisualization` **se derivan del mismo
 * Zod** que el cliente usa para parsear lo que llega (`AgentIntentSchema`). No se escriben
 * a mano: si se escribieran, el schema que ve el agente y el que valida la app podrían
 * desincronizarse, que es justo el tipo de deriva que la constitución evita con el catálogo
 * de visualización.
 *
 * `npm run setup:agent` los publica en ElevenLabs y además los escribe como JSON en
 * `elevenlabs/tools/` para poder leerlos en un diff.
 */

export interface ToolConfig {
  type: "client";
  name: string;
  description: string;
  expects_response: boolean;
  response_timeout_secs: number;
  parameters: Record<string, unknown>;
  pre_tool_speech?: string;
}

const NO_PARAMS = { type: "object", properties: {}, required: [] } as const;

type JsonSchema = Record<string, unknown>;

/**
 * JSON Schema → el dialecto que acepta ElevenLabs (`POST /v1/convai/tools` responde 422 con
 * cualquier otra cosa).
 *
 * - Cada propiedad escalar lleva `description`: es lo que le dice al agente que la llene él.
 * - Los arrays admiten sólo `type`, `description` e `items`: nada de `default` ni `maxItems`.
 * - Un nullable se escribe `type: ["integer", "null"]`, no con `anyOf`.
 *
 * Se arma por lista blanca, así que `default`, `minimum`, `maxItems` y compañía se caen. No
 * se pierde nada: los aplica el Zod del cliente al parsear, y las descripciones los enuncian.
 * Si falta una descripción corta acá, con la ruta del campo, en vez de volver con un 422.
 */
function toElevenLabs(node: JsonSchema, path: string): JsonSchema {
  if (Array.isArray(node.anyOf)) {
    const branches = node.anyOf as JsonSchema[];
    const [inner, ...rest] = branches.filter((b) => b.type !== "null");
    if (!inner || rest.length > 0 || branches.length !== 2 || typeof inner.type !== "string") {
      throw new Error(`${path}: ElevenLabs sólo admite anyOf para un escalar nullable.`);
    }
    const literal = toElevenLabs({ ...inner, description: node.description ?? inner.description }, path);
    return { ...literal, type: [inner.type, "null"] };
  }

  const description = typeof node.description === "string" ? { description: node.description } : {};

  if (node.type === "object") {
    const properties = (node.properties ?? {}) as Record<string, JsonSchema>;
    return {
      type: "object",
      ...description,
      properties: Object.fromEntries(
        Object.entries(properties).map(([key, prop]) => [key, toElevenLabs(prop, `${path}.${key}`)]),
      ),
      ...(Array.isArray(node.required) ? { required: node.required } : {}),
    };
  }

  if (node.type === "array") {
    return { type: "array", ...description, items: toElevenLabs(node.items as JsonSchema, `${path}[]`) };
  }

  if (!description.description) {
    throw new Error(`${path}: falta la descripción. Agregale .describe() en el Zod.`);
  }
  return { type: node.type, ...description, ...(node.enum ? { enum: node.enum } : {}) };
}

/** Zod → parámetros de un client tool, en la forma de entrada (con los defaults como opcionales). */
function toParameters(schema: z.ZodType, name: string): JsonSchema {
  return toElevenLabs(z.toJSONSchema(schema, { io: "input" }) as JsonSchema, name);
}

const describedIntent = AgentIntentSchema.describe(
  "Todo lo que define la visualización. Los ids de metric y groupBy salen de getDataCatalog: no los inventes.",
);

export const TOOLS: ToolConfig[] = [
  {
    type: "client",
    name: "getDataCatalog",
    description:
      "Devuelve qué datos hay disponibles: dominios, dimensiones por las que se puede cortar, métricas calculables con su cobertura, y las columnas que NO están disponibles con el motivo. Llamalo cuando el usuario pregunte qué podés mostrarle. Nunca contestes sobre disponibilidad de memoria.",
    expects_response: true,
    response_timeout_secs: 10,
    parameters: NO_PARAMS,
  },

  {
    type: "client",
    name: "proposeVisualization",
    description:
      "Genera una visualización nueva. Llamalo SOLO cuando ya tengas resueltos el dominio, la métrica y el corte. Si te falta alguno, preguntáselo al usuario primero: este tool no adivina. Te contesta enseguida, mientras el gráfico todavía se dibuja, así que podés empezar a describir el resultado sin esperar.",
    expects_response: true,
    response_timeout_secs: 15,
    // El agente dice algo al arrancar la llamada, así el silencio no queda al descubierto.
    pre_tool_speech: "auto",
    parameters: toParameters(describedIntent, "proposeVisualization"),
  },

  {
    type: "client",
    name: "refineVisualization",
    description:
      "Cambia el gráfico que ya está en pantalla: agregá un filtro, cambiá el corte, cambiá el tipo, reordená. Mandá SOLO los campos que cambian; el resto se conserva, incluidos los filtros anteriores. Para sacar un filtro, mandalo con value vacío. Usalo siempre que pidan una variación de lo que están viendo, en vez de generar de cero.",
    expects_response: true,
    response_timeout_secs: 15,
    pre_tool_speech: "auto",
    parameters: toParameters(AgentIntentDeltaSchema, "refineVisualization"),
  },

  {
    type: "client",
    name: "undoVisualization",
    description:
      "Vuelve al gráfico anterior. Usalo cuando digan 'volvé atrás', 'como estaba antes' o similar. Si ya no hay nada atrás te lo dice y se lo contás al usuario.",
    expects_response: true,
    response_timeout_secs: 10,
    parameters: NO_PARAMS,
  },

  {
    type: "client",
    name: "queryCurrentChart",
    description:
      "Consulta los datos exactos del gráfico que está en pantalla: cuál es el más alto, cuánto da el total, cuánto vale una categoría puntual, y de dónde salen (fuente, cuántos registros entraron y qué se agrupó en «Otros»). NUNCA leas un número del gráfico vos mismo ni lo calcules: pedilo acá. Te devuelve los valores ya formateados para que los leas tal cual, y resalta en pantalla la categoría que nombres en highlight.",
    expects_response: true,
    response_timeout_secs: 10,
    parameters: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "La pregunta del usuario, tal cual la dijo.",
        },
        highlight: {
          type: "string",
          description:
            "Etiqueta de la categoría a resaltar en pantalla, si la pregunta menciona una.",
        },
      },
      required: ["question"],
    },
  },
];

export const TOOL_NAMES = TOOLS.map((t) => t.name);
