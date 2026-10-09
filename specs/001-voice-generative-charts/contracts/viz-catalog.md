# Contrato — Etapa 3: catálogo de `json-render`

El catálogo es la **única** definición compartida entre el prompt del LLM, la validación del
servidor y el registry de render. Se define una vez en `lib/viz/catalog.ts` con `defineCatalog`
y de ahí se derivan el schema Zod para `streamObject` y el registry de React.

## Regla central: los datos entran por binding

Ningún componente del catálogo acepta un array de datos literal. El prop de datos es siempre
una **expresión de binding** de json-render, que usa JSON Pointer:

```ts
const DataRef = z.object({ $state: z.literal('/rows') })
```

El `ResultSet` de la etapa 2 se inyecta como `{ rows: [...], stats: [{...}] }` en el
`StateProvider` al montar el spec, y el renderer resuelve la expresión antes de pasar los props
al componente. Esto es lo que hace que el principio III sea estructural: el modelo no tiene
dónde escribir un número.

### `/stats`: los números que acompañan a un gráfico

`KpiTile` es el único componente que además puede leer `{"$state": "/stats"}`: una fila con
`total`, `max`, `min`, `avg` y `count` que calcula el motor (`resultStats` en
`lib/conversation/answers.ts`). `total` y `avg` son `null` si la métrica no se suma, como un
promedio de edad.

La regla, que valida `validateVizSpec` con el contexto del resultado:

- con **una fila** (un número solo), el KPI lee `/rows`;
- con **más de una**, lee `/stats`. Sobre `/rows` mostraría la primera categoría con un
  rótulo de total: "Total de registros: 40" en vez de 200;
- con `/stats`, `valueKey` tiene que ser una clave con valor para ese resultado.

El render progresivo aplica la misma regla, así que un KPI mal atado no aparece ni por un
instante.

## Componentes

### Contenedores

| Componente | Props | Slots |
|------------|-------|-------|
| `Screen` | `title`, `subtitle?` | `default` |
| `Row` | `gap?: 'sm' \| 'md' \| 'lg'`, `align?` | `default` |
| `Grid` | `columns: 2 \| 3 \| 4` | `default` |

### Gráficos

Todos comparten este bloque de props obligatorias, que es como se hace cumplir FR-008:

```ts
const ChartBase = z.object({
  data:     DataRef,
  title:    z.string(),
  subtitle: z.string().nullable(),
  xKey:     z.string(),
  xLabel:   z.string(),        // eje rotulado, obligatorio
  yLabel:   z.string(),        // incluye unidad
  series:   z.array(z.object({
    key:    z.string(),
    label:  z.string(),
    format: z.enum(['integer', 'decimal1', 'decimal2', 'percent', 'currency']),
  })).min(1),
  legend:   z.boolean().default(true),
  grid:     z.boolean().default(true),
  emptyMessage: z.string(),    // estado vacío, obligatorio
})
```

| Componente | Props adicionales |
|------------|-------------------|
| `BarChart` | `layout: 'vertical' \| 'horizontal'`, `stacked: boolean`, `showValues: boolean` |
| `LineChart` | `curve: 'linear' \| 'monotone'`, `showPoints: boolean`, `showArea: boolean` |
| `AreaChart` | `stacked: boolean`, `opacity: number` |
| `PieChart` | `donut: boolean`, `showPercent: boolean` — usa `series[0]` únicamente |
| `ScatterChart` | `yKey: string`, `sizeKey: string \| null`, `trendline: boolean` |
| `ComposedChart` | `barSeries: string[]`, `lineSeries: string[]`, `rightAxis: boolean` |

### Display

| Componente | Props |
|------------|-------|
| `KpiTile` | `data: {"$state": "/rows"} \| {"$state": "/stats"}`, `label`, `valueKey`, `format`, `unit`, `hero: boolean`, `caption` |
| `DataTable` | `data: DataRef`, `columns: { key, label, align, format }[]`, `maxRows` |
| `Callout` | `tone: 'info' \| 'warning'`, `text` — para advertencias de cobertura o supresión |
| `Provenance` | `text` — pie del gráfico con dominio, filtros y cantidad de filas |

`KpiTile` con `hero: true` usa `.stat-card-hero` (gradiente `--stat-gradient`, texto blanco,
`brightness(1.07)` en hover). Nunca vira a blanco.

## Estilo: los componentes no reciben colores

El LLM **no** puede pasar colores. La paleta de series se resuelve en `lib/viz/palette.ts` a
partir de los tokens de Flock y se asigna por índice de serie. Esto hace que SC-007 sea
verificable por construcción: no hay un prop de color donde meter un hex.

La paleta de datos se deriva de `--brand` (#7800C0), `--brand-2` (#9D2BD6), `--brand-dark`
(#300840) y `--accent` (#F85000), extendida con los tonos de estado del design system para
series adicionales. Se define una sola vez y cambia de valor en `html.dark` junto con los
tokens.

## Forma del spec

```json
{
  "root": "screen",
  "elements": {
    "screen":  { "type": "Screen", "props": { "title": "Dotación activa por región" },
                 "children": ["kpis", "chart", "prov"] },
    "kpis":    { "type": "Row", "props": { "gap": "md" }, "children": ["kpi1", "kpi2"] },
    "kpi1":    { "type": "KpiTile", "props": { "data": { "$state": "/stats" },
                 "label": "Personas activas", "valueKey": "total", "format": "integer",
                 "unit": "personas", "hero": true, "caption": null } },
    "chart":   { "type": "BarChart", "props": {
                 "data": { "$state": "/rows" }, "title": "Por región",
                 "xKey": "region", "xLabel": "Región", "yLabel": "Personas",
                 "series": [{ "key": "headcount_activo", "label": "Activos", "format": "integer" }],
                 "layout": "vertical", "stacked": false, "showValues": true,
                 "legend": false, "grid": true,
                 "emptyMessage": "No hay personas que cumplan ese filtro" } },
    "prov":    { "type": "Provenance", "props": { "text": "Nómina · 79 de 124 · activos" } }
  }
}
```

## Validación y degradación

1. `streamObject` produce el spec contra el schema derivado del catálogo.
2. Al cerrar el stream, el servidor revalida el documento completo.
3. Si no valida: se conserva el gráfico anterior, el agente avisa por voz y se reintenta **una
   vez** con el error de validación en el prompt. Un segundo fallo se reporta como tal.
4. Durante el streaming, los elementos incompletos se renderizan como esqueleto, nunca como
   componente a medio construir (FR-010).

## Extender el catálogo

Un tipo de gráfico nuevo se agrega en `lib/viz/catalog.ts` y su componente en
`lib/viz/components/`. El schema del LLM, la validación y el registry se actualizan solos
porque los tres derivan de la misma definición. No hay ningún otro lugar donde tocar — y no
existe una ruta de render fuera del catálogo.
