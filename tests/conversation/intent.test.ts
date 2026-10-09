import { describe, expect, it } from "vitest";
import {
  AgentIntentSchema,
  changedFields,
  coverageWarning,
  describeIntent,
  mergeIntent,
  normalizeAgentIntent,
  validateIntent,
  type AgentIntentDelta,
  type VizIntent,
} from "@/lib/conversation/intent";
import { current, EMPTY_HISTORY, push, undo } from "@/lib/conversation/history";

/** Lo que mandaría el agente para "mostrame la dotación por región". */
const agentSaid = AgentIntentSchema.parse({
  domain: "nomina",
  metric: "headcount_activo",
  groupBy: ["region"],
  filters: [],
  sortBy: "metric",
  sortDir: "desc",
  limit: null,
  chartType: "bar",
  title: "Dotación activa por región",
  assumptions: ["Ordenado de mayor a menor"],
});

const base = (): VizIntent => normalizeAgentIntent(agentSaid);

describe("lo que llega del agente", () => {
  it("normaliza a la forma interna", () => {
    const intent = base();
    expect(intent.domain).toBe("nomina");
    expect(intent.sort).toEqual({ by: "metric", dir: "desc" });
    expect(intent.filters).toEqual([]);
  });

  it("sortBy 'default' deja que decida el motor", () => {
    const intent = normalizeAgentIntent({ ...agentSaid, sortBy: "default" });
    // null significa "cronológico si es temporal, de mayor a menor si es categórica".
    expect(intent.sort).toBeNull();
  });

  it("parte por coma los operadores de varios valores", () => {
    const intent = normalizeAgentIntent({
      ...agentSaid,
      filters: [{ field: "region", op: "in", value: "CABA, GBA ,Interior" }],
    });
    expect(intent.filters[0]?.value).toEqual(["CABA", "GBA", "Interior"]);
  });

  it("no parte por coma los operadores de un solo valor", () => {
    const intent = normalizeAgentIntent({
      ...agentSaid,
      filters: [{ field: "region", op: "eq", value: "GBA, Pilar" }],
    });
    expect(intent.filters[0]?.value).toBe("GBA, Pilar");
  });

  it("convierte a número lo que es número, y deja el texto en paz", () => {
    const intent = normalizeAgentIntent({
      ...agentSaid,
      filters: [
        { field: "edad", op: "gte", value: "30" },
        { field: "region", op: "eq", value: "CABA" },
      ],
    });
    expect(intent.filters[0]?.value).toBe(30);
    expect(intent.filters[1]?.value).toBe("CABA");
  });

  it("aplica los defaults cuando el agente omite campos opcionales", () => {
    const parsed = AgentIntentSchema.parse({
      domain: "nomina",
      metric: "headcount_activo",
      groupBy: ["area"],
      chartType: "bar",
      title: "Personas activas por área",
    });
    expect(parsed.filters).toEqual([]);
    expect(parsed.sortBy).toBe("default");
    expect(parsed.limit).toBeNull();
  });
});

describe("validación semántica: la red de seguridad", () => {
  it("un intent correcto no tiene problemas", () => {
    expect(validateIntent(base())).toEqual([]);
  });

  it("rechaza una métrica inventada y dice cuáles hay", () => {
    const issues = validateIntent({ ...base(), metric: "facturacion" });
    expect(issues[0]?.message).toMatch(/no existe/i);
    expect(issues[0]?.suggestion).toMatch(/Personas activas/);
  });

  it("rechaza una dimensión inventada", () => {
    const issues = validateIntent({ ...base(), groupBy: ["salario"] });
    expect(issues[0]?.message).toMatch(/no se puede cortar/i);
  });

  it("no deja filtrar por una columna PII: no está en el catálogo", () => {
    for (const pii of ["nombre", "correo", "cuil", "telefono"]) {
      const issues = validateIntent({
        ...base(),
        filters: [{ field: pii, op: "eq", value: "x" }],
      });
      expect(issues.some((i) => /no se puede filtrar/i.test(i.message))).toBe(true);
    }
  });

  it("sin corte exige un KPI", () => {
    const issues = validateIntent({ ...base(), groupBy: [], chartType: "bar" });
    expect(issues[0]?.message).toMatch(/un solo número/i);
    expect(validateIntent({ ...base(), groupBy: [], chartType: "kpi" })).toEqual([]);
  });

  it("una torta necesita exactamente una dimensión", () => {
    expect(validateIntent({ ...base(), chartType: "donut", groupBy: ["region", "genero"] })[0]
      ?.message).toMatch(/exactamente una dimensión/i);
    expect(validateIntent({ ...base(), chartType: "donut" })).toEqual([]);
  });

  it("las apiladas necesitan dos", () => {
    expect(validateIntent({ ...base(), chartType: "barStacked" })[0]?.message)
      .toMatch(/dos dimensiones/i);
  });

  it("rechaza una serie con más valores que colores tiene la paleta", () => {
    // `proyecto` tiene 8 valores; la paleta distingue 7.
    const issues = validateIntent({
      ...base(),
      groupBy: ["area", "proyecto"],
      chartType: "barStacked",
    });
    expect(issues.some((i) => /paleta distingue/i.test(i.message))).toBe(true);
  });

  it("sólo avisa cobertura baja por debajo de la mitad de las filas", () => {
    // La edad falta en 3 de 124 personas y el attrition de 12 meses en los primeros 11 meses:
    // ninguna de las dos llega a ser un dato poco confiable.
    expect(coverageWarning({ ...base(), metric: "edad_prom" })).toBeNull();
    expect(
      coverageWarning({ ...base(), domain: "movimientos", metric: "attrition_12m", groupBy: ["mes"] }),
    ).toBeNull();
    expect(coverageWarning(base())).toBeNull();
  });
});

/**
 * SC-006: una cadena de cinco refinamientos hablados tiene que conservar el estado
 * acumulado. Es lo que diferencia una conversación de un buscador.
 */
describe("refinamiento encadenado", () => {
  const refine = (intent: VizIntent, delta: AgentIntentDelta) => mergeIntent(intent, delta);

  it("conserva el estado a lo largo de cinco vueltas", () => {
    let intent = base();

    // 1. "solo los activos"
    intent = refine(intent, { filters: [{ field: "activo", op: "eq", value: "Sí" }] });
    // 2. "quedate con CABA y GBA"
    intent = refine(intent, { filters: [{ field: "region", op: "in", value: "CABA, GBA" }] });
    // 3. "abrilo por género"
    intent = refine(intent, { groupBy: ["region", "genero"], chartType: "barStacked" });
    // 4. "ordenalo alfabéticamente"
    intent = refine(intent, { sortBy: "dimension", sortDir: "asc" });
    // 5. "mostrá solo los cinco primeros"
    intent = refine(intent, { limit: 5 });

    // Los dos filtros de las vueltas 1 y 2 siguen ahí.
    expect(intent.filters).toHaveLength(2);
    expect(intent.filters.map((f) => f.field).sort()).toEqual(["activo", "region"]);
    // Y lo de las vueltas 3, 4 y 5 también.
    expect(intent.groupBy).toEqual(["region", "genero"]);
    expect(intent.chartType).toBe("barStacked");
    expect(intent.sort).toEqual({ by: "dimension", dir: "asc" });
    expect(intent.limit).toBe(5);
    // Nada de lo que no se tocó cambió.
    expect(intent.metric).toBe("headcount_activo");
  });

  it("un filtro nuevo sobre un campo ya filtrado lo reemplaza", () => {
    let intent = refine(base(), { filters: [{ field: "region", op: "eq", value: "CABA" }] });
    intent = refine(intent, { filters: [{ field: "region", op: "eq", value: "GBA" }] });
    expect(intent.filters).toHaveLength(1);
    expect(intent.filters[0]?.value).toBe("GBA");
  });

  it("un valor vacío remueve el filtro", () => {
    let intent = refine(base(), {
      filters: [
        { field: "activo", op: "eq", value: "Sí" },
        { field: "region", op: "eq", value: "CABA" },
      ],
    });
    expect(intent.filters).toHaveLength(2);
    intent = refine(intent, { filters: [{ field: "region", op: "eq", value: "" }] });
    expect(intent.filters.map((f) => f.field)).toEqual(["activo"]);
  });

  it("cambiar de dominio descarta filtros y cortes que ya no significan nada", () => {
    const conFiltros = refine(base(), { filters: [{ field: "activo", op: "eq", value: "Sí" }] });
    const otro = refine(conFiltros, {
      domain: "movimientos",
      metric: "egresos",
      groupBy: ["mes"],
    });
    expect(otro.filters).toEqual([]);
    expect(otro.groupBy).toEqual(["mes"]);
  });

  it("informa qué cambió para que el agente lo confirme en voz", () => {
    const antes = base();
    const despues = refine(antes, { filters: [{ field: "activo", op: "eq", value: "Sí" }] });
    expect(changedFields(antes, despues)).toEqual(["filters"]);
  });
});

describe("historial", () => {
  it("volvé atrás restaura el estado anterior", () => {
    const uno = base();
    const dos = mergeIntent(uno, { filters: [{ field: "activo", op: "eq", value: "Sí" }] });

    let history = push(push(EMPTY_HISTORY, uno), dos);
    expect(current(history)?.filters).toHaveLength(1);

    const result = undo(history);
    expect(result.status).toBe("restored");
    if (result.status === "restored") {
      history = result.history;
      expect(current(history)?.filters).toEqual([]);
    }
  });

  it("con un solo gráfico no hay atrás, y lo dice", () => {
    expect(undo(push(EMPTY_HISTORY, base())).status).toBe("at_start");
    expect(undo(EMPTY_HISTORY).status).toBe("at_start");
  });

  it("deshacer no vacía la pantalla", () => {
    const history = push(push(EMPTY_HISTORY, base()), base());
    const result = undo(history);
    if (result.status === "restored") expect(current(result.history)).not.toBeNull();
  });
});

describe("lo que se muestra en pantalla", () => {
  it("describe la intención en una línea legible", () => {
    const intent = mergeIntent(base(), {
      filters: [{ field: "activo", op: "eq", value: "Sí" }],
    });
    expect(describeIntent(intent)).toBe("Personas activas · por región · estado: Sí");
  });

  it("enumera varios filtros", () => {
    const intent = mergeIntent(base(), {
      filters: [
        { field: "activo", op: "eq", value: "Sí" },
        { field: "region", op: "in", value: "CABA, GBA" },
      ],
    });
    const texto = describeIntent(intent);
    expect(texto).toMatch(/estado: Sí/);
    expect(texto).toMatch(/región ∈ CABA, GBA/);
  });
});
