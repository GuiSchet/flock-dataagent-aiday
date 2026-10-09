import { describe, expect, it } from "vitest";
import { dataOverview } from "@/lib/data/overview";

/** Lo que la portada dice que se puede preguntar, contra el catálogo real. */
describe("qué se le puede preguntar al agente", () => {
  const overview = dataOverview();

  it("dice hasta cuándo valen los datos", () => {
    expect(overview.cutoff).toBe("24/09/2026");
  });

  it("los temas enumeran las etiquetas reales del catálogo", () => {
    expect(overview.topics.map((t) => t.id)).toEqual(["estructura", "perfil", "tecnologia", "movimientos"]);
    expect(overview.topics[0]!.covers).toBe("Área, rol, seniority y proyecto");
    expect(overview.topics[3]!.covers).toMatch(/^Ingresos, egresos, attrition mensual y rotación$/);
  });

  it("cada tema trae una pregunta de ejemplo", () => {
    for (const topic of overview.topics) expect(topic.example).toMatch(/^¿.+\?$/);
  });

  it("la nota de privacidad dice que no hay nombres", () => {
    expect(overview.privacy).toMatch(/nombre y apellido/);
  });
});
