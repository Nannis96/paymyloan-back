# paymyloan-back — Backend/API de PayMyLoan.ai

Backend base para [paymyloan.ai](https://paymyloan.ai), proyecto **independiente**
del frontend (`../paymyloan`). Fases 0–6 del [plan de implementación](Docs/plan/)
están completas y en producción: autenticación propia (JWT + 2FA TOTP),
autorización/multi-tenant, CRUD completo de Admin/Prestamistas/Deudores, y el
ciclo de vida completo de `Contract` (creación, versionado de términos,
aceptación bilateral, amortización, cancelación). Fase 13 está **parcial**:
el núcleo de cotizaciones de marketplace (`LoanRequest`, cotizaciones de
varios Prestamistas elegidos, selección → `Contract`) ya corre; RentCast,
vetting del Deudor, suscripción y documentos siguen pendientes — ver
[Docs/IMPLEMENTATION_PROGRESS.md](Docs/IMPLEMENTATION_PROGRESS.md) para el
detalle de avance y [Docs/API_REFERENCE.md](Docs/API_REFERENCE.md) para el
contrato HTTP completo de cada endpoint. Próximo en el roadmap: Fase 7
(Pagos) — ver [Docs/plan/14-roadmap.md](Docs/plan/14-roadmap.md).
`Docs/plan/` es la única fuente de verdad del diseño; este README describe
el estado del código, no el plan.

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
NextAuth: sesión propia con JWT (access + refresh) + 2FA TOTP, implementada
en [Fase 2](Docs/plan/17-fase-2-actualizada.md)/[Fase 3](Docs/plan/fases/fase-03-authorization.md)
del plan de backend — ver `src/auth/` y `src/middlewares/`.

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

> Actualizado 2026-09-11 — refleja Fases 0–6 implementadas + Fase 13 parcial
> (`PB-011`/`PB-026`/`PB-017`). Detalle campo por campo del modelo de datos en
> [Docs/plan/04-base-de-datos.md](Docs/plan/04-base-de-datos.md); contrato
> HTTP completo de cada ruta en [Docs/API_REFERENCE.md](Docs/API_REFERENCE.md).

```
prisma/
  schema.prisma            User, LenderProfile/LenderCompany, BorrowerProfile,
                            Bookkeeper/InsuranceCompany, Property, Contract/
                            ContractTerms/ContractFeeItem/ScheduledPayment/
                            Transaction/Autopay (Fases 0–6), LoanRequest/
                            LoanRequestLenderTarget/LoanQuote (Fase 13 parcial)
  migrations/               historial de migraciones SQL
src/
  app/
    api/
      health/route.ts                          GET — sonda de infraestructura
      users/[route.ts, [id]/route.ts]           CRUD, solo ADMIN
      auth/                                     register, login(+2fa), refresh,
                                                 logout(-all), me, password/
                                                 forgot|reset, 2fa/*
      admin/
        users/[id]/{activate,deactivate}/       alta/baja de cualquier usuario
        lenders/[id]/[companies/[companyId]]    Admin CRUD de LenderCompany
      lenders/me/[companies, borrowers/[id]]    autoservicio del Prestamista
      borrowers/me/
        [password]                              autoservicio del Deudor
        loan-requests/[id]/                      CRUD propio + publish/withdraw/
                                                   targets/quotes(+select) (Fase 13)
      contracts/[id]/                           CRUD + cancel/borrowers/terms
                                                 (+submit/accept/reject/fees)/
                                                 schedule/balance (Fase 6)
      marketplace/loan-requests/[id]/quotes     browse (LENDER) + cotizar (Fase 13)
  proxy.ts                  CORS + requestId, corre antes de toda ruta /api/*
  config/
    env.ts                  punto único de lectura de variables de entorno (fail-fast)
  controllers/               un archivo por dominio (auth, users, adminUsers,
                              lenders, lenderBorrowers, borrowerProfile,
                              twoFactor, health, contracts, loanRequests,
                              loanQuotes)
  services/                  lógica de negocio, con *.integration.test.ts al lado
                              (contra Postgres real, no mocks) — incluye
                              amortization.service.ts (funciones puras, con
                              *.test.ts unitario aparte, sin DB)
  validations/                esquemas Zod (auth, users, lenders, borrowers,
                              contracts, loanRequests, loanQuotes, pagination,
                              parse compartido)
  auth/                      jwt.ts, password.ts, totp.ts — primitivas de Fase 2
  middlewares/                withAuth, withRole, requireContractAccess (BE-038,
                              consumido por Fase 6/13), rateLimit, cors — ver
                              src/middlewares/README.md (sin withTenantScope:
                              descartado, D-P6-1)
  repositories/               vacío — contracts.service.ts no lo terminó
                              necesitando, ver src/repositories/README.md
  jobs/                       recomputeContractDelinquency.ts (BE-063),
                              assessLateFees.ts (BE-064) — funciones invocables,
                              sin cron cableado todavía (ver src/jobs/README.md)
  db/
    prisma.ts                cliente Prisma (instancia única, reusada en dev)
    testFixtures.ts          fixtures compartidas por los tests de integración
  errors/
    AppError.ts              error tipado con statusCode/code
    errorHandler.ts          convierte cualquier error en respuesta HTTP, logueado con requestId
  lib/
    apiResponse.ts           helpers apiSuccess()/apiError() (forma JSON única)
    logger.ts                logger JSON estructurado + getRequestId()
    email.ts                 sendEmail() agnóstico de proveedor (modo dev sin EMAIL_API_KEY)
    audit.ts                 logAuditEvent() — AuditLog de solo inserción
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

Todas las respuestas usan la forma `{ success, data }` / `{ success: false,
error }` de `lib/apiResponse.ts`, sin excepción — ver el contrato completo de
cada endpoint (request/response/errores) en
[Docs/API_REFERENCE.md](Docs/API_REFERENCE.md), no duplicado acá.

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
- **`User.role` fijo por persona** (`ADMIN`/`LENDER`/`BORROWER`/`BOOKKEEPER`/
  `INSURANCE_COMPANY`), no un modelo simétrico tipo `LoanParty` por préstamo
  — modelo jerárquico multi-tenant confirmado explícitamente con Spencer
  (`D0-1`): el Prestamista crea el `Contract`, el Deudor acepta sus términos.
  El tenant real es `LenderCompany` (un `LenderProfile` puede tener N),
  nunca la sesión sola — ver [Docs/plan/07](Docs/plan/07-autenticacion-y-autorizacion.md).
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

Ver [`Docs/IMPLEMENTATION_PROGRESS.md`](Docs/IMPLEMENTATION_PROGRESS.md)
para el detalle ticket por ticket de qué está hecho, y
[`Docs/plan/14-roadmap.md`](Docs/plan/14-roadmap.md) para el orden
recomendado del resto. Resumen:

- **Fase 7 (Pagos)** — próxima en el roadmap: registro manual de pagos,
  waterfall mora→interés→capital, historial de transacciones. Stripe
  (`BE-065`/`066`/`070`) sigue bloqueado por la decisión Connect vs cuenta
  única (`A-3`).
- **Fase 13, resto** — `LoanRequestInvite` (invitar por correo a alguien
  sin cuenta), integración RentCast, `BorrowerApplication` (vetting),
  `BorrowerSubscription`.
- **Fase 11 (Documentos)** — motor de PDF, storage S3, Commitment Letter.
- **Fase 12 (Payoff)**, **Fase 14 (Dashboards/Ratings)**, **Fase 15
  (Exports)** — sin empezar.
- Conectar el frontend a este backend (hoy `paymyloan` no le apunta a
  nada).
- Decidir infraestructura de despliegue (reverse proxy/TLS, mismo servidor
  que el frontend o separado).
