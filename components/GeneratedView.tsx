"use client";

import * as React from "react";
import {
  ActionProvider,
  Renderer,
  StateProvider,
  VisibilityProvider,
} from "@json-render/react";
import { registry } from "@/lib/viz/registry";
import { stripModelState } from "@/lib/viz/schema";
import type { VizSpec } from "@/lib/viz/catalog";
import type { ResultStats } from "@/lib/conversation/answers";
import { HighlightProvider, type Highlight } from "@/lib/viz/components/highlight";
import { ProvenanceVisibleContext } from "@/lib/viz/components/Display";
import type { ResultRow } from "@/lib/data/types";

/**
 * Monta un spec de json-render con sus datos.
 *
 * El punto clave está en el `StateProvider`: las filas que produjo el motor
 * determinístico entran como `{ rows }`, y el spec las alcanza únicamente con la
 * expresión `{"$state": "/rows"}`. El modelo escribió la estructura; los números vienen
 * por un canal que el modelo no toca.
 */

export interface GeneratedViewProps {
  spec: VizSpec;
  rows: ResultRow[];
  /** El resumen del resultado que leen los KpiTile atados a `/stats`. */
  stats?: ResultStats | null;
  /** La categoría que el agente está nombrando, para atenuar el resto (T061). */
  highlight?: Highlight | null;
  /** Qué mostrar si un componente tira al renderizar. Por defecto, nada. */
  fallback?: React.ReactNode;
  /** Si se dibuja el `Provenance` del spec. El tablero lo dice una sola vez al pie. */
  showProvenance?: boolean;
}

export function GeneratedView({
  spec,
  rows,
  stats = null,
  highlight = null,
  fallback = null,
  showProvenance = true,
}: GeneratedViewProps) {
  // El estado se recrea cuando cambian las filas para que Recharts vea `data` nueva e
  // interpole, en vez de remontar (FR-021). `/stats` es una sola fila, para que un KpiTile
  // la lea igual que a `/rows`.
  const initialState = React.useMemo(() => ({ rows, stats: stats ? [stats] : [] }), [rows, stats]);
  // Barrera del principio III: ver stripModelState en lib/viz/schema.ts.
  const safeSpec = React.useMemo(() => stripModelState(spec), [spec]);

  return (
    <RenderBoundary fallback={fallback} resetKey={safeSpec}>
      <ProvenanceVisibleContext.Provider value={showProvenance}>
        <HighlightProvider value={highlight}>
          <StateProvider initialState={initialState}>
            {/* El Renderer consulta los contextos de visibilidad y de acciones en TODO elemento,
                así que ambos providers son obligatorios aunque nuestro catálogo no declare
                acciones y nuestros specs no usen condiciones `visible`. Sin ellos, el primer
                render tira. */}
            <VisibilityProvider>
              <ActionProvider handlers={{}}>
                {/* El tipo que infiere el catálogo declara `visible` como unknown, mientras que el
                    renderer lo quiere como VisibilityCondition. Son el mismo dato; el cast acota la
                    diferencia a esta línea. El spec ya pasó por validateVizSpec(). */}
                <Renderer
                  spec={safeSpec as React.ComponentProps<typeof Renderer>["spec"]}
                  registry={registry}
                />
              </ActionProvider>
            </VisibilityProvider>
          </StateProvider>
        </HighlightProvider>
      </ProvenanceVisibleContext.Provider>
    </RenderBoundary>
  );
}

/**
 * Última red: un componente que tira con props que el Zod dejó pasar no puede tumbar la
 * pantalla entera (principio II: degradar con gracia, nunca romper la vista). Se rearma
 * cuando llega otro spec.
 */
class RenderBoundary extends React.Component<
  { fallback: React.ReactNode; resetKey: unknown; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error("[render] Un componente del catálogo falló:", error);
  }

  componentDidUpdate(prev: { resetKey: unknown }) {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
