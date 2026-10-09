import { describe, expect, it, vi } from "vitest";
import { EMPTY_HISTORY, push, type History } from "@/lib/conversation/history";
import { resolveVisualization, type Resolved } from "@/lib/conversation/resolve";
import { createToolHandlers, type ToolDeps, type ToolSession } from "@/lib/conversation/tools";
import type { Stage } from "@/lib/conversation/stages";

/** Una sesión en memoria que registra lo que le piden los handlers. */
function fakeSession() {
  let history: History = EMPTY_HISTORY;
  let current: Resolved | null = null;
  const stages: Stage[] = [];
  const highlights: Array<string | null> = [];
  const session: ToolSession = {
    current: () => current,
    history: () => history,
    setStage: (s) => stages.push(s),
    show: (r, next) => {
      current = r;
      history = next ?? push(history, r.intent);
    },
    highlight: (label) => highlights.push(label),
  };
  return { session, stages, highlights, depth: () => history.stack.length };
}

/** El servidor de verdad, pero sin red: resolveVisualization directo. */
const localDeps: ToolDeps = {
  resolve: async (request) => resolveVisualization(request),
  catalog: async () => ({ domains: [] }),
};

const porArea = {
  domain: "nomina",
  metric: "headcount_activo",
  groupBy: ["area"],
  chartType: "bar",
  title: "Personas activas por área",
};

describe("proposeVisualization", () => {
  it("responde con el resumen y apila el intent", async () => {
    const { session, depth } = fakeSession();
    const tools = createToolHandlers(session, localDeps);
    const reply = JSON.parse(await tools.proposeVisualization(porArea));
    expect(reply.status).toBe("rendered");
    expect(reply.rowCount).toBe(3);
    expect(reply.summary).toContain("Operación");
    expect(depth()).toBe(1);
  });

  it("un pedido imposible vuelve como error explicable y no apila nada", async () => {
    const { session, depth, stages } = fakeSession();
    const tools = createToolHandlers(session, localDeps);
    const reply = JSON.parse(await tools.proposeVisualization({ ...porArea, metric: "facturacion" }));
    expect(reply.status).toBe("error");
    expect(reply.suggestion).toBeTruthy();
    expect(depth()).toBe(0);
    expect(stages.at(-1)).toBe("idle");
  });

  it("una falla de red no lanza: vuelve como error que se puede decir", async () => {
    const { session } = fakeSession();
    const tools = createToolHandlers(session, {
      ...localDeps,
      resolve: () => Promise.reject(new Error("offline")),
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const reply = JSON.parse(await tools.proposeVisualization(porArea));
    expect(reply.status).toBe("error");
  });
});

describe("refine y undo", () => {
  it("refinar sin gráfico en pantalla pide generar primero", async () => {
    const { session } = fakeSession();
    const tools = createToolHandlers(session, localDeps);
    const reply = JSON.parse(await tools.refineVisualization({ chartType: "pie" }));
    expect(reply.status).toBe("error");
  });

  it("refina sobre lo vigente y dice qué cambió", async () => {
    const { session, depth } = fakeSession();
    const tools = createToolHandlers(session, localDeps);
    await tools.proposeVisualization(porArea);
    const reply = JSON.parse(
      await tools.refineVisualization({ filters: [{ field: "genero", op: "eq", value: "femenino" }] }),
    );
    expect(reply.changed).toEqual(["filters"]);
    expect(reply.now).toContain("género: Femenino");
    // La procedencia es la de lo que queda en pantalla, filtro incluido, no la del catálogo.
    expect(reply.provenance).toEqual({
      fuente: "Nómina",
      registros: "33 de 124 registros",
      filtros: "género: Femenino",
    });
    expect(depth()).toBe(2);
  });

  it("volver atrás desapila y re-ejecuta el intent anterior", async () => {
    const { session, depth } = fakeSession();
    const tools = createToolHandlers(session, localDeps);
    await tools.proposeVisualization(porArea);
    await tools.refineVisualization({ filters: [{ field: "genero", op: "eq", value: "Femenino" }] });
    const reply = JSON.parse(await tools.undoVisualization({}));
    expect(reply.status).toBe("rendered");
    expect(reply.rowCount).toBe(3);
    expect(depth()).toBe(1);
    expect(session.current()?.intent.filters).toEqual([]);
  });

  it("con un solo gráfico no hay más atrás", async () => {
    const { session } = fakeSession();
    const tools = createToolHandlers(session, localDeps);
    await tools.proposeVisualization(porArea);
    const reply = JSON.parse(await tools.undoVisualization({}));
    expect(reply.status).toBe("at_start");
    // Tiene que quedar claro que el gráfico sigue en pantalla: el agente decía lo contrario.
    expect(reply.message).toMatch(/sigue ahí/);
    expect(reply.now).toBe("Personas activas · por área");
  });
});

describe("queryCurrentChart", () => {
  it("contesta desde el resultado vigente, no desde una lectura visual", async () => {
    const { session, highlights } = fakeSession();
    const tools = createToolHandlers(session, localDeps);
    await tools.proposeVisualization(porArea);
    const reply = JSON.parse(
      await tools.queryCurrentChart({ question: "¿cuántos hay en Operación?", highlight: "operacion" }),
    );
    expect(reply.answerable).toBe(true);
    expect(reply.answers.point[0].formatted).toBe("53 personas");
    // Y la categoría nombrada se resalta en pantalla mientras el agente contesta.
    expect(highlights).toEqual(["Operación"]);
  });
});
