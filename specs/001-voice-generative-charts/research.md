# Phase 0 — Investigación y decisiones

**Feature**: 001-voice-generative-charts | **Date**: 2026-09-22

Todo lo de acá está verificado contra los paquetes publicados y contra los CSV reales, no
asumido.

## D1 — Cómo se garantiza que el modelo no invente números

**Decisión**: tubería de tres etapas. El LLM emite `VizIntent` (etapa 1) y el spec de
presentación (etapa 3); un motor determinístico ejecuta la agregación (etapa 2). El spec
referencia los datos con la expresión `{"$state": "/rows"}` (JSON Pointer, que es la sintaxis
real de json-render 0.21), y el schema Zod del catálogo tipa los props de datos como
*referencias*, no como arrays.

**Por qué**: convierte una instrucción de prompt ("no inventes datos") en una imposibilidad
estructural. El modelo no tiene un campo donde escribir un número de dato aunque quisiera.

**Alternativas descartadas**:

- *Una sola llamada que emita el spec con los datos embebidos.* Más simple y más barato, y es
  lo que hacen casi todas las demos de UI generativa. Rechazada: viola el principio III. Con
  cientos de filas, el modelo transcribiría agregados y el error sería invisible hasta que
  alguien contara a mano.
- *Tool calling con function calling clásico devolviendo datos al modelo.* El modelo vuelve a
  ver los números y puede re-emitirlos alterados al componer. Mismo problema, un paso más
  tarde.
- *Generar SQL y correrlo sobre DuckDB-WASM.* Elegante y expresivo, pero mete un motor entero
  en el bundle para 329 filas, y abre superficie de inyección. Desproporcionado.

## D2 — Recharts como motor del catálogo

**Decisión**: 8 componentes de gráfico sobre Recharts 3.10, registrados en el catálogo de
`json-render`.

**Por qué**: decisión del usuario, y se sostiene técnicamente. Recharts anima transiciones de
estado de fábrica (`isAnimationActive`, interpolación de `data`), que es justo lo que el
principio V pide para el refinamiento hablado. Toma colores y tipografías como props, así que
los tokens de Flock entran sin capa de temas intermedia. Peer dep compatible con React 19.

**Costo aceptado**: los dos gráficos nativos de `json-render` (`BarGraph`, `LineGraph`) no se
usan; son demasiado pobres para el principio VI. Se reemplazan por componentes propios.

**Alternativa descartada**: Vega-Lite (lo que usa vistaenergy). Más expresivo —facetas, capas,
regresiones, binning— pero ~400 kB adicionales, y las transiciones entre specs son remontajes,
no animaciones de estado. Para estos dos datasets, la expresividad extra no se usaría.

## D3 — El refinamiento opera sobre el intent, no sobre el spec

**Decisión**: "sacá los inactivos" produce un `VizIntent` nuevo por merge sobre el anterior, y
se regenera la tubería completa. El historial es una pila de `VizIntent`.

**Por qué**: los pedidos de refinamiento son semánticos ("solo Argentina", "abrilo por género")
más que visuales. Sobre el intent, el estado acumulado queda explícito y consistente, el "volvé
atrás" es un `pop`, y el subtítulo del gráfico puede enumerar los filtros activos porque están
en una estructura, no enterrados en JSON de presentación.

**Alternativa descartada**: parchear el spec con JSON Patch. Menos tokens por turno, pero el
modelo tendría que razonar sobre árboles de presentación para expresar un cambio de filtro, y
se pierde la trazabilidad de qué está filtrado.

## D4 — Versiones del stack (verificadas contra el registry)

| Paquete | Versión | Restricción relevante |
|---------|---------|------------------------|
| `@json-render/core` | 0.21.0 | peer `zod@^4.0.0` |
| `@json-render/react` | 0.21.0 | peer `react@^19.2.3` |
| `next` | 16.3.5 | acepta React 19 |
| `react` | 19.2.x | impuesto por json-render |
| `zod` | 4.6.5 | impuesto por json-render |
| `ai` | 7.0.109 | peer `zod@^4.1.8` |
| `@ai-sdk/openai` | 4.0.72 | comparte `@ai-sdk/provider@4.0.17` con `ai@7` |
| `recharts` | 3.10.1 | peer React 19 OK |
| `@elevenlabs/react` | 1.15.2 | peer `react>=16.8` |
| `motion` | 13.4.0 | peer React 19 OK |
| `papaparse` | 5.7.0 | delimitador y campos multilínea |

**Consecuencia**: no se puede portar el `package.json` de vistaenergy tal cual. Ese proyecto
está en React 18, y `@json-render/react` exige 19. El salto arrastra Next 16 y zod 4.

**Riesgo asumido**: `@json-render/core` está en 0.21, o sea pre-1.0. La API puede romper entre
minors. Se mitiga fijando versión exacta (sin `^`) y aislando todo contacto con la librería en
`lib/viz/`, de modo que una migración toque un solo directorio.

## D5 — Puente entre la voz y la app

**Decisión**: ElevenLabs Conversational AI con *client tools*, siguiendo el patrón ya probado
en vistaenergy (`ConvAIWrapper` + contexto de React), pero con tools de dominio distinto.

Tools expuestos: `getDataCatalog`, `proposeVisualization`, `refineVisualization`,
`undoVisualization`, `queryCurrentChart`. El detalle está en `contracts/voice-tools.md`.

**Por qué**: es el mecanismo por el cual el agente de voz actúa sobre la app en vez de solo
narrarla. La repregunta vive en el prompt del agente, no en un tool: el agente solo llama a
`proposeVisualization` cuando ya resolvió los slots materiales.

**Alternativa descartada**: transcribir la voz y mandarla a un endpoint propio de
interpretación. Duplica el razonamiento conversacional que ElevenLabs ya hace y agrega latencia
en el peor momento.

## D6 — Etapas de espera

**Decisión**: máquina de estados de seis etapas —`idle`, `listening`, `interpreting`,
`querying`, `composing`, `rendering`— cada una con su animación, más render progresivo del spec
en streaming.

**Por qué**: el principio V exige que la espera comunique *en qué* está el sistema. Una barra
indeterminada no distingue "no te entendí todavía" de "estoy dibujando". Con seis etapas, el
usuario sabe si conviene esperar o reformular.

**Detalle de implementación**: `composing` y `rendering` se solapan a propósito —el esqueleto
del gráfico aparece con el primer fragmento del spec y se va completando. El umbral de 400 ms
del SC-005 se cubre con animaciones en loop dentro de cada etapa, no solo con cambios de etapa.

## D7 — Saneamiento de los CSV

Verificado parseando ambos archivos con un parser real (el corte por `;` engaña: hay campos
multilínea entrecomillados).

**Decisiones de ingesta**:

- Ambos archivos están en **latin-1**, no UTF-8, con delimitador `;`.
- Operaciones tiene **dos filas de preámbulo**: el encabezado está en la fila 3. Algunas filas
  traen únicamente una `Fecha actualización` y ninguna otra celda; se descartan por `Cuenta`
  vacía.
- Nómina tiene un encabezado con **salto de línea dentro de un campo entrecomillado**
  (`"AMBA 0 \nfuera de AMBA 1"`), y cientos de filas vacías al final que se descartan.
- Fechas `dd/mm/aaaa`; decimales con **coma** (`5,3`).
- `País` se normaliza: "Argenitna" → "Argentina".
- `Región` trae decenas de variantes para pocas zonas reales ("CABA", "AMBA", "GBA, <localidad>",
  "Buenos Aires"…). Se normaliza a un puñado de zonas y se conserva el valor
  crudo para trazabilidad.
- `NPS` mezcla dos cosas en una columna: valores numéricos y estados de medición ("En curso",
  un trimestre planificado, "No implementado aun", "Realizado el …"). Se parte en dos campos:
  `nps` numérico y `nps_estado` categórico. Muy pocos registros traen puntaje.

**Hallazgo bloqueante**: `Estado con cliente` llega como `??` en todas las filas donde tiene
contenido. Era un semáforo de emoji que el export a latin-1 destruyó. La columna es
irrecuperable desde este archivo. Se marca como no disponible en el catálogo y el agente lo
explica si se la piden. **Recuperarla requiere reexportar el CSV en UTF-8 desde la fuente** —
queda fuera del alcance de esta feature.

## D8 — Privacidad sobre la nómina

**Decisión**: k-anonimato con **k = 5**. Las columnas `Correo corporativo`, `Apellido`,
`Nombre`, `Fecha de Nacimiento`, `CUIL`, `Dirección`, `Teléfono` y `Emergencia` no se exponen
como dimensiones ni métricas: el motor las descarta en la ingesta, así que no hay forma de
pedirlas.

Los grupos por debajo de k se agrupan en "Otros"; si "Otros" queda por debajo de k, absorbe la
siguiente categoría más chica hasta alcanzarlo.

**Por qué**: el dataset original tiene, por persona, domicilio, teléfono, CUIL y contacto de
emergencia. Un gráfico "personas por región" sin supresión identifica individuos en las
regiones con una o dos personas.

**Consecuencia conocida y aceptada**: la categoría `Sexo = N` tiene una sola persona y quedará
agrupada. Es el comportamiento correcto; el agente lo explica como supresión por privacidad, no
como ausencia del dato.

---

# Fase 0 bis — Investigación de la capa de voz

**Fecha**: 2026-09-22 (tarde). Todo lo de acá sale de leer los `.d.ts` y el JS compilado de
los paquetes **instalados**, no de documentación ni de memoria. Donde una versión anterior de
este documento o del plan decía otra cosa, manda esto.

## D9 — El agente de voz produce la intención: se cae una llamada al LLM

**Decisión**: el schema de parámetros del client tool `proposeVisualization` **es** el
`VizIntent`. El agente de ElevenLabs lo llena directo. No hay una llamada aparte a OpenAI
para interpretar lo hablado, ni `app/api/intent/route.ts`.

**Por qué**: un client tool recibe parámetros tipados (JSON Schema estándar, verificado en
`POST /v1/convai/tools`), y el agente es un LLM. Pedirle a otro modelo que vuelva a
interpretar la misma frase es trabajo duplicado: más latencia, más costo y un punto de falla
más, a cambio de nada.

**De dónde venía la idea contraria**: vistaenergy tiene un clasificador de intenciones entero
(`services/openaiIntentRecognition.ts`, `components/NavigationOrchestrator.tsx`,
`app/api/intent-recognition/route.ts`) que corre un segundo LLM sobre la transcripción del
usuario. Existe porque su agente **no tiene tools**: hay que adivinar a qué gráfico de un
catálogo fijo se refería la frase y mapearlo a un id de plantilla, con dos diccionarios de
sinónimos hardcodeados que se pueden desincronizar entre sí. Nada de eso aplica cuando no hay
catálogo fijo y el agente puede actuar sobre la app.

**Alternativa descartada**: mantener la etapa 1 como llamada propia para "controlar mejor el
prompt". El control se ejerce igual desde el prompt del agente y desde la validación
semántica del servidor, que es la que realmente garantiza algo.

**Consecuencia**: `OPENAI_API_KEY` sigue haciendo falta, pero sólo para componer el spec.

## D10 — `@elevenlabs/react` 1.15.2 rompe con el patrón de vistaenergy

**Decisión**: no portar el código de voz de vistaenergy. Se reescribe contra la API 1.15.2.

vistaenergy corre 0.5.1. Las diferencias no son cosméticas:

| 0.5.x | 1.15.2 |
|---|---|
| `useConversation()` suelto | **`<ConversationProvider>` obligatorio**; sin él, lanza |
| `await startSession()` → `Promise<string>` | `startSession()` → **`void`**, fire-and-forget |
| `micMuted` / `toggleMute` en el retorno | `isMuted` / `setMuted`; `micMuted` es prop de entrada |
| Sólo WebSocket con `signedUrl` | `conversationToken` + `connectionType: "webrtc"` |
| `status` de tres valores | agrega **`"error"`** y un campo `message` |
| Ref + `registerXxx` a mano para los tools | **`useConversationClientTool(name, handler)`** oficial |

El último borra una capa entera. `clientTools` se congela al iniciar la sesión, así que un
handler declarado ahí queda con el closure viejo; vistaenergy lo esquiva con una ref, un
contexto aparte (`ChartToolsContext`) y un componente que re-registra en un efecto
(`ChartToolsConnector.tsx`). El SDK nuevo trae un hook que registra en mount, desregistra en
unmount y siempre ve el estado fresco. Toda esa gimnasia desaparece.

**Transporte elegido**: WebRTC con `conversationToken` desde
`GET /v1/convai/conversation/token?agent_id=…`. Menor latencia y mejor recuperación ante red
inestable que el WebSocket con signed URL, que es lo que usa vistaenergy.

**También descartado de vistaenergy**: el redirect a `/` apenas `status` vuelve a
`disconnected` (`ConvAI.tsx:41-46`) — una caída de red expulsa al usuario de la página; los
tres `alert()` bloqueantes; y el `MediaStream` de prueba de permisos que nunca se cierra con
`track.stop()`, que deja el indicador de micrófono prendido.

**Rescatable**: pedir el permiso de micrófono *antes* de pedir el token (no se quema un
token si el usuario deniega), y el mute vía el SDK en vez de manosear los `MediaStreamTrack`.

## D11 — `streamObject` está deprecado; `useUIStream` fija el formato de cable

**Decisión**: el compositor usa `streamText` y emite **JSONL de JSON Patches**; el cliente lo
consume con `useUIStream`.

**Por qué**: en AI SDK v7, `generateObject` y `streamObject` están marcados `@deprecated` a
favor de `generateText`/`streamText` con `output`. Además `system` pasó a `instructions`,
`maxTokens` a `maxOutputTokens`, y `mode` desapareció.

Del otro lado, `useUIStream` resuelve todo el streaming cliente-servidor —aplicación
incremental de patches, render progresivo, cancelación automática del envío anterior— pero
impone el contrato: sólo acepta `api`, hace `POST` con el body exacto
`{ prompt, context, currentSpec }`, y espera JSONL crudo separado por `\n`, no SSE.

Nos sirve igual porque `context` es libre: ahí van el intent, las columnas del `ResultSet` y
las advertencias. Y nos regala el render progresivo que pide FR-010 y el aborto del stream en
curso que pide el barge-in.

`catalog.prompt({ mode: "standalone" })` es lo que instruye al modelo a emitir exactamente
ese JSONL, sin prosa.

**Alternativa descartada**: la ruta nativa del AI SDK (`pipeJsonRender` sobre
`toUIMessageStream()` + `useChat` + `useJsonRenderMessage`). Es más idiomática para un chat,
pero acá no hay chat: el disparador es un tool call, no un mensaje de usuario. Traía una
abstracción de conversación que no usamos.

**Plan B si `useUIStream` estorba**: `createSpecStreamCompiler` del core, que consume el
mismo formato de cable. Son unas cuarenta líneas y el servidor no cambia.

## D12 — El prompt de fábrica de json-render pide inventar datos

**Hallazgo**: `catalog.prompt()` incluye, entre sus reglas base:

> *"When the user asks for a UI that displays data, ALWAYS include a state field with
> realistic sample data."*

Es exactamente lo que el principio III prohíbe, y viene de la librería, contradiciendo
nuestras `customRules`.

**Decisión**: defensa en dos capas.

1. Una regla explícita en `customRules` que la anule, en mayúsculas y sin ambigüedad.
2. **Descartar `spec.state` antes de renderizar.** Las filas llegan al `StateProvider` desde
   el motor determinístico y de ningún otro lado. Aunque el modelo emita parches sobre
   `/state`, no llegan a la pantalla.

La segunda es la que realmente cuenta: la primera depende de que el modelo obedezca, la
segunda no depende de nadie. Es la misma lógica que llevó a que los props de datos sean
referencias y no arrays.

## D13 — Un client tool no puede esperar a un modelo

**Hallazgo**: `expects_response: true` bloquea la conversación hasta que el tool responde,
con `response_timeout_secs` entre 1 y 120 (default 20).

**Decisión**: `proposeVisualization` devuelve **apenas termina la consulta determinística** y
dispara la composición del spec en segundo plano, sin esperarla.

**Por qué es también el mejor diseño**: la consulta tarda milisegundos y ya produce todo lo
que el agente necesita para narrar —cuántas filas, el máximo, las advertencias de cobertura,
los supuestos que se tomaron—. Si el tool esperara al compositor, el agente se quedaría mudo
varios segundos mirando una pantalla que ya podría estar dibujándose.

Devolviendo temprano, el agente dice "son seis regiones, CABA arriba" *mientras* las
barras aparecen. El principio V pide exactamente eso de los intervalos de espera, y acá sale
como consecuencia de una restricción, no como esfuerzo extra.

**Se fija `response_timeout_secs` explícito por tool** en vez de depender del default.

**Bonus del mismo endpoint**: `pre_tool_speech` permite que el agente diga algo al empezar la
llamada al tool, lo que cubre el arranque de la espera sin código propio.

## D14 — El compositor: gpt-5.6-luna sin razonamiento

**Hallazgo 1 — el razonamiento es espera pura.** Componer el spec no pide razonar: pide seguir
un catálogo. Medido sobre el prompt real (~5.000 tokens), tiempo hasta el primer token:

| Modelo | Esfuerzo por defecto | Esfuerzo mínimo |
|--------|----------------------|-----------------|
| gpt-5 | 41,6 s | 1,5 s (`minimal`) |
| gpt-5.6-luna | 4,3 s | 1,1 s (`none`) |

**Hallazgo 2 — elegir por la tarea, no por el ranking.** Mismos casos (barras, apiladas, KPI,
línea, dona, filtro), con el mínimo esfuerzo que admite cada modelo:

| Modelo | Specs válidos | Primer píxel | Total | Costo por gráfico |
|--------|---------------|--------------|-------|-------------------|
| **gpt-5.6-luna** (`none`) | 9/10 | 1,2–2,1 s | 2,0–4,2 s | ~US$ 0,002 |
| gpt-6-luna (`low`, su mínimo) | 10/10 | 2,2–2,7 s | 3,5–4,1 s | ~US$ 0,001 |
| gpt-5.4 (`none`) | 8/8 | 1,2–2,4 s | 2,1–4,5 s | ~US$ 0,03 |
| gpt-5.4-mini (`none`) | 2/4 | 1,1–1,9 s | 2,5–5,2 s | — |
| gpt-5.4-nano (`none`) | 0/4 | — | — | — |

**Decisión**: `gpt-5.6-luna` con `reasoningEffort: "none"` y `textVerbosity: "low"`. Es el
único que cumple SC-004 (primer píxel < 2 s, completo < 6 s) con margen y cuesta ~15 veces
menos que gpt-5.4. gpt-6-luna es más confiable pero no se puede apagar el razonamiento y
pierde el objetivo de latencia. Los nano y mini de 5.4 inventan datos o se olvidan props.
`OPENAI_MODEL` y `OPENAI_REASONING_EFFORT` lo cambian sin tocar código; si falta el
segundo, la ruta usa el mínimo que admite la familia del modelo.

**Hallazgo 3 — dos bugs que parecían del modelo.**

- *El stream se congelaba.* El `ReadableStream` de `/api/compose` volvía de `pull()` sin
  encolar nada cuando el SDK emitía una parte que no era texto; el stream no volvía a llamar
  a `pull()` y el lector quedaba esperando. Una composición de 3 s tardaba minutos. `pull()`
  ahora avanza hasta encontrar texto, error o fin.
- *Todos los specs fallaban el primer intento, con cualquier modelo.* El prompt de json-render
  presenta un prop `.nullable()` como opcional (`subtitle?: string`), el modelo lo omite, y la
  validación estricta lo exigía. Ahora un nullable omitido vale `null` antes de validar.

**Hallazgo 4 — un `state` emitido es inerte.** El único prop que lee estado es `data`, y sólo
admite exactamente `{"$state": "/rows"}`, que llena el motor. Un `state` inventado por el modelo
no tiene cómo llegar a pantalla, y además se descarta antes de renderizar. Rechazar el spec
por eso costaba un reintento entero sin proteger nada más. **Decisión**: se descarta y queda
como advertencia en consola; sólo se suma a los problemas si el spec falla por otra cosa y se
va a reintentar igual. La regla del prompt que lo prohíbe se mantiene.

## D15 — Tótem local, sin texto libre, y avisos de fallo por voz

Decisiones del 2026-09-23, al pasar del MVP al producto.

**Despliegue sólo local.** La app corre en la misma máquina del tótem (`next start -H
127.0.0.1`) y Chrome la abre en modo kiosco. Al escuchar sólo en loopback, las rutas que
cuestan plata (`/api/conversation-token`, `/api/compose`) no quedan expuestas ni en la red
local, así que no hace falta autenticarlas ni ponerles rate limit. Si algún día se hostea,
eso pasa a ser obligatorio.

**Texto libre afuera (T062 descartada).** `Hightlights` y `Action item` responderían
preguntas de "¿por qué?", pero pueden nombrar personas o clientes. La redacción automática
nunca es perfecta, y SC-009 pide cero datos individuales. El agente sigue hablando sólo de
agregados.

**Una interrupción no cancela la composición (T047).** Un "ajá" encima del agente no aborta
nada; la cancela un pedido nuevo, porque el tool nuevo vuelve a llamar a `send()`. Detalle en
contracts/voice-session.md.

**Los fallos de composición se avisan con un mensaje, no con un contextual update.**
Verificado en vivo interceptando `/api/compose`: con `sendContextualUpdate` el agente decía
"listo, ahora ves sólo Argentina" frente al gráfico anterior y nunca corregía. Con un
`sendUserMessage` marcado como `[aviso de la app, no lo dijo la persona]` dijo "el gráfico
filtrado por Argentina no se pudo dibujar y quedó el anterior". El prompt del agente tiene una
regla para esos avisos.

**"Volvé atrás" sin nada atrás dice que el gráfico sigue.** Con sólo `{status: "at_start"}` el
agente contestaba "no hay ningún gráfico en pantalla", con el gráfico delante. La respuesta
ahora lo dice explícitamente.

## D16 — Un prompt propio para el compositor

**El síntoma.** En la prueba manual, el log mostraba avisos de `[componer]` en casi cada
consulta: el spec traía un `state` con datos de ejemplo. No eran errores, porque ese `state` se
descarta antes de dibujar (D14, hallazgo 4). Pero costaban tiempo: esas composiciones tardaban
4,5 y 6,4 s, contra 2,9 y 3,4 s de las demás.

**La causa.** `catalog.prompt()` de json-render le pide ese `state` al modelo en siete lugares:
el formato de salida, el ejemplo, la sección INITIAL STATE ("You MUST include state patches…",
"Include realistic sample data"), una regla base y dos reglas del esquema de React. Del otro
lado había una sola regla nuestra, que decía "ANULA CUALQUIER REGLA ANTERIOR". El modelo
obedecía a la mayoría.

**Decisión.** `buildComposePrompt()` arma su propio prompt. Contiene la introducción, un
formato de salida sin `/state` y un ejemplo con nuestros componentes (`COMPOSE_EXAMPLE`, que un
test valida contra el catálogo). Suma la sección AVAILABLE COMPONENTS, extraída del prompt de
fábrica para que los componentes sigan saliendo del catálogo (principio II). Después van las
instrucciones de parches de `buildEditInstructions`, así los refinamientos siguen emitiendo
sólo lo que cambia, y al final nuestras reglas. Si una versión nueva de json-render cambia el
nombre de la sección, `extractSection` lanza un error y los tests fallan: el prompt nunca se
degrada en silencio.

**Medido** sobre 8 pedidos reales por `/api/compose`:

| | Specs con `state` | Promedio | Máximo |
|---|---|---|---|
| Prompt de fábrica | 6/8 | 3,9 s | — |
| Prompt propio | 0/8 | 3,1 s | 3,6 s |

Los refinamientos siguen saliendo como 2 o 3 parches `replace` válidos, en 1,8 a 2,4 s.
`stripModelState` queda como red de seguridad, y su aviso pasa a `console.info`.
