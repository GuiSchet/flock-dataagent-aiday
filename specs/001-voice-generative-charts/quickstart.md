# Quickstart

**Feature**: 001-voice-generative-charts

## Requisitos

- Node 24+ (el repo se desarrolla en v24.16)
- Un micrófono y un navegador basado en Chromium (WebRTC)
- Una cuenta de ElevenLabs con un agente de Conversational AI creado
- Una API key de OpenAI

## Puesta en marcha

```bash
npm install
cp .env.example .env.local   # completar las cuatro variables
npm run setup:agent          # sincroniza prompt y tools contra ElevenLabs
npm run dev                  # http://localhost:3000
```

## Variables de entorno

Todas son de servidor. Ninguna lleva prefijo `NEXT_PUBLIC_`: si una clave llega al cliente,
es un bug (FR-024).

| Variable | Para qué |
|----------|----------|
| `ELEVENLABS_API_KEY` | Pedir el token de conversación y sincronizar la config del agente |
| `ELEVENLABS_AGENT_ID` | El agente de voz |
| `OPENAI_API_KEY` | Componer el spec de visualización |
| `OPENAI_MODEL` | Opcional. Default `gpt-5.6-luna` (research.md D14) |
| `OPENAI_REASONING_EFFORT` | Opcional. Default: el mínimo que admite el modelo |

## Configuración del agente

El prompt del sistema y las cinco definiciones de client tool **viven en el repo**, no en el
dashboard:

```
elevenlabs/
├── agent.config.ts      prompt, voz, idioma, primer mensaje
├── tools/*.json         una definición por tool
└── sync.ts              lo que corre npm run setup:agent
```

`npm run setup:agent` crea o actualiza los tools (`POST /v1/convai/tools`) y los asocia al
agente. Es idempotente: se puede correr cuantas veces haga falta.

Sin ese paso el agente conversa pero no dibuja nada: los client tools tienen que estar
declarados en ElevenLabs *además* de registrados en el código.

Los nombres tienen que coincidir exactamente: `getDataCatalog`, `proposeVisualization`,
`refineVisualization`, `undoVisualization`, `queryCurrentChart`. El detalle de cada uno está
en `contracts/voice-tools.md`.

## Verificar que anda

Hablarle estas frases, en orden:

1. *"¿Qué me podés mostrar?"* → enumera los dos dominios con dimensiones reales.
2. *"Mostrame los clientes"* → **repregunta** por la métrica, sin dibujar nada.
3. *"La cantidad de registros por cuenta"* → barras con una por cuenta, la más grande arriba.
4. *"Quedate solo con Argentina"* → el mismo gráfico se anima al nuevo estado.
5. *"Volvé atrás"* → vuelve a todas las cuentas.
6. *"Mostrame la facturación"* → dice que no tiene ese dato y ofrece alternativas.

Si el paso 2 dibuja un gráfico en vez de repreguntar, el principio I está roto.

Si en el paso 3 el agente empieza a hablar recién cuando el gráfico ya está dibujado, el
retorno temprano del tool no está funcionando (research.md D13).

## Banco de pruebas de render

`/preview`, sólo en desarrollo (404 en producción). Muestra los componentes del catálogo con
datos reales y specs escritos a mano, para verificar el render en claro y oscuro sin depender
del micrófono ni de las claves.

## Datos

Los dos CSV viven en `data/` y se versionan. Están en **latin-1**, con delimitador `;`. El de
operaciones tiene el encabezado en la fila 3. No hay que convertirlos: la ingesta lo maneja.

Para repasar qué hay adentro: `data-model.md`.

## Comandos

```bash
npm run dev          # desarrollo con Turbopack
npm run build        # build de producción
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
npm test             # Vitest
npm run setup:agent  # sincroniza prompt, tools y límites de sesión con ElevenLabs
npm run bench:voice  # banco de pruebas por voz: 30 consultas contra el agente real
npm run audit:tokens # valores fuera del design system (SC-007)
npm run screenshots  # capturas en los dos temas y tres tamaños
npm run start:kiosk  # producción, sólo en 127.0.0.1:3000 (ver kiosk/README.md)
```

## Dónde tocar qué

| Quiero… | Archivo |
|---------|---------|
| Cambiar cómo repregunta el agente | `elevenlabs/agent.config.ts` + `npm run setup:agent` |
| Agregar o cambiar un client tool | `elevenlabs/tools/*.json` + `lib/conversation/tools.ts` |
| Agregar un tipo de gráfico | `lib/viz/catalog.ts` + `lib/viz/components/` |
| Cambiar qué dimensiones ve el agente | `lib/data/catalog.ts` |
| Ajustar cómo compone el spec | `lib/viz/schema.ts` → `buildComposePrompt()` |
| Cambiar colores de series | `lib/viz/palette.ts` (deriva de los tokens, no inventa) |
| Tocar las animaciones de espera | `components/StageIndicator.tsx` |
| Sanear una columna del CSV | `lib/data/normalize.ts` |
