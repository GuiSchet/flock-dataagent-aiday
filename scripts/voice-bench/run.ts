import fs from "node:fs";
import path from "node:path";
import { loadEnvLocal } from "../env";
import { composeDialogue, speech } from "./audio";
import { launch, sessionCookieHeader, signIn } from "./browser";
import { CONVERSATIONS, type Conversation } from "./cases";
import {
  evaluateConversation,
  evaluateReset,
  longestStill,
  parseLogs,
  percentile,
  type DomSnapshot,
  type MotionSample,
  type Parsed,
  type Person,
  type TurnResult,
} from "./evaluate";

/**
 * El banco de pruebas por voz.
 *
 *     npm run dev                          # en otra terminal
 *     npm run bench:voice                  # las 14 conversaciones, ~20 min
 *     npm run bench:voice -- --case q14    # sólo la conversación de ese turno
 *     npm run bench:voice -- --dark        # en tema oscuro
 *
 * Cada frase se sintetiza con el TTS de OpenAI (una vez: queda en caché), cada conversación
 * se arma como un WAV que Chrome usa de micrófono, y la app corre de verdad contra el agente
 * de ElevenLabs. El reporte queda en specs/001-voice-generative-charts/bench/.
 *
 * Cuesta: una corrida completa son ~15 minutos de conversación en ElevenLabs y centavos de
 * OpenAI (TTS la primera vez, composición siempre).
 */

const ROOT = process.cwd();
const CACHE = path.join(ROOT, ".cache", "voice-bench");
const REPORTS = path.join(ROOT, "specs", "001-voice-generative-charts", "bench");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function arg(name: string): string | null {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? "") : null;
}

/**
 * Las personas de la nómina, sólo para detectar si el agente nombra a alguien (SC-009).
 *
 * Los nombres no están en `data/`: `npm run data:synthetic` inventa uno por persona y los
 * deja en `.cache/nombres.json`, fuera del repo. Nunca los lee la app.
 */
function people(): Person[] {
  const file = path.join(ROOT, ".cache", "nombres.json");
  if (!fs.existsSync(file)) {
    throw new Error(
      "Falta .cache/nombres.json: sin la lista de nombres el banco no puede verificar que el agente no nombre a nadie. Corré `npm run data:synthetic`.",
    );
  }
  const list = JSON.parse(fs.readFileSync(file, "utf8")) as Array<{ nombre?: string; apellido?: string }>;
  return list
    .map((p) => ({ nombre: (p.nombre ?? "").trim(), apellido: (p.apellido ?? "").trim() }))
    .filter((p) => p.nombre && p.apellido)
    .map((p) => ({ full: `${p.nombre} ${p.apellido}`, surname: p.apellido }));
}

const SNAPSHOT = `(() => {
  const main = document.querySelector('[data-stage-view]');
  return {
    ribbon: document.querySelector('[aria-live=polite] p')?.textContent ?? null,
    notice: document.querySelector('main [role=status]')?.textContent ?? null,
    labels: [...document.querySelectorAll('.recharts-label-list text, .recharts-pie-label-text')].map((e) => e.textContent ?? ''),
    kpis: [...document.querySelectorAll('[data-value]')].map((e) => Number(e.getAttribute('data-value'))),
    dimmed: [...document.querySelectorAll('main [fill-opacity]')].filter((e) => Number(e.getAttribute('fill-opacity')) < 1).length,
    text: main ? main.innerText : '',
  };
})()`;

interface ConversationRun {
  conversation: Conversation;
  parsed: Parsed;
  results: TurnResult[];
  /** SC-005: el tramo más largo sin movimiento durante una generación, en ms. */
  still: number | null;
  error?: string;
}

/** Lo que anima mientras la tubería trabaja: el riel del indicador y el esqueleto. */
const MOTION_SAMPLE = `(() => {
  const bar = document.querySelector('[role=progressbar]');
  const moving = [...document.querySelectorAll('[role=progressbar] > div > div, [aria-busy=true] div')]
    .map((e) => { const s = getComputedStyle(e); return s.transform + '|' + s.opacity; })
    .join(';');
  return { stage: bar ? bar.getAttribute('aria-valuetext') : null, motion: moving };
})()`;

async function runConversation(
  conversation: Conversation,
  index: number,
  ctx: { url: string; apiKey: string; runDir: string; dark: boolean; people: Person[] },
): Promise<ConversationRun> {
  const segments = [];
  for (const turn of conversation.turns) {
    segments.push({ pcm: await speech(turn.say, path.join(CACHE, "tts"), ctx.apiKey), wait: turn.wait ?? 17 });
  }
  const wav = path.join(ctx.runDir, `${conversation.id}.wav`);
  const { starts, total } = composeDialogue(segments, wav);

  const browser = await launch({
    wav,
    profileDir: path.join(CACHE, "chrome", conversation.id),
    port: 9400 + index,
    colorScheme: ctx.dark ? "dark" : "light",
  });

  const doms: DomSnapshot[] = [];
  let final: DomSnapshot | null = null;
  const samples: MotionSample[] = [];
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      const s = await browser.evaluate<Omit<MotionSample, "t">>(MOTION_SAMPLE).catch(() => null);
      if (s) samples.push({ t: browser.now(), ...s });
      await sleep(100);
    }
  })();
  const stopSampling = async () => {
    sampling = false;
    await sampler;
  };
  try {
    await signIn(browser, ctx.url);
    await browser.send("Page.navigate", { url: ctx.url });
    await sleep(3500);
    const clicked = await browser.evaluate<boolean>(
      `(() => { const b = document.querySelector('button[aria-label="Empezar a hablar"]'); b?.click(); return !!b; })()`,
    );
    if (!clicked) throw new Error("No encontré el orbe para empezar a hablar.");

    // El audio arranca cuando el SDK abre el micrófono, que es cuando conecta.
    let connectedAt: number | null = null;
    for (let i = 0; i < 60 && connectedAt === null; i++) {
      await sleep(250);
      connectedAt = parseLogs(browser.logs).connectedAt;
    }
    if (connectedAt === null) throw new Error("La sesión de voz no conectó en 15 s.");

    // Al final de cada turno, justo antes de la próxima frase (o cuando el caso lo pida):
    // qué hay en pantalla.
    for (let k = 0; k < conversation.turns.length; k++) {
      const turn = conversation.turns[k]!;
      const end = turn.snapshotAfter !== undefined
        ? connectedAt + starts[k]! + turn.snapshotAfter
        : connectedAt + (starts[k + 1] ?? total) - 1;
      while (browser.now() < end) await sleep(200);
      doms.push(await browser.evaluate<DomSnapshot>(SNAPSHOT));
      await browser.screenshot(path.join(ctx.runDir, `${turn.id}.png`));
    }
    if (conversation.resetAtEnd) {
      while (browser.now() < connectedAt + total) await sleep(200);
      final = await browser.evaluate<DomSnapshot>(SNAPSHOT);
      await browser.screenshot(path.join(ctx.runDir, `${conversation.id}-reset.png`));
    }
  } catch (error) {
    await stopSampling();
    await browser.close();
    const parsed = parseLogs(browser.logs);
    return { conversation, parsed, results: [], still: null, error: (error as Error).message };
  }

  await stopSampling();
  await browser.close();
  const parsed = parseLogs(browser.logs);
  const turnStarts = starts.map((s) => parsed.connectedAt! + s);
  const results = evaluateConversation(conversation, parsed, turnStarts, parsed.connectedAt! + total, doms, ctx.people);
  if (conversation.resetAtEnd && final) results.push(evaluateReset(conversation, parsed, final));
  return { conversation, parsed, results, still: longestStill(samples) };
}

// ---------------------------------------------------------------------------
// Reporte
// ---------------------------------------------------------------------------

const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
const ms = (v: number | null) => (v === null ? "—" : `${(v / 1000).toFixed(1).replace(".", ",")} s`);

function report(runs: ConversationRun[], meta: { stamp: string; model: string; partial: boolean; dark: boolean }) {
  const results = runs.flatMap((r) => r.results);
  const passed = results.filter((r) => r.pass).length;
  const asks = results.filter((r) => r.turn.expect.kind === "ask");
  const numbers = results.flatMap((r) => r.problems.filter((p) => p.includes("no sale del motor")));
  const names = results.flatMap((r) => r.problems.filter((p) => p.startsWith("nombró")));
  const latencies = results.flatMap((r) => r.latencies).filter((l) => !l.fallo);
  const firstPixel = percentile(latencies.map((l) => l.primerPixel).filter((v): v is number => v !== null), 95);
  const complete = percentile(latencies.map((l) => l.completo), 95);
  const chain = runs.find((r) => r.conversation.id === "c09");
  // SC-005: el peor tramo quieto de todas las conversaciones.
  const stills = runs.map((r) => r.still).filter((v): v is number => v !== null);
  const worstStill = stills.length > 0 ? Math.max(...stills) : null;
  // SC-001: desde que se abre la sesión hasta el primer gráfico completo. El banco habla a
  // los 7 s; una persona real tarda más en arrancar, así que esto acota el tiempo del sistema.
  const firstCharts = runs
    .map((r) => {
      const first = r.parsed.latencies.find((l) => !l.fallo);
      return first && r.parsed.connectedAt !== null ? (first.t - r.parsed.connectedAt) * 1000 : null;
    })
    .filter((v): v is number => v !== null);
  const worstFirstChart = firstCharts.length > 0 ? Math.max(...firstCharts) : null;
  const need = Math.ceil(results.length * 0.8);
  const ok = (cond: boolean) => (cond ? "✓" : "✗");

  const lines = [
    `# Banco de pruebas por voz — ${meta.stamp}`,
    "",
    `Compositor: \`${meta.model}\` · Tema: ${meta.dark ? "oscuro" : "claro"} · ${results.length} turnos en ${runs.length} conversaciones${meta.partial ? " (corrida parcial)" : ""}.`,
    "",
    "## Criterios",
    "",
    "| Criterio | Meta | Resultado | |",
    "|---|---|---|---|",
    `| SC-002 | ≥ ${need}/${results.length} turnos correctos | ${passed}/${results.length} | ${ok(passed >= need)} |`,
    `| SC-002 | 0 números que no salen del motor | ${numbers.length} | ${ok(numbers.length === 0)} |`,
    `| SC-001 | primer gráfico < 45 s desde que se abre la sesión (peor caso) | ${ms(worstFirstChart)} | ${ok(worstFirstChart !== null && worstFirstChart < 45000)} |`,
    `| SC-003 | 100 % de repregunta ante ambigüedad | ${asks.filter((a) => a.pass).length}/${asks.length} | ${ok(asks.every((a) => a.pass))} |`,
    `| SC-004 | primer píxel p95 < 2 s | ${ms(firstPixel)} | ${ok(firstPixel !== null && firstPixel < 2000)} |`,
    `| SC-004 | gráfico completo p95 < 6 s | ${ms(complete)} | ${ok(complete !== null && complete < 6000)} |`,
    `| SC-005 | nada quieto > 400 ms durante una generación (peor tramo) | ${worstStill === null ? "—" : `${worstStill} ms`} | ${ok(worstStill !== null && worstStill <= 400)} |`,
    chain
      ? `| SC-006 | cadena de refinamientos sin perder estado | ${chain.results.filter((r) => r.pass).length}/${chain.results.length} | ${ok(chain.results.length > 0 && chain.results.every((r) => r.pass))} |`
      : "| SC-006 | cadena de refinamientos | no se corrió | |",
    `| SC-009 | 0 nombres de personas | ${names.length} | ${ok(names.length === 0)} |`,
    "",
    "## Turnos",
  ];

  for (const run of runs) {
    lines.push("", `### ${run.conversation.id} — ${run.conversation.title}`, "");
    if (run.parsed.conversationId) lines.push(`Conversación en ElevenLabs: \`${run.parsed.conversationId}\``, "");
    if (run.error) {
      lines.push(`**No se pudo correr:** ${run.error}`);
      continue;
    }
    lines.push("| Turno | Frase | Transcripción | Qué pasó | | Problemas |", "|---|---|---|---|---|---|");
    for (const r of run.results) {
      lines.push(
        `| ${r.turn.id} | ${cell(r.turn.say)} | ${cell(r.heard.join(" / ") || "—")} | ${cell(r.got)} | ${ok(r.pass)} | ${cell(r.problems.join("; ") || "—")} |`,
      );
    }
    for (const r of run.results.filter((x) => !x.pass)) {
      lines.push("", `<details><summary>${r.turn.id}: lo que dijo el agente</summary>`, "", ...r.said.map((s) => `> ${cell(s)}`), "", "</details>");
    }
  }

  lines.push("", "## Latencias", "", "| Turno | Vista | Desde | Primer píxel | Completo |", "|---|---|---|---|---|");
  for (const r of results) {
    for (const l of r.latencies) {
      lines.push(`| ${r.turn.id} | ${cell(l.vista)} | ${l.desde} | ${ms(l.primerPixel)} | ${ms(l.completo)}${l.fallo ? " (falló)" : ""} |`);
    }
  }
  lines.push("", `Capturas y audio: \`.cache/voice-bench/runs/${meta.stamp}/\` (no se versionan).`);

  return { markdown: lines.join("\n") + "\n", passed, total: results.length };
}

// ---------------------------------------------------------------------------

async function main() {
  loadEnvLocal();
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Falta OPENAI_API_KEY en .env.local (se usa para el TTS).");

  const url = arg("url") ?? process.env.BENCH_URL ?? "http://localhost:3000";
  const health = await fetch(new URL("/api/catalog", url), {
    headers: { cookie: await sessionCookieHeader() },
  }).catch(() => null);
  if (!health?.ok) throw new Error(`La app no responde en ${url}. Levantala con npm run dev.`);

  const only = arg("case");
  const conversations = only
    ? CONVERSATIONS.filter((c) => c.id === only || c.turns.some((t) => t.id === only))
    : CONVERSATIONS;
  if (conversations.length === 0) throw new Error(`No hay ningún caso ni conversación "${only}".`);

  const now = new Date();
  const stamp = `${now.toISOString().slice(0, 10)}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}`;
  const runDir = path.join(CACHE, "runs", stamp);
  fs.mkdirSync(runDir, { recursive: true });
  const dark = process.argv.includes("--dark");
  const ctx = { url, apiKey, runDir, dark, people: people() };

  const runs: ConversationRun[] = [];
  for (const [i, conversation] of conversations.entries()) {
    process.stdout.write(`${conversation.id} ${conversation.title}… `);
    const run = await runConversation(conversation, i, ctx);
    runs.push(run);
    const passed = run.results.filter((r) => r.pass).length;
    console.log(run.error ? `ERROR: ${run.error}` : `${passed}/${run.results.length}`);
    // Un respiro entre sesiones: ElevenLabs limita las conversaciones simultáneas.
    await sleep(3000);
  }

  const { markdown, passed, total } = report(runs, {
    stamp,
    model: process.env.OPENAI_MODEL ?? "gpt-5.6-luna",
    partial: Boolean(only),
    dark,
  });
  fs.mkdirSync(REPORTS, { recursive: true });
  const file = path.join(REPORTS, `${stamp}${only ? `-${only}` : ""}.md`);
  fs.writeFileSync(file, markdown);
  console.log(`\n${passed}/${total} turnos correctos. Reporte: ${path.relative(ROOT, file)}`);
  process.exitCode = passed === total ? 0 : 1;
}

main().catch((error: Error) => {
  console.error(`\n${error.message}`);
  process.exitCode = 2;
});
