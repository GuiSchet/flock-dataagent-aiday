import { getCatalogSummary } from "@/lib/data/catalog";

/**
 * Qué datos hay: dominios, dimensiones, métricas y lo que no está disponible. Sin filas.
 *
 * Existe porque el navegador no puede armar el catálogo —se lee de los CSV con `node:fs`—
 * y lo necesitan el tool `getDataCatalog` y la pantalla de reposo. Los CSV se versionan en
 * el repo y no cambian mientras el proceso vive, así que la respuesta se genera en el build.
 */

export const dynamic = "force-static";

export function GET() {
  return Response.json(getCatalogSummary());
}
