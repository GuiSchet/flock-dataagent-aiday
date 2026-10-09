# Implementation Plan: Agente de voz que co-diseña visualizaciones

**Branch**: `001-voice-generative-charts` | **Date**: 2026-09-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-voice-generative-charts/spec.md`

> **Revisión del 2026-09-22 (tarde)**: este plan se actualizó después de verificar las tres
> APIs contra los paquetes instalados. La tubería pasó de tres etapas con dos llamadas a
> OpenAI a **dos modelos**, porque el agente de voz ya produce la intención. Ver research.md
> D9–D13.

## Summary

Una app Next.js de pantalla única, tipo tótem, donde una conversación por voz produce
visualizaciones generativas sobre dos CSV de Flock.

El eje técnico es una **tubería que separa el juicio del cálculo**:

1. **Intención** — el agente de ElevenLabs traduce lo hablado a un `VizIntent` tipado, que
   es literalmente el schema de parámetros del client tool `proposeVisualization`. Mientras
   le falte un slot material, no llama al tool: repregunta por voz.
2. **Consulta** — un motor determinístico ejecuta ese intent sobre los datasets
   normalizados y devuelve filas agregadas. Ningún modelo toca un número.
3. **Composición** — un segundo modelo emite, en streaming, un spec de `json-render`
   validado contra un catálogo cerrado. Los datos entran por *data binding*
   (`{"$state": "/rows"}`), nunca como literales.

Esa separación es lo que hace que el principio "datos reales, cero alucinación" sea
estructural y no una promesa del prompt: aunque un modelo quisiera inventar un número, no
tiene por dónde emitirlo.

**Las etapas 2 y 3 no son secuenciales para el usuario.** El client tool devuelve apenas
termina la consulta —milisegundos— con todo lo que el agente necesita narrar, y dispara la
composición en segundo plano. El agente habla mientras el gráfico se dibuja.

## Technical Context

**Language/Version**: TypeScript 5.9 estricto, Node 24, React 19.2

**Primary Dependencies**:

| Área | Paquete | Versión | Por qué |
|------|---------|---------|---------|
| Framework | `next` | 16.3 | App Router, Route Handlers, streaming |
| UI | `react` / `react-dom` | 19.2 | Requisito duro de `@json-render/react` |
| UI generativa | `@json-render/core`, `@json-render/react` | 0.21 | Catálogo cerrado + `useUIStream` |
| Validación | `zod` | 4.6 | Peer de json-render; schema del catálogo |
| LLM compositor | `ai`, `@ai-sdk/openai` | 7.0 / 4.0 | `streamText` emitiendo JSONL de patches |
| Voz | `@elevenlabs/react` | 1.15 | Conversational AI, WebRTC, client tools |
| Gráficos | `recharts` | 3.10 | Motor de los componentes del catálogo |
| Animación | `motion` | 13.4 | Etapas de espera y transiciones de estado |
| Datos | `papaparse` | 5.7 | Parseo con delimitador `;` y campos multilínea |
| Estilos | `tailwindcss` | 3.4 | Consume tokens Flock, no los define |

Pares verificados: `ai@7.0.109` y `@ai-sdk/openai@4.0.72` comparten `@ai-sdk/provider@4.0.17`.

**Restricciones de API que condicionan el diseño** (verificadas contra los `.d.ts`
instalados, no asumidas — detalle en research.md D9–D13):

- `generateObject` / `streamObject` están **deprecados** en AI SDK v7. Se usa `streamText`.
  `system` pasó a `instructions`; `maxTokens` a `maxOutputTokens`; `mode` desapareció.
- `useUIStream` fija el contrato de cable: `POST` con body `{ prompt, context, currentSpec }`
  y respuesta en **JSONL crudo de JSON Patches**, no SSE.
- `useConversation` exige estar dentro de `<ConversationProvider>`; `startSession` devuelve
  `void`, no una promesa.

**Storage**: Ninguno. Dos CSV versionados en `data/`, normalizados en memoria al arrancar el
servidor y cacheados por proceso. Sin base de datos, sin persistencia de sesión.

**Testing**: Vitest para el motor de datos, la validación de specs y el merge de intents
(donde la corrección es verificable). La voz y la presentación se verifican corriendo la app.

**Target Platform**: Navegador basado en Chromium con micrófono, en un dispositivo tipo
tótem. WebRTC como transporte.

**Project Type**: Aplicación web de un solo proyecto (Next.js full-stack).

**Performance Goals**: El agente empieza a hablar en menos de 1 s desde el fin del turno
(lo habilita el retorno temprano del tool); primer píxel de gráfico < 2 s; gráfico completo
< 6 s; 60 fps en las transiciones; ningún estado visual estático > 400 ms.

**Constraints**: Las claves de OpenAI y ElevenLabs sólo del lado del servidor. Datos de
nómina agregados con k ≥ 5. Un client tool con `expects_response` bloquea la conversación
hasta `response_timeout_secs` (1–120, default 20), así que ningún tool puede esperar a un
modelo.

**Scale/Scope**: 2 dominios de datos, unos cientos de registros en total (personas de la
nómina + registros de seguimiento), ~20 dimensiones, ~13 métricas, 13 componentes en el catálogo, 5 client tools,
1 pantalla.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principio | Cómo lo satisface este plan | Estado |
|-----------|------------------------------|--------|
| I. Voz primero | Pantalla única sin selector de gráficos ni formulario. El único camino a un gráfico es un client tool del agente de voz. Los slots faltantes bloquean por diseño: el agente no llama al tool hasta tenerlos, y el servidor revalida. | PASA |
| II. Catálogo cerrado | Una única `defineCatalog` genera el prompt del compositor, la validación y el registry de render. `lib/viz/schema.ts` ejecuta los Zod del catálogo a mano, porque json-render sólo valida integridad estructural. | PASA |
| III. Datos reales | El agente emite la forma de la consulta; el motor determinístico produce las filas; el compositor sólo referencia `{"$state": "/rows"}`. **Además se descarta `spec.state` antes de renderizar**, porque el prompt de fábrica de json-render le pide al modelo inventar datos de ejemplo (D12). Las filas llegan al `StateProvider` desde el motor y de ningún otro lado. | PASA |
| IV. Design system | `tokens.css` de Flock copiado tal cual; Tailwind lo consume. La paleta de series se deriva de los tokens en un único módulo. Ningún componente del catálogo declara un prop de color. | PASA |
| V. Espera diseñada | Máquina de seis etapas con animación en loop por etapa; render progresivo vía `useUIStream`; el agente narra mientras el gráfico se dibuja (D13); `pre_tool_speech` cubre el arranque. | PASA |
| VI. Paridad de riqueza | 13 componentes contra los 6 tipos de vistaenergy, y cada gráfico exige título, ejes rotulados, leyenda, grilla, tooltip, estado vacío y formato es-AR por contrato de props. | PASA |

Una excepción acotada al principio I, documentada abajo en Complexity Tracking: el banco de
render `/preview`, que sólo existe en desarrollo.

## Project Structure

### Documentation (this feature)

```text
specs/001-voice-generative-charts/
├── plan.md              # Este archivo
├── research.md          # Fase 0: decisiones técnicas y alternativas descartadas (D1–D13)
├── data-model.md        # Fase 1: entidades, dominios, dimensiones y métricas reales
├── quickstart.md        # Fase 1: puesta en marcha
├── contracts/
│   ├── viz-intent.md    # Lo que el agente puede pedir
│   ├── viz-catalog.md   # Componentes y props del catálogo
│   ├── voice-tools.md   # Los cinco client tools
│   └── voice-session.md # Ciclo de vida de la sesión de voz
└── tasks.md             # Fase 2
```

### Source Code (repository root)

```text
elevenlabs/                      # Configuración del agente, versionada
├── agent.config.ts              # Prompt del sistema, voz, idioma, primer mensaje
├── tools/*.json                 # Una definición por tool
└── sync.ts                      # npm run setup:agent

app/
├── layout.tsx                   # Tema, tokens
├── page.tsx                     # Monta el tótem
├── globals.css                  # tokens.css de Flock + capas Tailwind
├── preview/page.tsx             # Banco de pruebas de render, sólo en desarrollo
└── api/
    ├── conversation-token/route.ts  # Token WebRTC (clave del lado servidor)
    ├── catalog/route.ts             # Resumen del catálogo, sin filas (estático)
    ├── query/route.ts               # Etapa 2: resuelve el intent y ejecuta la consulta
    └── compose/route.ts             # Etapa 3: JSONL de patches

lib/
├── data/                        # Ingesta, normalización, catálogo, consulta, privacidad
├── viz/                         # Catálogo, schema, paleta, registry, componentes
└── conversation/
    ├── stages.ts                # Máquina de seis etapas
    ├── intent.ts                # VizIntent, delta, merge, validación semántica
    ├── resolve.ts               # Parseo + merge + validación + consulta (sólo servidor)
    ├── history.ts               # Pila de intents
    ├── tools.ts                 # Los cinco handlers
    ├── answers.ts               # Respuestas exactas y resumen (/stats) del ResultSet vigente
    └── examples.ts              # Preguntas de la pantalla de reposo, sobre el catálogo real

# Los prompts no tienen módulo propio: el del agente vive en elevenlabs/agent.config.ts y el
# del compositor en lib/viz/schema.ts, cada uno junto a lo que describe.

contexts/SessionContext.tsx      # Intent vigente, ResultSet, spec, etapa, historial

components/
├── VoiceSession.tsx             # ConversationProvider, arranque y errores de la sesión
├── VoiceTools.tsx               # Registro de los cinco client tools; no renderiza
├── Totem.tsx                    # Orquestador de la pantalla
├── VoiceOrb.tsx                 # Estado de la conversación
├── StageIndicator.tsx           # Las seis etapas
├── IntentRibbon.tsx             # Lo que el agente entendió
├── SkeletonChart.tsx            # Esqueleto del gráfico que viene: el primer píxel
├── useKiosk.ts                  # Pantalla siempre encendida, cursor oculto
└── GeneratedView.tsx            # Render del spec con sus datos y el resaltado

scripts/
├── voice-bench/                 # Banco de pruebas por voz: casos, TTS, Chrome, juez
├── audit-tokens.ts              # SC-007: valores fuera del design system
└── screenshots.ts               # Capturas en los dos temas y tres tamaños

kiosk/                           # Units de systemd y política de Chrome para el tótem

data/                            # Los CSV, versionados
public/                          # Logos e isotipos de Flock
```

**Borde servidor / navegador.** Todo lo que toca el catálogo de datos corre en el servidor,
porque el catálogo se arma leyendo los CSV con `node:fs`. Eso incluye la validación semántica
del intent: el handler del client tool reenvía los parámetros crudos del agente a
`/api/query`, que los resuelve en `lib/conversation/resolve.ts`. El navegador guarda los
`VizIntent` como dato opaco y sólo importa lo que es puro: `lib/viz/*`, `lib/data/format.ts`,
`history.ts` y `answers.ts`.

**Structure Decision**: Proyecto único Next.js. No hay separación frontend/backend porque el
único trabajo de servidor son tres route handlers, y compartir los tipos del catálogo y del
motor de datos entre ambos lados es exactamente lo que hace que el principio II se sostenga:
una sola definición del catálogo, importada por el prompt, por el validador y por el
renderer.

### Decisiones de diseño que merecen justificarse

**Por qué el agente de voz produce la intención.** Un client tool recibe parámetros tipados,
y el agente de ElevenLabs es un LLM. Si el schema de `proposeVisualization` *es* el
`VizIntent`, el agente lo llena directo y se elimina una llamada entera a OpenAI. vistaenergy
necesitaba un clasificador aparte porque su agente no tenía tools y había que adivinar a qué
gráfico de un catálogo fijo se refería el usuario; nosotros no tenemos catálogo fijo ni nada
que adivinar. El tool call *es* la intención, ya estructurada.

**Por qué el modelo no compone con los datos adentro.** Sería más corto y más barato, y es el
camino de casi todas las demos de UI generativa. Se descarta porque rompe el principio III:
el modelo transcribiría agregados y tarde o temprano inventaría uno. Separando forma de
contenido, el modelo decide *qué mirar* y *cómo mostrarlo*, pero los valores entran por un
canal que no controla.

**Por qué el spec referencia datos por binding y no por valor.** `json-render` resuelve
expresiones `{"$state": "/ruta"}` (JSON Pointer) en cualquier prop, y el schema permite tipar
el prop de datos como exactamente esa referencia, en modo estricto. Eso convierte "el modelo
no debe inventar datos" en "el modelo no *puede* emitir datos". Con una salvedad importante
(D12): el prompt de fábrica de json-render pide lo contrario, así que además se descarta
`spec.state` antes de renderizar.

**Por qué el refinamiento muta el `VizIntent` y no el spec.** Un pedido como "sacá los
inactivos" es semántico, no visual. Aplicarlo sobre el `VizIntent` y regenerar deja el estado
acumulado consistente y hace trivial el "volvé atrás" (pila de intents). Editar el spec
obligaría al modelo a razonar sobre JSON de presentación y perdería la trazabilidad de qué
filtros están activos.

**Por qué Recharts y no Vega-Lite.** Decisión del usuario, y se sostiene: los tipos del
catálogo cubren el espacio de consultas de estos dos datasets, Recharts anima transiciones de
estado de fábrica (lo que el principio V exige al refinar) y toma los tokens de Flock como
props sin una capa de temas intermedia. El costo es que un gráfico exótico fuera del catálogo
no se puede expresar; si aparece esa necesidad, se agrega un componente, que es el mecanismo
previsto.

## Complexity Tracking

| Excepción | Principio | Por qué hace falta | Alternativa más simple descartada |
|-----------|-----------|--------------------|-----------------------------------|
| `/preview` dibuja gráficos sin una intención hablada | I (voz primero) | Verificar a ojo los 13 componentes del catálogo, en claro y oscuro, sin micrófono, claves ni costo de modelo. Es la referencia de lo que el compositor tiene que producir. | Probar el render sólo por voz: cada ajuste visual costaría una conversación, y un componente roto no se distinguiría de un spec mal compuesto. |

La excepción no llega al producto: `/preview` responde 404 con `NODE_ENV=production`, así que en
el tótem (que corre `next start`) no existe ningún camino a un gráfico que no pase por la voz.
