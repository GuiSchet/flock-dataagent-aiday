import { describe, expect, it } from "vitest";
import { answerFromResult, formatValue, summarize } from "@/lib/conversation/answers";
import { resolveVisualization, type Resolved } from "@/lib/conversation/resolve";

function resolve(params: Record<string, unknown>): Resolved {
  const r = resolveVisualization({ mode: "propose", params });
  if (!r.ok) throw new Error(r.message);
  return r;
}

const porRegion = () =>
  resolve({
    domain: "nomina",
    metric: "headcount_activo",
    groupBy: ["region"],
    chartType: "bar",
    title: "Activos por región",
  });

describe("formatValue", () => {
  it("formatea en es-AR con la unidad", () => {
    expect(formatValue(1234, { unit: "personas", format: "integer" })).toBe("1.234 personas");
    expect(formatValue(8.5, { unit: "puntos", format: "decimal2" })).toBe("8,50 puntos");
  });

  it("usa el singular con uno", () => {
    expect(formatValue(1, { unit: "registros", format: "integer" })).toBe("1 registro");
    expect(formatValue(1, { unit: "años", format: "integer" })).toBe("1 año");
    expect(formatValue(1, { unit: "años", format: "decimal1" })).toBe("1,0 años");
  });

  it("no duplica el signo de porcentaje", () => {
    expect(formatValue(12.34, { unit: "%", format: "percent" })).toBe("12,3 %");
  });
});

describe("respuestas sobre el gráfico vigente", () => {
  it("el total de las regiones da las 79 personas activas", () => {
    const r = porRegion();
    const a = answerFromResult(r.result, r.meta, r.description);
    expect(a.answerable).toBe(true);
    expect(a.answers.total?.formatted).toBe("79 personas");
    expect(a.answers.max?.label).toBeTruthy();
  });

  it("encuentra la categoría que se mencionó aunque se diga sin mayúsculas", () => {
    const r = porRegion();
    const a = answerFromResult(r.result, r.meta, r.description, "caba");
    expect(a.answers.point?.[0]?.label).toBe("CABA");
  });

  it("avisa cuando la categoría mencionada no está en el gráfico", () => {
    const r = porRegion();
    const a = answerFromResult(r.result, r.meta, r.description, "Rosario");
    expect(a.notFound).toBe("Rosario");
  });

  it("no suma promedios: la edad promedio no tiene total", () => {
    const r = resolve({
      domain: "nomina",
      metric: "edad_prom",
      groupBy: ["region"],
      chartType: "bar",
      title: "Edad promedio por región",
    });
    const a = answerFromResult(r.result, r.meta, r.description);
    expect(a.answers.total).toBeUndefined();
    expect(a.answers.max).toBeDefined();
  });

  it("dice de dónde salen los datos (FR-016)", () => {
    const r = porRegion();
    const a = answerFromResult(r.result, r.meta, r.description);
    expect(a.provenance).toMatchObject({ fuente: "Nómina", registros: "124 de 124 registros" });
    // Seis zonas entran enteras: no hubo que agrupar nada en "Otros".
    expect(a.provenance?.recorte).toBeNull();
  });

  it("sin gráfico en pantalla no contesta", () => {
    const a = answerFromResult(null, null, "");
    expect(a.answerable).toBe(false);
  });

  it("un KPI se lee como un valor solo", () => {
    const r = resolve({
      domain: "nomina",
      metric: "headcount_activo",
      groupBy: [],
      chartType: "kpi",
      title: "Dotación activa",
    });
    expect(answerFromResult(r.result, r.meta, r.description).answers.value?.formatted).toBe(
      "79 personas",
    );
    expect(summarize(r.result, r.meta)).toBe("Personas activas: 79 personas.");
  });
});
