# Tasks: Agente de voz que co-diseña visualizaciones

**Input**: Design documents from `/specs/001-voice-generative-charts/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: se incluyen tests acotados al motor de datos y a la validación de specs. No es TDD
completo: se testea donde la corrección es verificable contra los CSV (SC-002 exige que todo
número sea reproducible contando a mano) y donde una regresión sería silenciosa. La UI y la voz
se verifican corriendo la app.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: puede correr en paralelo (archivos distintos, sin dependencias)
- **[Story]**: a qué user story pertenece
- **`[x]`** hecha · **`[~]`** parcial · **`[!]`** superada por una revisión del plan

---

## Phase 1: Setup

**Purpose**: repo funcionando con el stack verificado en research.md D4.

- [x] T001 Inicializar Next.js 16 + React 19.2 + TypeScript estricto en la raíz del repo, con
      App Router y Turbopack. `tsconfig.json` con `strict: true` y `noUncheckedIndexedAccess`.
- [x] T002 Instalar dependencias con las versiones de research.md D4. Fijar
      `@json-render/core` y `@json-render/react` **sin caret** (están en 0.21, pre-1.0).
- [x] T003 [P] Configurar ESLint + Prettier, y los scripts `dev`, `build`, `lint`, `typecheck`,
      `test` en `package.json`.
- [x] T004 [P] Copiar los CSV de Flock a `data/` y los SVG de marca a `public/`.
- [x] T005 [P] Crear `.env.example` con las cuatro variables de quickstart.md y `.gitignore`
      con `.env.local`, `node_modules`, `.next`.
- [x] T006 [P] Escribir `CLAUDE.md` en la raíz con la guía operativa del repo, subordinada a
      `.specify/memory/constitution.md`. Se cierra con T093.

---

## Phase 2: Foundational (bloquea todas las user stories)

**Purpose**: los cimientos que toda story usa. Sin esto no arranca nada.

**⚠️ Ninguna user story puede empezar hasta que esta fase esté completa.**

### Sistema de diseño

- [x] T007 Copiar `tokens.css` de Flock a `app/globals.css` dentro de `:root` y `html.dark`,
      con `.text-mono` y `.stat-card-hero`. Sin modificar ningún valor.
- [x] T008 Configurar `tailwind.config.ts` para **consumir** los tokens vía `var(--*)`: la
      paleta de Tailwind se mapea a los tokens, no los redefine. Escala de espaciado base-4 y
      escala de radios 8/9/12/16/18/20.
- [x] T009 [P] `lib/viz/palette.ts`: paleta de series derivada de `--brand`, `--brand-2`,
      `--brand-dark`, `--accent` y los colores de estado. Asignación por índice de serie.
      Única fuente de color de datos en todo el proyecto.
- [x] T010 [P] `components/FlockMark.tsx` y el shell de `app/layout.tsx` con el toggle de tema
      claro/oscuro vía `html.dark`.

### Motor de datos

- [x] T011 `lib/data/ingest.ts`: parseo con papaparse — decodificar **latin-1**, delimitador
      `;`, campos multilínea entrecomillados, fila de encabezado configurable por archivo
      (nómina = 1, operaciones = 3), descarte de filas vacías.
- [x] T012 `lib/data/normalize.ts`: fechas `dd/mm/aaaa`, decimales con coma, `País`
      (tipeos → país canónico), `Región` (decenas de variantes → CABA / GBA / Buenos Aires /
      Interior / Exterior / Sin dato), partir `NPS` en `nps` numérico + `nps_estado`
      categórico, derivar `mes_ingreso`, `mes_egreso`, `rango_edad`, `rango_antiguedad`.
- [x] T013 `lib/data/privacy.ts`: descartar en la ingesta las 9 columnas PII de la nómina
      (data-model.md). k-anonimato con k=5: grupos chicos a "Otros"; si "Otros" queda bajo k,
      absorbe la siguiente categoría más chica. Registrar qué se suprimió.
- [x] T014 `lib/data/catalog.ts`: los dos dominios con sus dimensiones, métricas, cardinalidad,
      cobertura y columnas no disponibles con motivo. Es la fuente de verdad que ven el agente
      y el validador.
- [x] T015 `lib/data/query.ts`: motor determinístico que ejecuta un `VizIntent` — filtros,
      group-by de hasta 2 dimensiones, las 13 métricas de data-model.md, orden, top-N con
      "Otros" para alta cardinalidad. Devuelve `ResultSet` con `provenance`.
- [x] T016 [P] `lib/data/format.ts`: formato es-AR — miles con `.`, decimal con `,`, fechas
      `dd/mm/aaaa`, meses en español, porcentajes.
- [x] T017 [P] Tests del motor de datos en `tests/data/`: verificar contra los CSV que el
      headcount activo, el total de la nómina, los registros de clientes por cuenta y por razón
      principal coinciden con un conteo a mano, y que el k-anonimato agrupa `Sexo = N`.
- [x] T018 [P] Test de ingesta: que `Estado con cliente` se reporte como no disponible y que
      ninguna columna PII sobreviva a la normalización.

### Catálogo de visualización

- [x] T019 `lib/viz/catalog.ts`: `defineCatalog` con los contenedores, los 6 gráficos y los 4
      componentes de display de contracts/viz-catalog.md. `data` tipado como
      `z.object({ $state: z.literal('/rows') })` — sin prop de color en ningún componente.
- [x] T020 `lib/viz/schema.ts`: derivar del catálogo el schema Zod que usan `streamObject`, la
      validación de servidor y el registry. Una sola derivación, sin duplicar a mano.
- [x] T021 [P] Test de contrato: que un spec con un array de datos literal en `props.data` sea
      rechazado, y que un spec con un color en props no valide.

### Intención y conversación

- [x] T022 `lib/conversation/intent.ts`: `VizIntent`, `VizIntentDelta` y las reglas de merge de
      contracts/viz-intent.md. Validación semántica contra el catálogo de datos (las 8 reglas).
- [x] T023 `lib/conversation/history.ts`: pila de intents con `push`, `pop` y estado `at_start`.
- [x] T024 [P] Test de merge: que `filters` se acumule por campo, que `value: null` remueva un
      filtro, y que una cadena de 5 refinamientos conserve el estado acumulado (SC-006).

### Conexión de voz

- [!] T025 SUPERADA por la revisión del plan (research.md D10). El transporte pasó a WebRTC:
      en vez de `app/api/signed-url/route.ts` con una signed URL, va
      `app/api/conversation-token/route.ts` con un token efímero. Y el patrón de vistaenergy
      no se porta: su SDK es 0.5.1 y el nuestro 1.15.2, que rompe en cinco puntos.
      Reemplazada por las tareas de convergencia.
- [!] T026 SUPERADA por T077 y T088. Estaba escrita contra la API 0.5.x: en 1.15.2 el
      estado se lee con los hooks granulares y los tools se registran con
      `useConversationClientTool`. Original: `contexts/ConversationContext.tsx` +
      `components/ConvAIWrapper.tsx` con `useConversation`.
- [x] T027 `lib/conversation/stages.ts`: máquina de estados de 6 etapas (`idle`, `listening`,
      `interpreting`, `querying`, `composing`, `rendering`) con transiciones tipadas.

**Checkpoint**: datos normalizados y consultables, catálogo cerrado validando, voz conectada.

---

## Phase 3: User Story 1 — De una frase hablada a un gráfico completo (P1) 🎯 MVP

**Goal**: hablar una frase y obtener un gráfico completo sobre datos reales, con repregunta
cuando falte algo material.

**Independent Test**: decirle una frase ambigua, verificar que repregunte; luego una completa,
verificar que genere y que los números se reproduzcan contando sobre el CSV.

- [!] T028 [US1] SUPERADA (research.md D9). No hay prompt de etapa 1 porque no hay etapa 1:
      el agente de ElevenLabs emite el `VizIntent` directo, ya que el schema de parámetros
      de `proposeVisualization` ES el contrato. El prompt que sí hace falta es el del agente,
      y vive versionado en `elevenlabs/agent.config.ts`.
- [!] T029 [US1] SUPERADA (research.md D9). El endpoint no existe: se elimina la llamada a
      OpenAI para interpretar lo hablado. Además `generateObject` está deprecado en AI SDK v7.
      La repregunta vive en el prompt del agente; la validación semántica queda como red de
      seguridad en `lib/conversation/intent.ts`.
- [!] T030 [US1] SUPERADA en su forma (research.md D11). `streamObject` está deprecado y
      `useUIStream` impone JSONL de JSON Patches, no un objeto. La composición vive en
      `app/api/compose/route.ts` con `streamText`; el prompt ya está en `lib/viz/schema.ts`.
- [!] T031 [US1] SUPERADA (research.md D13). Las etapas 2 y 3 se separan en dos endpoints,
      porque el client tool tiene que devolver antes de que el compositor termine: `query`
      responde en milisegundos y `compose` streamea aparte.
- [x] T032 [US1] `lib/conversation/tools.ts`: implementar `proposeVisualization` según
      contracts/voice-tools.md. Van dos respuestas, `rendered` y `error`: `needs_input` se
      cayó con D9, porque la repregunta vive en el prompt del agente. Se implementa junto con
      los otros cuatro handlers en T088.
- [x] T033 [P] [US1] `lib/viz/components/ChartFrame.tsx`: marco común — título, subtítulo,
      procedencia al pie, estado vacío, contenedor responsive. Todo gráfico lo usa.
- [x] T034 [P] [US1] `lib/viz/components/BarChart.tsx` sobre Recharts: vertical/horizontal,
      simple/agrupada/apilada, ejes rotulados, grilla, leyenda, tooltip formateado, valores
      opcionales sobre las barras.
- [x] T035 [P] [US1] `lib/viz/components/LineChart.tsx`: multi-serie, curva lineal o monotone,
      puntos opcionales, área opcional.
- [x] T036 [P] [US1] `lib/viz/components/KpiTile.tsx`: variante normal y `hero` con
      `.stat-card-hero`, delta opcional, números en `.text-mono`.
- [x] T037 [US1] `components/GeneratedView.tsx`: montar el spec con el renderer de
      `@json-render/react`, inyectando el `ResultSet` como `state.rows`.
- [x] T038 [US1] `components/Totem.tsx` y `app/page.tsx` — cáscara lista (orbe,
      etapas, área de visualización, sin selector de gráficos); falta conectar la voz. Se
      cierra con T090.
      Original:: la pantalla única — orbe de voz,
      indicador de etapa y área de visualización. **Sin ningún selector de gráficos.**
- [x] T039 [US1] Manejo de fallo de validación del spec: conservar el gráfico previo, avisar
      por voz, reintentar una vez con el error en el prompt (contracts/viz-catalog.md).
- [x] T040 [US1] Consulta imposible: cuando el intent referencia un campo o métrica inexistente,
      devolver `error` con la alternativa más cercana en vez de generar (FR-011, edge case).

**Checkpoint**: MVP demostrable. Se habla, se repregunta, se dibuja, los números son reales.

---

## Phase 4: User Story 2 — Refinamiento hablado sobre el gráfico vivo (P1)

**Goal**: encadenar pedidos hablados que transforman el gráfico existente conservando el estado.

**Independent Test**: generar un base y encadenar 5 refinamientos, verificando que ninguno
resetee los filtros previos y que la transición sea animada.

- [!] T041 [US2] SUPERADA (research.md D9). No hay `lib/conversation/prompt.ts`: el delta lo
      arma el propio agente, guiado por la descripción de `refineVisualization` en
      `elevenlabs/tools.ts` y por su prompt en `elevenlabs/agent.config.ts`. El merge lo
      hace `mergeIntent` del lado servidor (T094).
- [x] T042 [US2] `refineVisualization` en `lib/conversation/tools.ts` (vía T088): merge,
      apilado, regeneración y `changed[]` para que el agente confirme en voz qué cambió.
- [x] T043 [US2] `undoVisualization` en `lib/conversation/tools.ts` (vía T088), con la
      respuesta `at_start` cuando la pila tiene un solo elemento.
- [x] T044 [US2] Transiciones de estado en el render: reusar la instancia del gráfico cuando el
      tipo no cambia, para que Recharts interpole `data` en vez de remontar.
- [x] T045 [US2] Transición entre tipos de gráfico distintos con `motion`: crossfade con
      continuidad de layout, no desmontaje seco.
- [x] T046 [US2] Subtítulo dinámico que enumera los filtros activos a partir del `VizIntent`
      (no del spec), para que el usuario vea el estado acumulado.
- [x] T047 [P] [US2] Cancelación (resuelta en D15: la cancela un pedido nuevo, no un barge-in suelto): si el usuario habla durante una generación, abortar el stream
      en curso y atender la nueva intención (edge case).

**Checkpoint**: la conversación tiene memoria y el artefacto es continuo.

---

## Phase 5: User Story 3 — La espera como parte de la experiencia (P2)

**Goal**: que ningún intervalo de generación sea un estado muerto.

**Independent Test**: forzar latencia de varios segundos y verificar que las etapas se sucedan
de forma legible y que nada quede estático más de 400 ms.

- [x] T048 [US3] `components/StageIndicator.tsx`: una animación por etapa con `motion`, en loop
      dentro de cada etapa (no solo en las transiciones), con la etiqueta de qué está pasando.
- [x] T049 [P] [US3] `components/VoiceOrb.tsx`: orbe de marca que reacciona a `listening` y a
      `isSpeaking`, con el gradiente de Flock.
- [x] T050 [P] [US3] `components/SkeletonChart.tsx`: esqueleto que se completa por partes —
      marco y título primero, luego ejes, luego series.
- [x] T051 [US3] Render progresivo real: consumir el spec parcial de `useUIStream().spec`
      mientras llegan los patches y montar los elementos ya disponibles, dejando los
      incompletos como esqueleto (FR-010). Reescrita: `streamObject` está deprecado (D11).
- [x] T052 [US3] Entrada escalonada de las series al completarse el gráfico, con la animación
      nativa de Recharts coordinada con `motion`.
- [x] T053 [P] [US3] Soporte de `prefers-reduced-motion` — ya cubierto en globals.css y
      en `usePrefersReducedMotion`; falta aplicarlo a las animaciones de etapa.
      Original: en todo el sistema de animación:
      degradar a fundidos breves conservando el feedback de etapa (FR-022).
- [x] T054 [US3] Verificar SC-004 y SC-005 con latencia instrumentada: primer píxel < 2 s,
      completo < 6 s, ningún estado estático > 400 ms.

**Checkpoint**: la espera comunica y el gráfico se materializa, no aparece.

---

## Phase 6: User Story 4 — Explorar el corpus sin saber qué hay (P2)

**Goal**: que alguien que no sabe qué datos existen pueda arrancar.

- [x] T055 [US4] `getDataCatalog` en `lib/conversation/tools.ts` (vía T088, sobre T095):
      devolver dominios, dimensiones, métricas con cobertura y columnas no disponibles con su
      motivo.
- [x] T056 [US4] Reglas de sugerencia en el prompt: proponer 3-4 preguntas concretas y
      contestables, derivadas del catálogo real, no inventadas.
- [x] T057 [US4] Aceptación de sugerencia por referencia hablada ("esa", "la segunda") sin
      repreguntar.
- [x] T058 [P] [US4] Pantalla de reposo animada con ejemplos rotativos de lo que se puede pedir,
      construidos desde el catálogo.
- [x] T059 [US4] Respuesta específica para `Estado con cliente`: explicar que el dato se perdió
      en la exportación y ofrecer `razon_principal` como aproximación.

---

## Phase 7: User Story 5 — Interrogar el gráfico en pantalla (P3)

**Goal**: preguntarle al gráfico y obtener respuestas exactas, no estimaciones visuales.

- [x] T060 [US5] `queryCurrentChart` en `lib/conversation/tools.ts` (vía T088, sobre T092):
      responder desde el `ResultSet` vigente, con `answerable: false` cuando la respuesta no
      está en los datos.
- [x] T061 [US5] Resaltado del elemento mencionado en el gráfico, coordinado con la respuesta
      hablada.
- [!] T062 [US5] DESCARTADA por privacidad (D15, SC-009). Acceso del agente a los campos de texto libre (`Hightlights`, `Action item`)
      como contexto narrativo para preguntas de "¿por qué?", sin nombrar personas.
- [x] T063 [P] [US5] `lib/viz/components/DataTable.tsx` y `Provenance.tsx`, para responder
      "mostrame los números" y "¿de dónde sale esto?".

---

## Phase 8: Completar el catálogo y pulido

- [x] T064 [P] `lib/viz/components/AreaChart.tsx` — apilada y con opacidad.
- [x] T065 [P] `lib/viz/components/PieChart.tsx` — torta y dona, con porcentajes.
- [x] T066 [P] `lib/viz/components/ScatterChart.tsx` — con tamaño opcional y línea de tendencia.
- [x] T067 [P] `lib/viz/components/ComposedChart.tsx` — barras + línea con eje derecho.
- [x] T068 [P] `lib/viz/components/Callout.tsx` — advertencias de cobertura baja y de supresión
      por privacidad.
- [x] T069 Estados de error de punta a punta: micrófono denegado, sin conexión de voz, filtro
      sin resultados, silencio prolongado (edge cases de spec.md).
- [x] T070 Auditoría de SC-007: buscar en todo el código cualquier hex, rem o sombra fuera de
      los tokens. Debe dar cero.
- [x] T071 Verificación en tema claro y oscuro de toda la interfaz, comprobando la regla de
      separación de capas (SC-008). Ningún panel sobre un fondo del mismo tinte.
- [x] T072 Pasar el banco de 25 consultas habladas de SC-002 y SC-003, registrando resultados.
- [x] T073 [P] `README.md` con la puesta en marcha y la arquitectura de tres etapas.

---

## Dependencias

```
Setup (T001-T006)
   ↓
Foundational (T007-T027)  ← bloquea todo lo demás
   ↓
US1 (T028-T040) 🎯 MVP ────┬─→ US2 (T041-T047)
                           ├─→ US3 (T048-T054)
                           ├─→ US4 (T055-T059)
                           └─→ US5 (T060-T063)
                                   ↓
                           Pulido (T064-T073)
```

US2 a US5 dependen de US1 pero son independientes entre sí: se pueden hacer en paralelo o
entregar de a una.

## Estado al 2026-09-24

**La spec está cumplida y medida.** El banco de pruebas por voz (`npm run bench:voice`, 29
turnos en 14 conversaciones contra el agente real) da, en su última corrida completa
(`bench/2026-09-24-2224.md`, más la repetición de c11 en `bench/2026-09-24-2238-c11.md`):

| Criterio | Meta | Resultado |
|----------|------|-----------|
| SC-002 | ≥ 80 % de turnos correctos | 29/29 (28 en la corrida completa, más q22 corregido en c11) |
| SC-002 | 0 números que no salen del motor | 0 |
| SC-003 | 100 % de repregunta ante ambigüedad | 3/3 |
| SC-004 | primer píxel p95 < 2 s | 0,7 s (era 2,4 s antes del esqueleto) |
| SC-004 | gráfico completo p95 < 6 s | 4,7 s |
| SC-006 | 5 refinamientos sin perder estado | 6/6 |
| SC-007 | 0 valores fuera del design system | 0 (`npm run audit:tokens`) |
| SC-009 | 0 nombres de personas | 0 |

- **q22 del banco estaba mal armado.** "Haceme un gráfico" venía justo después de preguntar
  por quién se fue, y en ese contexto no es ambiguo: el agente dibujó los egresos y lo
  anunció. Se movió al principio de su conversación, donde sí es ambiguo, y repregunta.
- **Verificado corriendo la app**: el reset entre personas (el agente corta tras 45 s de
  silencio y la pantalla vuelve al reposo), elegir una sugerencia diciendo "la segunda", el
  resaltado de la categoría nombrada, reduced motion (anillo fijo y riel quieto), y capturas
  en los dos temas a 1920×1080, 1080×1920 y 1280×800 (`npm run screenshots`).
- **Falta la máquina del tótem** (`[~]`): instalar `kiosk/` en el equipo real (T101) y ver
  allí el Wake Lock, el cursor oculto y la reconexión automática ante una caída de red
  (T103). Están implementados; acá no hay forma de cortar la red a mitad de sesión.
- **Mejora pendiente conocida**: con KPI más gráfico, a 757 px de alto útil la vista queda
  desplazable. A 1080 px entra completa. Lo mismo pasa con las tarjetas de la vista inicial
  (T109) a 1280×800: el área central se desplaza y el orbe queda siempre a la vista.

### Cierre de `/speckit-analyze`

Se corrigieron los hallazgos del análisis de consistencia:

- **Spec**: el filtro sin resultados es un error explícito (C1, principio III); el silencio
  prolongado corta la sesión y vuelve a cero (I1, D15); FR-011 queda como garantía del sistema
  y FR-023 acota el aviso por voz a cuando la voz sigue disponible (A1, A2); se corrigió el
  conteo de proyectos (I4); la intención ya no modela "lo que falta" (U1).
- **data-model.md**: métricas y dimensiones regeneradas desde `lib/data/catalog.ts` (I2).
- **Constitución 1.0.2**: el stack describe componentes propios en vez de shadcn/ui (I3).
- **plan.md**: `/preview` documentado en Complexity Tracking (M1).
- **Contrato de tools**: `at_start` con mensaje, `now` al refinar, procedencia y resaltado en
  `queryCurrentChart` (D1). Duplicados de tareas anotados (D2).
- **Código**: cada gráfico dibujado le devuelve al agente su procedencia exacta, filtros
  incluidos, y `queryCurrentChart` también (G1, FR-016). El prompt prohíbe inventar causas.
- **Banco**: mide SC-001 (primer gráfico desde que se abre la sesión) y SC-005 (tramo más
  largo sin movimiento durante una generación), y suma dos casos: procedencia (q29) y "¿por
  qué?" (q30) (G2–G4).

Verificado con la conversación c01 del banco: SC-001 en 37,1 s (preguntando primero qué hay),
SC-005 en 0 ms quieto, y q30 sin inventar una causa. **Falta verificar en la prueba manual** la
respuesta a "¿de dónde salen estos datos?" con un filtro activo: la procedencia en la respuesta
de cada gráfico se agregó después de esa corrida.

## Estado al 2026-09-22

Completo: Fase 1 (setup), Fase 2 salvo la conexión de voz, y los doce componentes del
catálogo con su registry y su renderer. 72 tests en verde, typecheck y lint limpios, build
de producción OK, y render verificado a ojo en claro y oscuro con Playwright.

Lo que falta es la mitad conversacional: `app/api/*`, el prompt, los client tools de
ElevenLabs y el cableado del tótem (T022–T026, T028–T032, y de ahí en adelante). Nada de
eso se puede probar sin `OPENAI_API_KEY` y `ELEVENLABS_API_KEY`.

Banco de pruebas de render en `/preview`, sólo en desarrollo.

### Hallazgos que cambiaron el plan

- **json-render no valida props.** `catalog.validate()` y `catalog.zodSchema()` sólo miran
  integridad estructural: un gráfico sin `xLabel`, con un prop `color` inventado o con
  `data` como array literal pasa las dos. Por eso `lib/viz/schema.ts` ejecuta los Zod del
  catálogo a mano, en modo estricto. Sin eso, el principio II era una sugerencia.
- **El `Renderer` exige `VisibilityProvider` y `ActionProvider`** aunque el catálogo no
  declare acciones ni los specs usen condiciones `visible`.
- **k-anonimato sobre el tiempo destruía la serie.** Plegar meses en "Otros" dejaba un
  pico final que no era ningún momento. Se reemplazó por generalización temporal
  (mes → trimestre → año) más fusión de períodos contiguos en rangos.
- **La paleta de datos tiene siete colores, no más.** Es cuanto da el design system sin
  inventar; el catálogo limita las series a ese número.

## Estrategia de entrega

1. **Setup + Foundational + US1** → demo que se sostiene sola. Es el corte mínimo con valor.
2. **+ US2** → deja de ser un generador de un solo tiro y se vuelve una conversación.
3. **+ US3** → deja de sentirse lenta.
4. **+ US4** → alguien que nunca la vio puede arrancar solo.
5. **+ US5 + pulido** → completa.

---

## Phase 9: Convergence

**Generada por `/speckit-converge` el 2026-09-22**, después de refrescar el plan con la
arquitectura verificada de la capa de voz. Sólo contiene trabajo que ninguna tarea abierta
cubre: las tareas T022–T024, T032, T039–T047, T050–T062 y T069–T073 siguen vigentes tal cual.

Las tareas marcadas `[!]` más arriba (T025, T028, T029, T030, T031) quedan reemplazadas por
las de acá.

### Violaciones de la constitución — primero

- [x] T074 **CRITICAL** Descartar `spec.state` en `components/GeneratedView.tsx` antes de
      pasar el spec al `Renderer`. El prompt de fábrica de json-render le pide al modelo
      incluir datos de ejemplo en `/state`, y sin este filtro llegarían a pantalla números
      inventados. Las filas entran al `StateProvider` desde el motor determinístico y de
      ningún otro lado. per Constitution III, research.md D12 (missing)
- [x] T075 **CRITICAL** Montar la sesión de voz: sin ninguna vía hablada, las cinco user
      stories son inalcanzables y el principio I no se cumple. per Constitution I, FR-001
      (missing)

### Conexión

- [x] T076 `app/api/conversation-token/route.ts`: `GET /v1/convai/conversation/token` con
      `xi-api-key`, `export const dynamic = "force-dynamic"` y `Cache-Control: no-store` —
      un token cacheado es un token quemado. per plan: transporte WebRTC (missing)
- [x] T077 `components/VoiceSession.tsx`: `<ConversationProvider connectionType="webrtc">`
      con los callbacks, y lectura de estado con los hooks granulares
      (`useConversationStatus`, `useConversationMode`, `useConversationInput`) en vez de
      `useConversation`, que re-renderiza ante cualquier cambio. Supera el diseño de T026,
      escrito contra la API 0.5.x. per plan: `@elevenlabs/react` 1.15.2 (contradicts)
- [x] T078 Permiso de micrófono **antes** de pedir el token, cerrando el stream de prueba
      con `track.stop()` en todos los tracks, y estado explícito en pantalla si lo deniegan.
      per contracts/voice-session.md (missing)
- [x] T079 No navegar a otro lado cuando la sesión cae: mostrar el error con reintento y
      conservar el gráfico. per contracts/voice-session.md, FR-023 (missing)

### Configuración del agente, versionada

- [x] T080 `elevenlabs/agent.config.ts` con el prompt del sistema (reglas de repregunta de
      FR-003, registro rioplatense, prohibición de decir números que no vengan de un tool) y
      `elevenlabs/tools/*.json` con las cinco definiciones. per plan: config versionada
      (missing)
- [x] T081 `elevenlabs/sync.ts` + script `setup:agent`: `POST /v1/convai/tools` con
      `tool_config` y asociación al agente. Idempotente. per plan: config versionada
      (missing)
- [x] T082 Fijar `response_timeout_secs` explícito por tool en vez de depender del default
      de 20 s, y `pre_tool_speech` en `proposeVisualization`. per research.md D13 (partial)
- [x] T083 **Spike, antes de escribir los handlers**: verificar que el agente llena bien el
      array de objetos de `filters`. Si no, aplanar a un string JSON y parsear del lado del
      cliente. Es el riesgo número uno del diseño. per research.md D9 (missing)

### Tubería

- [x] T084 `app/api/query/route.ts` envolviendo `runQuery`, con `QueryError` traducido a una
      respuesta que el agente pueda decir en voz. per plan: etapa 2 separada (missing)
- [x] T085 `app/api/compose/route.ts`: `streamText` con `instructions` (no `system`, que está
      deprecado), `buildUserPrompt({ prompt, currentSpec, state })`, `abortSignal: req.signal`
      → `createTextStreamResponse`. Acepta el body que impone `useUIStream`:
      `{ prompt, context, currentSpec }`. per plan: etapa 3, research.md D11 (missing)
- [x] T086 Agregar `mode: "standalone"` a `buildComposePrompt()` en `lib/viz/schema.ts` para
      que el modelo emita JSONL de patches sin prosa, más una regla explícita que **anule**
      la regla de fábrica que pide datos de ejemplo en `/state`. per Constitution III,
      research.md D12 (partial)
- [x] T087 `contexts/SessionContext.tsx`: intent vigente, `ResultSet`, spec, etapa e
      historial, con `useUIStream({ api: "/api/compose" })` adentro y validación del spec en
      `onComplete` vía `validateVizSpec`. per plan: estado de sesión (missing)
- [x] T088 Registrar los cinco tools con `useConversationClientTool(name, handler)` desde un
      componente dentro del provider y del contexto de sesión. Reemplaza el truco de ref +
      `registerXxx` de vistaenergy, que la API 1.15.2 ya no necesita. per plan:
      `@elevenlabs/react` 1.15.2 (missing)
- [x] T089 Retorno temprano de `proposeVisualization` y `refineVisualization`: responden
      apenas termina la consulta determinística y disparan la composición del spec sin
      esperarla, para que el agente narre mientras el gráfico se dibuja. per research.md D13,
      Constitution V (missing)

### Pantalla

- [x] T090 `components/Totem.tsx` como orquestador, con `app/page.tsx` reducido a montarlo.
      Completa T038, que dejó la cáscara sin conversación. per US1 (partial)
- [x] T091 `components/IntentRibbon.tsx`: una línea con lo que el agente entendió —métrica,
      corte y filtros activos— derivada del `VizIntent`, no de la transcripción. per decisión
      de producto: mostrar lo entendido, no lo dicho (missing)
- [x] T092 `lib/conversation/answers.ts`: máximo, mínimo, total, promedio y valor puntual
      sobre el `ResultSet` vigente, devueltos **ya formateados en es-AR** para que el agente
      los lea en vez de hacer aritmética. per US5, FR-011 (missing)

### Higiene

- [x] T093 `CLAUDE.md` propio con la guía operativa del repo, subordinado a la constitución.
      El actual es el que genera `next dev` y sólo incluye `@AGENTS.md`. Completa T006. per
      T006 (contradicts)

### Agregadas en el cierre del 2026-09-23

Al cablear el navegador apareció un borde que el plan no contemplaba: `lib/conversation/intent.ts`
importa el catálogo de datos, que lee los CSV con `node:fs`. `validateIntent`, `describeIntent`
y `getCatalogSummary` no pueden correr en el navegador, y el contrato de los tools suponía que
el handler validaba del lado cliente.

- [x] T094 `lib/conversation/resolve.ts`: `resolveVisualization({ mode, params, base })` hace
      en el servidor el parseo Zod, la normalización o el merge, la validación semántica, la
      consulta y la descripción, y devuelve el `VizIntent`, el `ResultSet`, la línea del
      `IntentRibbon`, `changed[]`, las advertencias y la forma del resultado para el
      compositor. `app/api/query/route.ts` pasa a llamarla. El cliente guarda los intents como
      dato opaco. per Constitution III, contracts/voice-tools.md (missing)
- [x] T095 `app/api/catalog/route.ts`: `GET` con `getCatalogSummary()`, estático, para que
      `getDataCatalog` y la pantalla de reposo lean el catálogo sin tocar `fs`. per FR-013
      (missing)

### Agregadas en el plan de producto del 2026-09-23

- [x] T096 Aviso por voz cuando la composición falla del todo: `sendUserMessage` marcado como
      aviso de la app, más la regla en el prompt del agente. Verificado interceptando
      `/api/compose`. per Constitution II, D15
- [x] T097 `undoVisualization` en `at_start` dice que el gráfico sigue en pantalla. per D15
- [x] T098 **Corrección** — `summary` determinístico (total si es sumable, máximo, mínimo,
      cantidad, promedio) en `/summary` del estado. `KpiTile` puede atarse a `/rows` o a
      `/summary`, y la validación rechaza un KpiTile sobre `/rows` cuando hay más de una fila.
      Hoy un "Total" sobre un gráfico de barras mostraría la primera fila. per FR-009,
      Constitution III
- [x] T099 Banco de pruebas por voz automatizado (`npm run bench:voice`): TTS cacheado, WAV
      como micrófono, Chrome por CDP, reporte en `bench/<fecha>.md` con pasa/falla y
      latencias. Números esperados calculados con `resolveVisualization`. Incluye casos de
      falla por intercepción de red. Cubre T072 y T054. per SC-002–SC-006, SC-009
- [x] T100 Instrumentación de latencia: fin de turno → primer spec montable → completo, una
      línea `[latencia]` por gráfico. per SC-004, T054. Misma tarea que T054, que queda cerrada con esta.
- [~] T101 `kiosk/`: units de systemd (`next start -H 127.0.0.1`, Chrome `--kiosk`), política
      `AudioCaptureAllowedUrls` y README de instalación y actualización. per D15
- [x] T102 Reset entre personas: tras N s sin actividad, cerrar la sesión y vaciar vista,
      pila y ribbon; vuelve el reposo. per edge case "silencio prolongado", SC-009
- [~] T103 Tótem resistente: Screen Wake Lock, cursor oculto en inactividad y reconexión con
      backoff. per FR-023
- [x] T104 Límites de costo en `elevenlabs/sync.ts`: duración máxima de la conversación y
      corte por silencio. per D15
- [x] T105 `npm run audit:tokens`, y los tres `#fff` pasan a `--text-on-brand` (valor del
      design system §5, en el bloque aparte de globals.css). per SC-007. Cierra T070.
- [x] T106 Capturas automáticas de `/preview` y del tótem en los dos temas, a 1920×1080,
      1080×1920 y 1280×800. per SC-008. Cierra T071.

### Agregadas tras la prueba manual del 2026-09-24

- [x] T107 Prompt propio del compositor en `buildComposePrompt()`: de json-render sólo se toman
      la sección de componentes y las instrucciones de parches. El `state` inventado bajó de 6/8
      specs a 0/8, y la composición promedio de 3,9 a 3,1 s. El aviso de consola pasa a
      `console.info`. per Constitution III, D16
- [x] T108 `dataOverview()` en `lib/data/overview.ts`: cifras, período, cortes y medidas de cada
      dominio, calculados por el motor y el catálogo. Lo que no hay, sin los campos personales.
      per FR-013, Constitution III
- [x] T109 Vista inicial: franja de marca con el isotipo blanco, "Flock DataAgent", un ejemplo
      rotativo y una tarjeta por dominio con lo que se puede pedir, más la línea de privacidad.
      per US4, SC-008
- [x] T110 Modo conversación: barra con el logo, el nombre y "Terminar". Tocarla corta la voz,
      borra la vista y vuelve al inicio, sin confirmación. `stop()` cancela además un arranque o
      una reconexión en curso. per SC-009

