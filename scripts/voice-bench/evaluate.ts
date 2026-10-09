import { availableStats, foldText } from "@/lib/conversation/answers";
import { resolveVisualization, type Resolved } from "@/lib/conversation/resolve";
import type { ConsoleLine } from "./browser";
import type { Conversation, Expectation, IntentMatch, Turn } from "./cases";

/**
 * La evaluación del banco, sin navegador: parte de las líneas de consola que deja la app
 * (`[tool]`, `[voz]`, `[latencia]`, `[componer]`) y de lo que había en pantalla al final
 * de cada turno.
 */

export interface ToolCall {
  t: number;
  name: string;
  params: Record<string, unknown>;
  reply: Record<string, unknown> | null;
}

export interface Latency {
  t: number;
  vista: string;
  desde: string;
  primerPixel: number | null;
  completo: number;
  fallo?: boolean;
}

export interface Parsed {
  conversationId: string | null;
  connectedAt: number | null;
  tools: ToolCall[];
  agent: Array<{ t: number; text: string }>;
  user: Array<{ t: number; text: string }>;
  latencies: Latency[];
  /** Momentos en que la app descartó una composición y volvió al gráfico anterior. */
  discards: number[];
  /** Motivos de desconexión ("agent", "user", "error"). */
  disconnects: string[];
  exceptions: string[];
}

function json(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function parseLogs(lines: ConsoleLine[]): Parsed {
  const parsed: Parsed = {
    conversationId: null,
    connectedAt: null,
    tools: [],
    agent: [],
    user: [],
    latencies: [],
    discards: [],
    disconnects: [],
    exceptions: [],
  };

  for (const { t, text } of lines) {
    let m: RegExpMatchArray | null;
    if ((m = text.match(/^\[voz\] Conectado\. conversation_id: (\S+)/))) {
      parsed.conversationId = m[1]!;
      parsed.connectedAt ??= t;
    } else if ((m = text.match(/^\[voz\] (agent|user): ([\s\S]*)$/))) {
      const entry = { t, text: m[2]!.trim() };
      if (m[1] === "agent") parsed.agent.push(entry);
      // "..." es cómo transcribe un silencio: no es un turno.
      else if (entry.text !== "..." && entry.text !== "") parsed.user.push(entry);
    } else if ((m = text.match(/^\[tool\] (\w+) → ([\s\S]*)$/))) {
      const open = [...parsed.tools].reverse().find((c) => c.name === m![1] && c.reply === null);
      if (open) open.reply = json(m[2]!);
    } else if ((m = text.match(/^\[tool\] (\w+) ([\s\S]*)$/))) {
      parsed.tools.push({ t, name: m[1]!, params: json(m[2]!) ?? {}, reply: null });
    } else if ((m = text.match(/^\[latencia\] ([\s\S]*)$/))) {
      const data = json(m[1]!);
      if (data) parsed.latencies.push({ t, ...(data as Omit<Latency, "t">) });
    } else if ((m = text.match(/^\[voz\] Desconectado: (\w+)/))) {
      parsed.disconnects.push(m[1]!);
    } else if (text.startsWith("[componer] Se descarta")) {
      parsed.discards.push(t);
    } else if (text.startsWith("[exception]")) {
      parsed.exceptions.push(text);
    }
  }
  return parsed;
}

/** Lo que había en pantalla al final de un turno. */
export interface DomSnapshot {
  ribbon: string | null;
  notice: string | null;
  /** Textos de las etiquetas de valor de los gráficos. */
  labels: string[];
  /** Valores crudos de los KPI (`data-value`). */
  kpis: number[];
  /** Marcas atenuadas por el resaltado de una categoría nombrada en voz (T061). */
  dimmed: number;
  /** Todo el texto visible del área central, para buscar nombres. */
  text: string;
}

export interface TurnResult {
  turn: Turn;
  pass: boolean;
  /** Qué pasó, en una línea. */
  got: string;
  problems: string[];
  heard: string[];
  said: string[];
  latencies: Latency[];
}

// ---------------------------------------------------------------------------
// Intención
// ---------------------------------------------------------------------------

const fold = (v: unknown) => foldText(String(v));

type FilterMatch = NonNullable<IntentMatch["filters"]>[number];

function sameValue(expected: FilterMatch, actual: unknown): boolean {
  const want = Array.isArray(expected.value) ? expected.value.map(fold) : [fold(expected.value)];
  const have = Array.isArray(actual) ? actual.map(fold) : [fold(actual)];
  return want.every((w) => have.includes(w));
}

export function intentProblems(expected: IntentMatch, actual: Resolved | null): string[] {
  if (!actual) return ["no quedó ningún gráfico en pantalla"];
  const { intent } = actual;
  const problems: string[] = [];
  if (intent.domain !== expected.domain) problems.push(`dominio ${intent.domain}, se esperaba ${expected.domain}`);
  if (intent.metric !== expected.metric) problems.push(`métrica ${intent.metric}, se esperaba ${expected.metric}`);
  const sortedA = [...intent.groupBy].sort().join(",");
  const sortedE = [...expected.groupBy].sort().join(",");
  if (sortedA !== sortedE) problems.push(`corte [${intent.groupBy.join(", ")}], se esperaba [${expected.groupBy.join(", ")}]`);
  for (const f of expected.filters ?? []) {
    const hit = intent.filters.find((a) => a.field === f.field && (!f.op || a.op === f.op) && sameValue(f, a.value));
    if (!hit) problems.push(`falta el filtro ${f.field}${f.op ? ` ${f.op}` : ""} ${JSON.stringify(f.value)}`);
  }
  if (expected.chartType && !expected.chartType.includes(intent.chartType)) {
    problems.push(`tipo ${intent.chartType}, se esperaba ${expected.chartType.join(" o ")}`);
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Números en pantalla
// ---------------------------------------------------------------------------

/** "1.234" → 1234, "8,50" → 8.5, "12,3 %" → 12.3. */
export function parseEsAr(text: string): number | null {
  const m = text.match(/-?\d{1,3}(?:\.\d{3})+(?:,\d+)?|-?\d+(?:,\d+)?/);
  if (!m) return null;
  return Number(m[0].replace(/\./g, "").replace(",", "."));
}

/** Todos los números que la pantalla puede mostrar legítimamente para este resultado. */
export function referenceNumbers(resolved: Resolved): number[] {
  const values: number[] = [];
  for (const row of resolved.result.rows) {
    for (const key of resolved.meta.valueKeys) {
      const v = row[key];
      if (typeof v === "number") values.push(v);
    }
  }
  const total = values.reduce((a, b) => a + b, 0);
  const shares = total > 0 ? values.map((v) => (v / total) * 100) : [];
  const stats = availableStats(resolved.stats).map((k) => resolved.stats[k as keyof typeof resolved.stats] as number);
  return [...values, ...shares, ...stats];
}

export function numberProblems(dom: DomSnapshot, resolved: Resolved | null): string[] {
  if (!resolved) return [];
  const reference = referenceNumbers(resolved);
  // Tolerancia de redondeo: con un decimal se puede diferir hasta 0,05; los porcentajes de la
  // torta se muestran sin decimales, así que ahí es medio punto.
  const matches = (n: number, tolerance = 0.051) =>
    reference.some((r) => Math.abs(r - n) <= tolerance + Math.abs(r) * 1e-9);
  const problems: string[] = [];
  for (const label of dom.labels) {
    const n = parseEsAr(label);
    if (n !== null && !matches(n, label.includes("%") ? 0.51 : 0.051)) {
      problems.push(`etiqueta "${label}" no sale del motor`);
    }
  }
  for (const n of dom.kpis) {
    if (!matches(n)) problems.push(`KPI ${n} no sale del motor`);
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Privacidad
// ---------------------------------------------------------------------------

export interface Person {
  full: string;
  surname: string;
}

/** Nombres de la nómina que aparecen en un texto. Devuelve iniciales: el reporte no los repite. */
export function nameHits(text: string, people: Person[]): string[] {
  const hay = ` ${foldText(text).replace(/[^a-zñ ]+/g, " ")} `;
  const hits = new Set<string>();
  for (const p of people) {
    const full = foldText(p.full);
    const surname = foldText(p.surname);
    // Apellidos cortos o comunes darían falsos positivos; el nombre completo, nunca.
    if (hay.includes(` ${full} `) || (surname.length >= 6 && hay.includes(` ${surname} `))) {
      hits.add(p.full.split(/\s+/).map((w) => `${w[0] ?? ""}.`).join(" "));
    }
  }
  return [...hits];
}

// ---------------------------------------------------------------------------
// Turnos
// ---------------------------------------------------------------------------

const CHART_TOOLS = new Set(["proposeVisualization", "refineVisualization", "undoVisualization"]);

/** Cómo suena "los datos no lo dicen", ya sin tildes (foldText). */
const NOT_IN_DATA =
  /\bno (lo )?(tengo|tenemos|hay|figura|figuran|aparece|aparecen|esta|estan|explica|explican|dicen|dice|muestra|muestran|puedo saber|se puede saber|registra|registran|incluye|incluyen)\b|los datos no|sin datos sobre|no cuento con/;

function rendered(call: ToolCall) {
  return call.reply?.status === "rendered";
}

/**
 * Evalúa una conversación entera. Reproduce la pila de intents igual que la app —apila con
 * cada gráfico dibujado, desapila al volver atrás o cuando la app descarta una composición—
 * para saber qué debería estar en pantalla al final de cada turno.
 */
export function evaluateConversation(
  conversation: Conversation,
  parsed: Parsed,
  /** Segundo, contado desde el arranque del navegador, en que empieza cada frase. */
  turnStarts: number[],
  endAt: number,
  doms: DomSnapshot[],
  people: Person[],
): TurnResult[] {
  const stack: Resolved[] = [];
  const results: TurnResult[] = [];

  conversation.turns.forEach((turn, i) => {
    const from = turnStarts[i]!;
    const to = turnStarts[i + 1] ?? endAt;
    const inWindow = <T extends { t: number }>(items: T[]) => items.filter((x) => x.t >= from && x.t < to);

    const calls = inWindow(parsed.tools);
    const said = inWindow(parsed.agent).map((a) => a.text);
    const heard = inWindow(parsed.user).map((u) => u.text);
    const latencies = inWindow(parsed.latencies);
    const discards = parsed.discards.filter((t) => t >= from && t < to);

    // Reproducir lo que pasó con la pila en este turno.
    for (const call of calls) {
      if (!rendered(call)) continue;
      if (call.name === "proposeVisualization") {
        const r = resolveVisualization({ mode: "propose", params: call.params });
        if (r.ok) stack.push(r);
      } else if (call.name === "refineVisualization") {
        const base = stack.at(-1);
        const r = resolveVisualization({ mode: "refine", params: call.params, base: base?.intent });
        if (r.ok) stack.push(r);
      } else if (call.name === "undoVisualization") {
        stack.pop();
      }
    }
    for (let d = 0; d < discards.length; d++) stack.pop();

    const current = stack.at(-1) ?? null;
    const dom = doms[i] ?? { ribbon: null, notice: null, labels: [], kpis: [], dimmed: 0, text: "" };
    const drew = calls.some((c) => CHART_TOOLS.has(c.name) && rendered(c)) && discards.length === 0;
    const problems: string[] = [];
    let got = calls.length > 0 ? calls.map((c) => `${c.name}${c.reply ? ` → ${String(c.reply.status ?? "?")}` : ""}`).join(", ") : "sin tools";

    const expectation: Expectation = turn.expect;
    switch (expectation.kind) {
      case "chart":
      case "undo": {
        const wanted = expectation.kind === "undo" ? "undoVisualization" : null;
        if (!drew) problems.push("no se dibujó ningún gráfico");
        if (wanted && !calls.some((c) => c.name === wanted && rendered(c))) problems.push("no volvió atrás");
        problems.push(...intentProblems(expectation.intent, current));
        problems.push(...numberProblems(dom, current));
        if (current) got += ` · ${current.description} (${current.intent.chartType})`;
        break;
      }
      case "ask":
        if (drew) problems.push("dibujó sobre una suposición en vez de repreguntar");
        if (!said.some((s) => s.includes("?"))) problems.push("no repreguntó");
        break;
      case "refuse":
        if (drew) problems.push("dibujó algo que no existe");
        if (said.length === 0) problems.push("el agente no contestó");
        break;
      case "catalog":
        if (!calls.some((c) => c.name === "getDataCatalog")) problems.push("no consultó el catálogo");
        if (said.length === 0) problems.push("el agente no contestó");
        break;
      case "answer": {
        if (!expectation.anySource && !calls.some((c) => c.name === "queryCurrentChart")) {
          problems.push("no consultó el gráfico");
        }
        const speech = foldText(said.join(" "));
        if (!expectation.mentions.some((m) => speech.includes(foldText(m)))) {
          problems.push(`la respuesta no menciona ${expectation.mentions.join(" / ")}`);
        }
        if (expectation.highlights && dom.dimmed === 0) problems.push("no resaltó la categoría en el gráfico");
        break;
      }
      case "notInData":
        if (drew) problems.push("dibujó algo en vez de contestar");
        if (said.length === 0) problems.push("el agente no contestó");
        // Heurística: tiene que decir que los datos no lo explican, no inventar una causa.
        else if (!NOT_IN_DATA.test(foldText(said.join(" ")))) {
          problems.push("no dijo que los datos no lo explican");
        }
        break;
      case "anyChart":
        if (!drew) problems.push("no dibujó la sugerencia elegida");
        if (current) got += ` · ${current.description} (${current.intent.chartType})`;
        problems.push(...numberProblems(dom, current));
        break;
      case "private":
        if (said.length === 0) problems.push("el agente no contestó");
        break;
    }

    // SC-009 vale para todos los turnos.
    const leaked = nameHits([...said, dom.text].join(" "), people);
    if (leaked.length > 0) problems.push(`nombró personas (${leaked.join(", ")})`);

    results.push({ turn, pass: problems.length === 0, got, problems, heard, said, latencies });
  });

  return results;
}

/**
 * El reset entre personas (T102): después del silencio largo, el agente cortó la
 * conversación y la pantalla quedó en reposo, sin el gráfico ni el ribbon de antes.
 */
export function evaluateReset(conversation: Conversation, parsed: Parsed, final: DomSnapshot): TurnResult {
  const problems: string[] = [];
  if (!parsed.disconnects.includes("agent")) problems.push("el agente no cortó la conversación por silencio");
  if (final.ribbon) problems.push(`quedó el ribbon "${final.ribbon}"`);
  if (final.labels.length > 0 || final.kpis.length > 0) problems.push("quedó el gráfico de la persona anterior");
  return {
    turn: { id: `${conversation.id}-reset`, say: "(silencio largo)", expect: { kind: "refuse" } },
    pass: problems.length === 0,
    got: `desconexión: ${parsed.disconnects.join(", ") || "ninguna"}`,
    problems,
    heard: [],
    said: [],
    latencies: [],
  };
}

/** Una muestra de lo que se mueve en pantalla, para SC-005. */
export interface MotionSample {
  t: number;
  /** Etiqueta de la etapa que muestra el indicador, o null en reposo. */
  stage: string | null;
  /** Firma de lo que anima: transform del riel activo y opacidad del esqueleto. */
  motion: string;
}

/** Las etapas en las que la tubería trabaja: escuchar no cuenta como generación. */
const WORKING_STAGES = new Set([
  "Interpretando lo que pediste",
  "Buscando en los datos",
  "Armando la visualización",
  "Dibujando",
]);

/**
 * SC-005: el tramo más largo, en ms, en que nada se movió mientras la tubería trabajaba.
 * Se mide sobre muestras consecutivas: si la firma de movimiento no cambió entre dos muestras
 * de una generación, ese intervalo cuenta como quieto. La resolución es la del muestreo.
 */
export function longestStill(samples: MotionSample[]): number {
  let longest = 0;
  let runStart: number | null = null;
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1]!;
    const cur = samples[i]!;
    const working = prev.stage !== null && WORKING_STAGES.has(prev.stage) && cur.stage === prev.stage;
    if (working && cur.motion === prev.motion) {
      runStart ??= prev.t;
      longest = Math.max(longest, (cur.t - runStart) * 1000);
    } else {
      runStart = null;
    }
  }
  return Math.round(longest);
}

/** Percentil sobre una lista de milisegundos. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!;
}
