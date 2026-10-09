import { describe, expect, it } from "vitest";
import type { Conversation } from "@/scripts/voice-bench/cases";
import {
  evaluateConversation,
  longestStill,
  nameHits,
  parseEsAr,
  parseLogs,
  type DomSnapshot,
} from "@/scripts/voice-bench/evaluate";

/**
 * El juez del banco de pruebas por voz. Si se equivoca, el banco aprueba lo que no anda o
 * reprueba lo que sí: por eso se prueba con trazas armadas a mano.
 */

const porArea = {
  domain: "nomina",
  metric: "headcount_activo",
  groupBy: ["area"],
  chartType: "bar",
  title: "Personas activas por área",
};

const conversation: Conversation = {
  id: "cx",
  title: "prueba",
  turns: [
    { id: "t1", say: "Mostrame las personas activas por área", expect: { kind: "chart", intent: { domain: "nomina", metric: "headcount_activo", groupBy: ["area"] } } },
    { id: "t2", say: "Quedate con las mujeres", expect: { kind: "chart", intent: { domain: "nomina", metric: "headcount_activo", groupBy: ["area"], filters: [{ field: "genero", value: "Femenino" }] } } },
    { id: "t3", say: "Mostrame la gente", expect: { kind: "ask" } },
  ],
};

const empty: DomSnapshot = { ribbon: null, notice: null, labels: [], kpis: [], dimmed: 0, text: "" };

function logs(lines: Array<[number, string]>) {
  return parseLogs(lines.map(([t, text]) => ({ t, text })));
}

describe("juez del banco", () => {
  const parsed = logs([
    [1, "[voz] Conectado. conversation_id: conv_x"],
    [9, "[voz] user: Mostrame las personas activas por área"],
    [9.1, `[tool] proposeVisualization ${JSON.stringify(porArea)}`],
    [9.2, `[tool] proposeVisualization → {"status":"rendered","rowCount":3}`],
    [10, "[voz] agent: Ahí tenés las tres áreas."],
    [29, "[voz] user: Quedate con las mujeres"],
    [29.1, `[tool] refineVisualization {"filters":[{"field":"genero","op":"eq","value":"femenino"}]}`],
    [29.2, `[tool] refineVisualization → {"status":"rendered"}`],
    [49, "[voz] user: Mostrame la gente"],
    [50, "[voz] agent: ¿Te interesa cuántas personas hay o su antigüedad?"],
    [50.5, '[latencia] {"vista":"x","desde":"fin del turno","primerPixel":900,"completo":2500}'],
  ]);

  it("parsea tools con su respuesta, lo que se dijo y la latencia", () => {
    expect(parsed.conversationId).toBe("conv_x");
    expect(parsed.tools.map((t) => t.reply?.status)).toEqual(["rendered", "rendered"]);
    expect(parsed.agent).toHaveLength(2);
    expect(parsed.latencies[0]?.primerPixel).toBe(900);
  });

  it("aprueba el gráfico, el refinamiento acumulado y la repregunta", () => {
    const doms: DomSnapshot[] = [{ ...empty, labels: ["53", "19"] }, { ...empty, labels: ["16"] }, empty];
    const results = evaluateConversation(conversation, parsed, [8, 28, 48], 70, doms, []);
    expect(results.map((r) => [r.turn.id, r.pass, r.problems])).toEqual([
      ["t1", true, []],
      ["t2", true, []],
      ["t3", true, []],
    ]);
  });

  it("reprueba un número en pantalla que no sale del motor", () => {
    const doms: DomSnapshot[] = [{ ...empty, labels: ["53", "999"] }, empty, empty];
    const [first] = evaluateConversation(conversation, parsed, [8, 28, 48], 70, doms, []);
    expect(first?.problems.join(" ")).toMatch(/999/);
  });

  it("reprueba un gráfico dibujado ante un pedido ambiguo", () => {
    const ambiguous: Conversation = { id: "c", title: "", turns: [conversation.turns[2]!] };
    const drew = logs([
      [1, "[voz] Conectado. conversation_id: conv_y"],
      [9, `[tool] proposeVisualization ${JSON.stringify(porArea)}`],
      [9.1, `[tool] proposeVisualization → {"status":"rendered"}`],
    ]);
    const [r] = evaluateConversation(ambiguous, drew, [8], 30, [empty], []);
    expect(r?.problems.join(" ")).toMatch(/suposición/);
  });

  it("si la app descartó la composición, vuelve al gráfico anterior", () => {
    const discarded = logs([
      [1, "[voz] Conectado. conversation_id: conv_z"],
      [9, `[tool] proposeVisualization ${JSON.stringify(porArea)}`],
      [9.1, `[tool] proposeVisualization → {"status":"rendered"}`],
      [29, `[tool] refineVisualization {"filters":[{"field":"genero","op":"eq","value":"Femenino"}]}`],
      [29.1, `[tool] refineVisualization → {"status":"rendered"}`],
      [29.5, "[componer] Se descarta la visualización: el reintento tampoco validó"],
    ]);
    const twoTurns: Conversation = { ...conversation, turns: conversation.turns.slice(0, 2) };
    const [, second] = evaluateConversation(twoTurns, discarded, [8, 28], 50, [empty, empty], []);
    expect(second?.pass).toBe(false);
    expect(second?.problems.join(" ")).toMatch(/no se dibujó|falta el filtro/);
  });

  it("lee números en formato es-AR", () => {
    expect(parseEsAr("1.234")).toBe(1234);
    expect(parseEsAr("8,50 puntos")).toBe(8.5);
    expect(parseEsAr("58 %")).toBe(58);
  });

  it("detecta nombres completos y apellidos largos, y los reporta con iniciales", () => {
    const people = [{ full: "Juana Pereyra", surname: "Pereyra" }];
    expect(nameHits("La que se fue es juana pereyra", people)).toEqual(["J. P."]);
    expect(nameHits("Pereyra renunció en marzo", people)).toEqual(["J. P."]);
    expect(nameHits("Se fueron 3 personas", people)).toEqual([]);
  });
});

describe("SC-005: nada quieto durante una generación", () => {
  const working = "Armando la visualización";

  it("mide el tramo más largo sin movimiento mientras la tubería trabaja", () => {
    const samples = [
      { t: 0.0, stage: working, motion: "a" },
      { t: 0.1, stage: working, motion: "b" },
      { t: 0.2, stage: working, motion: "b" },
      { t: 0.3, stage: working, motion: "b" },
      { t: 0.4, stage: working, motion: "c" },
    ];
    expect(longestStill(samples)).toBe(200);
  });

  it("escuchar no es generar: quieto mientras escucha no cuenta", () => {
    const samples = [
      { t: 0, stage: "Te escucho", motion: "a" },
      { t: 2, stage: "Te escucho", motion: "a" },
      { t: 2.1, stage: working, motion: "x" },
      { t: 2.2, stage: working, motion: "y" },
    ];
    expect(longestStill(samples)).toBe(0);
  });
});

describe("pregunta que los datos no responden", () => {
  const turn: Conversation = {
    id: "cy",
    title: "",
    turns: [{ id: "t", say: "¿Por qué Operación tiene tanta gente?", expect: { kind: "notInData" } }],
  };
  const run = (answer: string) =>
    evaluateConversation(turn, logs([[1, "[voz] Conectado. conversation_id: c"], [10, `[voz] agent: ${answer}`]]), [8], 30, [empty], [])[0]!;

  it("aprueba cuando dice que los datos no lo explican", () => {
    expect(run("Los datos no explican el motivo, pero puedo abrirlo por rol.").pass).toBe(true);
    expect(run("Eso no lo tengo en los datos: sólo sé cuántas personas hay.").pass).toBe(true);
  });

  it("reprueba cuando inventa una causa", () => {
    expect(run("Porque es el área con más proyectos de clientes.").pass).toBe(false);
  });
});
