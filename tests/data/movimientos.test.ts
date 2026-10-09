import { describe, expect, it } from "vitest";
import { getDomain } from "@/lib/data/catalog";
import { FILES, readCsv } from "@/lib/data/ingest";
import { lastCompleteMonth } from "@/lib/data/movimientos";
import { runQuery } from "@/lib/data/query";

/**
 * El dominio de movimientos se calcula de la nómina con `buildMovimientos`. El generador de
 * datos cuenta la misma serie por su lado, persona por persona, y la deja en
 * `control-attrition-2023-2024.csv`: dos implementaciones de la misma definición (quién está
 * el día 1, quién entra y quién se va en el mes) tienen que dar exactamente lo mismo.
 */

const control = readCsv(FILES.controlAttrition).map((r) => ({
  mes: r.mes!,
  headcount: Number(r.headcount_inicio),
  ingresos: Number(r.ingresos),
  bajas: Number(r.bajas),
}));

const byMonth = new Map(getDomain("movimientos").rows.map((r) => [r.mes, r]));

describe("movimientos contra la serie de control", () => {
  it("el control trae los 22 meses de enero 2023 a octubre 2024", () => {
    expect(control.length).toBe(22);
    expect(control[0]!.mes).toBe("2023-01");
    expect(control.at(-1)!.mes).toBe("2024-10");
  });

  it("arranca con la misma dotación: 50 personas en enero 2023", () => {
    expect(byMonth.get("2023-01")?.dotacion_inicio).toBe(50);
  });

  it("cada mes coincide en dotación, ingresos y bajas", () => {
    for (const month of control) {
      const row = byMonth.get(month.mes)!;
      expect(Number(row.dotacion_inicio), month.mes).toBe(month.headcount);
      expect(Number(row.ingresos), month.mes).toBe(month.ingresos);
      expect(Number(row.egresos), month.mes).toBe(month.bajas);
    }
  });
});

describe("indicadores", () => {
  const rows = getDomain("movimientos").rows;

  it("la serie va de enero 2023 al último mes completo antes del corte", () => {
    expect(rows[0]!.mes).toBe("2023-01");
    expect(rows.at(-1)!.mes).toBe("2026-08");
    expect(lastCompleteMonth("2026-09-24")).toBe("2026-08");
    expect(lastCompleteMonth("2026-09-30")).toBe("2026-09");
    expect(lastCompleteMonth("2026-01-10")).toBe("2025-12");
  });

  it("la dotación de un mes es la del cierre del anterior", () => {
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i]!.dotacion_inicio).toBe(rows[i - 1]!.dotacion_fin);
    }
  });

  it("la dotación al cierre coincide con las 79 personas activas de hoy", () => {
    expect(rows.at(-1)!.dotacion_fin).toBe(79);
  });

  it("usa las fórmulas de la planilla", () => {
    // Septiembre 2023: 62 al inicio, 3 ingresos, 1 baja.
    const sep = rows.find((r) => r.mes === "2023-09")!;
    expect(sep).toMatchObject({ dotacion_inicio: 62, ingresos: 3, egresos: 1, dotacion_fin: 64 });
    expect(sep.desercion_pct).toBeCloseTo((1 / 62) * 100, 6);
    expect(sep.attrition_pct).toBeCloseTo((1 / ((62 + 64) / 2)) * 100, 6);
    expect(sep.rotacion_pct).toBeCloseTo(((1 - 3) / 62) * 100, 6);
  });

  it("el attrition de 12 meses existe desde diciembre 2023", () => {
    expect(rows.find((r) => r.mes === "2023-11")!.attrition_12m).toBeNull();
    expect(rows.find((r) => r.mes === "2023-12")!.attrition_12m).toBeGreaterThan(0);
  });

  it("se consulta por trimestre y por año", () => {
    const byYear = runQuery({ domain: "movimientos", metric: "egresos", groupBy: ["anio"] });
    expect(byYear.rows.map((r) => r.anio)).toEqual(["2023", "2024", "2025", "2026"]);
    expect(byYear.rows.reduce((a, r) => a + Number(r.egresos), 0)).toBe(45);

    const byQuarter = runQuery({ domain: "movimientos", metric: "ingresos", groupBy: ["trimestre"] });
    expect(byQuarter.rows[0]!.trimestre).toBe("Q1 2023");
  });
});
