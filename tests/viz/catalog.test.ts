import { describe, expect, it } from "vitest";
import { z } from "zod";
import { catalog } from "@/lib/viz/catalog";
import { compileSpecStream } from "@json-render/core";
import {
  COMPOSE_EXAMPLE,
  validateVizSpec,
  buildComposePrompt,
  harmonizeHeadings,
  primaryChartType,
  renderableSubset,
  stripModelState,
  type ValidationContext,
  type VizSpec,
} from "@/lib/viz/schema";
import { MAX_SERIES, SERIES_PALETTE } from "@/lib/viz/palette";

/**
 * El catálogo es el borde de seguridad entre el LLM y la pantalla. Estos tests verifican
 * que ese borde aguanta de verdad — no que la librería diga que aguanta.
 */

const chartProps = {
  data: { $state: "/rows" },
  title: "Personas activas por región",
  subtitle: "Solo activos",
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
};

const validSpec = {
  root: "screen",
  elements: {
    screen: {
      type: "Screen",
      props: { title: "Dotación activa por región", subtitle: null },
      children: ["chart", "prov"],
    },
    chart: { type: "BarChart", props: chartProps, children: [] },
    prov: {
      type: "Provenance",
      props: { text: "Nómina · 79 de 124 personas · activos" },
      children: [],
    },
  },
};

/** Devuelve un spec con los props del gráfico modificados. */
const withChartProps = (patch: Record<string, unknown>, remove: string[] = []) => {
  const props: Record<string, unknown> = { ...chartProps, ...patch };
  for (const key of remove) delete props[key];
  return {
    ...validSpec,
    elements: { ...validSpec.elements, chart: { type: "BarChart", props, children: [] } },
  };
};

const messagesOf = (spec: unknown, ctx?: ValidationContext): string => {
  const result = validateVizSpec(spec, ctx);
  return result.ok ? "" : result.issues.map((i) => i.message).join(" | ");
};

describe("catálogo de visualización", () => {
  it("acepta un spec bien formado", () => {
    const result = validateVizSpec(validSpec);
    expect(result.ok, result.ok ? "" : messagesOf(validSpec)).toBe(true);
  });

  it("expone los componentes esperados", () => {
    expect(catalog.componentNames).toEqual(
      expect.arrayContaining([
        "Screen", "Row", "Grid",
        "BarChart", "LineChart", "AreaChart", "PieChart", "ScatterChart", "ComposedChart",
        "KpiTile", "DataTable", "Callout", "Provenance",
      ]),
    );
  });

  it("no declara ninguna acción: el usuario habla, no hace clic", () => {
    expect(catalog.actionNames).toEqual([]);
  });

  it("rechaza un componente que no existe", () => {
    const spec = {
      root: "x",
      elements: { x: { type: "PyramidChart", props: {}, children: [] } },
    };
    expect(messagesOf(spec)).toMatch(/no existe en el catálogo/i);
  });
});

/**
 * Este bloque documenta por qué `lib/viz/schema.ts` existe. json-render 0.21 valida
 * integridad estructural y nada más: los Zod del catálogo describen componentes para el
 * prompt, pero no se ejecutan contra los props. Si una versión futura empieza a
 * validarlos, estos tests fallan y sabremos que podemos simplificar.
 */
describe("límite conocido de json-render", () => {
  it("la validación de la librería NO mira los props", () => {
    const roto = withChartProps({ data: [{ region: "CABA", n: 36 }], color: "#ff0000" });
    expect(catalog.validate(roto).success).toBe(true);
    expect(catalog.zodSchema().safeParse(roto).success).toBe(true);
    // La nuestra sí.
    expect(validateVizSpec(roto).ok).toBe(false);
  });
});

describe("el modelo no puede emitir datos", () => {
  it("rechaza un array de datos literal en props.data", () => {
    expect(
      messagesOf(withChartProps({ data: [{ region: "CABA", headcount_activo: 30 }] })),
    ).toMatch(/data/i);
  });

  it("rechaza una referencia a un path que no es /rows", () => {
    expect(messagesOf(withChartProps({ data: { $state: "/secretos" } }))).toMatch(/data/i);
  });

  it("rechaza que data sea un string suelto", () => {
    expect(messagesOf(withChartProps({ data: "$state.rows" }))).toMatch(/data/i);
  });

  it("rechaza que data traiga filas escondidas junto a la referencia", () => {
    expect(
      messagesOf(withChartProps({ data: { $state: "/rows", rows: [{ a: 1 }] } })),
    ).toMatch(/data/i);
  });
});

describe("la riqueza del gráfico es obligatoria, no opcional", () => {
  // FR-008: un gráfico sin eje rotulado o sin estado vacío no llega a pantalla.
  for (const required of ["xLabel", "yLabel", "title", "emptyMessage", "series", "xKey"]) {
    it(`rechaza un gráfico sin ${required}`, () => {
      expect(messagesOf(withChartProps({}, [required]))).toMatch(new RegExp(required, "i"));
    });
  }

  it("rechaza más series que colores tiene la paleta", () => {
    const series = Array.from({ length: MAX_SERIES + 1 }, (_, i) => ({
      key: `s${i}`, label: `Serie ${i}`, format: "integer",
    }));
    expect(messagesOf(withChartProps({ series, legend: true }))).toMatch(/series/i);
  });

  it("exige Provenance en toda vista con gráfico", () => {
    const spec = {
      root: "screen",
      elements: {
        screen: { type: "Screen", props: { title: "T", subtitle: null }, children: ["chart"] },
        chart: { type: "BarChart", props: chartProps, children: [] },
      },
    };
    expect(messagesOf(spec)).toMatch(/Provenance/);
  });

  it("detecta hijos que no existen", () => {
    const spec = {
      root: "screen",
      elements: {
        screen: { type: "Screen", props: { title: "T", subtitle: null }, children: ["fantasma"] },
      },
    };
    expect(messagesOf(spec)).not.toBe("");
  });
});

describe("reglas semánticas que ningún schema expresa", () => {
  it("apilar con una sola serie no tiene sentido", () => {
    expect(messagesOf(withChartProps({ stacked: true }))).toMatch(/dos series/i);
  });

  it("una leyenda de un solo ítem es ruido", () => {
    expect(messagesOf(withChartProps({ legend: true }))).toMatch(/leyenda sobra/i);
  });

  it("un ComposedChart sin línea no es combinado", () => {
    const spec = {
      ...validSpec,
      elements: {
        ...validSpec.elements,
        chart: {
          type: "ComposedChart",
          props: {
            ...chartProps,
            layout: undefined,
            barSeries: ["headcount_activo"],
            lineSeries: [],
            rightAxis: false,
          },
          children: [],
        },
      },
    };
    delete (spec.elements.chart.props as Record<string, unknown>).layout;
    delete (spec.elements.chart.props as Record<string, unknown>).showValues;
    expect(messagesOf(spec)).toMatch(/barras y una de línea/i);
  });

  it("acumula todos los problemas, no solo el primero", () => {
    const result = validateVizSpec(withChartProps({ color: "#ff0000" }, ["xLabel", "yLabel"]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.length).toBeGreaterThanOrEqual(3);
  });
});

describe("el modelo no puede elegir colores", () => {
  it("ningún componente del catálogo declara un prop de color", () => {
    const components = catalog.data.components as Record<string, { props: z.ZodObject<z.ZodRawShape> }>;
    for (const [name, def] of Object.entries(components)) {
      for (const prop of Object.keys(def.props.shape)) {
        expect(
          /color|fill|stroke|hex|palette/i.test(prop),
          `${name}.${prop} deja al modelo elegir un color`,
        ).toBe(false);
      }
    }
  });

  it("un prop de color inventado se rechaza", () => {
    expect(messagesOf(withChartProps({ color: "#7800C0" }))).toMatch(/color/i);
  });

  it("la paleta es solo tokens de Flock, sin un hex a la vista", () => {
    for (const color of SERIES_PALETTE) {
      expect(color).toMatch(/^var\(--[a-z0-9-]+\)$/);
    }
  });
});

describe("prompt de composición", () => {
  it("describe los 13 componentes del catálogo y fija las reglas de la casa", () => {
    const prompt = buildComposePrompt();
    for (const name of catalog.componentNames) expect(prompt).toContain(`- ${name}:`);
    expect(prompt).toMatch(/\$state/);
    expect(prompt).toMatch(/rioplatense/i);
    // El refinamiento edita con parches: las instrucciones de edición tienen que estar.
    expect(prompt).toMatch(/PATCH MODE/);
  });

  it("es bastante más corto que el de fábrica: menos texto de entrada, primer token antes", () => {
    const factory = catalog.prompt({ mode: "standalone" });
    expect(buildComposePrompt().length).toBeLessThan(factory.length * 0.6);
  });

  it("el ejemplo que ve el modelo valida contra el catálogo", () => {
    // Un ejemplo con un prop inválido le enseñaría al modelo a equivocarse.
    const spec = compileSpecStream(COMPOSE_EXAMPLE.map((p) => JSON.stringify(p)).join("\n"));
    const outcome = validateVizSpec(spec, { rowCount: 12, stats: ["total", "max", "min", "avg", "count"] });
    expect(outcome.ok, outcome.ok ? "" : outcome.issues.map((i) => i.message).join(" | ")).toBe(true);
  });
});

/**
 * El principio III tiene dos barreras contra los datos inventados, y esta es la segunda.
 * La primera es una regla del prompt, que depende de que el modelo obedezca; esta no
 * depende de nadie.
 */
describe("barrera contra los datos inventados por el modelo", () => {
  const conState = {
    ...validSpec,
    state: { rows: [{ region: "Narnia", headcount_activo: 9999 }] },
  };

  it("un `state` emitido no llega a la vista validada, pero queda advertido", () => {
    // Importa que no se descarte en SILENCIO: si el modelo empieza a emitir datos, queremos
    // enterarnos. Pero es inerte, así que no justifica un reintento.
    const outcome = validateVizSpec(conState);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect("state" in outcome.spec).toBe(false);
    expect(outcome.warnings.join(" ")).toMatch(/datos de ejemplo.*se descartaron/i);
  });

  it("si el spec falla por otra cosa, el `state` se suma a los problemas del reintento", () => {
    // Sin Provenance: falla por FR-016, y el reintento tiene que enterarse de las dos cosas.
    const { prov: _prov, ...sinProvenance } = conState.elements;
    const roto = {
      ...conState,
      elements: { ...sinProvenance, screen: { ...conState.elements.screen, children: ["chart"] } },
    };
    const mensajes = messagesOf(roto);
    expect(mensajes).toMatch(/Provenance/);
    expect(mensajes).toMatch(/campo `state`/i);
  });

  it("stripModelState lo borra, venga como venga", () => {
    const limpio = stripModelState(conState) as Record<string, unknown>;
    expect("state" in limpio).toBe(false);
    // Y no toca nada más.
    expect(limpio.root).toBe("screen");
    expect(Object.keys(limpio.elements as object)).toEqual(["screen", "chart", "prov"]);
  });

  it("stripModelState no rompe con un spec normal ni con basura", () => {
    expect(stripModelState(validSpec)).toBe(validSpec); // misma referencia, sin copia
    expect(stripModelState(null)).toBe(null);
    expect(stripModelState(undefined)).toBe(undefined);
  });

  it("el prompt prohíbe el `state` y no trae nada del de fábrica que lo pida", () => {
    const prompt = buildComposePrompt();
    expect(prompt).toMatch(/Nunca emitas un campo `state`/);
    // El prompt de fábrica de json-render pedía datos de ejemplo en siete lugares (D16).
    // Ninguno puede volver a colarse.
    expect(prompt).not.toMatch(/sample data/i);
    expect(prompt).not.toMatch(/MUST include state/i);
    expect(prompt).not.toMatch(/INITIAL STATE/);
    expect(prompt).not.toMatch(/"path":"\/state/);
    expect(prompt).not.toMatch(/repeat/i);
  });

  it("el prompt pide JSONL sin prosa, que es lo que useUIStream consume", () => {
    expect(buildComposePrompt()).toMatch(/SOLO líneas JSONL/);
  });
});

describe("render progresivo", () => {
  const frame = {
    type: "Screen",
    props: { title: "Registros por cuenta", subtitle: null },
    children: ["chart", "prov"],
  };

  it("muestra el marco antes de que llegue el gráfico", () => {
    const partial = renderableSubset({ root: "screen", elements: { screen: frame } });
    expect(Object.keys(partial?.elements ?? {})).toEqual(["screen"]);
  });

  it("no monta un elemento que todavía no valida", () => {
    const partial = renderableSubset({
      root: "screen",
      elements: {
        screen: frame,
        // Un BarChart a medio llegar: sin ejes, sin series.
        chart: { type: "BarChart", props: { data: { $state: "/rows" }, title: "x" }, children: [] },
      },
    });
    expect(Object.keys(partial?.elements ?? {})).toEqual(["screen"]);
  });

  it("saca de la lista los hijos que todavía no llegaron", () => {
    // Si quedaran, el Renderer los saltearía igual, pero avisando en consola en cada parche.
    const partial = renderableSubset({ root: "screen", elements: { screen: frame } });
    expect(partial?.elements.screen?.children).toEqual([]);
  });

  it("sin raíz válida no hay nada que mostrar", () => {
    expect(renderableSubset({ root: "", elements: {} })).toBeNull();
    expect(renderableSubset({ root: "screen", elements: {} })).toBeNull();
  });
});

describe("props nullable omitidos", () => {
  // El prompt de json-render los muestra como opcionales (`subtitle?: string`), así que
  // el modelo los omite. Tienen que valer como null, no tumbar el spec.
  const spec = {
    root: "screen",
    elements: {
      screen: { type: "Screen", props: { title: "Registros por cuenta" }, children: ["kpi", "table", "prov"] },
      kpi: {
        type: "KpiTile",
        props: { data: { $state: "/rows" }, label: "Total", valueKey: "registros", format: "integer", hero: true },
        children: [],
      },
      table: {
        type: "DataTable",
        props: {
          data: { $state: "/rows" },
          columns: [
            { key: "cuenta", label: "Cuenta", align: "left" },
            { key: "registros", label: "Registros", align: "right", format: "integer" },
          ],
          maxRows: 12,
          emptyMessage: "Sin registros",
        },
        children: [],
      },
      prov: { type: "Provenance", props: { text: "Seguimiento de clientes" }, children: [] },
    },
  };

  it("valen como null, también dentro de las columnas de una tabla", () => {
    const outcome = validateVizSpec(spec);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const elements = outcome.spec.elements as Record<string, { props: Record<string, unknown> }>;
    expect(elements.screen?.props.subtitle).toBeNull();
    expect(elements.kpi?.props.unit).toBeNull();
    expect((elements.table?.props.columns as Array<Record<string, unknown>>)[0]?.format).toBeNull();
  });

  it("lo obligatorio de verdad sigue siendo obligatorio", () => {
    const sinTitulo = structuredClone(spec);
    delete (sinTitulo.elements.screen.props as Record<string, unknown>).title;
    expect(validateVizSpec(sinTitulo).ok).toBe(false);
  });

  it("el render progresivo también los acepta", () => {
    const partial = renderableSubset({ root: "screen", elements: { screen: spec.elements.screen } });
    expect(partial?.elements.screen).toBeDefined();
  });
});

describe("encabezados sin repeticiones", () => {
  // Lo que emitió el modelo en la prueba hablada: el título del Screen era la línea del
  // ribbon, y el subtítulo con el filtro aparecía en el Screen y en el gráfico.
  const repetido = {
    root: "screen",
    elements: {
      screen: {
        type: "Screen",
        props: { title: "Registros de seguimiento · por cuenta", subtitle: "país: Argentina" },
        children: ["chart", "table"],
      },
      chart: {
        type: "BarChart",
        props: { title: "Registros de seguimiento por cuenta", subtitle: "País: Argentina", xLabel: "Cuenta" },
        children: [],
      },
      table: { type: "DataTable", props: { title: "Registros de seguimiento por cuenta" }, children: [] },
    },
  } as unknown as VizSpec;

  const props = (spec: VizSpec, key: string) =>
    (spec.elements as Record<string, { props: Record<string, unknown> }>)[key]!.props;

  const ordenado = harmonizeHeadings(repetido, {
    title: "Registros de seguimiento por cuenta",
    subtitle: "país: Argentina",
  });

  it("el Screen lleva el título del agente y los filtros, no la línea del ribbon", () => {
    expect(props(ordenado, "screen")).toMatchObject({
      title: "Registros de seguimiento por cuenta",
      subtitle: "país: Argentina",
    });
  });

  it("el subtítulo aparece una sola vez, aunque cambien mayúsculas", () => {
    expect(props(ordenado, "chart").subtitle).toBeNull();
  });

  it("un gráfico que repite el titular pasa a nombrar su corte", () => {
    expect(props(ordenado, "chart").title).toBe("Por cuenta");
    // Una tabla debajo de un titular no necesita título propio.
    expect(props(ordenado, "table").title).toBeNull();
  });

  it("no toca lo que ya dice algo propio", () => {
    const propio = harmonizeHeadings(
      {
        ...repetido,
        elements: {
          ...repetido.elements,
          chart: {
            type: "BarChart",
            props: { title: "De mayor a menor", subtitle: "Sólo cuentas activas", xLabel: "Cuenta" },
            children: [],
          },
        },
      } as unknown as VizSpec,
      { title: "Registros de seguimiento por cuenta", subtitle: "país: Argentina" },
    );
    expect(props(propio, "chart")).toMatchObject({
      title: "De mayor a menor",
      subtitle: "Sólo cuentas activas",
    });
  });

  it("el resultado sigue validando", () => {
    const ok = validateVizSpec(validSpec);
    if (!ok.ok) throw new Error("validSpec debería validar");
    const again = validateVizSpec(harmonizeHeadings(ok.spec, { title: "Otro", subtitle: null }));
    expect(again.ok).toBe(true);
  });
});

describe("un KPI no puede mostrar un número con un rótulo que no le corresponde", () => {
  const kpiSpec = (data: unknown, valueKey: string) => ({
    ...validSpec,
    elements: {
      ...validSpec.elements,
      screen: { ...validSpec.elements.screen, children: ["kpi", "chart", "prov"] },
      kpi: {
        type: "KpiTile",
        props: { data, label: "Total de personas", valueKey, format: "integer", unit: "personas", hero: true, caption: null },
        children: [],
      },
    },
  });
  const ctx = { rowCount: 6, stats: ["total", "max", "min", "avg", "count"] };

  it("sobre /rows con varias filas se rechaza: mostraría la primera categoría", () => {
    const outcome = validateVizSpec(kpiSpec({ $state: "/rows" }, "headcount_activo"), ctx);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.issues.map((i) => i.message).join(" ")).toMatch(/\/stats/);
  });

  it("sobre /rows con una sola fila está bien: es un número solo", () => {
    const outcome = validateVizSpec(kpiSpec({ $state: "/rows" }, "headcount_activo"), { rowCount: 1, stats: ["max"] });
    expect(outcome.ok).toBe(true);
  });

  it("sobre /stats con una clave disponible valida", () => {
    expect(validateVizSpec(kpiSpec({ $state: "/stats" }, "total"), ctx).ok).toBe(true);
  });

  it("sobre /stats con una clave sin valor se rechaza", () => {
    const sinTotal = { rowCount: 6, stats: ["max", "min", "count"] };
    expect(messagesOf(kpiSpec({ $state: "/stats" }, "total"), sinTotal)).toMatch(/no existe en \/stats/);
  });

  it("no acepta otra ruta de estado: tampoco por un KPI entra un número del modelo", () => {
    expect(validateVizSpec(kpiSpec({ $state: "/otra" }, "total"), ctx).ok).toBe(false);
  });

  it("el render progresivo no lo muestra ni por un instante", () => {
    const partial = renderableSubset(kpiSpec({ $state: "/rows" }, "headcount_activo"), ctx);
    expect(Object.keys(partial?.elements ?? {})).not.toContain("kpi");
  });
});

describe("tipo del gráfico principal (transición entre tipos)", () => {
  it("es el primer gráfico desde la raíz, aunque haya KPIs antes", () => {
    const spec = {
      root: "screen",
      elements: {
        screen: { type: "Screen", props: {}, children: ["kpis", "chart"] },
        kpis: { type: "Row", props: {}, children: ["kpi"] },
        kpi: { type: "KpiTile", props: {}, children: [] },
        chart: { type: "PieChart", props: {}, children: [] },
      },
    } as unknown as VizSpec;
    expect(primaryChartType(spec)).toBe("PieChart");
  });

  it("un KPI solo es su propio tipo, y sin contenido no hay tipo", () => {
    const kpiOnly = { root: "s", elements: { s: { type: "Screen", props: {}, children: ["k"] }, k: { type: "KpiTile", props: {}, children: [] } } } as unknown as VizSpec;
    expect(primaryChartType(kpiOnly)).toBe("KpiTile");
    expect(primaryChartType(null)).toBeNull();
  });
});
