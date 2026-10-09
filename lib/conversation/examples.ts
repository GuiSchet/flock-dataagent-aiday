import type { getCatalogSummary } from "@/lib/data/catalog";

/**
 * Las preguntas de ejemplo de la portada y de la conversación (T058): lo que alguien que
 * nunca vio la app puede decir para arrancar (SC-001).
 *
 * No las inventa un modelo. Son frases escritas a mano para pares métrica–corte, y sólo se
 * muestran las que existen en el catálogo real: si mañana se va una columna, su ejemplo
 * desaparece en vez de prometer algo que el agente no puede dibujar.
 */

type CatalogSummary = ReturnType<typeof getCatalogSummary>;

interface Example {
  domain: string;
  metric: string;
  dimension: string | null;
  text: string;
}

const CURATED: Example[] = [
  { domain: "nomina", metric: "headcount_activo", dimension: "seniority", text: "¿Cuántas personas activas hay por seniority?" },
  { domain: "movimientos", metric: "dotacion", dimension: "mes", text: "¿Cómo evolucionó la dotación mes a mes?" },
  { domain: "nomina", metric: "egresos", dimension: "motivo_egreso", text: "¿Por qué motivos se fue la gente?" },
  { domain: "nomina", metric: "headcount_activo", dimension: "tech_principal", text: "¿Qué tecnologías usa más la gente?" },
  { domain: "movimientos", metric: "attrition", dimension: "trimestre", text: "¿Cómo evolucionó el attrition por trimestre?" },
  { domain: "nomina", metric: "pct_mujeres", dimension: "area", text: "¿Qué porcentaje de mujeres hay en cada área?" },
  { domain: "nomina", metric: "antiguedad_prom", dimension: "rol", text: "¿Cuál es la antigüedad promedio por rol?" },
  { domain: "nomina", metric: "headcount_activo", dimension: "proyecto", text: "¿En qué proyectos trabaja más gente?" },
];

export function exampleQuestions(summary: CatalogSummary, max = 6): string[] {
  const exists = (e: Example) => {
    const domain = summary.domains.find((d) => d.id === e.domain);
    if (!domain || !domain.metrics.some((m) => m.id === e.metric)) return false;
    return e.dimension === null || domain.dimensions.some((d) => d.id === e.dimension);
  };

  const curated = CURATED.filter(exists).map((e) => e.text);

  // Si el catálogo cambió y quedaron pocas, se completa con pares reales, dichos llano.
  const generic: string[] = [];
  for (const domain of summary.domains) {
    const metric = domain.metrics[0];
    for (const dimension of domain.dimensions) {
      if (!metric || dimension.kind !== "categorical" || dimension.cardinality > 12) continue;
      generic.push(`Mostrame ${metric.label.toLowerCase()} por ${dimension.label.toLowerCase()}`);
    }
  }

  return [...new Set([...curated, ...generic])].slice(0, max);
}
