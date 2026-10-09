# Tasks: nómina sintética y versión de escritorio

**Input**: una nómina de RR.HH. y el pedido de usar la app desde una PC por link, con una
portada que muestre gráficos de nómina y una UI más limpia. Para publicar el repo, la nómina
es sintética y el link queda detrás de un login.

**Estado al 2026-10-09**: implementado y verificado localmente (tests, tipos, lint, tokens y
build), con datos sintéticos y login con contraseña compartida. Falta correr el banco de voz,
que tiene costo y requiere confirmación.

- **`[x]`** hecha · **`[~]`** parcial · **`[!]`** superada · **`[ ]`** pendiente

## Datos

- [x] T201 `scripts/generate-synthetic.ts` + `npm run data:synthetic`: nómina sintética con
      semilla fija → `data/nomina.csv`, `meta.json` y `control-attrition-2023-2024.csv`, con
      la whitelist de columnas. Ninguna fila es de una persona real.
- [x] T202 Borrar los dos CSV anteriores y el dominio `clientes`.
- [x] T203 Dimensiones nuevas en `nomina` (área, rol, seniority, tecnología, proyecto, inglés,
      programas) y métrica `pct_mujeres`.
- [x] T204 Dominio `movimientos` (`lib/data/movimientos.ts`) contrastado con la serie de control.
- [x] T205 Motor: orden ordinal, residuos al final, "Otros" recalculado sobre las filas,
      filtros de trimestre y año.
- [!] T206 Privacidad con k = 5 (filtros y cruces chicos no se publicaban). Superada: a pedido
      de negocio se saca el umbral de grupo (constitución v3.0.0). Se mantiene que nunca
      aparece el nombre y apellido de nadie.
- [x] T208 Sin umbral de grupo: se expone la posición exacta, Trainee vuelve a separarse de
      Junior y se agregan año de ingreso y de egreso.
- [x] T207 Tests de datos reescritos sobre la nómina sintética.

## Conversación

- [x] T210 Enums de dominio, ejemplos, prompt del agente y snapshots de tools sin clientes.
- [x] T211 Tests de conversación y del juez del banco migrados; casos del banco reescritos y
      caso de privacidad nuevo (edad del CTO).
- [x] T212 `npm run setup:agent` para publicar prompt y tools en ElevenLabs.
- [ ] T213 `npm run bench:voice` completo contra el agente publicado.

## Pantalla

- [x] T220 Tablero fijo en la portada (`lib/dashboard/tablero.ts`, `components/Dashboard.tsx`):
      4 KPIs, dotación mes a mes, área, seniority, tecnologías y motivos de egreso.
- [x] T221 Layout de escritorio (`components/AgentApp.tsx`): barra fija, contenedor de 1280 px,
      conversación con gráfico grande y dock de voz.
- [x] T222 Sin comportamientos de kiosco: cursor, wake lock y reinicio automático.
- [x] T223 Menos texto chico: intención en texto normal, etapa en una línea, una sola nota de
      fuente en el tablero, leyendas en tinta de texto, "Otros" en gris.
- [x] T224 Constitución v2.0.0, `CLAUDE.md`, `README.md`.

## Repo público

- [x] T240 Datos sintéticos (`scripts/generate-synthetic.ts`) en lugar de la nómina real; sin
      el import del Excel. Cifras de tests, specs y banco actualizadas; transcripciones del
      banco fuera del repo.
- [x] T241 Leyenda de datos sintéticos en la barra, el tablero, el catálogo y el prompt del
      agente.

## Acceso y despliegue

- [~] T230 Auth y límite de uso en `/api/compose` y `/api/conversation-token` antes de
      compartir el link fuera de una red de confianza (research.md D15). Hecho el login con
      contraseña compartida (`proxy.ts`, `lib/auth/session.ts`, `app/login/`): sin sesión las
      páginas van a `/login` y las APIs devuelven 401; sin configuración, 503. Falta el
      límite de uso por persona.
- [ ] T231 Deploy: host a definir. El login no depende del host; la cookie va `Secure` cuando
      la página llega por HTTPS.
