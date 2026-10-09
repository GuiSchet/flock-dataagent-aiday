import { getDomains, getSourceMeta } from "./catalog";
import { formatDate } from "./format";
import type { DomainId } from "./types";

/**
 * Qué se le puede preguntar al agente, para la portada: lo que alguien que abre el link
 * tiene que saber para animarse a hablar.
 *
 * Los temas están escritos a mano, pero lo que cada uno enumera sale del catálogo: si una
 * dimensión deja de existir, desaparece de la lista, y un tema sin nada que mostrar no se
 * muestra. Así la portada nunca promete algo que el agente no puede dibujar.
 */

export interface Topic {
  id: string;
  title: string;
  /** "Área, rol, seniority y proyecto", con las etiquetas reales del catálogo. */
  covers: string;
  /** Una pregunta que funciona, dicha como la diría alguien. */
  example: string;
}

export interface DataOverview {
  /** Hasta cuándo valen los datos, `dd/mm/aaaa`. */
  cutoff: string;
  topics: Topic[];
  /** La única nota de privacidad de la portada. */
  privacy: string;
}

interface TopicSpec {
  id: string;
  title: string;
  domain: DomainId;
  /** Dimensiones o métricas que el tema enumera, en orden. */
  fields: string[];
  example: string;
}

const TOPICS: TopicSpec[] = [
  {
    id: "estructura",
    title: "Estructura",
    domain: "nomina",
    fields: ["area", "rol", "seniority", "proyecto"],
    example: "¿Cuántas personas activas hay por seniority?",
  },
  {
    id: "perfil",
    title: "Perfil del equipo",
    domain: "nomina",
    fields: ["rango_edad", "genero", "region", "hijes"],
    example: "¿Qué porcentaje de mujeres hay en cada área?",
  },
  {
    id: "tecnologia",
    title: "Tecnología e inglés",
    domain: "nomina",
    fields: ["tech_principal", "nivel_ingles", "flock_talent", "buddy"],
    example: "¿Qué tecnologías usa más la gente?",
  },
  {
    id: "movimientos",
    title: "Movimientos",
    domain: "movimientos",
    fields: ["ingresos", "egresos", "attrition", "rotacion"],
    example: "¿Cómo evolucionó el attrition por trimestre?",
  },
];

/** "a, b, c y d". */
function enumerate(labels: string[]): string {
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} y ${labels.at(-1)}`;
}

function lowerFirst(text: string): string {
  // Siglas y nombres propios ("I+D", "Flock Talent") se quedan como están.
  return /^[A-ZÁÉÍÓÚ][a-záéíóúñ]/.test(text) && !/^Flock\b/.test(text)
    ? text.charAt(0).toLowerCase() + text.slice(1)
    : text;
}

export function dataOverview(): DataOverview {
  const domains = getDomains();

  const topics = TOPICS.flatMap((spec): Topic[] => {
    const domain = domains[spec.domain];
    const labels = spec.fields
      .map(
        (id) =>
          domain.dimensions.find((d) => d.id === id)?.label ??
          domain.metrics.find((m) => m.id === id)?.label,
      )
      .filter((label): label is string => label !== undefined);
    if (labels.length === 0) return [];

    const [first, ...rest] = labels;
    return [
      {
        id: spec.id,
        title: spec.title,
        covers: enumerate([first!, ...rest.map(lowerFirst)]),
        example: spec.example,
      },
    ];
  });

  return {
    cutoff: formatDate(getSourceMeta().fechaCorte),
    topics,
    privacy: "Nadie aparece con nombre y apellido: la nómina se importa sin datos de contacto.",
  };
}
