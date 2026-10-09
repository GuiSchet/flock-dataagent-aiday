"use client";

import { defineRegistry } from "@json-render/react";
import { catalog } from "./catalog";
import { AreaChart } from "./components/AreaChart";
import { BarChart } from "./components/BarChart";
import { ComposedChart } from "./components/ComposedChart";
import { LineChart } from "./components/LineChart";
import { PieChart } from "./components/PieChart";
import { ScatterChart } from "./components/ScatterChart";
import {
  Callout,
  DataTable,
  Grid,
  KpiTile,
  Provenance,
  Row,
  Screen,
} from "./components/Display";

/**
 * El registry: qué componente de React corresponde a cada entrada del catálogo.
 *
 * Es la tercera derivación del catálogo, junto con el prompt y la validación. Si alguien
 * agrega un componente al catálogo y se olvida de registrarlo acá, TypeScript se queja:
 * `defineRegistry` exige cubrir todos los nombres declarados.
 *
 * Los props llegan ya resueltos — donde el spec dice `{"$state": "/rows"}`, el componente
 * recibe el array de filas.
 */

/* eslint-disable @typescript-eslint/no-explicit-any --
   Los props que entrega el renderer son `Record<string, unknown>` porque json-render no
   propaga los tipos del catálogo hasta el componente. Cada componente declara su propia
   interfaz y la valida en runtime `lib/viz/schema.ts` antes de llegar acá, así que el
   cast está acotado a este puente. */

export const { registry } = defineRegistry(catalog, {
  components: {
    // Contenedores
    Screen: ({ props, children }) => <Screen {...(props as any)}>{children}</Screen>,
    Row: ({ props, children }) => <Row {...(props as any)}>{children}</Row>,
    Grid: ({ props, children }) => <Grid {...(props as any)}>{children}</Grid>,

    // Gráficos
    BarChart: ({ props }) => <BarChart {...(props as any)} />,
    LineChart: ({ props }) => <LineChart {...(props as any)} />,
    AreaChart: ({ props }) => <AreaChart {...(props as any)} />,
    PieChart: ({ props }) => <PieChart {...(props as any)} />,
    ScatterChart: ({ props }) => <ScatterChart {...(props as any)} />,
    ComposedChart: ({ props }) => <ComposedChart {...(props as any)} />,

    // Display
    KpiTile: ({ props }) => <KpiTile {...(props as any)} />,
    DataTable: ({ props }) => <DataTable {...(props as any)} />,
    Callout: ({ props }) => <Callout {...(props as any)} />,
    Provenance: ({ props }) => <Provenance {...(props as any)} />,
  },
});
