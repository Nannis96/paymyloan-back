# paymyloan-back — Backend/API de PayMyLoan.ai

Backend base para [paymyloan.ai](https://paymyloan.ai), proyecto **independiente**
del frontend (`../paymyloan`). Todavía sin autenticación ni conexión con el
frontend; el primer endpoint de negocio real es alta/edición/eliminado
lógico de usuario (ver `../paymyloan-alcance.html` §3/§7).

## Stack

Versiones alineadas con `paymyloan` (frontend) para que el código sea
portable entre repos.

| Pieza | Versión |
|---|---|
| Next.js (App Router, Turbopack) | 16.1.1 |
| React / React DOM | 19.2.3 (dependencia de Next; no se usa JSX) |
| TypeScript | 5.x |
| Prisma / PostgreSQL | 6.19.3 / 18 |
| bcryptjs / zod | 3.0.3 / 4.5.4 |
| vitest | 4.x (unit + integración) |

Sin Tailwind, sin `lucide-react`: no hay UI, es un backend puro. Sin
NextAuth todavía: no hay sesión ni login, solo el modelo de usuario y sus
endpoints CRUD (la [Fase 2](Docs/plan/fases/fase-02-authentication.md) del
plan de backend agrega JWT propio + 2FA).

## Por qué Next.js como backend

Next App Router permite exponer endpoints HTTP como *route handlers*
(`src/app/api/**/route.ts`) sin necesidad de páginas ni de un framework de
servidor aparte. Se aprovecha:

- El mismo runtime, versión de Node y patrón de Docker que ya usa el
  frontend (menos piezas nuevas que aprender/mantener).
- `output: "standalone"` para imágenes de producción livianas.
- Route handlers tipados de punta a punta con TypeScript.

No hay ninguna página (`page.tsx`) en el proyecto a propósito: es
deliberadamente solo API.

## Correr con Docker

El proyecto está pensado para correr **siempre dentro de Docker**, en
desarrollo y en producción.

### Desarrollo (hot reload)

```bash
cp .env.example .env      # opcional, arranca con defaults igual
docker compose -f docker-compose.dev.yml up --build
# http://localhost:4000/api/health
```

El código se monta como volumen (`.` → `/app`), así que los cambios se
reflejan sin reconstruir la imagen. `node_modules` y `.next` quedan
aislados dentro del contenedor.

### Producción (imagen compilada)

```bash
docker compose up --build -d
# http://localhost:4000/api/health
```

Usa el target `runner` del `Dockerfile` (`output: standalone`), corre como
usuario no root y expone `HEALTHCHECK` sobre `/api/health`.

> Todavía no hay reverse proxy (nginx) ni TLS delante, a diferencia del
> frontend: el puerto se publica directo al host. Cuando este backend
> tenga que salir a un servidor real, se puede sumar nginx + certbot
> reutilizando el mismo patrón que ya existe en `../paymyloan`.

### Sin Docker (opcional, para editores/lint local)

Requiere Node 22, pnpm y una Postgres alcanzable en `DATABASE_URL` (por
ejemplo, levantando solo el servicio `db` de `docker-compose.dev.yml`):

```bash
pnpm install          # corre "prisma generate" vía postinstall
pnpm exec prisma migrate dev
pnpm dev
```

### Base de datos (Prisma)

```bash
pnpm run db:migrate          # nueva migración en desarrollo (requiere DB viva)
pnpm run db:migrate:deploy   # aplica migraciones pendientes (lo que corre en Docker)
pnpm run db:studio           # explorador visual de datos
```

`docker-compose.dev.yml` ya corre `prisma migrate deploy` antes de levantar
el server; `docker-compose.yml` lo hace en un servicio `migrate` aparte
(target `builder`, porque `runner` es standalone y no lleva el CLI de Prisma).

Postgres 18 (BE-001): las imágenes oficiales cambiaron la convención de
volumen en esta versión mayor — se monta en `/var/lib/postgresql` (no
`.../data`), el propio contenedor arma el subdirectorio por versión.

### Tests

```bash
pnpm test                # unitarios (funciones puras, sin DB) — vitest.config.mts
pnpm run test:watch      # igual, en modo watch

docker compose -f docker-compose.dev.yml up -d db-test
pnpm run test:integration   # contra Postgres real (servicio "db-test"), nunca mocks de Prisma
```

`db-test` es una base Postgres 18 separada de la de desarrollo (puerto
`5433`, sin volumen persistente): `test:integration` le aplica las
migraciones y corre ahí, así nunca toca los datos de `db`. Convención de
nombre de archivo: `*.test.ts` = unitario, `*.integration.test.ts` = contra
Postgres real (ver plan de backend §11).

## Puerto

**4000** (dev y prod), para no chocar con el frontend, que usa 3000.
Configurable con la variable `PORT` en `.env` — se aplica al mapeo de
puerto host↔contenedor en ambos `docker-compose*.yml` (el contenedor
siempre escucha en 4000 puertas adentro).

## Variables de entorno

Ver `.env.example` para el detalle de cada una. Todas se leen en un solo
lugar, `src/config/env.ts` (export `env`), que además valida al arrancar:
en `NODE_ENV=production` faltar `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` o
`DATABASE_URL` corta el proceso con un mensaje claro (`process.exit(1)`) en
vez de arrancar a medias. En desarrollo/test esas mismas variables tienen
un placeholder inseguro si se dejan vacías, para no bloquear el flujo local.

## Estructura

```
prisma/
  schema.prisma            datasource + modelo User (id UUIDv7)
  migrations/               historial de migraciones SQL
src/
  app/
    api/
      health/route.ts       GET /api/health — sonda de infraestructura
      users/route.ts         POST /api/users — alta de usuario
      users/[id]/route.ts     PATCH (edición) y DELETE (eliminado lógico)
  proxy.ts                  CORS + requestId, corre antes de toda ruta /api/*
  config/
    env.ts                  punto único de lectura de variables de entorno (fail-fast)
  controllers/
    health.controller.ts    orquesta la respuesta del endpoint de salud
    users.controller.ts     valida input (Zod) y llama a users.service
  services/
    users.service.ts        lógica de negocio: alta, edición, eliminado lógico
  validations/
    users.validation.ts     esquemas Zod de entrada para /api/users
  middlewares/
    cors.ts                 decide qué origen se permite (CORS_ORIGIN)
    rateLimit.ts            contador en memoria por key (login, 2FA, reset)
  auth/                     vacío — Fase 2 (jwt.ts, password.ts, totp.ts)
  repositories/             vacío — Fase 6 (queries complejas de contracts/payments)
  jobs/                     vacío — Fase 6 (mora, late fees, expiración de tokens)
  db/
    prisma.ts                cliente Prisma (instancia única, reusada en dev)
  errors/
    AppError.ts              error tipado con statusCode/code
    errorHandler.ts          convierte cualquier error en respuesta HTTP, logueado con requestId
  lib/
    apiResponse.ts           helpers apiSuccess()/apiError() (forma JSON única)
    logger.ts                logger JSON estructurado + getRequestId()
    email.ts                 sendEmail() agnóstico de proveedor (Resend hoy)
  types/
    api.ts                   tipos compartidos de la forma de respuesta
public/                     estáticos servidos tal cual (vacío hoy)
Dockerfile                  multietapa: deps → dev / builder → runner
docker-compose.yml          producción (db + migrate + api)
docker-compose.dev.yml      desarrollo con hot reload (db + db-test + api)
vitest.config.mts           tests unitarios (*.test.ts)
vitest.integration.config.mts  tests de integración (*.integration.test.ts, Postgres real)
.env.example                todas las variables soportadas hoy, documentadas
```

### Flujo de una request

`proxy.ts` (CORS + requestId) → `route.ts` (HTTP) → `controller` (valida el
input con Zod y llama a un `service`) → `service` (lógica de negocio, habla
con Prisma) → `lib/apiResponse` (formatea `{ success, data }` /
`{ success: false, error }`) — con `errors/errorHandler.ts` capturando
cualquier excepción en el medio y logueándola con el `requestId` de esa
request (`lib/logger.ts`). `GET /api/health` sigue siendo el ejemplo mínimo
sin negocio ni DB; `/api/users` es el primero que implementa la cadena
completa contra Postgres.

### API de usuarios

Identidad, contraseña y estado de 2FA — sin rol de negocio: el rol
(Lender / Borrower / Viewer) vive en la relación préstamo↔persona, todavía
sin modelar (ver alcance §3/§7). Todas las respuestas usan la forma
`{ success, data }` / `{ success: false, error }` de `lib/apiResponse.ts`.

| Método | Ruta | Qué hace |
|---|---|---|
| `GET` | `/api/users` | Lista los usuarios activos (excluye eliminados lógicamente) |
| `POST` | `/api/users` | Crea un usuario (`name`, `email`, `password`) |
| `PATCH` | `/api/users/:id` | Edita `name`/`email`/`password` (parcial) |
| `DELETE` | `/api/users/:id` | Eliminado lógico: apaga `deletedAt`, no borra la fila |

`password` nunca se devuelve ni se acepta un usuario ya eliminado como
destino de edición/borrado (responde `404 USER_NOT_FOUND`).

## Decisiones de arquitectura

- **`src/` en vez de `app/` en la raíz.** El frontend no lo necesita
  (solo tiene páginas), pero un backend con capas (controllers, services,
  validations, errors...) queda más ordenado separando "rutas HTTP"
  (`src/app`) de "resto de la aplicación" (`src/{config,controllers,...}`).
- **Sin páginas, solo `api/`.** Es un backend, no una app con UI. Se
  verificó que Next.js construye y corre sin problema sin ningún
  `page.tsx`/`layout.tsx` en el árbol.
- **CORS y requestId en `src/proxy.ts` (no `middlewares/`).** Next.js 16
  exige ese archivo/convención (reemplazo de `middleware.ts`, ver
  https://nextjs.org/docs/messages/middleware-to-proxy) para que algo corra
  antes de *cualquier* ruta; `middlewares/` queda para lógica invocada
  explícitamente desde un controller (rate limiting, y desde la Fase 3 los
  guards de auth/tenancy).
- **UUIDv7 nativo de Postgres (`dbgenerated("uuidv7()")`), no `cuid()`.**
  Ordenable por tiempo de creación como un autoincrement, pero no
  adivinable/enumerable como un ID secuencial — requiere Postgres 18
  (verificado sin warnings contra Prisma 6.19.3).
- **Fail-fast de variables de entorno con corte real del proceso.** Un
  `throw` en la evaluación de un módulo no basta: el runtime de Next
  (Turbopack) lo atrapa y sigue sirviendo requests degradado en vez de
  terminar — verificado con la imagen `runner`. `src/config/env.ts` hace
  `process.exit(1)` explícito para que falte-una-variable sea un corte
  visible, no un contenedor "Up" respondiendo 500 en bucle.
- **Endpoint de salud como pieza de infraestructura, no de negocio.**
  Sigue demostrando el patrón route → controller → error handler mínimo
  (sin DB), y es lo que usa el `HEALTHCHECK` del `Dockerfile`.
- **Forma de respuesta JSON única (`ApiSuccessBody`/`ApiErrorBody`).**
  Para que cada endpoint futuro no reinvente su propio formato de error o
  de éxito.
- **`pnpm install --frozen-lockfile` con `pnpm-lock.yaml` versionado**,
  para builds de Docker reproducibles.
- **`node:22-slim`, no `node:22-alpine`.** Prisma necesita un motor nativo
  con OpenSSL; alpine (musl) lo complica innecesariamente — mismo criterio
  que ya usa el proyecto Owner con el mismo stack.
- **`User` sin campo de rol.** A diferencia del `User` de Owner (que trae
  `role` y perfiles Seller/Buyer/etc.), acá el rol de negocio vive en la
  relación préstamo↔persona (`LoanParty`, todavía sin modelar), no en la
  persona — ver alcance §3.
- **Eliminado lógico, no físico.** `DELETE /api/users/:id` apaga
  `deletedAt` en vez de borrar la fila: un usuario puede quedar referenciado
  desde préstamos, documentos o la bitácora de auditoría más adelante.
- **`bcryptjs` (JS puro) en vez de `bcrypt` (nativo).** Evita sumar una
  segunda dependencia nativa además del motor de Prisma; mismo paquete que
  usa Owner en su código real (aunque también declara `bcrypt` sin usarlo).
- **Puerto 4000 y sin nginx/TLS todavía.** El frontend ya ocupa el 3000 y
  tiene su propio reverse proxy; el backend no necesita replicar eso hasta
  que se decida cómo se va a desplegar (mismo dominio detrás de un mismo
  nginx, subdominio propio, etc. — decisión de infraestructura pendiente).

## Qué queda pendiente

Ver [`Docs/plan/`](Docs/plan/) para el plan completo y
[`Docs/plan/fases/`](Docs/plan/fases/) para el backlog
(BE-001..BE-085 + PB-001..PB-015). Lo inmediato después de esta etapa
(Fase 0 — Foundation, completa):

- Conectar el frontend a este backend (hoy `paymyloan` no le apunta a
  nada; sigue funcionando standalone vía `NEXT_PUBLIC_REGISTRO_ENDPOINT`
  vacío).
- Fase 1 (Database): `role` en `User`, `LenderProfile`, `BorrowerProfile`
  + `LenderBorrower`, `Contract`/`ContractTerms` y el resto del modelo de
  negocio — `User` sigue siendo la única tabla real.
- Autenticación real (JWT access+refresh, 2FA por TOTP — `User` ya tiene
  los campos, falta el flujo completo de Fase 2).
- Decidir infraestructura de despliegue (reverse proxy/TLS, mismo servidor
  que el frontend o separado, y si Postgres corre en el mismo Docker host
  o en un servicio administrado).
