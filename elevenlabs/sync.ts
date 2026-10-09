import fs from "node:fs";
import path from "node:path";
import {
  AGENT_LANGUAGE,
  FIRST_MESSAGE,
  INTERRUPTION_IGNORE_TERMS,
  MAX_DURATION_SECS,
  SILENCE_END_CALL_SECS,
  buildAgentPrompt,
} from "./agent.config";
import { TOOLS, type ToolConfig } from "./tools";

/**
 * Sincroniza la configuración del agente con ElevenLabs.
 *
 *     npm run setup:agent
 *
 * Los client tools tienen que existir en ElevenLabs *además* de estar registrados en el
 * código del navegador: si faltan de un lado, el agente conversa pero no dibuja nada.
 *
 * Es idempotente: busca cada tool por nombre y lo actualiza si ya existe. Se puede correr
 * cuantas veces haga falta, y hay que correrlo cada vez que cambie un prompt, un schema de
 * parámetros o el catálogo de datos (el prompt lleva el catálogo incrustado).
 */

const API = "https://api.elevenlabs.io/v1";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`\n  Falta ${name} en el entorno.\n  Completá .env.local y volvé a intentar.\n`);
    process.exit(1);
  }
  return value;
}

/** `.env.local` no se carga solo fuera de Next. */
function loadEnvLocal() {
  const file = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const [, key, raw] = match;
    if (key && process.env[key] === undefined) {
      process.env[key] = raw!.replace(/^["']|["']$/g, "");
    }
  }
}

async function call<T>(
  method: string,
  endpoint: string,
  apiKey: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`${API}${endpoint}`, {
    method,
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${method} ${endpoint} → ${response.status}\n${detail}`);
  }
  return (await response.json()) as T;
}

interface ToolRecord {
  id: string;
  tool_config?: { name?: string };
}

/**
 * Los tools existentes, por nombre.
 *
 * El listado no está documentado en la referencia pública, así que si el endpoint no
 * responde se sigue igual: se intenta crear cada tool y, si ya existe, el error lo dice.
 * Vale más un script que avisa que uno que se planta.
 */
async function existingToolsByName(apiKey: string): Promise<Map<string, string>> {
  try {
    const listed = await call<{ tools?: ToolRecord[] }>("GET", "/convai/tools", apiKey);
    const byName = new Map<string, string>();
    for (const tool of listed.tools ?? []) {
      const name = tool.tool_config?.name;
      if (name) byName.set(name, tool.id);
    }
    return byName;
  } catch (error) {
    console.warn("  No se pudo listar los tools existentes; se intentará crearlos.");
    console.warn(`  (${(error as Error).message.split("\n")[0]})`);
    return new Map();
  }
}

async function upsertTool(
  tool: ToolConfig,
  apiKey: string,
  existing: Map<string, string>,
): Promise<string> {
  const id = existing.get(tool.name);

  if (id) {
    await call("PATCH", `/convai/tools/${id}`, apiKey, { tool_config: tool });
    console.log(`  · ${tool.name} actualizado`);
    return id;
  }

  const created = await call<ToolRecord>("POST", "/convai/tools", apiKey, { tool_config: tool });
  console.log(`  · ${tool.name} creado`);
  return created.id;
}

/** Deja los schemas resueltos en disco para poder leerlos en un diff. */
function writeSnapshots() {
  const dir = path.join(process.cwd(), "elevenlabs", "tools");
  fs.mkdirSync(dir, { recursive: true });
  for (const tool of TOOLS) {
    fs.writeFileSync(
      path.join(dir, `${tool.name}.json`),
      JSON.stringify(tool, null, 2) + "\n",
    );
  }
  console.log(`  · ${TOOLS.length} definiciones escritas en elevenlabs/tools/`);
}

async function main() {
  loadEnvLocal();
  const apiKey = required("ELEVENLABS_API_KEY");
  const agentId = required("ELEVENLABS_AGENT_ID");

  console.log("\nSincronizando el agente de Flock DataAgent\n");

  console.log("Definiciones de tools:");
  writeSnapshots();

  console.log("\nTools en ElevenLabs:");
  const existing = await existingToolsByName(apiKey);
  const toolIds: string[] = [];
  for (const tool of TOOLS) {
    toolIds.push(await upsertTool(tool, apiKey, existing));
  }

  console.log("\nAgente:");
  const prompt = buildAgentPrompt();
  await call("PATCH", `/convai/agents/${agentId}`, apiKey, {
    conversation_config: {
      agent: {
        prompt: { prompt, tool_ids: toolIds },
        first_message: FIRST_MESSAGE,
        language: AGENT_LANGUAGE,
      },
      conversation: { max_duration_seconds: MAX_DURATION_SECS },
      turn: {
        silence_end_call_timeout: SILENCE_END_CALL_SECS,
        interruption_ignore_terms: INTERRUPTION_IGNORE_TERMS,
      },
    },
  });
  console.log(`  · prompt actualizado (${prompt.length} caracteres, con el catálogo incrustado)`);
  console.log(`  · ${toolIds.length} tools asociados`);
  console.log(
    `  · sesión: máximo ${MAX_DURATION_SECS / 60} min, corta tras ${SILENCE_END_CALL_SECS} s de silencio, ${INTERRUPTION_IGNORE_TERMS.length} palabras que no interrumpen`,
  );

  console.log("\nListo. El agente ya puede dibujar.\n");
}

main().catch((error: Error) => {
  console.error("\nFalló la sincronización:\n");
  console.error(error.message);
  console.error("");
  process.exit(1);
});
