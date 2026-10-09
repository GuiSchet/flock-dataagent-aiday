"use client";

import * as React from "react";

/** Cada cuánto cambia el ejemplo. */
const EXAMPLE_MS = 4500;

/**
 * Una pregunta de ejemplo que va rotando: lo que alguien que nunca usó la app puede decir
 * para arrancar (T058). Las preguntas salen del catálogo real (`lib/conversation/examples.ts`).
 */
export function useRotatingExample(examples: string[], ms = EXAMPLE_MS): string | undefined {
  const [index, setIndex] = React.useState(0);
  React.useEffect(() => {
    if (examples.length < 2) return;
    const id = window.setInterval(() => setIndex((i) => (i + 1) % examples.length), ms);
    return () => window.clearInterval(id);
  }, [examples.length, ms]);
  return examples[index % Math.max(examples.length, 1)];
}
