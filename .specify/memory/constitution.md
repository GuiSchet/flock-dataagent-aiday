# Flock DataAgent Constitution

Agente conversacional por voz que co-diseña visualizaciones de datos con el usuario y las
materializa como UI generativa, sobre una nómina con la forma de la de Flock (sintética en este
repo). Se usa desde el navegador de una PC, por link y detrás de un login.

## Core Principles

### I. Voz primero, sin pantalla de respaldo

La conversación hablada es la única vía para pedir una visualización. No existe formulario,
buscador ni menú de gráficos que permita al usuario saltear el diálogo. El usuario dice qué
quiere ver; el agente repregunta hasta cerrar las decisiones que faltan (métrica, dimensión de
corte, filtro, rango temporal, tipo de gráfico) y recién entonces genera.

La única excepción es el **tablero de la portada**: un conjunto fijo y curado de indicadores
de nómina, definido en código y versionado, que se ve antes de hablar. No tiene selectores,
filtros ni controles que cambien lo que muestra, y cada uno de sus gráficos sale del motor y
pasa por la misma validación que una vista hablada (principios II y III).

Corolarios no negociables:

- Fuera del tablero fijo, ningún gráfico se renderiza sin una intención hablada que lo origine.
- El agente NUNCA adivina en silencio un parámetro ambiguo que cambie el significado del
  resultado. Si falta algo material, pregunta. Si el hueco es cosmético, elige un default y lo
  enuncia en voz alta ("lo hago por región, decime si preferís por seniority").
- El refinamiento es conversacional e incremental: "ahora sacá los inactivos", "ponelo en
  barras apiladas", "sumá el promedio" operan sobre el gráfico vivo, no crean uno desde cero.

### II. UI generativa con catálogo cerrado (NO NEGOCIABLE)

Toda visualización se materializa como un spec JSON de `json-render` validado contra un
catálogo tipado. El modelo elige y parametriza componentes del catálogo; nunca emite código.

- El LLM produce exclusivamente JSON conforme al schema del catálogo. Jamás JSX, HTML, CSS,
  SQL ni JavaScript.
- Todo spec pasa por validación Zod antes de tocar el DOM. Un spec inválido se rechaza y
  degrada con gracia (se conserva el gráfico previo + el agente avisa por voz), nunca rompe la
  vista ni se renderiza a medias.
- Agregar un tipo de gráfico o un prop significa extender el catálogo y su schema. No hay
  puertas traseras de renderizado fuera del catálogo.
- El catálogo es la única fuente de verdad compartida entre el prompt del modelo, la
  validación y el runtime de render. Se deriva de una sola definición; no se duplica a mano.

### III. Datos reales, cero alucinación

El corpus es fijo y local: una nómina sintética con la forma de la de RR.HH., en un CSV
versionado. Todo número mostrado o dicho proviene de una agregación ejecutada sobre esos datos.

- El LLM define la *forma* de la consulta (métrica, agrupación, filtro, orden, límite); el
  cálculo lo ejecuta código determinístico sobre el dataset. El modelo no inventa ni transcribe
  valores en el spec.
- Un campo inexistente, un filtro sin resultados o un cruce imposible es un error explícito que
  el agente comunica y ofrece corregir, no un gráfico vacío ni datos plausibles inventados.
- Nunca se dice el nombre y apellido de una persona. No hay umbral de grupo: un corte o un
  filtro de una sola persona se muestra, porque el uso es interno y lo pidió el negocio.
- Los datos personales identificables (nombre, correo, CUIL, domicilio, teléfono, fecha de
  nacimiento) y los salariales no entran al repo: la nómina es sintética y sólo tiene una
  whitelist de columnas, así que la regla anterior es estructural y no depende del prompt.
  Ninguna fila, cifra ni nombre de cliente de los datos reales se versiona.
- La procedencia es rastreable: cada gráfico conserva qué dataset, qué filas y qué agregación lo
  produjeron, y el agente puede responderlo.

### IV. El sistema de diseño Flock es ley

Toda la UI usa exclusivamente los tokens de Flock Design System v1.1.

- Cero colores, radios, sombras o tamaños tipográficos inventados. Solo `var(--*)` de
  `tokens.css`. Esto incluye las series de los gráficos: la paleta de datos se deriva de los
  tokens de marca y se define una sola vez.
- Stack de fuente del sistema, sin web fonts. Números y tablas en `.text-mono` con
  `tabular-nums`.
- Regla de separación de capas: tarjetas y paneles sobre `--panel`, nunca sobre
  `--surface`/`--brand-softer`. Violeta sobre violeta está prohibido.
- Dark mode vía `html.dark`, con `--brand` en `#9D2BD6`. Ambos temas son ciudadanos de primera:
  lo que se construye se verifica en los dos.

### V. El tiempo de espera es parte del diseño

Generar un gráfico toma segundos. Ese intervalo se diseña, no se tolera.

- Ningún estado muerto: cada espera tiene una animación con significado que comunica en qué
  etapa está (escuchando → interpretando → consultando datos → dibujando).
- El render es progresivo: a medida que el spec llega en streaming, la UI se materializa por
  partes (primero el marco y el título, después los ejes, después las series). No se espera al
  JSON completo.
- Las transiciones entre gráficos son continuas: al refinar, los elementos que persisten se
  animan a su nuevo estado en vez de desmontarse y remontarse.
- Toda animación respeta `prefers-reduced-motion`: se degrada a fundidos breves, nunca se
  elimina el feedback de estado.

### VI. Paridad de riqueza con el estado del arte previo

Un gráfico generado nunca puede ser más pobre que los gráficos fijos de vistaenergy-dataagent,
que son la línea de base explícita.

Todo gráfico generado incluye, cuando aplica: título y subtítulo, ejes rotulados con unidades,
leyenda, grilla, tooltips con formato, formato de números localizado (es-AR), estado vacío,
y responsive por contenedor. Los tipos soportados cubren como mínimo barras (agrupadas y
apiladas), líneas (multi-serie), área, dispersión, torta/dona, combinado, KPI y tabla.

## Stack y restricciones técnicas

- **Framework**: Next.js (App Router) + TypeScript estricto. `any` requiere justificación
  escrita en el código.
- **Voz**: ElevenLabs Conversational AI (`@elevenlabs/react`), con client tools como puente
  entre la conversación y el estado de la app.
- **Generación de specs**: OpenAI vía Vercel AI SDK, con `streamText` emitiendo JSONL de
  JSON Patches contra el schema del catálogo (`streamObject` está deprecado en AI SDK v7; ver
  research.md D11). La API key vive solo en el servidor; jamás llega al cliente.
- **UI generativa**: `@json-render/core` + `@json-render/react`.
- **Gráficos**: Recharts envuelto en componentes propios, registrados en el catálogo
  (`lib/viz/components/`) y estilados con Tailwind sobre los tokens de Flock. No se usa
  shadcn/ui: sus primitivas traen su propia paleta, y acá el color de cada serie sale de un solo
  módulo derivado de los tokens.
- **Datos**: `npm run data:synthetic` genera, con una semilla fija, el CSV versionado en
  `data/`, que se normaliza en build o en el arranque del servidor. Sin base de datos en esta
  instancia.
- **Acceso**: toda la app, páginas y APIs, queda detrás de un login con contraseña compartida
  (`proxy.ts`). Si falta su configuración, la app no responde: nunca queda abierta.
- **Estilos**: Tailwind mapeado a los tokens de Flock. Tailwind no define la paleta; la consume.

## Flujo de trabajo

- El proyecto se gestiona con Spec Kit. Toda funcionalidad atraviesa
  `/speckit-specify` → `/speckit-plan` → `/speckit-tasks` → `/speckit-implement`.
- Las tareas se agrupan por user story y cada story se entrega funcionando de punta a punta.
  Nada de "el backend anda pero no se ve".
- Antes de dar algo por terminado se verifica en la app corriendo, no solo en el código: voz
  real, gráfico real, en light y dark.
- Los secretos van en `.env.local`, nunca al repo. `.env.example` documenta cada variable.

## Governance

Esta constitución tiene precedencia sobre cualquier otra práctica o preferencia de estilo.

- Todo plan y toda revisión verifica cumplimiento explícito de los seis principios.
- Una violación es admisible solo si se documenta en la sección Complexity Tracking del plan,
  con la alternativa más simple que se descartó y por qué.
- Las enmiendas se documentan acá con versión y fecha. Cambios que rompen un principio son
  MAJOR; agregar un principio o expandir materialmente uno existente es MINOR; aclaraciones de
  redacción son PATCH.
- La guía operativa día a día vive en `CLAUDE.md`, que no puede contradecir este documento.

**Version**: 3.1.0 | **Ratified**: 2026-09-22 | **Last Amended**: 2026-10-09

- 1.0.1 (2026-09-23, PATCH): el stack nombra `streamText` en lugar de `streamObject`, que AI
  SDK v7 deprecó. No cambia ningún principio.
- 1.0.2 (2026-09-24, PATCH): el stack describe los componentes de gráficos como propios sobre
  Tailwind; decía shadcn/ui, que nunca se usó. No cambia ningún principio.
- 2.0.0 (2026-09-24, MAJOR): el principio I admite una excepción, el tablero fijo de la portada.
  El producto pasa de tótem a app web de escritorio, y la fuente de datos, de dos CSV al Excel
  de nómina importado a un CSV saneado; se deja el seguimiento de clientes. El principio III
  suma que un filtro por debajo del umbral no devuelve números y que los datos personales y
  salariales no entran al repo.
- 3.0.0 (2026-09-24, MAJOR): el principio III deja el k-anonimato. No hay umbral de grupo; lo
  que se mantiene es que nunca aparece el nombre y apellido de nadie, y que los datos
  personales y salariales no entran al repo.
- 3.1.0 (2026-10-09, MINOR): la fuente pasa a ser una nómina sintética generada en el repo,
  para poder publicarlo, y toda la app queda detrás de un login. Los principios no cambian:
  el III gana que ningún dato real se versiona.
