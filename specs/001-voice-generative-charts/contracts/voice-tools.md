# Contrato — Client tools del agente de voz

Los cinco tools son el puente por el que el agente actúa sobre la app. Con ellos el agente
deja de narrar gráficos y pasa a crearlos.

Cada tool existe **en dos lugares** y los dos tienen que coincidir:

1. **Declarado en ElevenLabs** (`POST /v1/convai/tools`, `tool_config.type: "client"`), con
   su JSON Schema de parámetros. Versionado en `elevenlabs/tools/*.json` y sincronizado con
   `npm run setup:agent`.
2. **Implementado en el navegador** con `useConversationClientTool(name, handler)`, que
   registra en mount, desregistra en unmount y siempre ve el estado fresco. Reemplaza el
   truco de ref + `registerXxx` que hacía falta en la API 0.5.x.

## Reglas de runtime (verificadas en el JS del SDK)

- El handler recibe **un solo argumento**: el objeto `parameters` tal cual lo manda el
  agente. No hay segundo argumento de contexto.
- Puede ser `async`; el agente espera el resultado si `expects_response` es `true`.
- Si devuelve un objeto, el SDK le hace `JSON.stringify`. El tipo declarado es
  `string | number | void`, así que conviene devolver la cadena ya serializada.
- Si devuelve `undefined`, se manda `"Client tool execution successful."`.
- Si **lanza**, se manda `is_error: true` con el mensaje y se dispara `onError`. Los handlers
  MUST capturar sus propios errores y devolver un `status: "error"` explicable en voz.

## Regla que ordena el diseño: ningún tool espera a un modelo

`expects_response: true` bloquea la conversación hasta `response_timeout_secs` (1–120,
default 20). Un tool que esperara al compositor dejaría al agente mudo varios segundos.

Por eso `proposeVisualization` y `refineVisualization` **devuelven apenas termina la consulta
determinística** —milisegundos— y disparan la composición del spec en segundo plano. El
agente narra mientras el gráfico se dibuja.

---

## `getDataCatalog`

```json
{
  "type": "client",
  "name": "getDataCatalog",
  "description": "Devuelve qué datos hay disponibles: dominios, dimensiones por las que se puede cortar, métricas calculables, su cobertura, y las columnas que NO están disponibles con el motivo. Llamalo al arrancar la conversación y cada vez que el usuario pregunte qué podés mostrarle. Nunca contestes sobre disponibilidad de memoria.",
  "expects_response": true,
  "response_timeout_secs": 10,
  "parameters": { "type": "object", "properties": {}, "required": [] }
}
```

Devuelve `getCatalogSummary()` serializado: dominios con sus dimensiones (id, etiqueta, tipo,
cardinalidad, cobertura, valores si son pocos) y métricas (id, etiqueta, unidad, formato,
cobertura), más `unavailable` con campo, motivo y alternativa sugerida.

Sin filas de datos. Nunca.

---

## `proposeVisualization`

Es el tool central. Sus parámetros **son** el `VizIntent` (ver `viz-intent.md`).

```json
{
  "type": "client",
  "name": "proposeVisualization",
  "description": "Genera una visualización nueva. Llamalo SOLO cuando ya tengas resueltos el dominio, la métrica y el corte. Si falta alguno, preguntáselo al usuario primero: este tool no adivina.",
  "expects_response": true,
  "response_timeout_secs": 15,
  "pre_tool_speech": "auto",
  "parameters": {
    "type": "object",
    "properties": {
      "domain":  { "type": "string", "enum": ["nomina", "clientes"],
                   "description": "Dominio de datos." },
      "metric":  { "type": "string",
                   "description": "Id de la métrica, de getDataCatalog. No lo inventes." },
      "groupBy": { "type": "array", "items": { "type": "string" }, "maxItems": 2,
                   "description": "Ids de dimensión. Vacío = un solo número (KPI). Uno = eje X. Dos = eje X más series de color." },
      "filters": { "type": "array",
                   "items": {
                     "type": "object",
                     "properties": {
                       "field": { "type": "string" },
                       "op":    { "type": "string",
                                  "enum": ["eq","neq","in","nin","gte","lte","between","contains"] },
                       "value": { "type": "string",
                                  "description": "Un valor, o varios separados por coma cuando op es in/nin/between." }
                     },
                     "required": ["field", "op", "value"]
                   },
                   "description": "Filtros a aplicar. Lista vacía si no hay." },
      "sortBy":  { "type": "string", "enum": ["metric", "dimension", "default"] },
      "sortDir": { "type": "string", "enum": ["asc", "desc"] },
      "limit":   { "type": "integer", "minimum": 1, "maximum": 50 },
      "chartType": { "type": "string",
                     "enum": ["bar","barGrouped","barStacked","line","area","pie","donut","scatter","composed","kpi","table"] },
      "title":    { "type": "string", "description": "Título en español rioplatense." },
      "assumptions": { "type": "array", "items": { "type": "string" },
                       "description": "Defaults que elegiste sin preguntar. Enuncialos en voz cuando describas el resultado." }
    },
    "required": ["domain", "metric", "groupBy", "chartType", "title"]
  }
}
```

Notas sobre el schema:

- `filters[].value` es **string** aunque a veces represente varios valores. Un `anyOf` con
  arrays es correcto en JSON Schema pero los agentes lo llenan peor; el cliente parsea por
  coma cuando `op` es `in`/`nin`/`between`. Si en las pruebas el agente tampoco llena bien
  el array de objetos, el plan B es aplanar `filters` a un string JSON (research.md D9).
- No hay campo `missing`. La repregunta vive en el prompt del agente: si le falta un slot
  material, **no llama al tool**. El servidor revalida como red de seguridad.
- `pre_tool_speech: "auto"` deja que el agente diga algo al arrancar, lo que cubre el inicio
  de la espera sin código propio.

**Qué hace el handler**, en orden:

1. `POST /api/query` con los parámetros **tal cual los mandó el agente**. La validación no
   puede correr en el navegador: el catálogo de datos se arma leyendo los CSV con `node:fs`.
   El servidor parsea con el Zod, normaliza, valida contra el catálogo (las reglas de
   `viz-intent.md`) y ejecuta la consulta, todo en `lib/conversation/resolve.ts`.
2. Si algo no valida → devuelve `status: "error"` con la alternativa más cercana. No genera.
3. Apila el `VizIntent` que devolvió el servidor y guarda el `ResultSet` en el contexto de
   sesión.
4. Dispara `useUIStream.send(...)` **sin esperarlo**.
5. Devuelve ya.

El cuerpo de `/api/query`:

```json
{ "mode": "propose", "params": { "…": "lo que mandó el agente" } }
{ "mode": "refine",  "params": { "…": "el delta" }, "base": { "…": "VizIntent vigente" } }
{ "mode": "resolve", "intent": { "…": "VizIntent ya resuelto, para volver atrás" } }
```

Responde `{ ok: true, intent, result, description, subtitle, changed, warnings, shape }` o,
con 422, `{ ok: false, message, suggestion }`. `shape` describe las columnas del resultado
sin un solo valor: es lo que recibe el compositor.

**Respuestas**:

```json
{ "status": "rendered",
  "rowCount": 6,
  "summary": "6 regiones. CABA arriba con 30 personas, Otros abajo con 3.",
  "warnings": ["Se agruparon en Otros 2 categorías con menos de 5 personas, para no identificar a nadie."],
  "assumptions": ["Ordenado de mayor a menor"] }
```

```json
{ "status": "error",
  "message": "La métrica \"facturacion\" no existe en Seguimiento de clientes.",
  "suggestion": "Las disponibles son: Registros de seguimiento, Cuentas, Proyectos, NPS promedio, % del total." }
```

El agente MUST enunciar `warnings` y `assumptions` al describir el resultado.

Cada respuesta `rendered` trae además la procedencia de lo que queda en pantalla, para que el
agente pueda contestar "¿de dónde salen estos datos?" sin otra consulta y sin caer en el total
del catálogo cuando hay filtros (FR-016):

```json
"provenance": { "fuente": "Seguimiento de clientes", "registros": "180 de 200 registros", "filtros": "país: Argentina" }
```

---

## `refineVisualization`

Mismos parámetros que `proposeVisualization`, pero **todos opcionales**: es un delta sobre el
intent vigente.

```json
{
  "type": "client",
  "name": "refineVisualization",
  "description": "Cambia el gráfico que ya está en pantalla: agregá un filtro, cambiá el corte, cambiá el tipo, reordená. Mandá SOLO los campos que cambian; el resto se conserva. Usalo siempre que el usuario pida una variación de lo que está viendo, en vez de generar de cero.",
  "expects_response": true,
  "response_timeout_secs": 15,
  "parameters": { "…": "igual que proposeVisualization, con required: []" }
}
```

Reglas de merge en `viz-intent.md`. Devuelve lo mismo que `proposeVisualization` más:

```json
{ "changed": ["filters"] }
```

para que el agente confirme en voz qué cambió ("listo, saqué los inactivos"), y `now` con la
descripción de lo que queda en pantalla, filtros incluidos.

---

## `undoVisualization`

```json
{
  "type": "client",
  "name": "undoVisualization",
  "description": "Vuelve al gráfico anterior. Usalo cuando el usuario diga 'volvé atrás', 'como estaba antes' o similar.",
  "expects_response": true,
  "response_timeout_secs": 10,
  "parameters": { "type": "object", "properties": {}, "required": [] }
}
```

Hace `pop` de la pila y regenera. Si queda un solo elemento devuelve:

```json
{ "status": "at_start",
  "message": "Ya estás en el primer gráfico de esta conversación: no hay uno anterior. El que está en pantalla sigue ahí.",
  "now": "Registros de seguimiento · por cuenta" }
```

El `message` no es decorativo: con sólo `{ "status": "at_start" }` el agente contestaba "no
hay ningún gráfico en pantalla", con el gráfico delante (research.md D15).

---

## `queryCurrentChart`

```json
{
  "type": "client",
  "name": "queryCurrentChart",
  "description": "Consulta los datos exactos del gráfico que está en pantalla. Usalo para cualquier pregunta sobre lo que se ve: cuál es el más alto, cuánto da el total, cuánto vale una categoría puntual. NUNCA leas un número del gráfico vos mismo: pedilo acá.",
  "expects_response": true,
  "response_timeout_secs": 10,
  "parameters": {
    "type": "object",
    "properties": {
      "question":  { "type": "string", "description": "La pregunta del usuario, tal cual." },
      "highlight": { "type": "string", "description": "Etiqueta de la categoría a resaltar en pantalla, si la pregunta menciona una." }
    },
    "required": ["question"]
  }
}
```

Responde desde el `ResultSet` vigente, nunca de una lectura visual. Devuelve **cadenas ya
formateadas en es-AR**, no números sueltos, para que el agente las lea en vez de hacer
aritmética:

```json
{ "answerable": true,
  "answers": {
    "max":   { "label": "CABA", "formatted": "30 personas" },
    "min":   { "label": "Otros", "formatted": "3 personas" },
    "total": { "formatted": "79 personas" },
    "avg":   { "formatted": "13,2 personas" }
  },
  "provenance": {
    "fuente": "Nómina",
    "metrica": "Personas activas",
    "registros": "124 de 124 registros",
    "privacidad": "1 categoría agrupada en \"Otros\" por tener menos de 5 personas" },
  "rows": [{ "region": "CABA", "valor": "30" }, "… hasta 15 filas"],
  "context": "Personas activas · por región" }
```

`provenance` es lo que contesta "¿de dónde salen estos datos?" (FR-016). Si `highlight` coincide
con una categoría, además de devolver su valor en `answers.point` la resalta en pantalla durante
8 s: las demás se atenúan (T061). El resaltado no pasa por el spec ni por el modelo.

Con `answerable: false`, el agente MUST decir que eso no está en los datos en vez de
especular (FR-011).

---

## Prompt del agente (reglas normativas)

El prompt completo vive en `elevenlabs/agent.config.ts` y se sincroniza con
`npm run setup:agent`. Sus reglas no negociables:

- Español rioplatense, voseo, tono profesional y directo. Sin relleno.
- **Repreguntar sólo por lo que cambia el significado** del resultado: métrica, dimensión de
  corte, universo de filas. Para lo cosmético —orden, tipo de gráfico, límite— elegir un
  default, pasarlo en `assumptions` y enunciarlo.
- No llamar a `proposeVisualization` con slots materiales sin resolver.
- Antes de generar, decir en una frase qué se va a mostrar.
- **Nunca decir un número que no haya venido de un tool.**
- Nunca nombrar personas, correos ni datos individuales de la nómina.
- Ante un pedido imposible: decir qué datos sí hay y proponer lo más cercano.
- Si hay un gráfico en pantalla y el usuario pide una variación, usar `refineVisualization`,
  no `proposeVisualization`.
- Máximo dos oraciones por turno, salvo que pidan explicar.
