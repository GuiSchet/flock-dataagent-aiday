"use client";

import Image from "next/image";
import { AnimatePresence, motion } from "motion/react";
import { GeneratedView } from "@/components/GeneratedView";
import { useRotatingExample } from "@/components/useRotatingExample";
import type { Dashboard as DashboardData, DashboardPanel } from "@/lib/dashboard/tablero";
import type { DataOverview } from "@/lib/data/overview";
import { usePrefersReducedMotion } from "@/lib/viz/components/ChartFrame";

/**
 * La portada: qué es esto, los indicadores de nómina que conviene ver primero y qué más se
 * le puede preguntar al agente.
 *
 * Los gráficos son fijos (constitución, principio I, excepción del tablero): no hay filtros
 * ni selectores. Cualquier otra vista se pide hablando, con el orbe de la presentación o el
 * botón de la barra. Todo lo que es texto chico se juntó en una sola nota al pie.
 */
interface DashboardProps {
  dashboard: DashboardData;
  overview: DataOverview;
  examples: string[];
  /** El orbe y el estado de la voz, que maneja la pantalla. */
  voice: React.ReactNode;
}

export function Dashboard({ dashboard, overview, examples, voice }: DashboardProps) {
  return (
    <div className="flex w-full flex-col gap-8 py-8">
      <Intro examples={examples} voice={voice} />

      {dashboard.kpis.length > 0 ? (
        <section aria-label="Indicadores principales" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {dashboard.kpis.map((panel) => (
            <Panel key={panel.id} panel={panel} />
          ))}
        </section>
      ) : null}

      {dashboard.trend ? (
        <section aria-label="Evolución de la dotación" className="chart-wide">
          <Panel panel={dashboard.trend} />
        </section>
      ) : null}

      {dashboard.charts.length > 0 ? (
        <section aria-label="Composición de la nómina" className="chart-compact grid gap-4 lg:grid-cols-2">
          {dashboard.charts.map((panel) => (
            <Panel key={panel.id} panel={panel} />
          ))}
        </section>
      ) : null}

      <Topics overview={overview} />

      <p className="type-secondary" style={{ color: "var(--text-soft)" }}>
        {dashboard.source}
      </p>
    </div>
  );
}

function Panel({ panel }: { panel: DashboardPanel }) {
  // Cada tarjeta es un spec validado con sus propias filas: el mismo camino que una vista
  // hablada, sin la procedencia por tarjeta (va una sola vez al pie).
  return <GeneratedView spec={panel.spec} rows={panel.rows} stats={panel.stats} showProvenance={false} />;
}

/** La presentación: qué es y cómo se usa, con Miguelo y el micrófono a la derecha. */
function Intro({ examples, voice }: { examples: string[]; voice: React.ReactNode }) {
  const reduced = usePrefersReducedMotion();
  const example = useRotatingExample(examples);

  return (
    <section className="panel flex flex-col items-start gap-6 p-7 md:flex-row md:items-center md:justify-between">
      <div className="flex flex-col gap-3">
        <h1 className="type-display" style={{ color: "var(--text)" }}>
          La nómina, de un vistazo
        </h1>
        <p className="type-body max-w-[68ch]" style={{ color: "var(--text-soft)" }}>
          Acá abajo tenés los números principales de una nómina sintética, con la forma de la de
          Flock pero sin ninguna persona real. Si querés conocer más, charlá con el agente de
          visualización.
        </p>
        {example ? (
          <p className="flex min-h-[26px] flex-wrap items-baseline gap-x-2" aria-live="off">
            <span className="type-body" style={{ color: "var(--text-soft)" }}>
              Por ejemplo:
            </span>
            <AnimatePresence mode="wait">
              <motion.span
                key={example}
                className="type-card"
                style={{ color: "var(--brand)" }}
                initial={{ opacity: 0, y: reduced ? 0 : 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: reduced ? 0 : -6 }}
                transition={{ duration: reduced ? 0.12 : 0.3 }}
              >
                “{example}”
              </motion.span>
            </AnimatePresence>
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-end gap-3 self-center">
        <Miguelo still={reduced} />
        <div className="flex flex-col items-center gap-2 pb-1">{voice}</div>
      </div>
    </section>
  );
}

/**
 * Miguelo, el robot de Flock, saludando hacia el micrófono: la cara del agente. Es negro sobre
 * transparente, así que en oscuro se invierte para no perderse sobre el panel. Flota apenas,
 * salvo con reduced motion.
 */
function Miguelo({ still }: { still: boolean }) {
  return (
    <motion.div
      className="hidden shrink-0 sm:block"
      animate={still ? { y: 0 } : { y: [0, -5, 0] }}
      transition={still ? { duration: 0 } : { duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
    >
      <Image
        src="/Miguelo robot blanco y negro.png"
        alt="Miguelo, el robot de Flock, saludando"
        width={111}
        height={150}
        priority
        className="h-[150px] w-auto select-none dark:invert"
      />
    </motion.div>
  );
}

/** Qué más se puede preguntar: un tema por tarjeta, con lo que cubre y una pregunta que funciona. */
function Topics({ overview }: { overview: DataOverview }) {
  if (overview.topics.length === 0) return null;

  return (
    <section className="flex flex-col gap-4" aria-labelledby="que-preguntar">
      <h2 id="que-preguntar" className="type-section" style={{ color: "var(--text)" }}>
        Qué le podés preguntar
      </h2>
      <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {overview.topics.map((topic) => (
          <li key={topic.id} className="panel flex flex-col gap-2 p-5">
            <h3 className="type-card" style={{ color: "var(--text)" }}>
              {topic.title}
            </h3>
            <p className="type-body" style={{ color: "var(--text-soft)" }}>
              {topic.covers}.
            </p>
            <p className="type-body mt-auto pt-1" style={{ color: "var(--brand)" }}>
              “{topic.example}”
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
