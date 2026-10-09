/**
 * La máquina de etapas de la conversación.
 *
 * Existe por el principio V: la espera se diseña. Una barra indeterminada no distingue
 * "todavía no te entendí" de "estoy dibujando", y esa diferencia es la que le dice al
 * usuario si conviene esperar o reformular. Cada etapa tiene su propia animación y su
 * propio texto.
 */

export type Stage =
  | "idle"
  | "listening"
  | "interpreting"
  | "querying"
  | "composing"
  | "rendering";

export interface StageInfo {
  id: Stage;
  /** Lo que se muestra en pantalla. Primera persona, rioplatense. */
  label: string;
  /** Cuánto suele durar, en ms. Se usa para dosificar la animación, no para temporizar. */
  typical: number;
}

export const STAGES: Record<Stage, StageInfo> = {
  idle: { id: "idle", label: "Contame qué querés ver", typical: 0 },
  listening: { id: "listening", label: "Te escucho", typical: 2500 },
  interpreting: { id: "interpreting", label: "Interpretando lo que pediste", typical: 1500 },
  querying: { id: "querying", label: "Buscando en los datos", typical: 300 },
  composing: { id: "composing", label: "Armando la visualización", typical: 2500 },
  rendering: { id: "rendering", label: "Dibujando", typical: 700 },
};

/** Orden de avance. `idle` queda afuera: es el reposo, no un paso. */
export const STAGE_SEQUENCE: Stage[] = [
  "listening",
  "interpreting",
  "querying",
  "composing",
  "rendering",
];

export function stageIndex(stage: Stage): number {
  return STAGE_SEQUENCE.indexOf(stage);
}

export function isWorking(stage: Stage): boolean {
  return stage !== "idle" && stage !== "listening";
}

/**
 * Transiciones válidas. Sirve para que un tool que reporta mal una etapa no deje la
 * interfaz en un estado imposible (por ejemplo, dibujando sin haber consultado).
 */
const ALLOWED: Record<Stage, Stage[]> = {
  idle: ["listening"],
  listening: ["interpreting", "idle"],
  interpreting: ["querying", "idle", "listening"],
  querying: ["composing", "idle"],
  composing: ["rendering", "idle"],
  rendering: ["idle", "listening"],
};

export function canTransition(from: Stage, to: Stage): boolean {
  return from === to || (ALLOWED[from]?.includes(to) ?? false);
}
