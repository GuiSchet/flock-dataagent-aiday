# Phase 1 — Modelo de datos

**Feature**: 001-voice-generative-charts | **Date**: 2026-09-22

> **Reemplazado el 2026-09-24** por `specs/002-nomina-escritorio/data-model.md`: la fuente
> pasó a ser una sola nómina y se dejó el seguimiento de clientes. Lo de abajo documenta la
> estructura de la versión tótem; las cifras y los nombres de cuentas de los datos originales
> no se publican.

La versión tótem leía dos CSV exportados de planillas internas (delimitador `;`, encoding
latin-1, campos multilínea).

## Dominio A — `nomina`

**Fuente**: CSV de datos personales de la nómina, una fila por persona, encabezado en fila 1
(con salto de línea interno).
**Nota de ingesta**: el export traía cientos de filas vacías al final; se descartan por
`Correo corporativo` vacío.

### Columnas bloqueadas (nunca salen del servidor)

Todas las que identifican a alguien: correo, apellido, nombre, fecha de nacimiento, CUIL,
dirección, teléfono, contacto de emergencia y edades de hijes.

Se descartan en la ingesta. No están en el catálogo, así que no hay consulta que las alcance.

### Dimensiones

| Id | Etiqueta | Tipo | Valores | Notas |
|----|----------|------|---------|-------|
| `activo` | Estado | categórica | Sí · No | Cobertura completa |
| `genero` | Género | categórica | Masculino · Femenino · No binario | Algún grupo cae bajo k=5 |
| `region` | Región | categórica | decenas de valores crudos → 5 normalizados + Sin dato | Ver normalización |
| `zona_amba` | AMBA / Fuera de AMBA | categórica | AMBA · Fuera de AMBA | Columna nativa del archivo (0 / 1) |
| `hijes` | Tiene hijes | categórica | No · Sí | |
| `motivo_egreso` | Motivo de egreso | categórica | ~10 valores | Solo egresados |
| `mes_ingreso` | Mes de ingreso | temporal | derivada de `Ingreso` | Cobertura completa |
| `mes_egreso` | Mes de egreso | temporal | derivada de `Egreso` | Solo egresados |
| `rango_edad` | Rango etario | categórica | derivada, tramos de 5 años | |
| `rango_antiguedad` | Rango de antigüedad | categórica | derivada: <1, 1-2, 2-3, 3-5, 5+ años | Cobertura completa |

**Normalización de `region`**: los valores crudos colapsan a `CABA`, `GBA` (los `GBA, *` más
`AMBA`), `Buenos Aires`, `Interior` (las provincias), `Exterior` (otros países) y `Sin dato`. El
corte AMBA / fuera de AMBA no se deduce de acá: la planilla trae una columna propia y
autoritativa.

**Valores de `motivo_egreso`**: las opciones del formulario de egreso (mejora salarial,
desarrollo profesional, razones personales, despidos por performance, actitud o falta de
asignación, pase a la nómina del cliente) más algunos valores libres.

### Métricas

| Id | Etiqueta | Cálculo | Unidad | Formato |
|----|----------|---------|--------|---------|
| `headcount` | Personas | conteo de filas | personas | entero |
| `headcount_activo` | Personas activas | conteo con `activo = Sí` | personas | entero |
| `egresos` | Egresos | conteo con `activo = No` | personas | entero |
| `antiguedad_prom` | Antigüedad promedio | promedio de `Antigüedad años` | años | 1 decimal |
| `edad_prom` | Edad promedio | promedio de `Edad` (alta cobertura) | años | 1 decimal |
| `pct_activos` | % de activos | activos ÷ total del grupo | % | 1 decimal |
| `pct_del_total` | % del total | participación del grupo en el total | % | 1 decimal |

Las altas y las bajas en el tiempo no son métricas propias: son `headcount` cortado por
`mes_ingreso` y `egresos` cortado por `mes_egreso`. La tasa de rotación (bajas sobre la
dotación del período) no está en el catálogo, porque necesita la dotación a cada fecha y la
nómina sólo trae ingreso y egreso por persona. Si la piden, el agente ofrece los egresos por
mes.

Fuente de verdad: `lib/data/catalog.ts`. Esta tabla la describe; si difieren, manda el código.

## Dominio B — `clientes`

**Fuente**: CSV de seguimiento de clientes, un registro por cuenta y proyecto por mes, con
**encabezado en fila 3** (dos filas de preámbulo).
**Nota de ingesta**: algunas filas traen sólo una fecha de actualización y ninguna otra
celda. Se descartan por `Cuenta` vacía.

### Dimensiones

| Id | Etiqueta | Tipo | Valores | Notas |
|----|----------|------|---------|-------|
| `mes` | Mes | temporal | valores tipo "Enero 2024" | Se parsea a fecha para ordenar |
| `pais` | País | categórica | un puñado de países | Incluye tipeos que se corrigen |
| `cuenta` | Cuenta | categórica | una docena de cuentas | |
| `proyecto` | Proyecto | categórica | más de 20 proyectos | Alta cardinalidad: top-N + "Otros" |
| `razon_principal` | Razón principal | categórica | Cliente · Equipo · Entregables · Rentabilidad | |
| `nps_estado` | Estado de medición NPS | categórica | En curso · Realizado · No implementado · Planificado | Derivada, ver abajo |

### Métricas

| Id | Etiqueta | Cálculo | Unidad | Formato |
|----|----------|---------|--------|---------|
| `registros` | Registros de seguimiento | conteo | registros | entero |
| `cuentas` | Cuentas | distinct de `cuenta` | cuentas | entero |
| `proyectos` | Proyectos | distinct de `proyecto` | proyectos | entero |
| `nps_prom` | NPS promedio | promedio de `nps` numérico (cobertura muy baja) | puntos | 2 decimales |
| `pct_del_total` | % del total | participación del grupo en el total | % | 1 decimal |

`Razón secundaria` no se ofrece como dimensión: es texto casi libre y con poca cobertura.
Fuente de verdad: `lib/data/catalog.ts`.

### Columna partida: `NPS`

La columna original mezcla dos cosas. Se parte en la ingesta:

- `nps` (numérico): muy pocos registros traen un número. Con esa cobertura, el agente debe
  advertirlo antes de graficar promedios de NPS.
- `nps_estado` (categórico): estados de la medición ("En curso", un trimestre planificado,
  "No implementado aun", "Realizado el …").

### Columna no disponible: `Estado con cliente`

Todas las filas traen `??`. Era un semáforo de emoji destruido por el export a latin-1. **No
se ofrece como dimensión.** Si el usuario la pide, el agente explica que el dato se perdió en
la exportación y ofrece `razon_principal` como aproximación.

### Campos de texto libre

`Hightlights` (sic, así viene), `Action item`, `Última visita a cliente`, `Próxima visita`. No
son graficables, y **tampoco llegan al agente**: pueden nombrar personas o clientes, y la
redacción automática nunca es perfecta (research.md D15, T062 descartada, SC-009). El agente
habla sólo de agregados.

## Entidades del sistema

### `Domain`

Un dataset normalizado con su catálogo. `{ id, label, rowCount, dimensions[], metrics[],
unavailable[] }`. `unavailable` lleva las columnas descartadas con su motivo, para que el
agente pueda explicarlas.

### `Dimension` / `Metric`

`Dimension: { id, label, kind: 'categorical' | 'temporal', cardinality, coverage, values? }`
`Metric: { id, label, agg, unit, format, coverage }`

`coverage` es clave: el agente advierte antes de graficar una métrica con cobertura baja
(`nps_prom` tenía una cobertura muy baja).

### `VizIntent`

Lo que el sistema entendió. `{ domain, metric, groupBy[], filters[], sort, limit, chartType,
title, assumptions[] }`. No hay campo `missing`: desde D9 la repregunta vive en el prompt del
agente, que no llama al tool hasta tener lo que cambia el resultado, y el servidor revalida
como red de seguridad. Contrato completo en `contracts/viz-intent.md`.

### `ResultSet`

`{ rows[], dimensionKeys[], metricKey, seriesKeys[], rowCount, provenance }`. `provenance`
lleva dominio, filtros aplicados, agregación, filas de origen y qué grupos se suprimieron por
k-anonimato — es lo que responde FR-016, en pantalla y en voz (`queryCurrentChart`). Junto al
`ResultSet` viaja el resumen `stats` (total, máximo, mínimo, promedio, cantidad), que es lo
único que puede leer un KPI encima de un gráfico.

### `VizSpec`

Documento de `json-render` validado contra el catálogo. Los datos entran por la expresión
`{ "$state": "/rows" }` (o `/stats`, sólo en un KPI); el spec no contiene valores literales de
datos, y un `state` que emita el modelo se descarta antes de renderizar (D14).

### `ConversationTurn`

No se persiste. La transcripción queda sólo en la consola, para diagnóstico: el tótem muestra lo
que el agente entendió, no lo que se dijo. Lo que implementa "volvé atrás" es la pila de
`VizIntent` (`lib/conversation/history.ts`), no una pila de turnos.

## Reglas transversales

**k-anonimato (k = 5)**: aplica a todo agrupamiento sobre `nomina`. Grupos con menos de 5
personas se agrupan en "Otros"; si "Otros" queda por debajo de 5, absorbe la siguiente
categoría más chica. El `provenance` registra qué se suprimió y el agente puede explicarlo.

**Alta cardinalidad**: dimensiones con más de 15 valores (como `proyecto`) se limitan por
defecto a top-N por la métrica, con el resto en "Otros". El agente lo enuncia.

**Formato es-AR**: separador de miles `.`, decimal `,`, fechas `dd/mm/aaaa`, meses en español.
