# Contrato — `VizIntent`

Lo único que el agente puede pedir. Es el límite exacto entre lo que un modelo decide y lo
que el motor calcula.

> **Revisión del 2026-09-22**: el `VizIntent` ya no lo produce una llamada aparte a OpenAI.
> Lo emite el agente de ElevenLabs directamente, porque el schema de parámetros del client
> tool `proposeVisualization` **es** este contrato (research.md D9). Eso cambia dos cosas:
> los parámetros se aplanan un poco para que un agente de voz los llene bien, y el campo
> `missing` desaparece —la repregunta vive en el prompt del agente, no en un campo—.

## La forma que llega del agente

Es el schema de parámetros de `proposeVisualization` (ver `voice-tools.md`), pensado para
que un agente de voz lo complete sin equivocarse:

```ts
const AgentIntent = z.object({
  domain: z.enum(["nomina", "clientes"]),
  metric: z.string(),
  groupBy: z.array(z.string()).max(2),

  filters: z.array(z.object({
    field: z.string(),
    op: z.enum(["eq","neq","in","nin","gte","lte","between","contains"]),
    // String aunque represente varios valores: se parsea por coma cuando op lo requiere.
    value: z.string(),
  })).default([]),

  // Aplanado en dos campos en vez de un objeto anidado.
  sortBy:  z.enum(["metric", "dimension", "default"]).default("default"),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
  limit:   z.number().int().min(1).max(50).nullable().default(null),

  chartType: z.enum([
    "bar","barGrouped","barStacked","line","area",
    "pie","donut","scatter","composed","kpi","table",
  ]),

  title: z.string(),
  assumptions: z.array(z.string()).default([]),
})
```

## La forma interna

El cliente normaliza lo anterior a la estructura que consume el motor:

```ts
interface VizIntent {
  domain: DomainId
  metric: string
  groupBy: string[]
  filters: Filter[]            // value ya parseado a string | number | array
  sort: SortSpec | null        // null = el default de la dimensión
  limit: number | null
  chartType: ChartType
  title: string
  subtitle: string | null      // derivado de los filtros activos, no lo escribe el agente
  assumptions: string[]
}
```

`Filter` y `SortSpec` salen de `lib/data/types.ts`: se reutilizan tal cual, no se duplican.

**Normalización de `filters[].value`**: con `op` en `in` / `nin` / `between` se parte por
coma y se recortan espacios; si cada parte parsea como número, se convierte. Con el resto de
los operadores se deja el string, salvo que parsee como número.

## Reglas de validación (cliente, antes de consultar)

Se aplican después del parseo y antes de ejecutar nada. Son la red de seguridad de que el
agente obedeció el prompt:

1. `metric` MUST existir en `catalog[domain].metrics`. Si no, error con las métricas que hay.
2. Cada id de `groupBy` y cada `filters[].field` MUST existir en
   `catalog[domain].dimensions`.
3. `groupBy` vacío MUST implicar `chartType: "kpi"`.
4. `pie` / `donut` MUST tener exactamente un `groupBy`.
5. `barStacked` / `barGrouped` / `composed` MUST tener dos `groupBy`.
6. La segunda dimensión MUST tener cardinalidad efectiva ≤ 7: es cuantas series distingue la
   paleta de Flock sin inventar colores.
7. Si la métrica tiene cobertura < 50 %, el motor agrega una advertencia al `provenance` y el
   agente MUST enunciarla antes de describir el gráfico.
8. Una dimensión bloqueada por PII no valida: no está en el catálogo, así que la regla 2 la
   rechaza.

Las reglas 1, 2 y 8 las hace `runQuery` y lanza `QueryError` con `suggestion`; las demás se
verifican en `lib/conversation/intent.ts` antes de llamar.

## Dónde vive la repregunta

**En el prompt del agente, no en este contrato.** El agente no llama a
`proposeVisualization` hasta tener resueltos el dominio, la métrica y el corte. Si le falta
alguno, pregunta por voz.

Eso es lo que implementa FR-003 y el principio I. La validación de arriba es el respaldo:
si el agente igual llama con algo incompleto o inventado, el handler devuelve
`status: "error"` y el agente tiene que corregir, pero **nunca se dibuja un gráfico sobre una
suposición silenciosa**.

`assumptions` es el canal opuesto: los defaults que el agente eligió sin preguntar —orden,
tipo de gráfico, límite— y que MUST enunciar en voz ("lo ordeno de mayor a menor").

## Merge de refinamientos

`refineVisualization` manda los mismos campos, todos opcionales. El merge sobre el intent
vigente:

- `metric`, `chartType`, `sortBy`, `sortDir`, `limit`, `title`: reemplazan si vienen.
- `groupBy`: reemplaza completo. "Abrilo por género" sobre "por región" exige que el agente
  emita `["region", "genero"]`, no sólo `["genero"]`; el prompt se lo dice.
- `filters`: se acumulan **por campo**. Un filtro nuevo sobre un campo ya filtrado lo
  reemplaza; sobre un campo nuevo, se suma. Un filtro con `value: ""` lo remueve.
- `assumptions`: reemplaza.

El intent resultante se apila. "Volvé atrás" es un `pop`.

## Ejemplos

**"Mostrame la dotación por región"** — el agente tiene todo, llama:

```json
{ "domain": "nomina", "metric": "headcount_activo", "groupBy": ["region"],
  "filters": [], "sortBy": "metric", "sortDir": "desc", "limit": null,
  "chartType": "bar", "title": "Dotación activa por región",
  "assumptions": ["Ordenado de mayor a menor", "Sólo personas activas"] }
```

**"Mostrame los clientes"** — ambiguo: el agente **no llama al tool**. Pregunta:

> ¿Qué te interesa de los clientes: cuántos registros de seguimiento hay por cuenta, el NPS,
> o cómo se reparten las razones de atención?

**"Sacá los inactivos"** — delta sobre el intent vigente:

```json
{ "filters": [{ "field": "activo", "op": "eq", "value": "Sí" }] }
```

**"Quedate con Argentina y México"** — `in` con valores separados por coma:

```json
{ "filters": [{ "field": "pais", "op": "in", "value": "Argentina, México" }] }
```
