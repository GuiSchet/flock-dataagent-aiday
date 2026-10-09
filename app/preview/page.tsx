import { notFound } from "next/navigation";
import { runQuery } from "@/lib/data/query";
import { validateVizSpec } from "@/lib/viz/schema";
import { getCatalogSummary } from "@/lib/data/catalog";
import { GeneratedView } from "@/components/GeneratedView";
import { pluralize } from "@/lib/data/format";
import { availableStats, resultStats } from "@/lib/conversation/answers";
import { buildMeta } from "@/lib/conversation/resolve";

/**
 * Banco de pruebas de render. NO es una pantalla del producto.
 *
 * La constitución (principio I) prohíbe que exista un camino a un gráfico que no pase por
 * la conversación hablada, salvo el tablero fijo de la portada, así que esta ruta devuelve
 * 404 en producción. Sirve para
 * verificar a ojo que los componentes del catálogo dibujan bien, en claro y en oscuro, sin
 * depender de tener un micrófono y las claves de API a mano.
 *
 * Los specs de acá están escritos a mano a propósito: son los que el LLM debería producir,
 * y sirven de referencia de lo que el prompt tiene que conseguir.
 */

export default function PreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();

  const casos = [
    dotacionPorRegion(),
    attritionPorTrimestre(),
    altasPorPeriodo(),
    areaPorGenero(),
    composicionSeniority(),
  ];

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-10 px-6 py-10">
      <header className="flex flex-col gap-1.5">
        <p className="type-label">Banco de pruebas · no es una pantalla del producto</p>
        <h1 className="type-display" style={{ color: "var(--text)" }}>
          Catálogo de visualización
        </h1>
        <p className="type-secondary">
          {getCatalogSummary().domains.length} dominios ·{" "}
          {pluralize(
            getCatalogSummary().domains.reduce((a, d) => a + d.rowCount, 0),
            "registro",
            "registros",
          )}
        </p>
      </header>

      {casos.map((caso, i) => (
        <section key={i} className="flex flex-col gap-3">
          {caso}
        </section>
      ))}
    </main>
  );
}

/** Ejecuta la consulta, valida el spec y devuelve la vista montada o el error. */
function render(
  spec: unknown,
  query: Parameters<typeof runQuery>[0],
) {
  const result = runQuery(query);
  const stats = resultStats(result, buildMeta(query, result));
  const validation = validateVizSpec(spec, { rowCount: result.rowCount, stats: availableStats(stats) });

  if (!validation.ok) {
    return (
      <pre className="panel overflow-auto p-4 text-[12px]" style={{ color: "var(--state-blocked-fg)" }}>
        {validation.issues.map((i) => `${i.elementKey ?? "spec"}: ${i.message}`).join("\n")}
      </pre>
    );
  }

  return <GeneratedView spec={validation.spec} rows={result.rows} stats={stats} />;
}

// ---------------------------------------------------------------------------
// Casos
// ---------------------------------------------------------------------------

function dotacionPorRegion() {
  const query = {
    domain: "nomina" as const,
    metric: "headcount_activo",
    groupBy: ["region"],
  };
  const { provenance, rows } = runQuery(query);

  return render(
    {
      root: "screen",
      elements: {
        screen: {
          type: "Screen",
          props: { title: "Dotación activa por región", subtitle: null },
          children: ["kpis", "chart", "prov"],
        },
        kpis: { type: "Row", props: { gap: "md" }, children: ["kpi"] },
        kpi: {
          type: "KpiTile",
          props: {
            // Con varias filas, un KPI lee /stats: sobre /rows mostraría la primera región
            // con un rótulo que no le corresponde.
            data: { $state: "/stats" },
            label: "Región más poblada",
            valueKey: "max",
            format: "integer",
            unit: "personas",
            hero: true,
            caption: String(rows[0]?.region ?? "—"),
          },
          children: [],
        },
        chart: {
          type: "BarChart",
          props: {
            data: { $state: "/rows" },
            title: "Personas activas por región",
            subtitle: "Solo quienes siguen en la empresa",
            xKey: "region",
            xLabel: "Región",
            yLabel: "Personas",
            series: [{ key: "headcount_activo", label: "Activos", format: "integer" }],
            legend: false,
            grid: true,
            emptyMessage: "No hay personas que cumplan ese filtro",
            layout: "vertical",
            stacked: false,
            showValues: true,
          },
          children: [],
        },
        prov: {
          type: "Provenance",
          props: {
            text: `${provenance.domainLabel} · ${provenance.rowsMatched} de ${provenance.rowsTotal} registros`,
          },
          children: [],
        },
      },
    },
    query,
  );
}

/** Serie de movimientos: una línea por trimestre. */
function attritionPorTrimestre() {
  const query = {
    domain: "movimientos" as const,
    metric: "attrition",
    groupBy: ["trimestre"],
  };
  const { rowCount } = runQuery(query);

  return render(
    {
      root: "screen",
      elements: {
        screen: {
          type: "Screen",
          props: {
            title: "Attrition por trimestre",
            subtitle: "Promedio mensual de cada trimestre",
          },
          children: ["chart", "prov"],
        },
        chart: {
          type: "LineChart",
          props: {
            data: { $state: "/rows" },
            title: "Bajas sobre la dotación promedio",
            subtitle: null,
            xKey: "trimestre",
            xLabel: "Trimestre",
            yLabel: "Attrition mensual",
            series: [{ key: "attrition", label: "Attrition", format: "percent" }],
            legend: false,
            grid: true,
            emptyMessage: "No hay meses completos en ese período",
            curve: "monotone",
            showPoints: true,
          },
          children: [],
        },
        prov: {
          type: "Provenance",
          props: { text: `Movimientos · ${rowCount} trimestres` },
          children: [],
        },
      },
    },
    query,
  );
}

/** Serie de nómina por año, con un Callout de aviso. */
function altasPorPeriodo() {
  const query = {
    domain: "nomina" as const,
    metric: "headcount",
    groupBy: ["anio_ingreso"],
  };
  const { provenance } = runQuery(query);

  return render(
    {
      root: "screen",
      elements: {
        screen: {
          type: "Screen",
          props: { title: "Altas por período", subtitle: "Toda la historia de la nómina" },
          children: ["aviso", "chart", "prov"],
        },
        aviso: {
          type: "Callout",
          props: {
            tone: "info",
            text: provenance.warnings.join(" ") || "Cuenta a todas las personas que entraron cada año, sigan o no en la empresa.",
          },
          children: [],
        },
        chart: {
          type: "BarChart",
          props: {
            data: { $state: "/rows" },
            title: "Ingresos por año",
            subtitle: null,
            xKey: "anio_ingreso",
            xLabel: "Año de ingreso",
            yLabel: "Personas",
            series: [{ key: "headcount", label: "Altas", format: "integer" }],
            legend: false,
            grid: true,
            emptyMessage: "No hay ingresos en ese período",
            layout: "vertical",
            stacked: false,
            showValues: true,
          },
          children: [],
        },
        prov: {
          type: "Provenance",
          props: {
            text: `Nómina · ${provenance.rowsMatched} personas`,
          },
          children: [],
        },
      },
    },
    query,
  );
}

/** Dos dimensiones: ejercita las series apiladas y los cruces chicos que quedan vacíos. */
function areaPorGenero() {
  const query = {
    domain: "nomina" as const,
    metric: "headcount",
    groupBy: ["area", "genero"],
    filters: [{ field: "activo", op: "eq" as const, value: "Sí" }],
  };
  const { provenance, seriesKeys } = runQuery(query);

  return render(
    {
      root: "screen",
      elements: {
        screen: {
          type: "Screen",
          props: { title: "Personas activas por área y género", subtitle: "activo: Sí" },
          children: ["aviso", "chart", "prov"],
        },
        aviso: {
          type: "Callout",
          props: { tone: "warning", text: provenance.warnings.join(" ") || "Sin advertencias." },
          children: [],
        },
        chart: {
          type: "BarChart",
          props: {
            data: { $state: "/rows" },
            title: "Por área, apilado por género",
            subtitle: null,
            xKey: "area",
            xLabel: "Área",
            yLabel: "Personas",
            series: seriesKeys.map((key) => ({ key, label: key, format: "integer" })),
            legend: true,
            grid: true,
            emptyMessage: "No hay personas que cumplan ese filtro",
            layout: "vertical",
            stacked: true,
            showValues: false,
          },
          children: [],
        },
        prov: {
          type: "Provenance",
          props: { text: `${provenance.domainLabel} · ${provenance.rowsMatched} personas activas` },
          children: [],
        },
      },
    },
    query,
  );
}

/** Composición de un total en una dona, sobre una dimensión ordinal. */
function composicionSeniority() {
  const query = {
    domain: "nomina" as const,
    metric: "headcount",
    groupBy: ["seniority"],
    filters: [{ field: "activo", op: "eq" as const, value: "Sí" }],
  };
  const { provenance } = runQuery(query);

  return render(
    {
      root: "screen",
      elements: {
        screen: {
          type: "Screen",
          props: { title: "Composición por seniority", subtitle: "activo: Sí" },
          children: ["chart", "prov"],
        },
        chart: {
          type: "PieChart",
          props: {
            data: { $state: "/rows" },
            title: "Personas activas por nivel",
            subtitle: null,
            labelKey: "seniority",
            valueKey: "headcount",
            format: "integer",
            donut: true,
            showPercent: true,
            emptyMessage: "No hay personas que cumplan ese filtro",
          },
          children: [],
        },
        prov: {
          type: "Provenance",
          props: { text: `${provenance.domainLabel} · ${provenance.rowsMatched} personas activas` },
          children: [],
        },
      },
    },
    query,
  );
}
