# Modelo de datos — nómina sintética

**Feature**: 002-nomina-escritorio | **Date**: 2026-09-24

Reemplaza los dominios de `specs/001-voice-generative-charts/data-model.md`. Los datos de
`data/` son sintéticos: tienen la forma de una nómina de RR.HH., pero ninguna fila es de una
persona real y los clientes son inventados.

## Fuente

`npm run data:synthetic` (`scripts/generate-synthetic.ts`) genera la nómina con una semilla
fija y escribe en `data/`:

| Archivo | Qué es |
|---|---|
| `nomina.csv` | Una fila por persona, UTF-8, fechas ISO, punto decimal. Sólo la whitelist de columnas. |
| `meta.json` | Fuente, fecha de corte y conteos. |
| `control-attrition-2023-2024.csv` | La serie mensual de dotación, ingresos y bajas, contada por el generador. Sólo la leen los tests. |

- El generador reproduce las desprolijidades de una planilla cargada a mano (grafías distintas
  de una misma cuenta, tipeos en la categoría, "N/A", celdas vacías), para que el saneamiento
  tenga trabajo. Los legajos incompletos son los de quienes ya se fueron.
- `Activo` se deriva de la fecha de egreso, y la antigüedad se calcula contra la fecha de
  corte con la fórmula truncada de la planilla.
- No existen en ningún lado: nombre, apellido, correo, CUIL, fecha de nacimiento, cumpleaños,
  domicilio, teléfono, contacto de emergencia, edades de hijes, referente, champion y co
  champion asignados. Tampoco salarios, bonos ni bandas.

## Dominio `nomina`

124 personas: 79 activas y 45 egresadas.

| Dimensión | De la columna | Normalización |
|---|---|---|
| `activo` | Egreso | Sí / No |
| `area` | Área | Operación, Estructura, I+D (N/A → sin dato) |
| `rol` | Posición | Familias: Ingeniería de software, QA, Producto y análisis, I+D, Gestión y dirección, Comercial, People. |
| `posicion` | Posición | El puesto exacto, tal cual. |
| `seniority` | Categoría | Trainee, Junior, Semi Senior, Senior, No aplica (N/A). Ordinal. |
| `tech_principal` | Tech Principal | Grafía unificada, primera tecnología; los roles no técnicos quedan sin dato. |
| `proyecto` | Proyecto Actual | "Aseg. Tero" → Aseguradora Tero. |
| `nivel_ingles` | Inglés | Básico (A), Intermedio (B), Avanzado (C). Cobertura cerca de 30 %. |
| `genero`, `region`, `zona_amba`, `hijes` | Sexo, Región, AMBA 0/1, Hijes | Como en 001. |
| `rango_edad`, `rango_antiguedad` | edad, antigüedad | Tramos, ordinales. |
| `motivo_egreso` | Motivo | Etiquetas cortas ("Razones personales", "Despido por performance"…). |
| `entrevistador`, `es_champion`, `flock_talent`, `buddy` | Nómina principal | Sí / No. |
| `mes_ingreso`, `mes_egreso` | Ingreso, Egreso | `aaaa-mm`. |
| `anio_ingreso`, `anio_egreso` | Ingreso, Egreso | `aaaa`. |

Métricas: `headcount`, `headcount_activo`, `egresos`, `antiguedad_prom`, `edad_prom`,
`pct_activos`, `pct_mujeres`, `pct_del_total`.

**Privacidad**: no hay umbral de grupo (constitución v3.0.0). Un corte, un cruce o un filtro de
una sola persona se muestra tal cual. Lo que nunca aparece es el nombre y apellido de nadie, y
eso es estructural: los datos no tienen nombres ni datos de contacto.

**"Otros"** sólo existe por legibilidad: una categórica con más de 12 valores se recorta a los
principales. Su valor se recalcula sobre la unión de las filas, no sumando promedios.

## Dominio `movimientos` (no sensible)

Una fila por mes, de enero 2023 al último mes completo antes del corte (hoy, agosto 2026: 44
meses), calculada de las fechas de ingreso y egreso de la nómina.

| Campo | Fórmula (la de una planilla de attrition de RR.HH.) |
|---|---|
| `dotacion_inicio` | Ingresaron antes del 1.º y no egresaron antes del 1.º |
| `ingresos`, `egresos` | Ingresos y egresos del mes |
| `dotacion_fin` | inicio + ingresos − egresos |
| `desercion_pct` | egresos / inicio |
| `attrition_pct` | egresos / ((inicio + fin) / 2) |
| `rotacion_pct` | (egresos − ingresos) / inicio |
| `attrition_12m` | egresos de 12 meses / dotación promedio de 12 meses (desde dic. 2023) |

Dimensiones `mes`, `trimestre` y `anio` (temporales, con su granularidad).

**Contraste con la serie de control**: el generador cuenta dotación, ingresos y bajas mes a
mes, persona por persona, de enero 2023 a octubre 2024. `buildMovimientos` tiene que dar
exactamente lo mismo (`tests/data/movimientos.test.ts`).
