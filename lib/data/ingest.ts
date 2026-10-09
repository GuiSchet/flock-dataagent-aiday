import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";

/**
 * Lectura de los archivos de `data/`.
 *
 * Es una nómina sintética: la genera `npm run data:synthetic` con una semilla fija, sin
 * ninguna fila de una persona real. El script ya dejó sólo las columnas que la app puede usar, en UTF-8,
 * con fechas ISO y punto decimal, así que acá no hay nada que adivinar.
 */

export const FILES = {
  nomina: "nomina.csv",
  meta: "meta.json",
  controlAttrition: "control-attrition-2023-2024.csv",
} as const;

/** Lo que el import dejó escrito sobre la fuente. */
export interface SourceMeta {
  fuente: string;
  hojas: string[];
  /** `aaaa-mm-dd`: hasta cuándo valen los datos. */
  fechaCorte: string;
  personas: number;
  activas: number;
  egresadas: number;
}

function dataPath(file: string): string {
  return path.join(process.cwd(), "data", file);
}

/** Un CSV de `data/` como objetos crudos, con las celdas vacías como cadena vacía. */
export function readCsv(file: string): Record<string, string>[] {
  const text = fs.readFileSync(dataPath(file), "utf8");
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transform: (value) => value.trim(),
  });
  if (parsed.errors.length > 0) {
    const first = parsed.errors[0]!;
    throw new Error(`${file}, fila ${first.row ?? "?"}: ${first.message}`);
  }
  return parsed.data;
}

export function readMeta(): SourceMeta {
  return JSON.parse(fs.readFileSync(dataPath(FILES.meta), "utf8")) as SourceMeta;
}
