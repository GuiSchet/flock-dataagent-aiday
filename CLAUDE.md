@AGENTS.md

# Flock DataAgent — guía operativa

Una app web de escritorio sobre una nómina sintética con la forma de la de Flock, detrás de un
login con contraseña compartida. La portada muestra un tablero fijo de indicadores y, para
todo lo demás, la gente habla y un agente de voz de ElevenLabs arma la visualización. Esta guía está subordinada a `.specify/memory/constitution.md`. Si algo de acá
la contradice, manda la constitución.

## Comandos

```bash
npm run data:synthetic # regenera la nómina sintética de data/ (semilla fija)
npm run dev          # http://localhost:3000 (Turbopack); pide la clave de APP_PASSWORD
npm test             # Vitest: motor de datos, contrato del catálogo, intents
npm run typecheck && npm run lint && npm run build
npm run setup:agent  # publica prompt y tools en ElevenLabs; correrlo si cambia
                     # elevenlabs/, AgentIntentSchema o el catálogo de datos
npm run audit:tokens # cero colores, radios, sombras o tipografías fuera del design system
npm run screenshots  # tablero y /preview en claro y oscuro, en tamaños de escritorio
npm run bench:voice  # banco de pruebas por voz contra el agente real (~20 min, cuesta)
```

Si cambia el generador: `npm run data:synthetic`, `npm test` (las cifras de `tests/data`
salen de esos datos y hay que actualizarlas a propósito), `npm run setup:agent` y
`npm run build`.

Después de tocar la conversación, la composición o la pantalla, correr el banco (o el caso
que corresponda: `-- --case q14`). Si cambia el comportamiento del agente, el caso nuevo va en
`scripts/voice-bench/cases.ts`.

`/preview` es el banco de render sin voz, sólo en desarrollo.

## Los datos

- **El repo es público.** `data/` es sintético (`scripts/generate-synthetic.ts`, semilla
  fija): ninguna fila es de una persona real y los clientes son inventados. Nunca se commitea
  una nómina real, ni cifras, nombres de clientes o nombres de personas que salgan de ella:
  tampoco en tests, specs ni comentarios.
- Dos dominios: `nomina` (una fila por persona) y `movimientos` (una fila por mes desde
  enero 2023, calculada de la nómina: dotación, ingresos, egresos, attrition, deserción y
  rotación con las fórmulas de una planilla de RR.HH.). El generador cuenta la misma serie por
  su lado y la deja como control en `tests/data/movimientos.test.ts`.

## El login

`proxy.ts` (Next 16: lo que antes era `middleware.ts`) deja pasar sólo a `/login` y a los
assets; sin sesión, una página redirige a `/login` y una API devuelve 401. La sesión es una
cookie firmada (`lib/auth/session.ts`) con `AUTH_SECRET` + `APP_PASSWORD`; sin cualquiera de
las dos, 503. Los route handlers que gastan o devuelven datos verifican la sesión otra vez
(`requireSession`). Los scripts que abren Chrome (`screenshots`, `bench:voice`) inyectan una
cookie válida.

## La tubería, en una línea

Agente de voz → client tool con un `VizIntent` → `/api/query` (resuelve, valida y agrega
filas en el servidor) → `/api/compose` (OpenAI emite un spec de json-render con
`{"$state": "/rows"}`) → `GeneratedView` monta el spec con las filas del motor.

## Reglas que se revisan en cada cambio

1. **Voz primero.** Ningún selector, formulario ni botón que genere un gráfico. El único
   camino es un client tool. La excepción es el tablero fijo de la portada
   (`lib/dashboard/tablero.ts`): specs curados, sin filtros, validados como cualquier otro.
2. **Catálogo cerrado.** Un gráfico o un prop nuevo se agrega en `lib/viz/catalog.ts`. Todo
   spec pasa por `validateVizSpec` antes de llegar al DOM.
3. **Datos reales.** Los números salen de `lib/data/query.ts` y de ningún otro lado. El
   modelo nunca ve filas; `stripModelState` descarta cualquier `state` que emita. El agente
   lee valores ya formateados, nunca calcula.
4. **Design system.** Sólo `var(--*)` de los tokens de Flock. Sin hex, rem ni sombras
   propias. La paleta de series vive en `lib/viz/palette.ts`. Todo se mira en claro y oscuro.
5. **Espera diseñada.** Ningún estado estático más de 400 ms. Ningún tool espera a un
   modelo: `proposeVisualization` y `refineVisualization` devuelven apenas termina la consulta.
6. **Sin nombres.** No hay umbral de grupo: un corte de una persona se muestra. Lo que nunca
   aparece, ni en pantalla ni en voz, es el nombre y apellido de alguien, y eso es estructural:
   los datos no tienen nombres ni datos de contacto.

## Borde servidor / navegador

`lib/data/catalog.ts` lee `data/` con `node:fs`, así que todo lo que lo importa corre en el
servidor: `intent.ts` (validación, descripción), `resolve.ts`, `query.ts`,
`lib/dashboard/tablero.ts`. Del lado del navegador sólo se importan `lib/viz/*`,
`lib/data/format.ts`, `lib/conversation/history.ts` y `lib/conversation/answers.ts`, y los
tipos con `import type`.

## APIs que no son las de tu memoria

Todas verificadas contra los `.d.ts` instalados (research.md D9–D13):

- **Next 16**: leer `node_modules/next/dist/docs/` antes de tocar convenciones.
- **AI SDK v7**: `streamText` con `instructions` (no `system`). `generateObject` y
  `streamObject` están deprecados.
- **`@elevenlabs/react` 1.15**: `<ConversationProvider>` obligatorio; `startSession()` devuelve
  `void`; estado con `useConversationStatus` / `useConversationMode` / `useConversationInput` /
  `useConversationControls`; tools con `useConversationClientTool`. Nada del patrón 0.5.x de
  vistaenergy.
- **json-render 0.21**: `useUIStream` espera JSONL crudo de JSON Patches. `catalog.validate()`
  no valida props: por eso existe `lib/viz/schema.ts`.

## Dónde tocar qué

| Quiero… | Archivo |
|---------|---------|
| Cambiar cómo repregunta o habla el agente | `elevenlabs/agent.config.ts` + `npm run setup:agent` |
| Cambiar los parámetros de un tool | `lib/conversation/intent.ts` (`AgentIntentSchema`) + `npm run setup:agent` |
| Cambiar qué hace un tool | `lib/conversation/tools.ts` |
| Agregar un tipo de gráfico | `lib/viz/catalog.ts` + `lib/viz/components/` + `lib/viz/registry.tsx` |
| Cambiar dimensiones o métricas | `lib/data/catalog.ts` (+ `normalize.ts` si hay que agrupar valores) |
| Agregar una columna a los datos | `scripts/generate-synthetic.ts` (`COLUMNS`) + `npm run data:synthetic` |
| Cambiar el login | `proxy.ts`, `lib/auth/session.ts`, `app/login/` |
| Cambiar los gráficos del tablero | `lib/dashboard/tablero.ts` |
| Ajustar la composición del spec | `lib/viz/schema.ts` → `buildComposePrompt()` |

## Spec Kit

El trabajo vive en `specs/001-voice-generative-charts/` (la versión tótem) y
`specs/002-nomina-escritorio/` (nómina nueva, escritorio, datos sintéticos y login).
`tasks.md` es el estado real: marcar `[x]` / `[~]` / `[!]` al cerrar cada tarea y actualizar
"Estado al …".
