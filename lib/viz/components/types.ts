import type { NumberFormat } from "@/lib/data/types";

/**
 * Los props que los componentes reciben del renderer.
 *
 * Reflejan el catálogo (`lib/viz/catalog.ts`), que es la fuente de verdad. Se escriben a
 * mano en vez de inferirse con `z.infer` porque el renderer ya resolvió las expresiones
 * de binding: donde el catálogo declara `data: { $state: "/rows" }`, acá llega el array
 * de filas.
 */

export interface SeriesSpec {
  key: string;
  label: string;
  format: NumberFormat;
}

export type DataRow = Record<string, string | number | null>;

export interface ChartBaseProps {
  data: DataRow[];
  title: string;
  subtitle: string | null;
  xKey: string;
  xLabel: string;
  yLabel: string;
  series: SeriesSpec[];
  legend: boolean;
  grid: boolean;
  emptyMessage: string;
}

/** Normaliza lo que llega del renderer: si el binding no resolvió, es una lista vacía. */
export function rowsOf(data: unknown): DataRow[] {
  return Array.isArray(data) ? (data as DataRow[]) : [];
}
