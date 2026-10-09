import type { NumberFormat } from "./types";

/** Formato es-AR: miles con punto, decimal con coma, meses en español. */

const MESES_LARGOS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

const nf = (min: number, max: number) =>
  new Intl.NumberFormat("es-AR", {
    minimumFractionDigits: min,
    maximumFractionDigits: max,
  });

const FORMATTERS: Record<NumberFormat, Intl.NumberFormat> = {
  integer: nf(0, 0),
  decimal1: nf(1, 1),
  decimal2: nf(2, 2),
  percent: nf(1, 1),
};

export function formatNumber(value: number | null, format: NumberFormat): string {
  if (value === null || !Number.isFinite(value)) return "—";
  const text = FORMATTERS[format].format(value);
  return format === "percent" ? `${text} %` : text;
}

/** `"2024-01"` → `"enero 2024"`. Es lo que el agente dice en voz. */
export function formatMonth(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})$/);
  if (!m) return iso;
  const mes = MESES_LARGOS[Number(m[2]) - 1];
  return mes ? `${mes} ${m[1]}` : iso;
}

/** `"2024-01-25"` → `"25/01/2024"`. */
export function formatDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** Etiqueta legible de un valor de celda, según el tipo de dimensión. */
export function formatLabel(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Sin dato";
  const s = String(value);
  if (/^\d{4}-\d{2}$/.test(s)) return formatMonth(s);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return formatDate(s);
  // Trimestres y años: "2024-Q3" y "2024".
  if (/^\d{4}-Q[1-4]$/.test(s)) return `${s.slice(5)} ${s.slice(0, 4)}`;
  if (/^\d{4}$/.test(s)) return s;
  // Rangos que salieron de fusionar períodos contiguos: se formatea cada extremo.
  if (s.includes("\u2013")) {
    return s.split("\u2013").map((part) => formatLabel(part)).join("\u2013");
  }
  return s;
}

/** "3 regiones" / "1 región" — para que el agente no diga "1 regiones". */
export function pluralize(count: number, singular: string, plural: string): string {
  return `${formatNumber(count, "integer")} ${count === 1 ? singular : plural}`;
}
