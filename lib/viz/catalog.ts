import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { z } from "zod";
import { MAX_SERIES } from "./palette";

/**
 * El catálogo de visualización: la única definición de qué puede dibujar el agente.
 *
 * De acá salen simultáneamente el prompt del LLM (`catalog.prompt()`), el schema de
 * salida estructurada (`catalog.zodSchema()`) y la validación (`catalog.validate()`).
 * Al derivar los tres de un solo lugar es imposible que se desincronicen, que es lo que
 * exige el principio II de la constitución.
 */

// ---------------------------------------------------------------------------
// La regla que sostiene el principio III
// ---------------------------------------------------------------------------

/**
 * Los datos NO son un prop: son una referencia al estado.
 *
 * El modelo no puede escribir un array de números acá aunque quiera — el único valor que
 * valida es esta expresión exacta. El `ResultSet` que produjo el motor determinístico se
 * inyecta como `{ rows: [...] }` en el `StateProvider`, y el renderer la resuelve antes
 * de pasarle los props al componente.
 */
const DataRef = z
  // strictObject, no object: un z.object anidado DESCARTA las claves que no declara en
  // vez de rechazarlas, así que `{ $state: "/rows", rows: [...] }` pasaría y el modelo
  // podría contrabandear datos por ahí. Con strict, no.
  .strictObject({ $state: z.literal("/rows") })
  .describe("Referencia a los datos. SIEMPRE exactamente {\"$state\": \"/rows\"}.");

/**
 * Lo que puede leer un KPI: las filas, o el resumen del resultado.
 *
 * `/rows` sirve cuando el resultado es un número solo (una fila). Encima de un gráfico, un
 * KPI atado a `/rows` mostraría la primera categoría con un rótulo de total; para eso está
 * `/stats`, una fila con total, máximo, mínimo, promedio y cantidad que calcula el motor.
 * Las dos son referencias exactas: tampoco por acá puede entrar un número del modelo.
 */
const KpiDataRef = z
  .union([
    z.strictObject({ $state: z.literal("/rows") }),
    z.strictObject({ $state: z.literal("/stats") }),
  ])
  .describe(
    'Referencia a los datos. {"$state": "/rows"} si el resultado es un número solo; {"$state": "/stats"} para un total, máximo, mínimo, promedio o cantidad junto a un gráfico.',
  );

const NumberFormat = z
  .enum(["integer", "decimal1", "decimal2", "percent"])
  .describe("Cómo formatear los valores. Se aplica formato es-AR.");

const Series = z
  .strictObject({
    key: z
      .string()
      .describe("Nombre exacto de la columna en los datos. Viene del ResultSet, no se inventa."),
    label: z.string().describe("Etiqueta legible para la leyenda y el tooltip."),
    format: NumberFormat,
  })
  .describe("Una serie del gráfico.");

/**
 * Props que todo gráfico exige. Son obligatorias a propósito: es como FR-008 (título,
 * ejes rotulados, leyenda, grilla, tooltip, estado vacío) se vuelve imposible de olvidar.
 * Un gráfico sin eje rotulado directamente no valida.
 */
const chartBase = {
  data: DataRef,
  title: z.string().describe("Título del gráfico. Concreto, no genérico."),
  subtitle: z
    .string()
    .nullable()
    .describe("Subtítulo: filtros activos o contexto. null si no aporta."),
  xKey: z.string().describe("Columna del eje X. Nombre exacto de la columna."),
  xLabel: z.string().describe("Rótulo del eje X. Obligatorio."),
  yLabel: z.string().describe("Rótulo del eje Y, con la unidad. Obligatorio."),
  series: z
    .array(Series)
    .min(1)
    .max(MAX_SERIES)
    .describe(
      `Series a dibujar. Entre 1 y ${MAX_SERIES}: la paleta de Flock tiene siete colores distinguibles y no se inventan más.`,
    ),
  legend: z.boolean().describe("Mostrar leyenda. Poner false si hay una sola serie."),
  grid: z.boolean().describe("Mostrar grilla de fondo."),
  emptyMessage: z
    .string()
    .describe("Qué decir si no hay datos. Obligatorio, en rioplatense."),
};

export const catalog = defineCatalog(schema, {
  components: {
    // -----------------------------------------------------------------------
    // Contenedores
    // -----------------------------------------------------------------------
    Screen: {
      props: z.object({
        title: z.string().describe("Título de la vista completa."),
        subtitle: z.string().nullable(),
      }),
      slots: ["default"],
      description:
        "Contenedor raíz de una visualización. Siempre es el root del spec. Adentro van KPIs, gráficos, tablas y la procedencia.",
    },

    Row: {
      props: z.object({
        gap: z.enum(["sm", "md", "lg"]),
      }),
      slots: ["default"],
      description: "Fila horizontal. Para poner tarjetas KPI una al lado de la otra.",
    },

    Grid: {
      props: z.object({
        columns: z.union([z.literal(2), z.literal(3), z.literal(4)]),
      }),
      slots: ["default"],
      description: "Grilla de columnas iguales. Para varias tarjetas o gráficos chicos.",
    },

    // -----------------------------------------------------------------------
    // Gráficos
    // -----------------------------------------------------------------------
    BarChart: {
      props: z.object({
        ...chartBase,
        layout: z
          .enum(["vertical", "horizontal"])
          .describe(
            "vertical = barras hacia arriba. horizontal = barras hacia el costado; usar cuando las etiquetas son largas o hay más de 8 categorías.",
          ),
        stacked: z.boolean().describe("Apilar las series. Solo con 2 o más series."),
        showValues: z.boolean().describe("Escribir el valor arriba de cada barra."),
      }),
      slots: [],
      description:
        "Barras. El default para comparar una métrica entre categorías. Con varias series: agrupadas (stacked=false) para comparar, apiladas (stacked=true) para ver composición.",
    },

    LineChart: {
      props: z.object({
        ...chartBase,
        curve: z.enum(["linear", "monotone"]),
        showPoints: z.boolean().describe("Marcar cada punto. Útil con pocos datos."),
      }),
      slots: [],
      description:
        "Líneas. Para evolución en el tiempo. Usar siempre que el eje X sea un mes o una fecha.",
    },

    AreaChart: {
      props: z.object({
        ...chartBase,
        curve: z.enum(["linear", "monotone"]),
        stacked: z.boolean().describe("Apilar para mostrar composición de un total."),
      }),
      slots: [],
      description:
        "Áreas. Como líneas pero enfatizando volumen acumulado. Apiladas muestran cómo se compone un total en el tiempo.",
    },

    PieChart: {
      props: z.object({
        data: DataRef,
        title: z.string(),
        subtitle: z.string().nullable(),
        labelKey: z.string().describe("Columna con la etiqueta de cada porción."),
        valueKey: z.string().describe("Columna con el valor de cada porción."),
        format: NumberFormat,
        donut: z.boolean().describe("true = dona (con agujero), false = torta."),
        showPercent: z.boolean().describe("Mostrar el porcentaje en cada porción."),
        emptyMessage: z.string(),
      }),
      slots: [],
      description:
        "Torta o dona. Solo para composición de un total, con 7 categorías o menos. Si hay más, usar barras horizontales.",
    },

    ScatterChart: {
      props: z.object({
        data: DataRef,
        title: z.string(),
        subtitle: z.string().nullable(),
        xKey: z.string(),
        xLabel: z.string(),
        yKey: z.string(),
        yLabel: z.string(),
        labelKey: z.string().nullable().describe("Columna para identificar cada punto."),
        format: NumberFormat,
        grid: z.boolean(),
        emptyMessage: z.string(),
      }),
      slots: [],
      description:
        "Dispersión. Para ver si dos métricas numéricas se relacionan. Requiere dos columnas numéricas.",
    },

    ComposedChart: {
      props: z.object({
        ...chartBase,
        barSeries: z.array(z.string()).describe("Claves de serie que van como barras."),
        lineSeries: z.array(z.string()).describe("Claves de serie que van como línea."),
        rightAxis: z
          .boolean()
          .describe("Poner las líneas en un eje derecho propio. Usar si las escalas difieren mucho."),
      }),
      slots: [],
      description:
        "Barras y líneas combinadas. Para mezclar un volumen (barras) con una tasa o promedio (línea) en el mismo eje X.",
    },

    // -----------------------------------------------------------------------
    // Display
    // -----------------------------------------------------------------------
    KpiTile: {
      props: z.object({
        data: KpiDataRef,
        label: z.string().describe("Qué mide. Corto."),
        valueKey: z
          .string()
          .describe("Columna con el número a mostrar. Con /stats: total, max, min, avg o count."),
        format: NumberFormat,
        unit: z.string().nullable().describe("Unidad, si aporta ('personas', 'años')."),
        hero: z
          .boolean()
          .describe("true = tarjeta con gradiente de marca. Usar en UNA sola por vista."),
        caption: z.string().nullable().describe("Aclaración al pie."),
      }),
      slots: [],
      description:
        'Tarjeta con un número grande. Para el titular de la vista, o una fila de indicadores arriba del gráfico. Si el resultado tiene más de una fila, SIEMPRE va sobre {"$state": "/stats"}: sobre /rows mostraría sólo la primera fila.',
    },

    DataTable: {
      props: z.object({
        data: DataRef,
        title: z.string().nullable(),
        columns: z
          .array(
            z.strictObject({
              key: z.string(),
              label: z.string(),
              align: z.enum(["left", "right"]),
              format: NumberFormat.nullable().describe("null si la columna es texto."),
            }),
          )
          .min(1),
        maxRows: z.number().int().min(1).max(50),
        emptyMessage: z.string(),
      }),
      slots: [],
      description:
        "Tabla. Para cuando el usuario pide ver los números exactos, o como complemento debajo de un gráfico.",
    },

    Callout: {
      props: z.object({
        tone: z.enum(["info", "warning"]),
        text: z.string(),
      }),
      slots: [],
      description:
        "Aviso breve. Usarlo para advertencias de cobertura baja o de recortes que vengan en las warnings del ResultSet.",
    },

    Provenance: {
      props: z.object({
        text: z
          .string()
          .describe("De dónde salen los datos: dominio, filtros y cantidad de filas."),
      }),
      slots: [],
      description:
        "Pie de página del gráfico con la procedencia. Incluirlo SIEMPRE como último hijo del Screen.",
    },
  },

  // Sin acciones: esta app no tiene formularios ni botones generados. El usuario habla.
  actions: {},
});

export type VizSpec = typeof catalog._specType;

export const COMPONENT_NAMES = catalog.componentNames;
