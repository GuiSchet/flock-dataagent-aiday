"use client";

import { AnimatePresence, motion } from "motion/react";

/**
 * Una línea con lo que el agente entendió: "Personas activas · por área · género: Femenino".
 *
 * La decisión de producto es mostrar la interpretación y no la transcripción. Confirma
 * de un vistazo que el agente entendió bien —y, al refinar, que los filtros anteriores
 * siguen puestos— sin convertir la pantalla en un chat. El texto lo arma el servidor a
 * partir del `VizIntent` resuelto, nunca de lo que se dijo.
 */
export function IntentRibbon({ description }: { description: string | null }) {
  return (
    <div className="flex min-h-[22px] w-full" aria-live="polite">
      <AnimatePresence mode="wait">
        {description ? (
          <motion.p
            key={description}
            className="type-body max-w-full truncate"
            style={{ color: "var(--text-soft)" }}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.2 }}
            title={description}
          >
            <span className="font-semibold" style={{ color: "var(--text)" }}>
              Mostrando:
            </span>{" "}
            {description}
          </motion.p>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
