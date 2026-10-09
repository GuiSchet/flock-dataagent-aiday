import type { Row } from "./types";

/**
 * Los movimientos de la dotación, mes a mes, calculados sobre la nómina.
 *
 * Se calcula de las fechas de ingreso y egreso, así que llega hasta la fecha de corte y no
 * se desalinea de la nómina. El generador de datos cuenta la misma serie por su lado y la deja
 * como control para los tests. Las fórmulas son las de una planilla de attrition de RR.HH.:
 *
 * - **Deserción**: bajas del mes sobre la dotación al inicio del mes.
 * - **Attrition**: bajas sobre la dotación promedio del mes (inicio + fin, sobre 2).
 * - **Rotación**: bajas menos ingresos, sobre la dotación al inicio. Negativa si la
 *   dotación creció.
 *
 * La nómina no tiene los egresos anteriores a 2023, así que la serie arranca en enero 2023.
 * Termina en el último mes completo antes de la fecha de corte: un mes a medias se vería
 * como una caída de ingresos que no existe.
 */

export const FIRST_MONTH = "2023-01";

function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

function quarterOf(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
}

/** El último mes completo al `cutoff` (`aaaa-mm-dd`). */
export function lastCompleteMonth(cutoff: string): string {
  const [y, m, d] = cutoff.split("-").map(Number) as [number, number, number];
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d === lastDay) return cutoff.slice(0, 7);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

const pct = (num: number, den: number) => (den === 0 ? null : (num / den) * 100);

export function buildMovimientos(nomina: Row[], cutoff: string): Row[] {
  const people = nomina
    .map((r) => ({ ingreso: r.ingreso, egreso: r.egreso }))
    .filter((p): p is { ingreso: string; egreso: string | null } => typeof p.ingreso === "string");

  const last = lastCompleteMonth(cutoff);
  const rows: Row[] = [];
  const window: Array<{ egresos: number; promedio: number }> = [];

  for (let month = FIRST_MONTH; month <= last; month = nextMonth(month)) {
    const start = `${month}-01`;
    const end = `${nextMonth(month)}-01`;

    // Al inicio del mes están quienes entraron antes y todavía no se habían ido. Un egreso
    // el día 1 cuenta como baja de ese mes: esa persona arrancó el mes en la dotación.
    const inicio = people.filter((p) => p.ingreso < start && (p.egreso === null || p.egreso >= start)).length;
    const ingresos = people.filter((p) => p.ingreso >= start && p.ingreso < end).length;
    const egresos = people.filter((p) => p.egreso !== null && p.egreso >= start && p.egreso < end).length;
    const fin = inicio + ingresos - egresos;
    const promedio = (inicio + fin) / 2;

    window.push({ egresos, promedio });
    if (window.length > 12) window.shift();
    const attrition12m =
      window.length === 12
        ? pct(
            window.reduce((acc, w) => acc + w.egresos, 0),
            window.reduce((acc, w) => acc + w.promedio, 0) / 12,
          )
        : null;

    rows.push({
      mes: month,
      trimestre: quarterOf(month),
      anio: month.slice(0, 4),
      dotacion_inicio: inicio,
      dotacion_fin: fin,
      ingresos,
      egresos,
      desercion_pct: pct(egresos, inicio),
      attrition_pct: pct(egresos, promedio),
      rotacion_pct: pct(egresos - ingresos, inicio),
      attrition_12m: attrition12m,
    });
  }

  return rows;
}
