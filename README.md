# Flock DataAgent

Una app web para mirar una nómina de RR.HH. desde el navegador. La portada muestra un tablero
fijo con los indicadores principales (dotación, ingresos, attrition, área, seniority,
tecnologías y motivos de egreso). Para todo lo demás, se le habla al agente: la persona pide lo
que quiere ver, y un agente de voz arma la visualización, la refina a pedido y contesta
preguntas sobre ella. No hay menús ni selector de gráficos: fuera del tablero, todo pasa por
la conversación.

Los números nunca los escribe un modelo: salen de un motor determinístico sobre la nómina, y
el spec del gráfico sólo puede referenciarlos.

**Los datos son sintéticos.** La nómina de `data/` tiene la forma de una nómina real de
Flock, pero ninguna fila es de una persona real y los clientes son inventados (ver
[Los datos](#los-datos)).

## Puesta en marcha

Requisitos: Node 24, Chrome o Chromium, un micrófono, una cuenta de ElevenLabs con un agente
creado y una API key de OpenAI.

```bash
npm install
cp .env.example .env.local   # completar las claves de ElevenLabs y OpenAI, y las del login
npm run setup:agent          # publica el prompt, los tools y los límites de sesión en ElevenLabs
npm run dev                  # http://localhost:3000: entrá con la clave, hacé clic en el micrófono y hablá
```

## El login

La app entera queda detrás de una contraseña compartida: sin sesión, cualquier página
redirige a `/login` y cualquier API devuelve 401. Así nadie de afuera ve los datos ni gasta los
créditos de OpenAI y ElevenLabs que consumen `/api/compose` y `/api/conversation-token`.

```bash
APP_PASSWORD=la-clave-que-se-comparte
AUTH_SECRET=$(openssl rand -base64 32)
```

- El chequeo vive en `proxy.ts` (la convención de Next 16 para lo que antes era middleware),
  y las rutas que gastan o devuelven datos lo repiten por su cuenta.
- La sesión es una cookie `httpOnly` firmada con HMAC-SHA256 que dura 7 días. Cambiar
  `APP_PASSWORD` o `AUTH_SECRET` cierra todas las sesiones.
- Si falta cualquiera de las dos variables, la app responde 503: nunca queda abierta por un
  error de configuración.
- No hay límite de uso por persona: quien tiene la clave puede gastar créditos.

## Los datos

`data/` tiene una nómina **sintética**: 124 personas con la misma whitelist de columnas que
usaría la de RR.HH. (área, puesto, seniority, tecnología, proyecto, región, fechas de ingreso
y egreso, motivo de egreso…). No hay nombres, correos, CUIL, domicilios, teléfonos, fechas de
nacimiento ni salarios, ni en los datos ni en el código.

```bash
npm run data:synthetic   # regenera data/ con la semilla fija: siempre los mismos archivos
```

- El generador (`scripts/generate-synthetic.ts`) reproduce las desprolijidades de una
  planilla cargada a mano: grafías distintas de una misma cuenta, tipeos en la categoría,
  "N/A", celdas vacías en los legajos de quienes ya se fueron. Así el saneamiento de
  `lib/data/normalize.ts` tiene trabajo de verdad.
- También cuenta por su lado la serie mensual de dotación, ingresos y bajas
  (`control-attrition-2023-2024.csv`). El dominio de movimientos que calcula la app tiene que
  coincidir con ella exactamente.

Si cambia el generador: `npm run data:synthetic`, `npm test` (las cifras de `tests/data`
salen de estos datos y hay que actualizarlas a propósito), `npm run setup:agent` y
`npm run build`.

## Cómo funciona

```
 persona ──voz──▶ agente de ElevenLabs ──client tool──▶ navegador
                  (entiende, repregunta,                  │
                   llena un VizIntent)                    ▼
                                                 POST /api/query
                                                 resuelve y valida el intent,
                                                 ejecuta la consulta sobre data/
                                                          │  filas + resumen + forma
                        el agente ya habla ◀──────────────┤  (milisegundos)
                        con los números reales            ▼
                                                 POST /api/compose
                                                 gpt-5.6-luna emite un spec de
                                                 json-render en streaming, que sólo
                                                 referencia {"$state": "/rows"}
                                                          │
                                                          ▼
                                     esqueleto ▶ gráfico que se arma ▶ gráfico validado
```

- **Voz primero**: fuera del tablero fijo de la portada, el único camino a un gráfico es un
  client tool del agente. Si falta algo que cambia el resultado (la métrica, el corte), el
  agente repregunta antes de dibujar.
- **Datos reales**: el compositor recibe la *forma* del resultado, nunca sus valores. Un
  `state` inventado se descarta, y un KPI sólo puede leer las filas del motor o su resumen.
- **Catálogo cerrado**: todo spec se valida contra el Zod de cada componente antes de
  llegar a la pantalla. Si falla dos veces, queda el gráfico anterior y el agente lo dice.
- **Espera diseñada**: el tool responde en milisegundos y el agente narra mientras se
  dibuja. Un esqueleto del gráfico que viene aparece en ~0,4 s.
- **Sin nombres**: se puede mirar cualquier corte, aunque sea de una persona, pero nunca aparece
  el nombre y apellido de nadie: los datos no los tienen.

El detalle está en [`specs/001-voice-generative-charts/`](specs/001-voice-generative-charts/):
la spec, el plan, las decisiones de diseño (`research.md`, D1–D16), los contratos y las
tareas. El paso a la nómina nueva, a escritorio y al repo público, en
[`specs/002-nomina-escritorio/`](specs/002-nomina-escritorio/). Las reglas no negociables, en
[`.specify/memory/constitution.md`](.specify/memory/constitution.md).

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run data:synthetic` | Regenera la nómina sintética de `data/` |
| `npm run dev` | Desarrollo, en `localhost:3000` |
| `npm test` | Tests: motor de datos, contrato del catálogo, intents, tools, juez del banco |
| `npm run typecheck && npm run lint` | Tipos y estilo |
| `npm run audit:tokens` | Colores, radios, sombras y tipografías fuera del design system (SC-007) |
| `npm run build && npm run start` | Producción |
| `npm run setup:agent` | Publica en ElevenLabs lo que vive en `elevenlabs/` |
| `npm run bench:voice` | El banco de pruebas por voz (ver abajo) |
| `npm run screenshots` | Capturas del tablero y de `/preview`, en los dos temas y cuatro tamaños de escritorio |

`/preview` es el banco de render sin voz: todos los componentes del catálogo con datos reales,
sólo en desarrollo.

## El banco de pruebas por voz

`npm run bench:voice` prueba la app de verdad, sin que nadie hable:

1. Sintetiza cada frase con el TTS de OpenAI (queda en caché).
2. Arma cada conversación como un WAV que Chrome usa de micrófono.
3. Corre la app contra el agente real de ElevenLabs.
4. Compara lo que quedó en pantalla con lo que calcula el motor.

Son conversaciones con gráficos, refinamientos encadenados, pedidos ambiguos que tienen que
repreguntar, pedidos imposibles, preguntas sobre el gráfico y privacidad. El reporte queda en
`specs/001-voice-generative-charts/bench/`, con los criterios de la spec (SC-001 a SC-009) y
la latencia de cada gráfico. No se versiona: trae los IDs y las transcripciones de las
conversaciones.

```bash
npm run dev                                   # en otra terminal (o un build de producción)
npm run bench:voice                           # todo, ~20 min
npm run bench:voice -- --case q14             # sólo la conversación de ese turno
npm run bench:voice -- --url http://127.0.0.1:3018 --dark
```

Una corrida completa son ~20 minutos de conversación en ElevenLabs y centavos de OpenAI.

## Dónde tocar qué

| Quiero… | Archivo |
|---|---|
| Cambiar cómo habla o repregunta el agente | `elevenlabs/agent.config.ts` + `npm run setup:agent` |
| Cambiar los parámetros de un tool | `lib/conversation/intent.ts` + `npm run setup:agent` |
| Cambiar qué hace un tool | `lib/conversation/tools.ts` |
| Cambiar dimensiones o métricas | `lib/data/catalog.ts` |
| Agregar una columna a los datos | `scripts/generate-synthetic.ts` (`COLUMNS`) + `npm run data:synthetic` |
| Cambiar el login | `proxy.ts`, `lib/auth/session.ts`, `app/login/` |
| Cambiar los gráficos del tablero | `lib/dashboard/tablero.ts` |
| Agregar un tipo de gráfico | `lib/viz/catalog.ts` + `lib/viz/components/` + `lib/viz/registry.tsx` |
| Ajustar la composición del spec | `lib/viz/schema.ts` (`buildComposePrompt`) |
| Cambiar el modelo del compositor | `OPENAI_MODEL` en `.env.local` (research.md D14) |
| Agregar un caso al banco | `scripts/voice-bench/cases.ts` |
