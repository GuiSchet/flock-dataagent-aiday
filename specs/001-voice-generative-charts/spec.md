# Feature Specification: Agente de voz que co-diseña visualizaciones

**Feature Branch**: `001-voice-generative-charts`

**Created**: 2026-09-22

**Status**: Draft

**Input**: User description: "Agente conversacional por voz para Flock que, en vez de mostrar gráficos fijos, conversa con el usuario hasta terminar de definir qué quiere visualizar y va creando los gráficos de manera hablada, con UI generativa sobre los CSV de Flock, con animaciones que cubran los tiempos de generación."

## Resumen

El usuario habla. El agente entiende qué quiere ver, detecta qué falta para poder dibujarlo,
repregunta lo imprescindible y genera un gráfico completo sobre datos reales de Flock. Después
el usuario sigue hablando y el gráfico se transforma: cambia el corte, se filtra, cambia de
tipo, se agrega una serie. No hay catálogo de gráficos predefinidos ni pantalla de armado
manual: la visualización nace y evoluciona en la conversación.

Esto invierte el modelo de vistaenergy-dataagent, donde el usuario elegía un tema de una rueda
y luego un gráfico de una lista cerrada, y el agente solo lo narraba.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - De una frase hablada a un gráfico completo (Priority: P1)

Una persona de Flock se para frente a la pantalla y dice "mostrame cómo viene la dotación".
El agente responde por voz que puede mostrarlo de varias formas y pregunta lo mínimo necesario
para desambiguar ("¿te interesa la foto de hoy o la evolución de ingresos y egresos?"). La
persona contesta "la evolución". El agente confirma en voz alta lo que va a hacer, y mientras
lo genera la pantalla muestra una animación que refleja en qué etapa está. Aparece un gráfico
de líneas con altas y bajas por mes, ejes rotulados, leyenda, tooltips y totales, construido
sobre los registros reales de la nómina.

**Why this priority**: Es el núcleo de la propuesta. Sin esto no hay producto; con solo esto ya
hay una demo que se sostiene sola.

**Independent Test**: Se prueba de punta a punta hablándole a la app una sola frase ambigua y
verificando que (a) repregunte, (b) genere, (c) el gráfico muestre números que coinciden con un
conteo manual sobre el CSV.

**Acceptance Scenarios**:

1. **Given** la app conectada y sin gráfico en pantalla, **When** el usuario dice "mostrame la
   dotación por región", **Then** el agente genera un gráfico de barras de headcount activo por
   región normalizada, con título, eje Y rotulado "Personas", valores que suman la dotación activa, y lo
   describe por voz.
2. **Given** una consulta ambigua como "mostrame los clientes", **When** el agente la procesa,
   **Then** repregunta por voz cuál es la métrica de interés antes de generar nada, y no
   aparece ningún gráfico en pantalla hasta que la ambigüedad se resuelve.
3. **Given** una consulta que solo omite un detalle cosmético, **When** el agente genera,
   **Then** elige un default razonable, lo enuncia en voz alta ("lo ordeno de mayor a menor") y
   no bloquea la generación con una repregunta.
4. **Given** una consulta sobre datos que no existen ("mostrame la facturación por cliente"),
   **When** el agente la procesa, **Then** dice por voz qué datos sí tiene disponibles y
   propone la alternativa más cercana, sin inventar un gráfico.

---

### User Story 2 - Refinamiento hablado sobre el gráfico vivo (Priority: P1)

Con un gráfico en pantalla, la persona sigue hablando: "sacá los que ya no están", "ponelo
apilado por género", "mostralo como torta", "ordenalo de mayor a menor", "quedate solo con
Argentina". Cada pedido transforma el gráfico existente con una transición animada — las barras
se reordenan, se recolorean, se subdividen — en vez de desaparecer y volver a aparecer.

**Why this priority**: Es lo que diferencia esto de un generador de gráficos de un solo tiro.
La conversación tiene memoria y el artefacto es continuo. Sin esto, cada frase arranca de cero
y la experiencia se siente un buscador, no un diálogo.

**Independent Test**: Se genera un gráfico base y se encadenan cinco refinamientos hablados,
verificando que cada uno parte del estado anterior (no resetea filtros previos) y que la
transición es animada.

**Acceptance Scenarios**:

1. **Given** un gráfico de headcount por región, **When** el usuario dice "solo los activos",
   **Then** el mismo gráfico se actualiza con el filtro aplicado, el subtítulo refleja el
   filtro activo, y las barras se animan a su nueva altura.
2. **Given** un gráfico ya filtrado por activos, **When** el usuario dice "ahora abrilo por
   género", **Then** el filtro de activos se conserva y se agrega la dimensión de color.
3. **Given** un gráfico de barras, **When** el usuario dice "mostralo como torta", **Then**
   cambia el tipo conservando métrica, dimensión y filtros.
4. **Given** cualquier gráfico, **When** el usuario dice "volvé atrás", **Then** se restaura el
   estado inmediatamente anterior.

---

### User Story 3 - La espera como parte de la experiencia (Priority: P2)

Entre que la persona termina de hablar y el gráfico está dibujado pasan varios segundos. Ese
tiempo no es una pantalla congelada ni un spinner genérico: la interfaz comunica en qué etapa
está el sistema (escuchando, interpretando, consultando los datos, dibujando) con una animación
de marca, y el gráfico se materializa progresivamente a medida que llega el spec —primero el
marco y el título, luego los ejes, luego las series entrando escalonadas.

**Why this priority**: El usuario lo pidió explícitamente y es lo que define si la demo se
siente viva o rota. Depende de que P1 exista, pero es independiente de P2 en implementación.

**Independent Test**: Se fuerza una latencia artificial de varios segundos y se verifica que en
ningún momento haya un estado visual muerto y que las etapas se sucedan de forma legible.

**Acceptance Scenarios**:

1. **Given** el usuario terminó de hablar, **When** el sistema procesa, **Then** la pantalla
   muestra la etapa actual con una animación de marca y nunca queda estática más de 400 ms.
2. **Given** el spec llega en streaming, **When** llega parcialmente, **Then** la UI renderiza
   lo que ya está disponible en vez de esperar al JSON completo.
3. **Given** el usuario tiene `prefers-reduced-motion` activo, **When** ocurre cualquier
   transición, **Then** se degrada a fundidos breves conservando el feedback de estado.

---

### User Story 4 - Explorar el corpus sin saber qué hay (Priority: P2)

La persona no sabe qué datos existen. Pregunta "¿qué me podés mostrar?" y el agente describe
por voz los dos dominios disponibles (nómina y seguimiento de clientes), enumera las
dimensiones y métricas reales de cada uno, y propone tres o cuatro preguntas concretas que
puede responder. Si la persona elige una, se genera.

**Why this priority**: Sin esto el usuario se queda mudo frente al tótem. Es el arranque en
frío de toda demo.

**Independent Test**: Se abre la app y se pregunta "¿qué datos tenés?", verificando que lo
enumerado coincide exactamente con las columnas utilizables del corpus.

**Acceptance Scenarios**:

1. **Given** la app recién conectada, **When** el usuario pregunta qué puede ver, **Then** el
   agente enumera dominios, dimensiones y métricas que existen de verdad en los CSV.
2. **Given** el usuario acepta una sugerencia diciendo "esa, la segunda", **Then** se genera
   ese gráfico sin repreguntar.

---

### User Story 5 - Interrogar el gráfico en pantalla (Priority: P3)

Con un gráfico visible, la persona pregunta "¿cuál es el más alto?", "¿cuánto da el total?",
"¿de dónde salen estos datos?". El agente responde por voz usando los datos exactos que
alimentan ese gráfico, no una estimación visual, y resalta el elemento mencionado. Lo que los
datos no dicen —"¿por qué cayó en marzo?"— lo dice así, en vez de inventar una razón.

**Why this priority**: Enriquece mucho la demo pero el producto se sostiene sin esto.

**Acceptance Scenarios**:

1. **Given** un gráfico con series, **When** el usuario pregunta por el máximo, **Then** el
   agente responde con el valor y la etiqueta exactos y ese elemento se resalta visualmente.
2. **Given** una pregunta cuya respuesta no está en los datos del gráfico, **Then** el agente
   lo dice en vez de especular.

### Edge Cases

- **Consulta imposible sobre datos inexistentes** (facturación, costos, horas): el agente
  enumera lo que sí hay y propone lo más cercano. No genera un gráfico vacío.
- **Filtro que deja cero filas**: no se dibuja nada. Es un error explícito (principio III): el
  agente dice que ningún registro cumple con los filtros, enumera cuáles están activos y ofrece
  sacar o cambiar alguno. El gráfico anterior queda en pantalla.
- **Grupo demasiado chico para mostrar**: las categorías por debajo del umbral de k-anonimato
  se agrupan en "Otros" en vez de exponer individuos identificables.
- **Columna inutilizable**: `Estado con cliente` llega 100% como `??` por pérdida de
  caracteres en el export. El agente no la ofrece como dimensión y, si se la piden, explica que
  no está disponible.
- **Valores sucios**: `País` trae tipeos; `Región` trae decenas de variantes para lo que son
  pocas zonas reales; `NPS` mezcla números con estados ("En curso", un trimestre planificado) y
  muy pocos registros traen puntaje. El sistema normaliza, y el agente explica qué normalizó y advierte
  cuando una métrica tiene cobertura baja.
- **El spec generado es inválido**: se conserva el gráfico previo, el agente avisa por voz y
  reintenta una vez. Nunca se rompe la vista.
- **El usuario habla mientras se genera**: la generación en curso se cancela y se atiende la
  nueva intención.
- **Micrófono denegado o sin conexión de voz**: pantalla de estado explícita con el motivo y
  cómo resolverlo.
- **Silencio prolongado**: tras unos segundos sin respuesta el agente vuelve a preguntar. Si el
  silencio sigue (45 s), la persona se fue: el agente corta la sesión y, poco después, la
  pantalla vuelve al reposo animado sin el gráfico anterior, para que la persona siguiente no
  vea lo que pidió otra (research.md D15). Tocar el orbe abre una sesión nueva.

## Requirements *(mandatory)*

### Functional Requirements

**Conversación**

- **FR-001**: El sistema MUST aceptar entrada de voz en español rioplatense como única vía de
  interacción y mantener la conversación en ese registro.
- **FR-002**: El sistema MUST mantener el estado de la conversación entre turnos, de forma que
  un pedido de refinamiento se interprete contra el gráfico actualmente en pantalla.
- **FR-003**: El agente MUST repreguntar cuando falte un parámetro que cambie el significado
  del resultado (métrica, dimensión de corte, universo de filas) y MUST NOT repreguntar por
  parámetros cosméticos, para los que elige un default y lo enuncia.
- **FR-004**: El agente MUST narrar por voz lo que va a generar antes de generarlo, y describir
  el resultado una vez dibujado.
- **FR-005**: Los usuarios MUST poder deshacer el último cambio y volver al gráfico anterior
  por comando hablado.

**Generación de la visualización**

- **FR-006**: El sistema MUST traducir la intención conversacional a un spec JSON validado
  contra un catálogo cerrado de componentes, y MUST rechazar cualquier spec que no valide.
- **FR-007**: El catálogo MUST soportar como mínimo: barras (simples, agrupadas y apiladas),
  líneas multi-serie, área, dispersión, torta/dona, combinado barra+línea, tarjetas KPI y
  tabla de datos.
- **FR-008**: Todo gráfico generado MUST incluir título, ejes rotulados con unidades, leyenda
  cuando haya más de una serie, grilla, tooltips formateados, números en formato es-AR y
  comportamiento responsive por contenedor.
- **FR-009**: El sistema MUST permitir componer más de una visualización en pantalla (por
  ejemplo, fila de KPIs sobre un gráfico) cuando la intención del usuario lo amerite.
- **FR-010**: El sistema MUST renderizar de forma progresiva a medida que el spec llega,
  mostrando las partes disponibles sin esperar al documento completo.

**Datos**

- **FR-011**: Todos los valores mostrados o dichos MUST provenir de agregaciones ejecutadas
  sobre los CSV del repositorio. Ningún valor emitido por un modelo de lenguaje MUST llegar a la
  pantalla ni a la voz: el spec sólo referencia los datos, y cualquier dato que el modelo
  escriba igual se descarta antes de renderizar (research.md D12, D14).
- **FR-012**: El sistema MUST normalizar en la ingesta: decodificar latin-1, delimitador `;`,
  encabezado en la fila correcta por archivo, campos multilínea entrecomillados, fechas
  `dd/mm/aaaa`, decimales con coma, y consolidar variantes de texto de `País` y `Región`.
- **FR-013**: El sistema MUST exponer al agente un catálogo de dimensiones y métricas
  disponibles por dominio, y el agente MUST responder sobre disponibilidad usando ese catálogo.
- **FR-014**: El sistema MUST suprimir o agrupar en "Otros" los grupos por debajo del umbral de
  k-anonimato, y MUST NOT emitir datos a nivel individuo (nombre, correo, CUIL, dirección,
  teléfono, contacto de emergencia, fecha de nacimiento) ni por pantalla ni por voz.
- **FR-015**: El sistema MUST reportar como no disponible toda columna cuyos datos estén
  corruptos en origen, en lugar de graficarla.
- **FR-016**: Cada gráfico MUST conservar su procedencia (dominio, filtros, agregación,
  cantidad de filas) y el agente MUST poder responderla si se la preguntan.

**Presentación**

- **FR-017**: Toda la interfaz MUST usar exclusivamente los tokens del Flock Design System
  v1.1, incluida la paleta de series de datos, sin colores ni tamaños inventados.
- **FR-018**: El sistema MUST soportar tema claro y oscuro, con `--brand` en `#9D2BD6` sobre
  oscuro, y MUST respetar la regla de separación de capas.
- **FR-019**: Los números y tablas MUST usar la pila mono con `tabular-nums`.
- **FR-020**: Todo intervalo de espera MUST tener una animación de estado que comunique la
  etapa en curso, y ningún estado visual puede quedar estático más de 400 ms durante una
  generación.
- **FR-021**: Los cambios sobre un gráfico existente MUST animarse como transición de estado,
  preservando los elementos que persisten.
- **FR-022**: Todas las animaciones MUST degradarse bajo `prefers-reduced-motion` sin perder el
  feedback de estado.

**Robustez**

- **FR-023**: Un fallo en cualquier etapa (voz, interpretación, consulta, render) MUST
  comunicarse en pantalla y, mientras el canal de voz siga disponible, también por voz,
  conservando el último estado válido. Si lo que falla es la voz (micrófono, conexión), el
  aviso es en pantalla con una forma de reintentar.
- **FR-024**: La clave de API del proveedor de lenguaje MUST permanecer del lado del servidor.

### Key Entities

- **Dominio de datos**: un CSV normalizado con su catálogo de dimensiones y métricas. Hay dos:
  *Nómina* (una fila por persona: región, género, antigüedad, edad, estado activo, motivo de
  egreso, hijes, fechas de ingreso y egreso) y *Seguimiento de clientes* (un registro por cuenta
  y proyecto por mes: país, cuenta, proyecto, razón principal, NPS, highlights, action items).
- **Dimensión**: columna categórica o temporal por la que se puede cortar, con sus valores
  normalizados y su cardinalidad.
- **Métrica**: cantidad calculable sobre un dominio (conteo, promedio, suma, porcentaje,
  distinct count) con su unidad y formato.
- **Intención de visualización**: lo que el sistema entendió del usuario — dominio, métrica,
  dimensiones, filtros, orden, límite, tipo de gráfico — y las decisiones cosméticas que tomó
  sin preguntar. Lo que falta no se modela: mientras falte algo material, el agente repregunta
  y la intención no existe todavía.
- **Spec de visualización**: el documento JSON validado contra el catálogo que describe qué
  renderizar.
- **Conjunto de resultados**: las filas agregadas que alimentan un spec, con su procedencia.
- **Turno de conversación**: un intercambio con su transcripción, la intención resultante y el
  spec producido, si hubo. No se persiste: la transcripción no se muestra y queda sólo para
  diagnóstico.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Una persona que nunca vio la app llega a su primer gráfico útil hablando, en
  menos de 45 segundos y sin instrucciones escritas.
- **SC-002**: En un banco de 25 consultas habladas representativas, al menos 20 producen un
  gráfico correcto sin intervención, y ninguna produce números que no se puedan reproducir
  contando sobre el CSV.
- **SC-003**: Toda consulta ambigua del banco genera una repregunta antes de generar, con cero
  casos de gráfico dibujado sobre una suposición silenciosa.
- **SC-004**: Desde el fin del turno hablado hasta que hay algo dibujado en pantalla pasan
  menos de 2 segundos, y hasta el gráfico completo menos de 6.
- **SC-005**: Durante toda generación, ningún estado visual permanece estático más de 400 ms.
- **SC-006**: Una cadena de 5 refinamientos hablados conserva el estado acumulado en el 100% de
  los casos, sin resetear filtros previos.
- **SC-007**: Cero valores de color, radio, sombra o tamaño tipográfico fuera de los tokens de
  Flock en toda la interfaz, verificable por inspección del código.
- **SC-008**: La app es legible y correcta en tema claro y oscuro, sin ningún panel sobre un
  fondo del mismo tinte.
- **SC-009**: Cero datos a nivel individuo expuestos, por pantalla o por voz, en el banco de
  consultas.

## Assumptions

- Los datos son fijos para esta primera instancia: los dos CSV versionados en el repositorio.
  No hay base de datos, ingesta en vivo ni carga de archivos por parte del usuario.
- El uso es de demostración en un dispositivo con micrófono, de a una persona por vez, en un
  entorno con ruido moderado. No hay autenticación ni multiusuario.
- La sesión es efímera: los gráficos generados no se persisten entre sesiones.
- El idioma es español rioplatense, tanto de entrada como de salida.
- Se reutiliza el patrón de integración de voz de vistaenergy-dataagent (ElevenLabs
  Conversational AI con client tools) como base probada, pero la rueda de temas y el catálogo
  fijo de gráficos no se portan: se reemplazan por la generación conversacional.
- Los gráficos de vistaenergy-dataagent son la línea de base de riqueza visual a igualar o
  superar.
- La columna `Estado con cliente` se considera perdida en origen y queda fuera del alcance
  hasta que se reexporte el CSV.
- El formato de exportación o compartido de un gráfico queda fuera del alcance de esta primera
  instancia.
