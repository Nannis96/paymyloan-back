# paymyloan-back — Backend/API de PayMyLoan.ai

Backend base para [paymyloan.ai](https://paymyloan.ai), proyecto **independiente**
del frontend (`../paymyloan`). Por ahora es solo la estructura, sin lógica
de negocio: sin autenticación, sin base de datos, sin endpoints reales y
**sin ninguna conexión con el frontend todavía**.

## Stack

Versiones alineadas con `paymyloan` (frontend) para que el código sea
portable entre repos.

| Pieza | Versión |
|---|---|
| Next.js (App Router, Turbopack) | 16.1.1 |
| React / React DOM | 19.2.3 (dependencia de Next; no se usa JSX) |
| TypeScript | 5.x |

Sin Tailwind, sin `lucide-react`: no hay UI, es un backend puro. Sin
Prisma, sin NextAuth: todavía no hay base de datos ni autenticación.

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

Requiere Node 22 y npm instalados en el host:

```bash
npm install
npm run dev
```

## Puerto

**4000** (dev y prod), para no chocar con el frontend, que usa 3000.
Configurable con la variable `PORT` en `.env` — se aplica al mapeo de
puerto host↔contenedor en ambos `docker-compose*.yml` (el contenedor
siempre escucha en 4000 puertas adentro).

## Variables de entorno

Ver `.env.example`. Hoy solo se usan `PORT` y `NODE_ENV` (leídas en un solo
lugar: `src/config/env.ts`). El archivo también documenta, comentadas,
variables reservadas para cuando existan esas piezas (`DATABASE_URL`,
`JWT_SECRET`, `CORS_ORIGIN`): no se leen en ningún lado del código todavía.

## Estructura

```
src/
  app/
    api/
      health/route.ts     GET /api/health — único endpoint real hoy
  config/
    env.ts                 punto único de lectura de variables de entorno
  controllers/
    health.controller.ts   orquesta la respuesta del endpoint de salud
  services/                lógica de negocio (vacío, ver README interno)
  validations/             esquemas de validación de input (vacío)
  middlewares/             middlewares reutilizables (vacío)
  db/                      conexión/cliente de base de datos (vacío)
  errors/
    AppError.ts             error tipado con statusCode/code
    errorHandler.ts         convierte cualquier error en respuesta HTTP
  lib/
    apiResponse.ts          helpers apiSuccess()/apiError() (forma JSON única)
  types/
    api.ts                  tipos compartidos de la forma de respuesta
public/                     estáticos servidos tal cual (vacío hoy)
Dockerfile                  multietapa: deps → dev / builder → runner
docker-compose.yml          producción
docker-compose.dev.yml      desarrollo con hot reload
.env.example                variables soportadas hoy + reservadas a futuro
```

Cada carpeta vacía (`services/`, `validations/`, `middlewares/`, `db/`)
tiene su propio `README.md` explicando qué va a vivir ahí.

### Flujo de una request

`route.ts` (HTTP) → `controller` (arma la respuesta, futuro: valida input y
llama a un `service`) → `service` (lógica de negocio, futuro) → `lib/apiResponse`
(formatea `{ success, data }` / `{ success: false, error }`) — con
`errors/errorHandler.ts` capturando cualquier excepción en el medio. El
endpoint `GET /api/health` implementa esta cadena completa como ejemplo
funcional mínimo, sin tocar negocio, DB ni auth.

## Decisiones de arquitectura

- **`src/` en vez de `app/` en la raíz.** El frontend no lo necesita
  (solo tiene páginas), pero un backend con capas (controllers, services,
  validations, errors...) queda más ordenado separando "rutas HTTP"
  (`src/app`) de "resto de la aplicación" (`src/{config,controllers,...}`).
- **Sin páginas, solo `api/`.** Es un backend, no una app con UI. Se
  verificó que Next.js construye y corre sin problema sin ningún
  `page.tsx`/`layout.tsx` en el árbol.
- **Capas vacías con `README.md`, no código de ejemplo especulativo.**
  Se prefirió dejar `services/`, `validations/`, `middlewares/` y `db/`
  documentadas pero vacías, en vez de inventar un `user.service.ts` o un
  cliente de base de datos que no correspondería a un requerimiento real
  todavía (y que probablemente no coincidiría con lo que se necesite
  después).
- **Endpoint de salud como única pieza funcional.** Sirve para dos cosas:
  demuestra el patrón route → controller → error handler → respuesta
  JSON de forma end-to-end (probado, no solo diseñado), y es lo que usa el
  `HEALTHCHECK` del `Dockerfile`.
- **Forma de respuesta JSON única (`ApiSuccessBody`/`ApiErrorBody`).**
  Para que cada endpoint futuro no reinvente su propio formato de error o
  de éxito.
- **`npm ci` con `package-lock.json` versionado**, igual que el frontend,
  para builds de Docker reproducibles.
- **`node:22-alpine`.** No hay dependencias nativas todavía (sin
  Prisma/bcrypt). Si más adelante se agrega algo que requiera compilar,
  cambiar a `node:22-slim` — mismo criterio que ya documenta el
  `Dockerfile` del frontend.
- **Puerto 4000 y sin nginx/TLS todavía.** El frontend ya ocupa el 3000 y
  tiene su propio reverse proxy; el backend no necesita replicar eso hasta
  que se decida cómo se va a desplegar (mismo dominio detrás de un mismo
  nginx, subdominio propio, etc. — decisión de infraestructura pendiente).

## Qué queda pendiente (fuera de alcance de esta etapa, a propósito)

- Conectar el frontend a este backend (hoy `paymyloan` no le apunta a
  nada; sigue funcionando standalone vía `NEXT_PUBLIC_REGISTRO_ENDPOINT`
  vacío).
- Autenticación (sesión, JWT, lo que se decida).
- Conexión a base de datos (elegir motor/ORM, definir `src/db/`).
- Endpoints de negocio reales (registro, préstamos, `LoanParty`, etc. —
  ver `../paymyloan-alcance.html`).
- Validación de input real (elegir librería, ej. Zod, y usar
  `src/validations/`).
- CORS: definir `CORS_ORIGIN` y aplicarlo cuando el frontend empiece a
  llamar a esta API desde el navegador.
- Decidir infraestructura de despliegue (reverse proxy/TLS, mismo servidor
  que el frontend o separado).
