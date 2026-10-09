import { describe, expect, it } from "vitest";
import { resolveVisualization, type Resolved } from "@/lib/conversation/resolve";

/** Lo que mandaría el agente para "las personas activas por área". */
const porArea = {
  domain: "nomina",
  metric: "headcount_activo",
  groupBy: ["area"],
  chartType: "bar",
  title: "Personas activas por área",
};

/** Una serie de movimientos, para los filtros de período. */
const egresosPorMes = {
  domain: "movimientos",
  metric: "egresos",
  groupBy: ["mes"],
  chartType: "bar",
  title: "Egresos por mes",
};

function ok(resolution: ReturnType<typeof resolveVisualization>): Resolved {
  if (!resolution.ok) throw new Error(`Se esperaba ok y vino: ${resolution.message}`);
  return resolution;
}

describe("propose", () => {
  it("resuelve lo que manda el agente y ejecuta la consulta", () => {
    const r = ok(resolveVisualization({ mode: "propose", params: porArea }));
    const operacion = r.result.rows.find((row) => row.area === "Operación");
    expect(operacion?.headcount_activo).toBe(53);
    expect(r.result.rowCount).toBe(3);
    expect(r.description).toBe("Personas activas · por área");
    expect(r.subtitle).toBeNull();
    expect(r.changed).toEqual([]);
  });

  it("aplica los defaults del Zod a lo que el agente no mandó", () => {
    const r = ok(resolveVisualization({ mode: "propose", params: porArea }));
    expect(r.intent.filters).toEqual([]);
    expect(r.intent.limit).toBeNull();
    expect(r.intent.assumptions).toEqual([]);
  });

  it("le da al agente un resumen con números reales y ya formateados", () => {
    const r = ok(resolveVisualization({ mode: "propose", params: porArea }));
    expect(r.summary).toContain("3 valores de área");
    expect(r.summary).toContain("Operación con 53 personas");
  });

  it("describe la forma del resultado sin un solo valor", () => {
    const r = ok(resolveVisualization({ mode: "propose", params: porArea }));
    expect(r.shape.columns?.map((c) => c.key)).toEqual(["area", "headcount_activo"]);
    expect(r.shape.rowCount).toBe(3);
    // Lo único que viaja al compositor son claves y etiquetas: ningún número del resultado.
    const wire = JSON.stringify(r.shape);
    expect(wire).not.toContain("53");
  });

  it("calcula el resumen que leen los KPIs: el total es 79, no la primera área", () => {
    const r = ok(resolveVisualization({ mode: "propose", params: porArea }));
    expect(r.stats).toMatchObject({ total: 79, max: 53, min: 7, count: 3 });
    // La forma para el compositor dice qué claves hay, sin los valores.
    expect(r.shape.stats?.map((s) => s.key)).toEqual(["total", "max", "min", "avg", "count"]);
  });

  it("no ofrece total ni promedio de una métrica que no se suma", () => {
    const r = ok(
      resolveVisualization({
        mode: "propose",
        params: { domain: "nomina", metric: "edad_prom", groupBy: ["region"], chartType: "bar", title: "Edad" },
      }),
    );
    expect(r.stats.total).toBeNull();
    expect(r.stats.avg).toBeNull();
    expect(r.shape.stats?.map((s) => s.key)).toEqual(["max", "min", "count"]);
  });

  it("rechaza una métrica inventada con las que sí existen", () => {
    const r = resolveVisualization({
      mode: "propose",
      params: { ...porArea, metric: "facturacion" },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain('"facturacion" no existe');
    expect(r.suggestion).toContain("Personas activas");
  });

  it("rechaza una torta con dos dimensiones y sugiere apiladas", () => {
    const r = resolveVisualization({
      mode: "propose",
      params: { ...porArea, groupBy: ["area", "genero"], chartType: "pie" },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.suggestion).toContain("barras apiladas");
  });

  it("rechaza parámetros que no respetan el schema, con el campo que falla", () => {
    const r = resolveVisualization({ mode: "propose", params: { domain: "nomina" } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain("metric");
  });

  it("rechaza un dominio que ya no existe", () => {
    const r = resolveVisualization({ mode: "propose", params: { ...porArea, domain: "clientes" } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain("domain");
  });

  it("un filtro sin resultados es un error explicable, no un gráfico vacío", () => {
    const r = resolveVisualization({
      mode: "propose",
      params: {
        ...porArea,
        filters: [
          { field: "activo", op: "eq", value: "No" },
          { field: "area", op: "eq", value: "I+D" },
          { field: "seniority", op: "eq", value: "Senior" },
        ],
      },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain("Ningún registro");
    expect(r.suggestion).toContain("área: I+D");
  });

  it("un filtro de una sola persona devuelve el dato: no hay umbral de grupo", () => {
    const r = ok(
      resolveVisualization({
        mode: "propose",
        params: {
          domain: "nomina",
          metric: "antiguedad_prom",
          groupBy: [],
          chartType: "kpi",
          title: "Antigüedad del CTO",
          filters: [{ field: "posicion", op: "eq", value: "Chief Technology Officer" }],
        },
      }),
    );
    expect(r.result.rows[0]?.antiguedad_prom).toBe(1.1);
    expect(r.result.provenance.rowsMatched).toBe(1);
  });

  it("pasa las advertencias del motor, como el recorte a los principales", () => {
    const r = ok(
      resolveVisualization({
        mode: "propose",
        params: { domain: "nomina", metric: "headcount", groupBy: ["posicion"], chartType: "bar", title: "Por posición" },
      }),
    );
    expect(r.warnings.some((w) => w.includes("Otros"))).toBe(true);
    expect(r.shape.warnings).toEqual(r.warnings);
  });
});

describe("valores de filtro dichos en voz", () => {
  it("corrige tildes y mayúsculas contra los valores reales", () => {
    const r = ok(
      resolveVisualization({
        mode: "propose",
        params: { ...porArea, groupBy: ["seniority"], filters: [{ field: "area", op: "eq", value: "operacion" }] },
      }),
    );
    expect(r.intent.filters[0]?.value).toBe("Operación");
    expect(r.subtitle).toBe("área: Operación");
  });

  it("corrige cada valor de una lista", () => {
    const r = ok(
      resolveVisualization({
        mode: "propose",
        params: { ...porArea, filters: [{ field: "area", op: "in", value: "estructura, i+d" }] },
      }),
    );
    expect(r.intent.filters[0]?.value).toEqual(["Estructura", "I+D"]);
  });

  it("rechaza un valor que no existe diciendo cuáles hay", () => {
    const r = resolveVisualization({
      mode: "propose",
      params: { ...porArea, filters: [{ field: "area", op: "eq", value: "Ventas" }] },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).toContain('"Ventas"');
    expect(r.suggestion).toContain("Estructura, I+D, Operación");
  });

  it("lleva un mes dicho en palabras a AAAA-MM", () => {
    const r = ok(
      resolveVisualization({
        mode: "propose",
        params: {
          ...egresosPorMes,
          filters: [{ field: "mes", op: "between", value: "enero 2024, marzo de 2024" }],
        },
      }),
    );
    expect(r.intent.filters[0]?.value).toEqual(["2024-01", "2024-03"]);
  });

  it("un año solo es el rango entero de ese año", () => {
    const r = ok(
      resolveVisualization({
        mode: "propose",
        params: { ...egresosPorMes, filters: [{ field: "mes", op: "eq", value: "2024" }] },
      }),
    );
    expect(r.intent.filters[0]).toEqual({ field: "mes", op: "between", value: ["2024-01", "2024-12"] });
    expect(r.result.rowCount).toBe(12);
  });

  it("lleva un trimestre dicho de cualquier forma a AAAA-Qn", () => {
    const r = ok(
      resolveVisualization({
        mode: "propose",
        params: {
          domain: "movimientos",
          metric: "attrition",
          groupBy: ["trimestre"],
          chartType: "bar",
          title: "Attrition del primer trimestre",
          filters: [{ field: "trimestre", op: "eq", value: "Q1 2024" }],
        },
      }),
    );
    expect(r.intent.filters[0]).toEqual({ field: "trimestre", op: "eq", value: "2024-Q1" });
    expect(r.result.rows.map((row) => row.trimestre)).toEqual(["Q1 2024"]);
  });

  it("sobre la dimensión año, un año es ese año y no un rango de meses", () => {
    const r = ok(
      resolveVisualization({
        mode: "propose",
        params: {
          domain: "movimientos",
          metric: "egresos",
          groupBy: ["anio"],
          chartType: "bar",
          title: "Egresos de 2024",
          filters: [{ field: "anio", op: "eq", value: "2024" }],
        },
      }),
    );
    expect(r.intent.filters[0]).toEqual({ field: "anio", op: "eq", value: "2024" });
    expect(r.result.rows).toMatchObject([{ anio: "2024", egresos: 15 }]);
  });
});

describe("refine y resolve", () => {
  const base = () => ok(resolveVisualization({ mode: "propose", params: porArea })).intent;

  it("acumula filtros sobre el intent vigente y dice qué cambió", () => {
    const first = ok(
      resolveVisualization({
        mode: "refine",
        base: base(),
        params: { filters: [{ field: "activo", op: "eq", value: "si" }] },
      }),
    );
    expect(first.changed).toEqual(["filters"]);

    const second = ok(
      resolveVisualization({
        mode: "refine",
        base: first.intent,
        params: { filters: [{ field: "genero", op: "eq", value: "femenino" }] },
      }),
    );
    expect(second.intent.filters.map((f) => f.field)).toEqual(["activo", "genero"]);
    expect(second.intent.groupBy).toEqual(["area"]);
  });

  it("un delta que sólo cambia el tipo conserva corte, orden y límite", () => {
    // Regresión: en Zod 4 los defaults sobreviven a .partial(). Con el delta derivado del
    // schema completo, este refinamiento llegaba con groupBy: [] y sortBy: "default".
    const start = ok(
      resolveVisualization({
        mode: "propose",
        params: { ...porArea, sortBy: "dimension", sortDir: "asc", limit: 5 },
      }),
    ).intent;
    const r = ok(resolveVisualization({ mode: "refine", base: start, params: { chartType: "pie" } }));
    expect(r.intent.groupBy).toEqual(["area"]);
    expect(r.intent.sort).toEqual({ by: "dimension", dir: "asc" });
    expect(r.intent.limit).toBe(5);
    expect(r.changed).toEqual(["chartType"]);
  });

  it("sin intent vigente no hay nada que refinar", () => {
    const r = resolveVisualization({ mode: "refine", base: null, params: { chartType: "pie" } });
    expect(r.ok).toBe(false);
  });

  it("re-ejecuta un intent ya resuelto para volver atrás", () => {
    const r = ok(resolveVisualization({ mode: "resolve", intent: base() }));
    expect(r.result.rowCount).toBe(3);
  });

  it("no confía en un intent que volvió del navegador con otra forma", () => {
    const r = resolveVisualization({ mode: "resolve", intent: { domain: "nomina" } });
    expect(r.ok).toBe(false);
  });
});
