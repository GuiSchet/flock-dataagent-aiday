import { availableStats, resultStats, type ResultStats } from "@/lib/conversation/answers";
import { buildMeta } from "@/lib/conversation/resolve";
import { getDomain, getSourceMeta } from "@/lib/data/catalog";
import { formatDate, formatMonth } from "@/lib/data/format";
import { lastCompleteMonth } from "@/lib/data/movimientos";
import { runQuery, type QueryRequest } from "@/lib/data/query";
import type { ResultRow } from "@/lib/data/types";
import type { VizSpec } from "@/lib/viz/catalog";
import { validateVizSpec } from "@/lib/viz/schema";

/**
 * El tablero de la portada: los indicadores de nómina que conviene ver antes de preguntar.
 *
 * Es la única excepción al principio I (constitución v2.0.0): un conjunto fijo y curado de
 * gráficos, versionado acá, sin selectores ni filtros. Todo lo demás sigue siendo por voz.
 * Cada panel se arma igual que una vista hablada: la consulta la ejecuta el motor
 * (`runQuery`, principio III), el spec pasa por `validateVizSpec` (principio II) y lo monta
 * `GeneratedView` con las filas del motor. Si un panel deja de validar —porque cambió el
 * catálogo—, se cae ese panel y no la portada.
 *
 * Corre en el servidor: el catálogo se lee de `data/` con `node:fs`.
 */

export interface DashboardPanel {
  id: string;
  spec: VizSpec;
  rows: ResultRow[];
  stats: ResultStats;
}

export interface Dashboard {
  /** `dd/mm/aaaa`: hasta cuándo valen los datos. */
  cutoff: string;
  kpis: DashboardPanel[];
  /** La evolución de la dotación, a todo el ancho. */
  trend: DashboardPanel | null;
  charts: DashboardPanel[];
  /** La fuente de todo el tablero, dicha una sola vez. */
  source: string;
}

const ACTIVOS = { field: "activo", op: "eq" as const, value: "Sí" };

/** `aaaa-mm` de `n` meses antes. */
function monthsBefore(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const index = y * 12 + (m - 1) - n;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** Ejecuta la consulta, valida el spec y devuelve el panel, o null si algo no cierra. */
function panel(id: string, query: QueryRequest, build: (rows: ResultRow[]) => unknown): DashboardPanel | null {
  try {
    const result = runQuery(query);
    if (result.rowCount === 0) return null;
    const stats = resultStats(result, buildMeta(query, result));
    const validation = validateVizSpec(build(result.rows), {
      rowCount: result.rowCount,
      stats: availableStats(stats),
    });
    if (!validation.ok) {
      console.error(`[tablero] El panel "${id}" no valida:`, validation.issues);
      return null;
    }
    return { id, spec: validation.spec, rows: result.rows, stats };
  } catch (error) {
    console.error(`[tablero] El panel "${id}" no se pudo calcular:`, error);
    return null;
  }
}

/** Un KPI: el número solo, sin gráfico. */
function kpi(
  id: string,
  query: QueryRequest,
  tile: { label: string; unit: string | null; format: "integer" | "percent"; hero?: boolean; caption: string | null },
): DashboardPanel | null {
  return panel(id, query, () => ({
    root: "kpi",
    elements: {
      kpi: {
        type: "KpiTile",
        props: {
          data: { $state: "/rows" },
          label: tile.label,
          valueKey: query.metric,
          format: tile.format,
          unit: tile.unit,
          hero: tile.hero ?? false,
          caption: tile.caption,
        },
        children: [],
      },
    },
  }));
}

/**
 * Un gráfico con su procedencia. En el tablero la procedencia no se dibuja en cada
 * tarjeta —todas salen de la misma nómina y se dice una vez al pie—, pero el spec la
 * declara igual: es el contrato de toda visualización (FR-016).
 */
function chart(id: string, query: QueryRequest, element: { type: string; props: Record<string, unknown> }, provenance: string) {
  return panel(id, query, () => ({
    root: "panel",
    elements: {
      panel: { type: "Row", props: { gap: "sm" }, children: ["chart", "prov"] },
      chart: { ...element, children: [] },
      prov: { type: "Provenance", props: { text: provenance }, children: [] },
    },
  }));
}

export function buildDashboard(): Dashboard {
  const meta = getSourceMeta();
  const cutoff = formatDate(meta.fechaCorte);
  const lastMonth = lastCompleteMonth(meta.fechaCorte);
  const yearAgo = monthsBefore(lastMonth, 11);
  const last12 = { field: "mes", op: "between" as const, value: [yearAgo, lastMonth] };
  const period12 = `${formatMonth(yearAgo)} a ${formatMonth(lastMonth)}`;
  const nomina = `Nómina · ${meta.activas} personas activas`;
  const firstMonth = String(getDomain("movimientos").rows[0]?.mes ?? "2023-01");

  const kpis = [
    kpi("activos", { domain: "nomina", metric: "headcount_activo", groupBy: [] }, {
      label: "Personas activas",
      unit: null,
      format: "integer",
      hero: true,
      caption: `Al ${cutoff}`,
    }),
    kpi("mujeres", { domain: "nomina", metric: "pct_mujeres", groupBy: [], filters: [ACTIVOS] }, {
      label: "Mujeres",
      unit: null,
      format: "percent",
      caption: "De las personas activas",
    }),
    kpi("ingresos", { domain: "movimientos", metric: "ingresos", groupBy: [], filters: [last12] }, {
      label: "Ingresos",
      unit: "personas",
      format: "integer",
      caption: "Últimos 12 meses",
    }),
    kpi("attrition", {
      domain: "movimientos",
      metric: "attrition_12m",
      groupBy: [],
      filters: [{ field: "mes", op: "eq", value: lastMonth }],
    }, {
      label: "Attrition",
      unit: null,
      format: "percent",
      caption: "Últimos 12 meses",
    }),
  ].filter((p): p is DashboardPanel => p !== null);

  const trend = chart(
    "dotacion",
    { domain: "movimientos", metric: "dotacion", groupBy: ["mes"] },
    {
      type: "AreaChart",
      props: {
        data: { $state: "/rows" },
        title: "Dotación mes a mes",
        subtitle: `Personas en la empresa al cierre de cada mes, desde ${formatMonth(firstMonth)}`,
        xKey: "mes",
        xLabel: "",
        yLabel: "Personas",
        series: [{ key: "dotacion", label: "Dotación", format: "integer" }],
        legend: false,
        grid: true,
        emptyMessage: "Todavía no hay meses completos para mostrar",
        curve: "monotone",
        stacked: false,
      },
    },
    `Movimientos · ${period12}`,
  );

  const charts = [
    chart(
      "area",
      { domain: "nomina", metric: "headcount_activo", groupBy: ["area"], filters: [ACTIVOS] },
      {
        type: "PieChart",
        props: {
          data: { $state: "/rows" },
          title: "Por área",
          subtitle: "Personas activas",
          labelKey: "area",
          valueKey: "headcount_activo",
          format: "integer",
          donut: true,
          showPercent: false,
          emptyMessage: "No hay personas activas con área cargada",
        },
      },
      nomina,
    ),
    chart(
      "seniority",
      { domain: "nomina", metric: "headcount_activo", groupBy: ["seniority"], filters: [ACTIVOS] },
      {
        type: "BarChart",
        props: {
          data: { $state: "/rows" },
          title: "Por seniority",
          subtitle: "Personas activas, de menor a mayor nivel",
          xKey: "seniority",
          xLabel: "",
          yLabel: "Personas",
          series: [{ key: "headcount_activo", label: "Personas activas", format: "integer" }],
          legend: false,
          grid: true,
          emptyMessage: "No hay personas activas con seniority cargado",
          layout: "vertical",
          stacked: false,
          showValues: true,
        },
      },
      nomina,
    ),
    chart(
      "tecnologia",
      {
        domain: "nomina",
        metric: "headcount_activo",
        groupBy: ["tech_principal"],
        // Sólo los perfiles técnicos: el resto no tiene una tecnología principal.
        filters: [ACTIVOS, { field: "tech_principal", op: "neq", value: null }],
        limit: 5,
      },
      {
        type: "BarChart",
        props: {
          data: { $state: "/rows" },
          title: "Tecnologías principales",
          subtitle: "Personas activas con perfil técnico",
          xKey: "tech_principal",
          xLabel: "",
          yLabel: "Personas",
          series: [{ key: "headcount_activo", label: "Personas activas", format: "integer" }],
          legend: false,
          grid: true,
          emptyMessage: "No hay tecnologías cargadas",
          layout: "horizontal",
          stacked: false,
          showValues: true,
        },
      },
      nomina,
    ),
    chart(
      "motivos",
      {
        domain: "nomina",
        metric: "egresos",
        groupBy: ["motivo_egreso"],
        filters: [{ field: "activo", op: "eq", value: "No" }],
        limit: 6,
      },
      {
        type: "BarChart",
        props: {
          data: { $state: "/rows" },
          title: "Por qué se fue la gente",
          subtitle: `Los ${meta.egresadas} egresos desde 2023, por motivo`,
          xKey: "motivo_egreso",
          xLabel: "",
          yLabel: "Egresos",
          series: [{ key: "egresos", label: "Egresos", format: "integer" }],
          legend: false,
          grid: true,
          emptyMessage: "No hay egresos registrados",
          layout: "horizontal",
          stacked: false,
          showValues: true,
        },
      },
      `Nómina · ${meta.egresadas} egresos`,
    ),
  ].filter((p): p is DashboardPanel => p !== null);

  return {
    cutoff,
    kpis,
    trend,
    charts,
    source: `Fuente: ${meta.fuente.toLowerCase()} (${meta.personas} personas, ${meta.activas} activas), datos al ${cutoff}.`,
  };
}
