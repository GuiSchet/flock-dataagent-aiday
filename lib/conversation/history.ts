import type { VizIntent } from "./intent";

/**
 * La pila de intenciones.
 *
 * El historial se guarda sobre el `VizIntent`, no sobre el spec generado, y eso es
 * deliberado: "volvé atrás" se convierte en un `pop`, y el estado acumulado de filtros
 * queda explícito en una estructura en vez de enterrado en JSON de presentación. Volver
 * atrás re-ejecuta la tubería desde la intención anterior, así que el gráfico que aparece
 * es siempre coherente con los datos, no una foto vieja.
 */

export interface History {
  /** Del más viejo al más nuevo. El último es el vigente. */
  readonly stack: readonly VizIntent[];
}

export const EMPTY_HISTORY: History = { stack: [] };

export function current(history: History): VizIntent | null {
  return history.stack.at(-1) ?? null;
}

export function push(history: History, intent: VizIntent): History {
  return { stack: [...history.stack, intent] };
}

export type UndoResult =
  | { status: "restored"; history: History; intent: VizIntent }
  | { status: "at_start" };

/**
 * Deshace el último cambio.
 *
 * Con un solo elemento devuelve `at_start` en vez de vaciar la pila: dejar la pantalla en
 * blanco no es "volver atrás", y el agente necesita poder decir que ya no hay más atrás.
 */
export function undo(history: History): UndoResult {
  if (history.stack.length <= 1) return { status: "at_start" };
  const stack = history.stack.slice(0, -1);
  return { status: "restored", history: { stack }, intent: stack.at(-1)! };
}

export function depth(history: History): number {
  return history.stack.length;
}
