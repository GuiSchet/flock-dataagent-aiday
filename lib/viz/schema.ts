import { buildEditInstructions, validateSpec } from "@json-render/core";
import { z } from "zod";
import { catalog } from "./catalog";
import type { VizSpec } from "./catalog";

/**
 * Validación de specs. Es el borde entre lo que dice el modelo y lo que llega al DOM.
 *
 * ## Por qué este módulo existe
 *
 * `catalog.validate()` y `catalog.zodSchema()` de json-render **solo verifican integridad
 * estructural**: que exista el root, que los hijos referenciados existan, que `visible` no
 * esté adentro de `props`. Los schemas Zod que se declaran en el catálogo se usan para
 * describir los componentes en el prompt, pero NO se ejecutan contra los props generados
 * — comprobado contra la versión 0.21: un `BarChart` sin `xLabel`, con un prop `color`
 * inventado o con `data` como array literal pasa las dos validaciones de la librería.
 *
 * Como toda la arquitectura se apoya en que el catálogo sea un borde real y no una
 * sugerencia (principios II y III de la constitución), esa verificación la hacemos acá:
 * cada elemento se parsea contra el Zod de su componente, en modo estricto para que un
 * prop que nadie declaró sea un error y no algo que se ignora en silencio.
 */

/**
 * Lo que el compositor sabe del resultado: su *forma*, nunca sus valores.
 *
 * Lo arma el servidor en `lib/conversation/resolve.ts` y viaja como `context` de
 * `useUIStream` hasta `/api/compose`. Las claves de columna son las de las filas que el
 * motor pone en `/rows`; los nombres de serie son etiquetas de categoría, no números.
 */
export interface ComposeContext {
  columns?: Array<{
    key: string;
    label: string;
    kind: "dimension" | "metric";
    format?: string;
    unit?: string;
  }>;
  /** Qué hay en `/stats` (una sola fila): las claves que un KpiTile puede mostrar. */
  stats?: Array<{ key: string; label: string; kind: "metric"; format?: string; unit?: string }>;
  /** Cuántas filas tiene el resultado, para que el modelo elija cómo mostrarlo. */
  rowCount?: number;
  /** Tipo de gráfico que pidió la intención. */
  chartType?: string;
  /** Título que propuso el agente. */
  title?: string;
  /** Subtítulo derivado de los filtros activos. */
  subtitle?: string | null;
  /** Texto de procedencia, ya armado. */
  provenance?: string;
  /** Advertencias que el gráfico tiene que mostrar en un Callout. */
  warnings?: string[];
}

/** Envoltorio del spec. Los props se validan aparte, por tipo de componente. */
const ElementEnvelope = z.object({
  type: z.string(),
  props: z.record(z.string(), z.unknown()).default({}),
  children: z.array(z.string()).default([]),
  slots: z.record(z.string(), z.array(z.string())).optional(),
  visible: z.unknown().optional(),
});

const SpecEnvelope = z.object({
  root: z.string().min(1),
  // Se declara para poder DETECTARLO y reportarlo. Un `z.object` lo descartaría en
  // silencio, y entonces nunca nos enteraríamos de que el modelo está inventando datos.
  state: z.unknown().optional(),
  elements: z.record(z.string(), ElementEnvelope),
});

type ComponentDefs = Record<string, { props: z.ZodObject<z.ZodRawShape> }>;

const componentDefs = catalog.data.components as ComponentDefs;

export interface VizSpecIssue {
  elementKey?: string;
  message: string;
}

export type ValidationOutcome =
  /** `warnings`: cosas que se corrigieron solas y conviene dejar registradas. */
  | { ok: true; spec: VizSpec; warnings: string[] }
  | { ok: false; issues: VizSpecIssue[] };

/** Para el reintento: se le explica al modelo qué hizo mal. */
const STATE_EMITTED =
  "El spec trae un campo `state`. Los datos NO se escriben en el spec: llegan del motor de consulta y se referencian con {\"$state\": \"/rows\"}.";

/** Para la consola: no es un error, y lo que vea quien lee el log tiene que decirlo. */
export const STATE_DISCARDED =
  "El modelo agregó datos de ejemplo (`state`) y se descartaron antes de dibujar: no llegan a pantalla.";

/**
 * Lo que la validación necesita saber del resultado para las reglas que dependen de los
 * datos. Es opcional: sin contexto, esas reglas no se aplican (el banco de `/preview` y los
 * tests de contrato validan specs sueltos).
 */
export interface ValidationContext {
  /** Filas del resultado. Con más de una, un KpiTile no puede leer `/rows`. */
  rowCount?: number;
  /** Claves de `/stats` que tienen valor para este resultado. */
  stats?: string[];
}

/**
 * Un KPI mal atado muestra un número real con un rótulo falso: sobre `/rows`, con varias
 * filas, lee la primera categoría; sobre `/stats`, una clave sin valor sale como "—".
 */
function kpiIssue(element: { type: string; props: Record<string, unknown> }, ctx?: ValidationContext) {
  if (element.type !== "KpiTile" || !ctx) return null;
  const ref = (element.props.data as { $state?: unknown } | undefined)?.$state;
  const valueKey = element.props.valueKey;
  if (ref === "/rows" && ctx.rowCount !== undefined && ctx.rowCount > 1) {
    return `KpiTile sobre {"$state": "/rows"} con ${ctx.rowCount} filas mostraría sólo la primera. Usá {"$state": "/stats"} con valueKey ${ctx.stats?.join(", ") ?? "total, max, min, avg o count"}.`;
  }
  if (ref === "/stats" && ctx.stats && typeof valueKey === "string" && !ctx.stats.includes(valueKey)) {
    return `KpiTile.valueKey "${valueKey}" no existe en /stats para este resultado. Disponibles: ${ctx.stats.join(", ")}.`;
  }
  return null;
}

/**
 * Valida un spec completo en tres capas, de la más barata a la más cara.
 *
 * Se devuelven TODOS los problemas, no el primero: el reintento le pasa la lista al
 * modelo, y con un solo error por vuelta haría falta una vuelta por error.
 */
export function validateVizSpec(input: unknown, context?: ValidationContext): ValidationOutcome {
  // 1. Forma general.
  const envelope = SpecEnvelope.safeParse(input);
  if (!envelope.success) {
    return {
      ok: false,
      issues: envelope.error.issues.map((i) => ({
        message: `${i.path.join(".") || "spec"}: ${i.message}`,
      })),
    };
  }

  const spec = envelope.data;
  const issues: VizSpecIssue[] = [];

  // 2. Integridad estructural (esto sí lo hace bien json-render).
  const structural = validateSpec(spec as Parameters<typeof validateSpec>[0]);
  for (const issue of structural.issues) {
    if (issue.severity === "error") {
      issues.push({ elementKey: issue.elementKey, message: issue.message });
    }
  }

  // 3. Props contra el Zod del catálogo — la capa que la librería no hace.
  for (const [key, element] of Object.entries(spec.elements)) {
    const def = componentDefs[element.type];
    if (!def) {
      issues.push({
        elementKey: key,
        message: `El componente "${element.type}" no existe en el catálogo. Disponibles: ${catalog.componentNames.join(", ")}.`,
      });
      continue;
    }

    element.props = fillOmittedNulls(def.props, element.props);

    // `.strict()` es el punto: un prop que el catálogo no declara —un `color`, un
    // `data` con forma rara— es un error, no algo que se descarta calladamente.
    const parsed = def.props.strict().safeParse(element.props);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const path = issue.path.join(".");
        issues.push({
          elementKey: key,
          message: `${element.type}.${path || "props"}: ${issue.message}`,
        });
      }
    }
  }

  // 4. Reglas semánticas propias, que ningún schema puede expresar.
  issues.push(...semanticIssues(spec));
  for (const [key, element] of Object.entries(spec.elements)) {
    const message = kpiIssue(element, context);
    if (message) issues.push({ elementKey: key, message });
  }

  // 5. Un `state` emitido por el modelo es inerte: se descarta acá, y aunque sobreviviera
  //    no habría cómo alcanzarlo, porque el único prop que lee estado es `data` y sólo
  //    admite exactamente {"$state": "/rows"} o, en un KpiTile, {"$state": "/stats"}, que
  //    llena el motor. Rechazar el spec por eso
  //    costaba un reintento entero sin proteger nada que no estuviera ya protegido. Si hay
  //    otros problemas y se va a reintentar igual, se suma a la lista para que el modelo
  //    también lo corrija.
  const emittedState = spec.state !== undefined;
  if (issues.length > 0) {
    if (emittedState) issues.push({ message: STATE_EMITTED });
    return { ok: false, issues };
  }
  return {
    ok: true,
    spec: stripModelState(spec) as unknown as VizSpec,
    warnings: emittedState ? [STATE_DISCARDED] : [],
  };
}

function semanticIssues(spec: z.infer<typeof SpecEnvelope>): VizSpecIssue[] {
  const issues: VizSpecIssue[] = [];
  const types = Object.values(spec.elements).map((e) => e.type);

  // FR-016: todo gráfico declara de dónde salen sus datos.
  const hasChart = types.some((t) => t.endsWith("Chart") || t === "DataTable");
  if (hasChart && !types.includes("Provenance")) {
    issues.push({
      message:
        "Falta el elemento Provenance. Toda visualización tiene que declarar de dónde salen sus datos.",
    });
  }

  for (const [key, element] of Object.entries(spec.elements)) {
    const props = element.props as Record<string, unknown>;

    // Apilar una sola serie no apila nada; es un error de intención del modelo.
    if (props.stacked === true && Array.isArray(props.series) && props.series.length < 2) {
      issues.push({
        elementKey: key,
        message: `${element.type}: stacked=true necesita al menos dos series.`,
      });
    }

    // Una leyenda de un solo ítem es ruido.
    if (props.legend === true && Array.isArray(props.series) && props.series.length === 1) {
      issues.push({
        elementKey: key,
        message: `${element.type}: con una sola serie la leyenda sobra; poner legend=false.`,
      });
    }

    if (element.type === "ComposedChart") {
      const bar = (props.barSeries as string[] | undefined) ?? [];
      const line = (props.lineSeries as string[] | undefined) ?? [];
      if (bar.length === 0 || line.length === 0) {
        issues.push({
          elementKey: key,
          message: "ComposedChart necesita al menos una serie de barras y una de línea.",
        });
      }
    }
  }

  return issues;
}

/**
 * Descarta el `state` que venga adentro del spec.
 *
 * No es paranoia: el prompt de fábrica de json-render trae, entre sus reglas base,
 * *"When the user asks for a UI that displays data, ALWAYS include a state field with
 * realistic sample data"*. O sea, la librería le pide al modelo exactamente lo que el
 * principio III de la constitución prohíbe.
 *
 * Nuestras reglas del prompt lo contradicen, pero eso depende de que el modelo obedezca.
 * Esto no depende de nadie: cualquier `state` que el modelo emita muere acá, y las filas
 * que llegan al render son siempre las del motor determinístico.
 */
export function stripModelState<T>(spec: T): T {
  if (!spec || typeof spec !== "object" || !("state" in spec)) return spec;
  const { state: _discarded, ...clean } = spec as T & { state?: unknown };
  return clean as T;
}

/**
 * Completa con `null` los props nullable que el modelo omitió.
 *
 * El prompt que arma json-render presenta un prop `.nullable()` como opcional
 * (`subtitle?: string`), así que el modelo lo omite en vez de mandar `null`. Con la
 * validación estricta, eso hacía fallar el primer intento de todo spec, con cualquier
 * modelo. Omitir es exactamente lo que el prompt le permitió, así que acá se interpreta
 * como `null`, que es lo que los componentes esperan. Baja un nivel en los arrays de
 * objetos, como las columnas de `DataTable`. Lo obligatorio de verdad —título, ejes,
 * `emptyMessage`— no es nullable y sigue sin validar si falta.
 */
function fillOmittedNulls(
  shape: z.ZodObject<z.ZodRawShape>,
  props: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...props };
  for (const [key, field] of Object.entries(shape.shape) as Array<[string, z.ZodType]>) {
    if (!(key in out)) {
      if (field.safeParse(null).success) out[key] = null;
      continue;
    }
    const value = out[key];
    if (field instanceof z.ZodArray && field.element instanceof z.ZodObject && Array.isArray(value)) {
      const item = field.element as z.ZodObject<z.ZodRawShape>;
      out[key] = value.map((v) =>
        v && typeof v === "object" && !Array.isArray(v)
          ? fillOmittedNulls(item, v as Record<string, unknown>)
          : v,
      );
    }
  }
  return out;
}

/**
 * Lo que ya se puede mostrar de un spec que todavía está llegando.
 *
 * Concilia dos principios que tiran para lados opuestos: el V pide render progresivo —el
 * marco primero, después el gráfico— y el II prohíbe renderizar algo a medias o inválido.
 * La salida es montar, mientras llegan los parches, **sólo los elementos que ya validan**
 * contra el Zod de su componente. Un elemento incompleto o mal formado no se muestra; los
 * hijos que referencia y todavía no llegaron el `Renderer` los saltea solo.
 *
 * El spec completo pasa igual por `validateVizSpec` al terminar: esto decide qué se ve
 * durante el stream, no qué se acepta.
 */
export function renderableSubset(partial: unknown, context?: ValidationContext): VizSpec | null {
  if (!partial || typeof partial !== "object") return null;
  const { root, elements } = partial as { root?: unknown; elements?: unknown };
  if (typeof root !== "string" || root === "" || !elements || typeof elements !== "object") {
    return null;
  }

  const kept: Record<string, z.infer<typeof ElementEnvelope>> = {};
  for (const [key, raw] of Object.entries(elements)) {
    const element = ElementEnvelope.safeParse(raw);
    if (!element.success) continue;
    const def = componentDefs[element.data.type];
    if (!def) continue;
    const props = fillOmittedNulls(def.props, element.data.props);
    if (!def.props.strict().safeParse(props).success) continue;
    // Tampoco se muestra, ni por un instante, un KPI que la validación final va a rechazar.
    if (kpiIssue({ type: element.data.type, props }, context)) continue;
    kept[key] = { ...element.data, props };
  }

  if (!kept[root]) return null;
  // Los hijos que todavía no llegaron (o no validan) se sacan de la lista: el Renderer los
  // saltearía igual, pero avisando en consola por cada uno en cada parche.
  for (const element of Object.values(kept)) {
    element.children = element.children.filter((child) => child in kept);
  }
  return { root, elements: kept } as unknown as VizSpec;
}

/** Para comparar encabezados: sin tildes, mayúsculas, puntuación ni espacios de más. */
function foldHeading(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ]+/g, " ")
    .trim();
}

type LooseElement = { type: string; props: Record<string, unknown>; children?: string[] };

/**
 * Los encabezados de la vista, sin repeticiones.
 *
 * El modelo tiende a copiar el mismo texto en todos lados: el título del `Screen`, el del
 * gráfico, y el subtítulo en los dos. En pantalla eso se lee como la misma frase tres veces.
 * Acá se ordena de forma determinística, sin depender de que obedezca el prompt:
 *
 * - El `Screen` lleva el título que eligió el agente y, como subtítulo, los filtros activos.
 *   Son los datos de la intención, así que no hay nada que el modelo tenga que inventar.
 * - Ningún elemento repite el subtítulo del `Screen`.
 * - Un gráfico cuyo título repite el del `Screen` pasa a nombrar su corte ("Por área"),
 *   que es lo único que agrega debajo de un titular que ya dice qué se mide.
 */
export function harmonizeHeadings(
  spec: VizSpec,
  heading: { title?: string | null; subtitle?: string | null },
): VizSpec {
  const elements = spec.elements as Record<string, LooseElement>;
  const root = elements[spec.root];
  if (!root || root.type !== "Screen") return spec;

  const title = heading.title || String(root.props.title ?? "");
  const subtitle = heading.subtitle ?? null;
  const same = (a: unknown, b: string | null) =>
    typeof a === "string" && b !== null && foldHeading(a) === foldHeading(b);

  const next: Record<string, LooseElement> = {};
  for (const [key, element] of Object.entries(elements)) {
    if (key === spec.root) {
      next[key] = { ...element, props: { ...element.props, title, subtitle } };
      continue;
    }
    const props = { ...element.props };
    if (same(props.subtitle, subtitle)) props.subtitle = null;
    if (same(props.title, title)) props.title = fallbackTitle(element.type, props);
    next[key] = { ...element, props };
  }
  return { ...spec, elements: next } as VizSpec;
}

function fallbackTitle(type: string, props: Record<string, unknown>): string | null {
  // DataTable admite título null: debajo de un titular, una tabla no necesita otro.
  if (type === "DataTable") return null;
  if (type === "PieChart") return "Composición";
  const axis = typeof props.xLabel === "string" ? props.xLabel.trim() : "";
  return axis ? `Por ${axis.charAt(0).toLowerCase()}${axis.slice(1)}` : "Detalle";
}

/** Los componentes que muestran datos, a diferencia de los que ordenan o anotan. */
const CONTENT_TYPES = new Set([
  "BarChart", "LineChart", "AreaChart", "PieChart", "ScatterChart", "ComposedChart",
  "KpiTile", "DataTable",
]);

/**
 * Si un spec ya muestra algún dato. Un spec que sólo trae el `Screen` o el `Provenance` es
 * un marco vacío: mientras tanto se sigue viendo el esqueleto del gráfico que viene.
 */
export function hasVisualContent(spec: VizSpec | null): boolean {
  if (!spec) return false;
  return Object.values(spec.elements as Record<string, { type: string }>).some((e) => CONTENT_TYPES.has(e.type));
}

/**
 * El tipo del gráfico principal de la vista: el primero que aparece recorriendo desde la
 * raíz. Con él se decide si una actualización interpola (mismo tipo) o hace un fundido
 * cruzado (barras → torta, T045).
 */
export function primaryChartType(spec: VizSpec | null): string | null {
  if (!spec) return null;
  const elements = spec.elements as Record<string, { type: string; children?: string[] }>;
  const seen = new Set<string>();
  const queue = [spec.root];
  let kpi = false;
  while (queue.length > 0) {
    const key = queue.shift()!;
    if (seen.has(key)) continue;
    seen.add(key);
    const element = elements[key];
    if (!element) continue;
    if (element.type.endsWith("Chart") || element.type === "DataTable") return element.type;
    if (element.type === "KpiTile") kpi = true;
    queue.push(...(element.children ?? []));
  }
  return kpi ? "KpiTile" : null;
}

/** Las incidencias como texto, para devolvérselas al modelo en el reintento. */
export function formatIssues(issues: VizSpecIssue[]): string {
  return issues
    .map((i) => (i.elementKey ? `- [${i.elementKey}] ${i.message}` : `- ${i.message}`))
    .join("\n");
}

/**
 * El ejemplo que ve el compositor: una vista completa, con nuestros componentes y ningún dato.
 *
 * Es código y no texto suelto para que un test lo valide contra el catálogo: un ejemplo que
 * enseñara un prop inválido le enseñaría al modelo a equivocarse.
 */
export const COMPOSE_EXAMPLE: Array<{ op: "add"; path: string; value: unknown }> = [
  { op: "add", path: "/root", value: "screen" },
  {
    op: "add",
    path: "/elements/screen",
    value: {
      type: "Screen",
      props: { title: "Personas activas por área", subtitle: null },
      children: ["kpi", "chart", "prov"],
    },
  },
  {
    op: "add",
    path: "/elements/kpi",
    value: {
      type: "KpiTile",
      props: {
        data: { $state: "/stats" },
        label: "Total de personas activas",
        valueKey: "total",
        format: "integer",
        unit: "personas",
        hero: true,
        caption: null,
      },
      children: [],
    },
  },
  {
    op: "add",
    path: "/elements/chart",
    value: {
      type: "BarChart",
      props: {
        data: { $state: "/rows" },
        title: "Por área, de mayor a menor",
        subtitle: null,
        xKey: "area",
        xLabel: "Área",
        yLabel: "Personas",
        series: [{ key: "headcount_activo", label: "Personas activas", format: "integer" }],
        legend: false,
        grid: true,
        emptyMessage: "No hay personas para esos filtros",
        layout: "vertical",
        stacked: false,
        showValues: true,
      },
      children: [],
    },
  },
  {
    op: "add",
    path: "/elements/prov",
    value: { type: "Provenance", props: { text: "<el texto de Procedencia que te pasan, tal cual>" }, children: [] },
  },
];

/**
 * Saca una sección del prompt de fábrica de json-render: desde su encabezado hasta el
 * siguiente. Si no la encuentra, lanza: una actualización de la librería tiene que romper los
 * tests, no degradar el prompt en silencio.
 */
function extractSection(prompt: string, heading: string): string {
  const lines = prompt.split("\n");
  const start = lines.findIndex((l) => l.startsWith(heading));
  if (start < 0) throw new Error(`El prompt de json-render ya no tiene la sección "${heading}".`);
  const end = lines.findIndex((l, i) => i > start && /^[A-Z][A-Z ]+:$/.test(l));
  return lines.slice(start, end < 0 ? undefined : end).join("\n").trim();
}

const COMPOSE_RULES = [
  'Nunca emitas un campo `state` ni parches sobre /state. Los datos no los tenés y no los vas a tener: la aplicación pone las filas en /rows y el resumen en /stats.',
  'El prop `data` vale exactamente {"$state": "/rows"}. La única excepción es KpiTile, que también puede valer {"$state": "/stats"}. Nunca escribas datos, números ni arrays.',
  'Un KpiTile junto a un gráfico (resultado de más de una fila) SIEMPRE usa {"$state": "/stats"} y una de sus claves (total, max, min, avg, count). Sobre /rows mostraría sólo la primera categoría.',
  "Nunca inventes un prop que no esté declarado. En particular no existen props de color: la paleta la resuelve la app.",
  "Todo elemento lleva `children`: un array vacío en las hojas. Todo hijo que referenciás tiene que existir como elemento propio.",
  "El root SIEMPRE es un Screen. El último hijo del Screen SIEMPRE es un Provenance, con el texto de Procedencia que te pasan.",
  "Todo gráfico lleva título, xLabel, yLabel y emptyMessage. No son opcionales.",
  "El Screen lleva como title exactamente el Título dado y como subtitle el Subtítulo dado (o null). Ningún otro elemento repite esos textos: el title de un gráfico dice qué muestra ese gráfico con otras palabras (por ejemplo, el corte o el orden), y su subtitle es null salvo que aporte algo propio.",
  'En DataTable, `format` sólo admite "integer", "decimal1", "decimal2" o "percent". Las columnas de texto (dimensiones) llevan format null.',
  "Los textos van en español rioplatense, breves y concretos.",
  "Si el ResultSet trae warnings, incluí un Callout con tone=warning arriba del gráfico.",
  "Si hay un número que resume la vista, poné un KpiTile con hero=true antes del gráfico. Con varias filas, ese número sale de /stats (por ejemplo, el total).",
  "La vista es enfocada: un solo gráfico y, como mucho, un KpiTile arriba. No agregues una DataTable ni un segundo gráfico salvo que el pedido hable de ver los números, el detalle o comparar dos cosas. Se ve en una pantalla de escritorio apaisada: el gráfico ocupa todo el ancho, así que tiene que leerse de un vistazo y dibujarse rápido.",
];

/**
 * El system prompt de composición.
 *
 * No es el prompt de fábrica de json-render, porque ese le pide al modelo lo contrario de lo
 * que necesitamos: "incluí datos de ejemplo realistas en state", en siete lugares (el formato de
 * salida, el ejemplo, la sección de estado inicial, una regla base y tres reglas del esquema de
 * React). Contradecirlo con una regla propia no alcanzaba: 6 de cada 8 specs traían un `state`
 * inventado, que se descartaba pero costaba segundos de salida (research.md D16).
 *
 * De json-render se toma sólo la descripción de los componentes, que sale del catálogo (una
 * sola fuente de verdad, principio II), y las instrucciones para editar con parches, que usa el
 * refinamiento. El formato, el ejemplo y las reglas son nuestros, y ninguno menciona `/state`
 * salvo para prohibirlo. `stripModelState` sigue descartando cualquier `state` que igual llegue.
 */
export function buildComposePrompt(extraRules: string[] = []): string {
  const factory = catalog.prompt({ mode: "standalone" });
  const rules = [...COMPOSE_RULES, ...extraRules];
  return [
    "Sos el compositor de visualizaciones de Flock DataAgent. Traducís una consulta ya resuelta en una vista completa y legible.",
    "",
    "FORMATO DE SALIDA:",
    "Emití SOLO líneas JSONL: un objeto JSON por línea, cada uno una operación RFC 6902 JSON Patch. Sin prosa, sin markdown, sin bloques de código.",
    'Primero el root: {"op":"add","path":"/root","value":"<clave>"}. Después cada elemento: {"op":"add","path":"/elements/<clave>","value":{"type":"...","props":{...},"children":[...]}}.',
    "Emití los elementos de arriba hacia abajo, empezando por el Screen: la pantalla se arma a medida que llegan.",
    'Los datos NO van en el spec. Los componentes los leen del estado de la aplicación con {"$state": "/rows"} o, en un KpiTile, {"$state": "/stats"}.',
    "",
    "EJEMPLO (una vista completa, una línea por operación):",
    ...COMPOSE_EXAMPLE.map((patch) => JSON.stringify(patch)),
    "",
    extractSection(factory, "AVAILABLE COMPONENTS"),
    "",
    buildEditInstructions({ modes: ["patch"] }, "json"),
    "",
    "REGLAS:",
    ...rules.map((rule, i) => `${i + 1}. ${rule}`),
  ].join("\n");
}

export { catalog };
export type { VizSpec };
