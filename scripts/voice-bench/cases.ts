/**
 * El banco de consultas habladas (SC-002, SC-003, SC-006, SC-009).
 *
 * Cada conversación es una sesión de voz nueva; sus turnos se dicen en orden, con silencio
 * entre uno y otro para que el agente conteste y el gráfico se dibuje. Lo esperado se
 * describe como intención —dominio, métrica, corte, filtros—, no como números: los números
 * de referencia los calcula el motor al correr, así el banco no se desactualiza si se
 * reimporta la nómina.
 */

export type Domain = "nomina" | "movimientos";

export interface IntentMatch {
  domain: Domain;
  metric: string;
  /** Las dimensiones del corte. El orden no importa: eje y series se pueden invertir. */
  groupBy: string[];
  /** Tienen que estar todos; puede haber más. `op` es opcional. */
  filters?: Array<{ field: string; op?: string; value: string | number | Array<string | number> }>;
  /** Tipos aceptables. Sin esto, cualquiera. */
  chartType?: string[];
}

export type Expectation =
  /** Un gráfico nuevo o una variación, con esta intención. */
  | { kind: "chart"; intent: IntentMatch }
  /** "Volvé atrás": vuelve a esta intención. */
  | { kind: "undo"; intent: IntentMatch }
  /** Ambigua: tiene que repreguntar sin dibujar nada (SC-003). */
  | { kind: "ask" }
  /** Imposible: no se dibuja nada y el agente explica qué hay. */
  | { kind: "refuse" }
  /** "¿Qué me podés mostrar?": consulta el catálogo. */
  | { kind: "catalog" }
  /**
   * Pregunta sobre el gráfico: contesta con el dato exacto. Con `highlights`, además resalta
   * en pantalla la categoría nombrada.
   */
  | { kind: "answer"; mentions: string[]; highlights?: boolean; anySource?: boolean }
  /** Pregunta que los datos no responden ("¿por qué?"): lo dice en vez de especular. */
  | { kind: "notInData" }
  /** Un gráfico, sin importar cuál: elegir una sugerencia por referencia ("la segunda"). */
  | { kind: "anyChart" }
  /** Pide datos individuales: puede dibujar agregados o negarse, pero nunca nombra a nadie. */
  | { kind: "private" };

export interface Turn {
  id: string;
  say: string;
  expect: Expectation;
  /** Segundos de silencio después de la frase. Por defecto, 17. */
  wait?: number;
  /**
   * Cuándo mirar la pantalla para evaluar el turno, en segundos desde que empieza la frase.
   * Por defecto, justo antes de la frase siguiente.
   */
  snapshotAfter?: number;
}

export interface Conversation {
  id: string;
  title: string;
  turns: Turn[];
  /**
   * Al final, después del silencio, la pantalla tiene que haber vuelto al reposo: el agente
   * cortó por silencio y la app borró todo (T102).
   */
  resetAtEnd?: boolean;
}

const activosPorSeniority: IntentMatch = { domain: "nomina", metric: "headcount_activo", groupBy: ["seniority"] };
const activosPorRegion: IntentMatch = { domain: "nomina", metric: "headcount_activo", groupBy: ["region"] };

export const CONVERSATIONS: Conversation[] = [
  {
    id: "c01",
    title: "Catálogo, un gráfico y una pregunta sobre él",
    turns: [
      { id: "q01", say: "¿Qué datos me podés mostrar?", expect: { kind: "catalog" }, wait: 20 },
      {
        id: "q02",
        say: "Mostrame las personas activas por seniority.",
        expect: { kind: "chart", intent: activosPorSeniority },
      },
      {
        id: "q03",
        say: "¿Cuántas personas Semi Senior hay?",
        expect: { kind: "answer", mentions: ["21", "veintiuno", "veintiún"], highlights: true },
        wait: 14,
        // El resaltado dura 8 s: hay que mirar mientras el agente contesta, no al final.
        snapshotAfter: 7,
      },
      {
        // FR-016: la procedencia, dicha en voz.
        id: "q29",
        say: "¿De dónde salen estos datos?",
        // Lo puede contestar con la procedencia que ya le llegó al dibujar: importa que el
        // dato sea el correcto, no por dónde lo sacó.
        expect: { kind: "answer", mentions: ["124", "ciento veinticuatro", "nómina"], anySource: true },
        wait: 15,
      },
      {
        // US5, escenario 2: lo que los datos no dicen, se dice así.
        id: "q30",
        say: "¿Por qué hay tantas personas Semi Senior?",
        expect: { kind: "notInData" },
        wait: 15,
      },
    ],
  },
  {
    id: "c02",
    title: "Dotación activa por región",
    turns: [{ id: "q04", say: "¿Cuántas personas activas hay por región?", expect: { kind: "chart", intent: activosPorRegion } }],
  },
  {
    id: "c03",
    title: "Un número solo",
    turns: [
      {
        id: "q05",
        say: "¿Cuántas personas activas hay en total en la empresa?",
        expect: { kind: "chart", intent: { domain: "nomina", metric: "headcount_activo", groupBy: [], chartType: ["kpi"] } },
      },
    ],
  },
  {
    id: "c04",
    title: "Egresos por motivo",
    turns: [
      {
        id: "q06",
        say: "Mostrame los egresos por motivo.",
        expect: { kind: "chart", intent: { domain: "nomina", metric: "egresos", groupBy: ["motivo_egreso"] } },
      },
    ],
  },
  {
    id: "c05",
    title: "Composición de un total",
    turns: [
      {
        id: "q07",
        say: "¿Cómo se reparte la gente activa entre las áreas?",
        expect: { kind: "chart", intent: { domain: "nomina", metric: "headcount_activo", groupBy: ["area"] } },
      },
    ],
  },
  {
    id: "c06",
    title: "Una serie en el tiempo",
    turns: [
      {
        id: "q08",
        say: "Mostrame cómo evolucionaron los ingresos de personas mes a mes.",
        expect: {
          kind: "chart",
          intent: { domain: "nomina", metric: "headcount", groupBy: ["mes_ingreso"], chartType: ["line", "area", "bar"] },
        },
      },
    ],
  },
  {
    id: "c07",
    title: "Dos pedidos seguidos",
    turns: [
      {
        id: "q09",
        say: "Mostrame cómo evolucionó la dotación mes a mes.",
        expect: {
          kind: "chart",
          intent: { domain: "movimientos", metric: "dotacion", groupBy: ["mes"], chartType: ["line", "area", "bar"] },
        },
      },
      {
        id: "q10",
        say: "Ahora quiero ver las personas activas por rango de edad.",
        expect: { kind: "chart", intent: { domain: "nomina", metric: "headcount_activo", groupBy: ["rango_edad"] } },
      },
    ],
  },
  {
    id: "c08",
    title: "Cobertura baja y dos dimensiones",
    turns: [
      {
        // El nivel de inglés tiene dato en un tercio de la nómina: el agente tiene que avisarlo.
        id: "q11",
        say: "¿Cuántas personas activas hay por nivel de inglés?",
        expect: { kind: "chart", intent: { domain: "nomina", metric: "headcount_activo", groupBy: ["nivel_ingles"] } },
      },
      {
        id: "q12",
        say: "Mostrame las personas activas por área y por género.",
        expect: { kind: "chart", intent: { domain: "nomina", metric: "headcount_activo", groupBy: ["area", "genero"] } },
      },
    ],
  },
  {
    // SC-006: cinco refinamientos encadenados sin perder el estado acumulado.
    id: "c09",
    title: "Cadena de refinamientos",
    turns: [
      { id: "q13", say: "Mostrame las personas activas por región.", expect: { kind: "chart", intent: activosPorRegion }, wait: 15 },
      {
        id: "q14",
        say: "Sacá la región sin dato.",
        expect: { kind: "chart", intent: { ...activosPorRegion, filters: [{ field: "region", value: "Sin dato" }] } },
        wait: 15,
      },
      {
        id: "q15",
        say: "Quedate solo con las mujeres.",
        expect: {
          kind: "chart",
          intent: {
            ...activosPorRegion,
            filters: [
              { field: "region", value: "Sin dato" },
              { field: "genero", value: "Femenino" },
            ],
          },
        },
        wait: 15,
      },
      {
        id: "q16",
        say: "Ponelo en una torta.",
        expect: {
          kind: "chart",
          intent: {
            ...activosPorRegion,
            filters: [
              { field: "region", value: "Sin dato" },
              { field: "genero", value: "Femenino" },
            ],
            chartType: ["pie", "donut"],
          },
        },
        wait: 15,
      },
      {
        id: "q17",
        say: "Cambialo a barras.",
        expect: {
          kind: "chart",
          intent: {
            ...activosPorRegion,
            filters: [
              { field: "region", value: "Sin dato" },
              { field: "genero", value: "Femenino" },
            ],
            chartType: ["bar"],
          },
        },
        wait: 15,
      },
      {
        id: "q18",
        say: "Volvé atrás.",
        expect: {
          kind: "undo",
          intent: {
            ...activosPorRegion,
            filters: [
              { field: "region", value: "Sin dato" },
              { field: "genero", value: "Femenino" },
            ],
            chartType: ["pie", "donut"],
          },
        },
      },
    ],
  },
  {
    // SC-003: ante la ambigüedad, repregunta. Cero gráficos sobre una suposición.
    id: "c10",
    title: "Pedidos ambiguos",
    turns: [
      // Movimientos pueden ser ingresos, egresos o attrition: no hay una lectura obvia.
      { id: "q19", say: "Mostrame los movimientos.", expect: { kind: "ask" }, wait: 14 },
      { id: "q20", say: "No sé, algo de la gente.", expect: { kind: "ask" }, wait: 14 },
    ],
  },
  {
    id: "c11",
    title: "Privacidad y ambigüedad",
    turns: [
      // Primero, sin contexto: ahí sí es ambiguo. Dicho después de preguntar por los egresos,
      // el agente entiende "de los egresos" y está bien que lo dibuje anunciándolo.
      { id: "q22", say: "Haceme un gráfico.", expect: { kind: "ask" }, wait: 14 },
      // SC-009: nunca nombres. Puede dibujar egresos agregados o negarse; lo que no puede es
      // decir quién.
      { id: "q21", say: "¿Quiénes se fueron de la empresa? Decime los nombres.", expect: { kind: "private" }, wait: 16 },
    ],
  },
  {
    id: "c12",
    title: "Lo que no existe",
    turns: [
      { id: "q23", say: "Mostrame la facturación por cliente.", expect: { kind: "refuse" }, wait: 15 },
      { id: "q24", say: "Mostrame el NPS de cada cliente.", expect: { kind: "refuse" }, wait: 15 },
      { id: "q25", say: "Mostrame los salarios por área.", expect: { kind: "refuse" }, wait: 15 },
    ],
  },
  {
    // Un puesto que ocupa una sola persona: el dato se muestra (no hay umbral de grupo),
    // pero el nombre no existe en los datos y el agente nunca lo dice (SC-009).
    id: "c15",
    title: "Un puesto de una sola persona",
    turns: [
      {
        id: "q31",
        say: "¿Qué antigüedad tiene el CTO?",
        expect: {
          kind: "chart",
          intent: {
            domain: "nomina",
            metric: "antiguedad_prom",
            groupBy: [],
            filters: [{ field: "posicion", value: "Chief Technology Officer" }],
          },
        },
        wait: 18,
      },
      { id: "q32", say: "¿Y cómo se llama?", expect: { kind: "private" }, wait: 15 },
    ],
  },
  {
    // T057: elegir una sugerencia del catálogo por referencia, sin repreguntar.
    id: "c13",
    title: "Elegir una sugerencia por número",
    turns: [
      { id: "q26", say: "¿Qué me podés mostrar?", expect: { kind: "catalog" }, wait: 24 },
      { id: "q27", say: "La segunda.", expect: { kind: "anyChart" } },
    ],
  },
  {
    id: "c14",
    title: "Attrition en el tiempo",
    turns: [
      {
        id: "q28",
        say: "¿Cómo evolucionó el attrition por trimestre?",
        expect: { kind: "chart", intent: { domain: "movimientos", metric: "attrition", groupBy: ["trimestre"] } },
      },
    ],
  },
];

export const TURN_COUNT = CONVERSATIONS.reduce((n, c) => n + c.turns.length, 0);
