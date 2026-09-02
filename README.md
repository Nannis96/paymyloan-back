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
| Prisma / PostgreSQL | 6.19.3 / 16 |
| bcryptjs / zod | 3.0.3 / 4.5.4 |

Sin Tailwind, sin `lucide-react`: no hay UI, es un backend puro. Sin
NextAuth todavía: no hay sesión ni login, solo el modelo de usuario y sus
endpoints CRUD.

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

## Puerto

**4000** (dev y prod), para no chocar con el frontend, que usa 3000.
Configurable con la variable `PORT` en `.env` — se aplica al mapeo de
puerto host↔contenedor en ambos `docker-compose*.yml` (el contenedor
siempre escucha en 4000 puertas adentro).

## Variables de entorno

Ver `.env.example`. `PORT` y `NODE_ENV` se leen en `src/config/env.ts`;
`DATABASE_URL` la lee Prisma directamente (`prisma/schema.prisma`). El
archivo también documenta, comentadas, variables reservadas para cuando
existan esas piezas (`JWT_SECRET`, `CORS_ORIGIN`): no se leen en ningún
lado del código todavía.

## Estructura

```
prisma/
  schema.prisma            datasource + modelo User
  migrations/               historial de migraciones SQL
src/
  app/
    api/
      health/route.ts       GET /api/health — sonda de infraestructura
      users/route.ts         POST /api/users — alta de usuario
      users/[id]/route.ts     PATCH (edición) y DELETE (eliminado lógico)
  config/
    env.ts                  punto único de lectura de variables de entorno
  controllers/
    health.controller.ts    orquesta la respuesta del endpoint de salud
    users.controller.ts     valida input (Zod) y llama a users.service
  services/
    users.service.ts        lógica de negocio: alta, edición, eliminado lógico
  validations/
    users.validation.ts     esquemas Zod de entrada para /api/users
  middlewares/               middlewares reutilizables (vacío por ahora)
  db/
    prisma.ts                cliente Prisma (instancia única, reusada en dev)
  errors/
    AppError.ts              error tipado con statusCode/code
    errorHandler.ts          convierte cualquier error en respuesta HTTP
  lib/
    apiResponse.ts           helpers apiSuccess()/apiError() (forma JSON única)
  types/
    api.ts                   tipos compartidos de la forma de respuesta
public/                     estáticos servidos tal cual (vacío hoy)
Dockerfile                  multietapa: deps → dev / builder → runner
docker-compose.yml          producción (db + migrate + api)
docker-compose.dev.yml      desarrollo con hot reload (db + api)
.env.example                variables soportadas hoy + reservadas a futuro
```

### Flujo de una request

`route.ts` (HTTP) → `controller` (valida el input con Zod y llama a un
`service`) → `service` (lógica de negocio, habla con Prisma) → `lib/apiResponse`
(formatea `{ success, data }` / `{ success: false, error }`) — con
`errors/errorHandler.ts` capturando cualquier excepción en el medio.
`GET /api/health` sigue siendo el ejemplo mínimo sin negocio ni DB;
`/api/users` es el primero que implementa la cadena completa contra Postgres.

### API de usuarios

Identidad, contraseña y estado de 2FA — sin rol de negocio: el rol
(Lender / Borrower / Viewer) vive en la relación préstamo↔persona, todavía
sin modelar (ver alcance §3/§7). Todas las respuestas usan la forma
`{ success, data }` / `{ success: false, error }` de `lib/apiResponse.ts`.

| Método | Ruta | Qué hace |
|---|---|---|
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
- **`middlewares/` sigue vacío a propósito.** Todavía no hay nada que deba
  correr antes de que la request llegue a una ruta (ej. sesión/JWT); se
  llena cuando exista auth real.
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

## Qué queda pendiente (fuera de alcance de esta etapa, a propósito)

- Conectar el frontend a este backend (hoy `paymyloan` no le apunta a
  nada; sigue funcionando standalone vía `NEXT_PUBLIC_REGISTRO_ENDPOINT`
  vacío).
- Autenticación (sesión, JWT, 2FA por TOTP — `User` ya tiene los campos,
  falta el flujo).
- `GET /api/users` (listar/leer): no se pidió para esta etapa, solo alta,
  edición y eliminado lógico.
- `Property`, `Loan`, `LoanParty` y el resto del modelo de datos de
  `../paymyloan-alcance.html` §7 — `User` es la primera pieza únicamente.
- CORS: definir `CORS_ORIGIN` y aplicarlo cuando el frontend empiece a
  llamar a esta API desde el navegador.
- Decidir infraestructura de despliegue (reverse proxy/TLS, mismo servidor
  que el frontend o separado, y si Postgres corre en el mismo Docker host
  o en un servicio administrado).
