import { describe, expect, it } from "vitest";
import { getCatalogSummary } from "@/lib/data/catalog";
import { exampleQuestions } from "@/lib/conversation/examples";

describe("ejemplos de la portada", () => {
  it("salen del catálogo real y no se repiten", () => {
    const examples = exampleQuestions(getCatalogSummary());
    expect(examples.length).toBe(6);
    expect(new Set(examples).size).toBe(examples.length);
    expect(examples[0]).toBe("¿Cuántas personas activas hay por seniority?");
  });

  it("si una columna desaparece del catálogo, su ejemplo no se ofrece", () => {
    const summary = getCatalogSummary();
    const sinSeniority = {
      ...summary,
      domains: summary.domains.map((d) => ({ ...d, dimensions: d.dimensions.filter((x) => x.id !== "seniority") })),
    };
    const examples = exampleQuestions(sinSeniority, 20);
    expect(examples.some((e) => /seniority/i.test(e))).toBe(false);
  });
});
