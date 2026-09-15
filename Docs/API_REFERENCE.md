# API Reference — PayMyLoan Backend

Documentación de las APIs **realmente implementadas** en este momento — a
diferencia de [`plan/06-api-endpoints.md`](plan/06-api-endpoints.md) (el mapa
completo de todo lo que el plan prevé, incluyendo lo que todavía no existe),
este documento describe solo lo que hoy corre: request, response, códigos de
error y variables de entorno de cada endpoint, tal como está en el código.
Fuente de verdad = `src/app/api/**/route.ts` + sus controllers/services — si
este documento y el código alguna vez difieren, gana el código.

Estado de avance por fase: [IMPLEMENTATION_PROGRESS.md](IMPLEMENTATION_PROGRESS.md).
Decisiones de diseño detrás de cada endpoint de auth: [plan/07](plan/07-autenticacion-y-autorizacion.md) y [plan/17](plan/17-fase-2-actualizada.md).

---

## Índice

- [Convenciones](#convenciones)
- [Variables de entorno](#variables-de-entorno)
- [Salud](#salud)
- [Usuarios](#usuarios-srcappapiusers)
- [Autenticación](#autenticación-srcappapiauth)
- [Administración de usuarios](#administración-de-usuarios-srcappapiadminusersid)
- [Prestamistas — Admin](#prestamistas--admin-srcappapiadminlenders)
- [Prestamistas y Deudores — autoservicio](#prestamistas-y-deudores--autoservicio)
- [Contratos](#contratos-srcappapicontracts)
- [Marketplace / Loan Requests](#marketplace--loan-requests-srcappapiborrowersmeloan-requests-srcappapimarketplaceloan-requests)
- [Catálogo de códigos de error](#catálogo-de-códigos-de-error)

---

## Convenciones

**Base URL**: `http://localhost:4000` en desarrollo (`PORT`, default `4000`). Todas las rutas cuelgan de `/api`.

**Formato de respuesta** — toda ruta devuelve uno de estos dos sobres (`src/types/api.ts`), nunca el dato "pelado":

```jsonc
// éxito
{ "success": true, "data": { /* lo que sea que documente cada endpoint */ } }

// error
{ "success": false, "error": { "message": "texto para mostrar", "code": "CODIGO_ESTABLE" } }
```

`code` es lo que un cliente debería usar para bifurcar lógica (nunca parsear `message`, que es texto humano en español y puede cambiar). Ver el [catálogo completo](#catálogo-de-códigos-de-error) al final.

**Autenticación**: `Authorization: Bearer <accessToken>` en las rutas marcadas "Autenticado". El access token es un JWT propio (no NextAuth, no cookies) firmado con `JWT_ACCESS_SECRET`, payload `{ sub: userId, role }` — **sin** `lenderId` (ver [D-P2-2](plan/00-contradicciones-y-decisiones.md#decisiones-2026-09-06-ronda-fase-2)); para saber con qué `LenderCompany`(s) opera un usuario hay que llamar a [`GET /api/auth/me`](#get-apiauthme). Vida corta: 15 min (`JWT_ACCESS_TTL`).

**Sesión vs. rol**: `src/middlewares/withAuth.ts` (verifica el token, adjunta `session`) y `src/middlewares/withRole.ts` (verifica el rol) son los middlewares definitivos (Fase 3). **`withRole` además exige 2FA activo por default para ADMIN/LENDER** en endpoints de negocio (escrituras) — ver el aviso en cada endpoint afectado y el código `TWO_FACTOR_REQUIRED` en el [catálogo](#catálogo-de-códigos-de-error). Quedan exentos de ese chequeo de 2FA: lecturas (`GET /api/users`), autoservicio sin rol específico (`logout`, `logout-all`, `GET`/`PATCH /api/auth/me`) y las propias rutas `/api/auth/2fa/*` (ahí es donde se activa el 2FA que la regla exige en el resto).

**Rate limiting**: en memoria por proceso (`src/middlewares/rateLimit.ts`), no distribuido — si el backend corre con más de una réplica, cada una lleva su propio contador. La clave es `"<bucket>:<ip>"`, con la IP tomada de `X-Forwarded-For` (primer valor de la lista; sin ese header, la clave es `"<bucket>:unknown"` y todos los clientes sin ese header comparten el mismo cupo). Cada bucket (`login`, `login2fa`, `password-forgot`) es independiente — agotar uno no afecta a los demás (criterio explícito de `BE-028`: un código de 2FA incorrecto no debe consumir el cupo de `login`).

**`x-request-id`**: todo response lleva ese header (generado por `src/proxy.ts` si el cliente no lo mandó); útil para correlacionar con los logs estructurados del backend.

**Paginación** (`GET /api/admin/lenders`, `GET /api/lenders/me/borrowers`): query params `page` (default `1`), `pageSize` (default `20`, máximo `100`), `search` (opcional). Respuesta:

```jsonc
{ "success": true, "data": { "items": [ /* ... */ ], "page": 1, "pageSize": 20, "total": 3, "totalPages": 1 } }
```

**Acceso multi-empresa sin selector de tenant** (`D-P4-1`, confirmado definitivo por `D-P6-1`): un `LENDER` puede tener más de una `LenderCompany`. No existe (ni se va a construir — `withTenantScope` quedó descartado, no solo diferido) ningún mecanismo para indicar "con cuál empresa estoy operando" que persista entre requests: las lecturas de `/api/lenders/me/borrowers*` devuelven resultados de **todas** las empresas del Lender, y la creación (`POST .../borrowers`, `POST /api/contracts`) resuelve la empresa destino sola si hay una sola, o exige `lenderCompanyId` explícito si hay más de una. Mismo patrón que usará el matching de marketplace (Fase 13) una vez implementado.

---

## Variables de entorno

Fuente única: `src/config/env.ts` (`.env.example` documenta lo mismo con comentarios). En `NODE_ENV=production`, el proceso corta al arrancar si falta `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` o `DATABASE_URL`; el resto tiene un valor por defecto seguro para desarrollo.

| Variable | Default (dev) | Usada por | Para qué |
|---|---|---|---|
| `PORT` | `4000` | todo el proceso | Puerto donde escucha Next |
| `NODE_ENV` | `development` | todo el proceso | `development` / `production` / `test` — cambia validaciones fail-fast, seeders bloqueados, etc. |
| `DATABASE_URL` | — (obligatoria) | todo lo que toca Prisma | Conexión a Postgres |
| `JWT_ACCESS_SECRET` | placeholder inseguro | `src/auth/jwt.ts` | Firma/verifica access tokens **y** pending tokens de 2FA (mismo secreto, distinguidos por el claim `purpose`) |
| `JWT_REFRESH_SECRET` | placeholder inseguro | *(provisionada, aún sin uso)* | Reservada — el refresh token implementado es opaco (no JWT), así que hoy no la lee ningún código; queda exigida en producción por si un futuro rediseño la necesita |
| `JWT_ACCESS_TTL` | `15m` | `signAccessToken` | Vida del access token |
| `JWT_REFRESH_TTL` | `30d` | `login`/`loginTwoFactor`/`refresh` (`auth.service.ts`) | Vida del refresh token (columna `RefreshToken.expiresAt`) |
| `BCRYPT_COST` | `12` | `src/auth/password.ts`, `users.service.ts` | Costo de `bcrypt.hash` para `User.password` |
| `CORS_ORIGIN` | `http://localhost:3000` | `src/proxy.ts` (CORS) y `passwordReset.service.ts` (arma la URL del link de reset) | Origen permitido; también base del link `{CORS_ORIGIN}/reset-password?token=...` que se envía por correo |
| `TOTP_ISSUER` | `PayMyLoan` | `src/auth/totp.ts` | Nombre que muestra la app autenticadora (Google Authenticator, etc.) al escanear el QR |
| `REQUIRE_TWO_FACTOR` | `true` (exigido salvo `"false"` explícito) | `src/middlewares/withRole.ts` | Interruptor temporal (`D-P4-4`) para probar el resto de la API sin activar 2FA en cada usuario de prueba — en `"false"`, `withRole` saltea solo el chequeo de 2FA (rol, cuenta activa, `mustChangePassword` siguen exigidos). Nunca se toca en producción; pensado para sacarse del todo más adelante |
| `EMAIL_PROVIDER` | `resend` | `src/lib/email.ts` | Proveedor detrás de `sendEmail()` — hoy solo `"resend"` está implementado |
| `EMAIL_API_KEY` | *(vacío)* | `src/lib/email.ts` | API key de Resend. **Si está vacío, `sendEmail()` no llama a ningún proveedor — loguea el correo completo (`to`/`subject`/`html`) y retorna** (modo dev, ver [D-P2-1](plan/00-contradicciones-y-decisiones.md#decisiones-2026-09-06-ronda-fase-2)) |
| `EMAIL_FROM` | `servicing@paymyloan.ai` | `src/lib/email.ts` | Remitente en los correos enviados vía Resend |
| `RATE_LIMIT_LOGIN_MAX` | `5` | `login`, `login/2fa`, `password/forgot` | Intentos permitidos por ventana, por bucket+IP |
| `RATE_LIMIT_LOGIN_WINDOW_MS` | `900000` (15 min) | idem | Duración de la ventana |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PUBLISHABLE_KEY` | *(vacío)* | *(sin uso todavía)* | Reservadas para Fase 7 (Pagos) — bloqueadas por la decisión Stripe Connect vs. cuenta única |
| `S3_BUCKET` / `S3_REGION` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | *(vacío)* | *(sin uso todavía)* | Reservadas para Fase 11 (Documentos) |

---

## Salud

### `GET /api/health`

**¿Para qué sirve?** Para que un balanceador de carga, Docker o un monitoreo externo verifiquen que el proceso sigue vivo — no lo llama el frontend de la app.

Sonda de infraestructura (Docker `HEALTHCHECK`, balanceador, monitoreo externo) — no es un endpoint de negocio y no toca la base de datos.

- **Auth**: Público.
- **Response `200`**:
  ```json
  { "success": true, "data": { "status": "ok", "environment": "development", "uptime": 123.45, "timestamp": "2026-09-07T14:38:48.471Z" } }
  ```

---

## Usuarios (`src/app/api/users/`)

> **Restringido a ADMIN desde el 2026-09-07 (`D-P2-4`, `BE-098`).** Hasta esa fecha estos 4 endpoints no verificaban sesión ni rol — quedó documentado acá como aviso mientras duró y ya no aplica. Hoy los 4 exigen `Authorization: Bearer <accessToken>` de un usuario con `role=ADMIN`.

### `GET /api/users`

**¿Para qué sirve?** Para que un Admin vea de un vistazo todas las cuentas del sistema (de cualquier rol) y decida a quién activar, desactivar o editar.

Lista los usuarios **no eliminados lógicamente** (`deletedAt IS NULL`) — incluye tanto activos como inactivos, es lo que el Admin necesita ver para decidir a quién activar/desactivar.

- **Auth**: Autenticado, rol `ADMIN`.
- **Response `200`**: `data` = array de `SafeUser` (ver forma abajo), orden `createdAt desc`.
- **Errores**: `401 UNAUTHENTICATED`/`INVALID_TOKEN` · `403 FORBIDDEN` (sesión válida pero no es ADMIN).

### `POST /api/users`

**¿Para qué sirve?** Para que un Admin dé de alta una cuenta a mano (sin pasar por el auto-registro público) — es el único camino para crear cuentas de roles que no pueden auto-registrarse (`ADMIN`, `BOOKKEEPER`, `INSURANCE_COMPANY`).

Alta de usuario por un Admin (identidad + rol, opcionalmente teléfono e `isActive`). **No pide contraseña** (`D-P2-5`, 2026-09-07) — nace sin una utilizable, igual que el auto-registro (`POST /api/auth/register`, más abajo). No confundir tampoco con ese endpoint: acá lo llama un Admin autenticado y la cuenta queda **activa por default** salvo que se mande `isActive:false` explícito (el auto-registro siempre nace inactivo).

- **Auth**: Autenticado, rol `ADMIN`. Es una escritura de negocio — el Admin necesita 2FA activo (`D-P3-1`, ver [Convenciones](#convenciones)).
- **Request body**:

  | Campo | Tipo | Validación |
  |---|---|---|
  | `name` | string | 1–120 caracteres, se recorta (`trim`) |
  | `email` | string | formato email, se normaliza a minúsculas |
  | `phone` | string | opcional — **exactamente 10 dígitos** (`^\d{10}$`), sin espacios/guiones/`+` |
  | `role` | string | uno de `ADMIN`, `LENDER`, `BORROWER`, `BOOKKEEPER`, `INSURANCE_COMPANY` — obligatorio, sin default |
  | `isActive` | boolean | opcional — sin este campo, nace **activo** (mismo default que la tabla) |

  ```json
  {
    "name": "Jane Cooper",
    "email": "jane.cooper@example.com",
    "phone": "5125550100",
    "role": "BORROWER",
    "isActive": true
  }
  ```

- **Response `201`**:
  ```jsonc
  {
    "success": true,
    "data": {
      /* ...SafeUser... */
      // presentes salvo que se haya mandado isActive:false
      "temporaryPassword": "48213967",
      "emailSent": true
    }
  }
  ```
  Sin `isActive:false` en el body, la cuenta queda activa de inmediato: se genera una contraseña temporal de **8 dígitos numéricos**, se intenta enviar por correo, y se devuelve en `temporaryPassword` — mismo mecanismo que activar por `PATCH`/`POST /api/admin/users/:id/activate` (ver [esas secciones](#patch-apiusersid)). Con `isActive:false`, la respuesta no trae `temporaryPassword` ni `emailSent` — la cuenta queda sin contraseña utilizable hasta que alguien la active después.
- **Errores**: `400 VALIDATION_ERROR` (body inválido, incluyendo un `phone` que no tiene 10 dígitos) · `401 UNAUTHENTICATED`/`INVALID_TOKEN` · `403 FORBIDDEN` (no es ADMIN) · `403 TWO_FACTOR_REQUIRED` (es ADMIN, pero sin 2FA activo) · `409 EMAIL_TAKEN` (el correo ya existe).

### `PATCH /api/users/:id`

**¿Para qué sirve?** Para que un Admin corrija los datos de cualquier cuenta, o la active/desactive — es el mismo endpoint que se usa para "prender" a alguien que nació inactivo.

Edición parcial — cualquier subconjunto no vacío de `name`/`email`/`phone`/`password`/`isActive`.

- **Auth**: Autenticado, rol `ADMIN` + 2FA activo (`D-P3-1`, es una escritura de negocio).
- **Request body**: mismos campos que `POST` (todos opcionales), pero **al menos uno** debe venir.

  ```json
  {
    "name": "Jane Cooper",
    "phone": "5125550100",
    "isActive": true
  }
  ```

- **Response `200`**:
  ```jsonc
  {
    "success": true,
    "data": {
      /* ...SafeUser... */
      // presentes solo si este PATCH disparó una primera activación (ver abajo)
      "temporaryPassword": "48213967",
      "emailSent": true
    }
  }
  ```
- **Errores**: `400 VALIDATION_ERROR` · `401 UNAUTHENTICATED`/`INVALID_TOKEN` · `403 FORBIDDEN` (no es ADMIN) · `403 TWO_FACTOR_REQUIRED` (es ADMIN, pero sin 2FA activo) · `404 USER_NOT_FOUND` · `409 EMAIL_TAKEN` (si el nuevo correo ya lo usa otro usuario).
- **`isActive`, activación/desactivación desde este mismo endpoint (`D-P2-4`)**: si `isActive` pasa de `false` a `true`, corre exactamente la misma lógica que [`POST /api/admin/users/:id/activate`](#post-apiadminusersidactivate) — en la primera activación (el usuario nunca inició sesión) genera una contraseña temporal, la guarda hasheada, intenta enviarla por correo, **y la devuelve en la respuesta** (`temporaryPassword`) — mientras no haya un proveedor de correo real configurado, esta es la forma confiable de que el Admin la vea. Una reactivación (el usuario ya había iniciado sesión antes) no toca la contraseña ni agrega `temporaryPassword`. Si `isActive` pasa de `true` a `false`, revoca todos los refresh tokens vigentes del usuario, igual que `/deactivate`. Un `password` explícito enviado en el mismo body que dispara una primera activación se ignora — gana la contraseña generada.

### `DELETE /api/users/:id`

**¿Para qué sirve?** Para que un Admin dé de baja una cuenta sin destruir su historial — préstamos, documentos y auditoría pueden seguir apuntando a ese usuario.

Eliminación **lógica**: pone `deletedAt = now()`. Nunca borra la fila (puede estar referenciada desde préstamos, documentos o auditoría) — distinto de `isActive` (activar/desactivar), que es reversible y no oculta al usuario de listados.

- **Auth**: Autenticado, rol `ADMIN` + 2FA activo (`D-P3-1`, es una escritura de negocio).
- **Response `200`**: `data` = `SafeUser` con `deletedAt` seteado.
- **Errores**: `401 UNAUTHENTICATED`/`INVALID_TOKEN` · `403 FORBIDDEN` (no es ADMIN) · `403 TWO_FACTOR_REQUIRED` (es ADMIN, pero sin 2FA activo) · `404 USER_NOT_FOUND`.

### Forma de `SafeUser`

Nunca incluye `password` ni `twoFactorSecret` — es lo único que la API expone de un `User`:

```jsonc
{
  "id": "01a0...",           // UUIDv7
  "name": "Dev Admin",
  "email": "admin@paymyloan.dev",
  "phone": null,              // string de 10 dígitos, o null
  "role": "ADMIN",           // ADMIN | LENDER | BORROWER | BOOKKEEPER | INSURANCE_COMPANY
  "isActive": true,
  "isTwoFactorEnabled": false,
  "mustChangePassword": false, // true mientras siga siendo una contraseña generada por el sistema (D-P4-2)
  "createdAt": "2026-09-04T23:45:41.967Z",
  "updatedAt": "2026-09-04T23:45:41.967Z",
  "deletedAt": null
}
```

---

## Autenticación (`src/app/api/auth/`)

JWT propio (access + refresh), sin NextAuth ni cookies — ver [plan/07 §7.1](plan/07-autenticacion-y-autorizacion.md#71-estrategia-de-sesión). Resumen de todos los endpoints de este módulo:

| Método | Ruta | Auth | Rate limit |
|---|---|---|---|
| POST | `/api/auth/register` | Público | — |
| POST | `/api/auth/login` | Público | bucket `login` |
| POST | `/api/auth/login/2fa` | Público (con `pendingToken`) | bucket `login2fa` |
| POST | `/api/auth/refresh` | Público (con `refreshToken`) | — |
| POST | `/api/auth/logout` | Autenticado | — |
| POST | `/api/auth/logout-all` | Autenticado | — |
| GET | `/api/auth/me` | Autenticado | — |
| PATCH | `/api/auth/me` | Autenticado | — |
| POST | `/api/auth/password/forgot` | Público | bucket `password-forgot` |
| POST | `/api/auth/password/reset` | Público (con `token`) | — |
| POST | `/api/auth/2fa/setup` | Autenticado, rol ADMIN o LENDER | — |
| POST | `/api/auth/2fa/verify` | Autenticado, rol ADMIN o LENDER | — |
| POST | `/api/auth/2fa/disable` | Autenticado, rol ADMIN o LENDER | — |
| POST | `/api/auth/2fa/recovery-codes` | Autenticado, rol ADMIN o LENDER | — |

### `POST /api/auth/register`

**¿Para qué sirve?** Para que una persona (futuro Lender o Borrower) cree su propia cuenta sin que nadie la haya dado de alta antes. Queda inactiva hasta que un Admin la active.

Auto-registro de `LENDER` o `BORROWER` — el usuario crea su propia cuenta, sin que un Admin/Lender lo haya dado de alta antes (`D-P1-10`). **No pide contraseña.** La cuenta nace `isActive=false`; solo un Admin puede activarla (`POST /api/admin/users/:id/activate`, más abajo), momento en el que recién se genera una contraseña y se envía por correo.

- **Auth**: Público.
- **Request body**:

  | Campo | Tipo | Validación |
  |---|---|---|
  | `name` | string | 1–120 caracteres |
  | `email` | string | formato email, se normaliza a minúsculas |
  | `phone` | string | opcional — exactamente 10 dígitos (`^\d{10}$`) |
  | `role` | string | **solo** `LENDER` o `BORROWER` — `ADMIN`/`BOOKKEEPER`/`INSURANCE_COMPANY` no pueden auto-registrarse |

  ```json
  {
    "name": "Jane Cooper",
    "email": "jane.cooper@example.com",
    "phone": "5125550100",
    "role": "BORROWER"
  }
  ```

- **Response `202`** (siempre, exista o no ya el correo — anti-enumeración, misma postura que `password/forgot`):
  ```json
  { "success": true, "data": { "message": "Si los datos son válidos, tu cuenta quedará pendiente de activación. Una vez que un administrador la active, recibirás un correo con tu contraseña temporal." } }
  ```
- **Errores**: `400 VALIDATION_ERROR` (rol inválido, campos faltantes).
- **Qué pasa por dentro**: crea `User(isActive=false, password=hash de un valor aleatorio que nadie conoce)` + `LenderProfile(createdByAdminId=null)` o `BorrowerProfile(createdByUserId=null)`, en una transacción. Si el correo ya existe, no hace nada — responde igual.

### `POST /api/auth/login`

**¿Para qué sirve?** Iniciar sesión con correo y contraseña — primer paso del login. Si la cuenta tiene 2FA activo, todavía no entrega tokens de sesión: hay que completar el paso 2 (`/login/2fa`).

Paso 1 de login. Si el usuario tiene 2FA activo, no emite tokens todavía — hay que completar el paso 2.

- **Auth**: Público. **Rate limit**: bucket `login` (`RATE_LIMIT_LOGIN_MAX` intentos por `RATE_LIMIT_LOGIN_WINDOW_MS`, por IP).
- **Request body**: `{ "email": string, "password": string (1–72 chars) }`.

  ```json
  { "email": "lender1@paymyloan.dev", "password": "DevPass!2026" }
  ```

- **Response `200`** — dos formas posibles:
  ```jsonc
  // sin 2FA
  { "success": true, "data": { "requiresTwoFactor": false, "accessToken": "...", "refreshToken": "...", "user": /* SafeUser */ {} } }

  // con 2FA activo — todavía no hay sesión
  { "success": true, "data": { "requiresTwoFactor": true, "pendingToken": "..." } }
  ```
  `pendingToken` vive 2 minutos y solo sirve para `POST /api/auth/login/2fa` — no es un access token válido para ninguna otra ruta.
- **Errores**:
  - `401 INVALID_CREDENTIALS` — correo inexistente **o** contraseña incorrecta. **A propósito devuelven el mismo mensaje y código**, y el caso "correo inexistente" corre igual un `bcrypt.compare` contra un hash dummy — mitigación de timing attack, para que el tiempo de respuesta no delate cuál de los dos casos fue.
  - `403 ACCOUNT_INACTIVE` — contraseña correcta pero `isActive=false` (se revisa recién *después* de validar la contraseña, para que tampoco sirva para enumerar cuentas).
  - `429 RATE_LIMITED`.

### `POST /api/auth/login/2fa`

**¿Para qué sirve?** Completar el login cuando la cuenta tiene 2FA activo — recién acá se entregan `accessToken`/`refreshToken`.

Paso 2, solo alcanzable con un `pendingToken` válido del paso 1. Acepta un código TOTP **o** un recovery code de un solo uso.

- **Auth**: Público (el `pendingToken` hace de credencial). **Rate limit**: bucket `login2fa`, independiente del bucket `login` — un código incorrecto acá nunca consume el cupo de `/login`.
- **Request body**: `{ "pendingToken": string, "code": string }` — `code` puede ser un TOTP de 6 dígitos o uno de los 8 recovery codes entregados al activar 2FA.

  ```json
  { "pendingToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...", "code": "482913" }
  ```

- **Response `200`**: igual que el login exitoso sin 2FA (`requiresTwoFactor: false, accessToken, refreshToken, user`).
- **Errores**: `401 INVALID_TOKEN` (pendingToken inválido/expirado) · `401 INVALID_CREDENTIALS` (el usuario detrás del pendingToken ya no es válido — desactivado, borrado, o perdió el 2FA entre el paso 1 y el 2) · `401 INVALID_2FA_CODE` (código y recovery code, ambos inválidos) · `429 RATE_LIMITED`.
- **Nota**: un recovery code usado una vez queda marcado (`usedAt`) y no vuelve a funcionar.

### `POST /api/auth/refresh`

**¿Para qué sirve?** Renovar la sesión (pedir un `accessToken` nuevo, que dura solo 15 min) sin volver a pedir usuario/contraseña, usando el `refreshToken` que se recibió al loguearse.

Rota el refresh token en cada uso — nunca se puede reusar uno ya canjeado.

- **Auth**: Público (el `refreshToken` hace de credencial).
- **Request body**: `{ "refreshToken": string }`.

  ```json
  { "refreshToken": "8f3b1c2a-9e4d-4a7b-9c3e-1a2b3c4d5e6f" }
  ```

- **Response `200`**: nuevo par `{ accessToken, refreshToken, user }` — el `refreshToken` viejo queda revocado (`revokedAt`), enlazado al nuevo vía `replacedByTokenId`.
- **Errores**:
  - `401 INVALID_TOKEN` — token inexistente, expirado, o ya revocado.
  - **Detección de robo**: si el token presentado ya había sido **rotado** antes (alguien más lo canjeó primero — `replacedByTokenId` seteado) y se reintenta el original, se revocan **todos** los refresh tokens vigentes de ese usuario, en todas sus sesiones/dispositivos. Un token revocado por un `logout()` normal (sin rotación previa) no dispara esta cascada — solo se rechaza ese token puntual.

### `POST /api/auth/logout`

**¿Para qué sirve?** Cerrar sesión en un solo dispositivo/pestaña — revoca únicamente el `refreshToken` que se le manda, el resto de sesiones abiertas del usuario siguen activas.

Revoca un refresh token puntual.

- **Auth**: Autenticado (`Authorization: Bearer <accessToken>`) + el `refreshToken` a revocar en el body.
- **Request body**: `{ "refreshToken": string }`.

  ```json
  { "refreshToken": "8f3b1c2a-9e4d-4a7b-9c3e-1a2b3c4d5e6f" }
  ```

- **Response `200`**: `{ "loggedOut": true }`.
- **Errores**: `401 UNAUTHENTICATED` (sin access token) · `401 INVALID_TOKEN` (access token inválido/expirado) · `400 VALIDATION_ERROR`.

### `POST /api/auth/logout-all`

**¿Para qué sirve?** Cerrar sesión en todos los dispositivos a la vez — por ejemplo si el usuario sospecha que alguien más tiene acceso a su cuenta.

Revoca **todos** los refresh tokens vigentes del usuario autenticado (todas sus sesiones).

- **Auth**: Autenticado. Sin body.
- **Response `200`**: `{ "loggedOut": true }`.

### `GET /api/auth/me`

**¿Para qué sirve?** Es el endpoint que cualquier cliente (frontend, mobile) llama justo después de loguearse, para saber quién es el usuario y con qué `LenderCompany`(s) puede operar — el token JWT en sí no trae esa información.

Perfil propio + el detalle de rol correspondiente. Como el JWT no lleva `lenderId` (ver [Convenciones](#convenciones)), esta es la forma de que el cliente sepa con qué `LenderCompany`(s) puede operar.

- **Auth**: Autenticado.
- **Response `200`**:
  ```jsonc
  {
    "success": true,
    "data": {
      "user": /* SafeUser */ {},
      // presente solo si role === "LENDER"
      "lenderProfile": {
        "id": "...",
        "lenderCompanies": [ { "id": "...", "companyName": "...", "status": "ACTIVE", "isOpenToDeals": true } ]
      },
      // presente solo si role === "BORROWER"
      "borrowerProfile": {
        "id": "...",
        "lenderCompanies": [ { "id": "...", "companyName": "..." } ]
      }
    }
  }
  ```
- **Errores**: `401 UNAUTHENTICATED` / `401 INVALID_TOKEN` · `404 USER_NOT_FOUND` (el usuario del token fue borrado después de emitirse).

### `PATCH /api/auth/me`

**¿Para qué sirve?** Para que cualquier usuario logueado (de cualquier rol) edite su propio nombre o teléfono, sin depender de un Admin.

Autoservicio (`BE-099`, nuevo `D-P2-4`): el usuario edita su propia información de contacto. Deliberadamente **no** acepta `email`/`password`/`role`/`isActive` — un campo fuera de este schema se descarta en vez de aplicarse, así que no hay forma de colarlos en el mismo body.

- **Auth**: Autenticado. Sin restricción de rol — cualquiera edita lo suyo.
- **Request body**: `{ "name"?: string, "phone"?: string }` — al menos uno de los dos, `phone` con el mismo formato de 10 dígitos que el resto de la API.

  ```json
  { "name": "Jane Cooper", "phone": "5125550100" }
  ```

- **Response `200`**:
  ```json
  { "success": true, "data": { "user": /* SafeUser actualizado */ {} } }
  ```
- **Errores**: `401 UNAUTHENTICATED`/`INVALID_TOKEN` · `400 VALIDATION_ERROR` (body vacío o `phone` inválido).

### `POST /api/auth/password/forgot`

**¿Para qué sirve?** Pedir un correo con un link para restablecer la contraseña cuando no se la recuerda (o nunca se logueó y no tiene una todavía).

- **Auth**: Público. **Rate limit**: bucket `password-forgot`.
- **Request body**: `{ "email": string }`.

  ```json
  { "email": "lender1@paymyloan.dev" }
  ```

- **Response `200`** (siempre, exista o no el correo — anti-enumeración):
  ```json
  { "success": true, "data": { "message": "Si el correo existe, vas a recibir instrucciones para restablecer tu contraseña." } }
  ```
- **Qué pasa por dentro** (si el correo existe): genera un `PasswordResetToken` opaco (expira en 1h, solo se guarda su hash SHA-256) y envía un correo (plantilla `password-reset`) con el link `{CORS_ORIGIN}/reset-password?token=<token-en-claro>`.

### `POST /api/auth/password/reset`

**¿Para qué sirve?** Fijar una contraseña nueva usando el token que llegó por correo desde `/password/forgot` — cierra el flujo de "olvidé mi contraseña".

- **Auth**: Público (el `token` del correo hace de credencial).
- **Request body**: `{ "token": string, "newPassword": string (8–72 chars) }`.

  ```json
  { "token": "3f9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c", "newPassword": "NewPass!2026" }
  ```

- **Response `200`**: `{ "message": "Contraseña actualizada." }`.
- **Errores**: `400 INVALID_TOKEN` (token inexistente, ya usado, o expirado) · `400 VALIDATION_ERROR`.
- **Efecto secundario importante**: revoca **todos** los refresh tokens del usuario — fuerza a volver a loguearse en todos los dispositivos.

### `POST /api/auth/2fa/setup`

**¿Para qué sirve?** Primer paso para activar 2FA en la cuenta: genera el secreto y el QR para escanear con Google Authenticator/Authy. Todavía no activa nada.

Genera el secreto TOTP — **no activa 2FA todavía**, eso pasa recién en `/verify`.

- **Auth**: Autenticado, rol `ADMIN` o `LENDER`. Sin body.
- **Response `200`**:
  ```json
  { "success": true, "data": { "secret": "4Z3E3OZW...", "otpAuthUrl": "otpauth://totp/PayMyLoan:user%40example.com?secret=...&issuer=PayMyLoan" } }
  ```
  `otpAuthUrl` es lo que se codifica como QR para escanear con Google Authenticator / Authy / etc.
- **Errores**: `403 FORBIDDEN` (rol no permitido) · `409 TWO_FACTOR_ALREADY_ENABLED`.

### `POST /api/auth/2fa/verify`

**¿Para qué sirve?** Segundo y último paso para activar 2FA: confirma que la app autenticadora quedó bien configurada (el usuario manda un código válido) y recién ahí prende `isTwoFactorEnabled`, entregando los recovery codes.

Confirma que el usuario efectivamente pudo generar un código con el secreto de `/setup` — recién ahí activa 2FA.

- **Auth**: Autenticado, rol `ADMIN` o `LENDER`.
- **Request body**: `{ "code": string }` (código TOTP de 6 dígitos).

  ```json
  { "code": "482913" }
  ```

- **Response `200`**:
  ```json
  { "success": true, "data": { "recoveryCodes": ["IqM0k63iCI", "UJspkfptW2", "...8 en total..."] } }
  ```
  Los 8 recovery codes se muestran **una única vez** — solo se guarda su hash SHA-256, no hay forma de volver a consultarlos en claro (si se pierden, hay que regenerarlos con `/recovery-codes`).
- **Errores**: `403 FORBIDDEN` · `401 INVALID_2FA_CODE` (código incorrecto — 2FA sigue sin activarse) · `409 TWO_FACTOR_ALREADY_ENABLED` · `409 TWO_FACTOR_SETUP_REQUIRED` (no se llamó a `/setup` antes).

### `POST /api/auth/2fa/disable`

**¿Para qué sirve?** Apagar 2FA en la cuenta (por ejemplo si se cambió de celular y se perdió acceso a la app autenticadora, pero todavía se tiene un recovery code o la app vieja).

Exige contraseña **y** código TOTP vigente — nunca alcanza con tener la sesión activa (evita que un access token robado, por sí solo, pueda apagar 2FA).

- **Auth**: Autenticado, rol `ADMIN` o `LENDER`.
- **Request body**: `{ "password": string, "code": string }`.

  ```json
  { "password": "DevPass!2026", "code": "482913" }
  ```

- **Response `200`**: `{ "disabled": true }`.
- **Errores**: `403 FORBIDDEN` · `401 INVALID_CREDENTIALS` (password o código incorrectos) · `409 TWO_FACTOR_NOT_ENABLED`.
- **Efecto**: `isTwoFactorEnabled=false`, borra el secreto y **todos** los recovery codes existentes.

### `POST /api/auth/2fa/recovery-codes`

**¿Para qué sirve?** Generar un set nuevo de 8 códigos de respaldo (por ejemplo porque se perdieron o se gastaron los anteriores), invalidando los viejos.

Regenera el set de 8 recovery codes — invalida los anteriores. Misma exigencia que `/disable`.

- **Auth**: Autenticado, rol `ADMIN` o `LENDER`.
- **Request body**: `{ "password": string, "code": string }`.

  ```json
  { "password": "DevPass!2026", "code": "482913" }
  ```

- **Response `200`**: `{ "recoveryCodes": [ /* 8 nuevos, en claro, una única vez */ ] }`.
- **Errores**: igual que `/disable`.

---

## Administración de usuarios (`src/app/api/admin/users/[id]/`)

Adelantados desde Fase 4 (`BE-097`, ver [D-P2-1](plan/00-contradicciones-y-decisiones.md#decisiones-2026-09-06-ronda-fase-2)) porque sin ellos el auto-registro (`POST /api/auth/register`) es un callejón sin salida: una cuenta que nace `isActive=false` necesita alguna forma de activarse.

### `POST /api/admin/users/:id/activate`

**¿Para qué sirve?** Habilitar el acceso de una cuenta que nació inactiva (auto-registro, o creada con `isActive:false`). Si el usuario nunca inició sesión, además le genera y envía una contraseña temporal — es el paso que "destraba" a alguien recién auto-registrado.

- **Auth**: Autenticado, rol `ADMIN` + 2FA activo (`D-P3-1`, es una escritura de negocio).
- **Response `200`**:
  ```jsonc
  {
    "success": true,
    "data": {
      "user": /* SafeUser, isActive: true */ {},
      "emailSent": true,
      // presente solo en una primera activación (ver abajo)
      "temporaryPassword": "48213967"
    }
  }
  ```
- **Errores**: `401 UNAUTHENTICATED`/`INVALID_TOKEN` · `403 FORBIDDEN` (no es ADMIN) · `403 TWO_FACTOR_REQUIRED` (es ADMIN, pero sin 2FA activo) · `404 USER_NOT_FOUND`.
- **Comportamiento según el historial del usuario**:
  - **Primera activación** (`lastLoginAt` nulo — nunca inició sesión, típicamente recién auto-registrado): genera una contraseña temporal, la guarda hasheada (bcrypt), intenta enviarla por correo (plantilla `account-activated`, ver [variables de entorno](#variables-de-entorno) — sin `EMAIL_API_KEY`, el correo se loguea en vez de enviarse de verdad) **y la devuelve también en `temporaryPassword`** (`D-P2-4` — mientras no haya un proveedor de correo real conectado, es la forma confiable de que el Admin la tenga a mano). `emailSent` indica si el envío tuvo éxito, independientemente de que `temporaryPassword` siempre esté presente en este caso.
  - **Reactivación** (el usuario ya había iniciado sesión alguna vez): solo pone `isActive=true`, **no** toca la contraseña ni reenvía correo — `emailSent` viene `false` y `temporaryPassword` no viene en la respuesta.
  - Si el correo de la primera activación falla, el reintento es: `deactivate` → `activate` de nuevo (vuelve a contar como "primera activación" porque `lastLoginAt` sigue nulo, así que regenera y reenvía).
  - El mismo comportamiento (con la misma forma de respuesta) se dispara también desde `PATCH /api/users/:id` con `{ "isActive": true }` — ver [esa sección](#patch-apiusersid).

### `POST /api/admin/users/:id/deactivate`

**¿Para qué sirve?** Bloquear el acceso de una cuenta sin borrarla, y cerrar de paso cualquier sesión que tuviera abierta en ese momento.

- **Auth**: Autenticado, rol `ADMIN` + 2FA activo (`D-P3-1`, es una escritura de negocio).
- **Response `200`**: `{ "success": true, "data": /* SafeUser, isActive: false */ {} }`.
- **Errores**: igual que `/activate`.
- **Efecto secundario**: revoca todos los refresh tokens vigentes del usuario — una cuenta desactivada no puede seguir usando una sesión que ya tenía abierta.

---

## Prestamistas — Admin (`src/app/api/admin/lenders/`)

`BE-041..044`, `BE-040` (rescopeado `D-P4-5`). Este módulo ya **no** da de alta personas — un `LENDER` nace por autoservicio ([`POST /api/auth/register`](#post-apiauthregister)) y un Admin lo activa ([`POST /api/admin/users/:id/activate`](#post-apiadminusersidactivate)). Lo que sí cubre este módulo es la empresa (`LenderCompany`) — el tenant real — sobre un `LenderProfile` que ya existe.

> **`:id` en las 4 rutas de abajo acepta `LenderProfile.id` o el `User.id` de la persona** (`D-P4-7`) — indistintamente. Existen porque [`GET /api/users`](#get-apiusers) (el único lugar donde un Admin ve el id de un Lender sin pasar por `GET /api/admin/lenders`) solo expone `User.id`; exigir `LenderProfile.id` ahí hacía inutilizable ese camino.

### `POST /api/admin/lenders/:id/companies`

**¿Para qué sirve?** Crearle una empresa (`LenderCompany`) nueva a un Lender que ya existe como persona — es lo que convierte a alguien en prestamista "operativo" (sin ninguna empresa, no puede recibir deudores ni contratos).

Un Admin asocia una `LenderCompany` **nueva** a un Lender que ya existe — nunca toca `User`/`LenderProfile`, solo campos de la empresa (`D-P4-5`: rescopeo de `BE-040`, que antes creaba la persona también). Mismo servicio (`lenders.service.ts#createLenderCompany`) que usa la variante autoservicio, [`POST /api/lenders/me/companies`](#post-apilendersmecompanies), abajo.

- **Auth**: Autenticado, rol `ADMIN` + 2FA activo (`D-P3-1`).
- **Request body**:

  | Campo | Tipo | Validación |
  |---|---|---|
  | `companyName` | string | 1–200 caracteres |
  | `ein` | string | formato `XX-XXXXXXX` |
  | `contactPhone` | string | opcional, 10 dígitos — teléfono de la empresa (`LenderCompany.contactPhone`) |
  | `addressLine1` / `addressLine2` / `city` / `state` (2 letras) / `postalCode` | string | dirección de la empresa; `addressLine2` opcional |

  ```json
  {
    "companyName": "Lone Star Capital LLC",
    "ein": "12-3456789",
    "contactPhone": "5125550100",
    "addressLine1": "100 Congress Ave",
    "addressLine2": "Suite 200",
    "city": "Austin",
    "state": "TX",
    "postalCode": "78701"
  }
  ```

- **Response `201`**: `{ "success": true, "data": { /* LenderCompanySummary, ver forma abajo */ } }`.
- **Errores**: `400 VALIDATION_ERROR` · `401 UNAUTHENTICATED`/`INVALID_TOKEN` · `403 FORBIDDEN`/`TWO_FACTOR_REQUIRED` · `404 LENDER_NOT_FOUND` · `409 EIN_TAKEN`.

### `PATCH /api/admin/lenders/:id/companies/:companyId`

**¿Para qué sirve?** Editar los datos de una empresa de un Lender, o — algo que solo puede hacer el Admin — suspenderla (`status: SUSPENDED`) o marcarla como cerrada a nuevos negocios (`isOpenToDeals: false`).

`D-P4-8`, nuevo. Un Admin edita cualquier campo de una `LenderCompany` puntual — incluidos `status` (suspender/reactivar una empresa, `D-P1-8`) e `isOpenToDeals` (`M-4`). `:companyId` se valida contra `:id`: una empresa que existe pero es de otro Lender responde `404`, igual que si no existiera.

- **Auth**: Autenticado, rol `ADMIN` + 2FA activo (`D-P3-1`).
- **Request body**: todos los campos de `POST .../companies` (arriba), todos opcionales, más `isOpenToDeals` (boolean) y `status` (`"ACTIVE"` | `"SUSPENDED"`) — al menos uno.

  ```json
  { "isOpenToDeals": false, "status": "SUSPENDED" }
  ```

- **Response `200`**: `{ "success": true, "data": { /* LenderCompanySummary */ } }`.
- **Errores**: `400 VALIDATION_ERROR` · `401`/`403`/`403 TWO_FACTOR_REQUIRED` · `404 LENDER_NOT_FOUND` · `404 LENDER_COMPANY_NOT_FOUND` · `409 EIN_TAKEN`.

### `DELETE /api/admin/lenders/:id/companies/:companyId`

**¿Para qué sirve?** Dar de baja una sola empresa de un Lender (no a la persona ni a sus otras empresas) — por ejemplo si cerró esa entidad legal puntual.

`D-P4-8`, nuevo. Soft-delete de **una sola** `LenderCompany` (no del Lender ni de sus otras empresas) — bloqueado si esa empresa tiene un `Contract` `ACTIVE`/`DELINQUENT`. Puede dejar al Lender con cero empresas — estado ya válido (el mismo que un recién auto-registrado, `D-P2-1`).

- **Auth**: Autenticado, rol `ADMIN` + 2FA activo (`D-P3-1`).
- **Response `200`**: `{ "success": true, "data": { "deleted": true } }`.
- **Errores**: `401`/`403`/`403 TWO_FACTOR_REQUIRED` · `404 LENDER_NOT_FOUND` · `404 LENDER_COMPANY_NOT_FOUND` · `409 LENDER_HAS_ACTIVE_CONTRACTS`.

### `GET /api/admin/lenders`

**¿Para qué sirve?** Para que un Admin busque y liste todos los Lenders del sistema junto con sus empresas — la pantalla típica de "gestión de prestamistas".

Lista + búsqueda (por nombre/email de la persona o `companyName`) + paginación (ver [Convenciones](#convenciones)) + filtro `status` (`ACTIVE`/`SUSPENDED`, sobre alguna `LenderCompany` del Lender).

- **Auth**: Autenticado, rol `ADMIN` (lectura, exenta de 2FA).
- **Response `200`**: `data` = [resultado paginado](#convenciones) de objetos con la forma de `Lender` (ver abajo).

### `GET /api/admin/lenders/:id`

**¿Para qué sirve?** Ver el detalle completo de un Lender puntual: todas sus empresas, cuántos deudores tiene y cuántos contratos activos — la pantalla de "ficha de prestamista".

Incluye el resumen agregado de **todas** las `LenderCompany` del Lender — no depende de ninguna "empresa activa".

- **Auth**: Autenticado, rol `ADMIN` (lectura, exenta de 2FA).
- **Response `200`**:
  ```jsonc
  {
    "success": true,
    "data": {
      "id": "...",                 // LenderProfile.id
      "user": /* SafeUser */ {},
      "lenderCompanies": [ { "id": "...", "companyName": "...", "ein": "...", "contactPhone": null, "addressLine1": "...", "addressLine2": null, "city": "...", "state": "TX", "postalCode": "...", "isOpenToDeals": true, "status": "ACTIVE" } ],
      "borrowersCount": 3,         // LenderBorrower activos, todas sus empresas
      "activeContractsCount": 1    // Contract en ACTIVE o DELINQUENT, todas sus empresas
    }
  }
  ```
- **Errores**: `401`/`403` (igual que arriba) · `404 LENDER_NOT_FOUND`.

> `LenderProfile` no tiene ningún campo propio editable (`D-P4-8`: su único campo, `contactPhone`, se eliminó por redundante con `User.phone`) — no hay `PATCH /api/admin/lenders/:id`. Editar una empresa es `PATCH .../companies/:companyId` (arriba); editar el nombre/teléfono de la persona es [`PATCH /api/users/:id`](#patch-apiusersid).

### `DELETE /api/admin/lenders/:id`

**¿Para qué sirve?** Dar de baja a un Lender completo: la persona y todas sus empresas de una — bloqueado si alguna empresa tiene contratos en curso, para no dejar deuda huérfana.

Soft-delete de `User` + `LenderProfile` + **todas** sus `LenderCompany` (`deletedAt`, y el `User` además `isActive=false` + revoca sus refresh tokens) — bloqueado si alguna empresa tiene un `Contract` `ACTIVE`/`DELINQUENT`.

- **Auth**: Autenticado, rol `ADMIN` + 2FA activo (escritura).
- **Response `200`**: `data` = `SafeUser` con `deletedAt` seteado.
- **Errores**: `401`/`403`/`403 TWO_FACTOR_REQUIRED` · `404 LENDER_NOT_FOUND` · `409 LENDER_HAS_ACTIVE_CONTRACTS`.

---

## Prestamistas y Deudores — autoservicio

### `GET /api/lenders/me`

**¿Para qué sirve?** Para que un Lender vea su propio perfil y sus empresas, sin depender de un Admin — es el `/me` equivalente de `GET /api/admin/lenders/:id`.

`BE-100` (nuevo — el mapa de endpoints del plan lo preveía sin ningún ticket detrás, `D-P4-3`). Mismo shape que `GET /api/admin/lenders/:id` (arriba), pero sobre el `LenderProfile` de la sesión. No hay `PATCH` acá (`D-P4-8`): `LenderProfile` no tiene ningún campo propio editable — `name`/`phone` de `User` se editan por [`PATCH /api/auth/me`](#patch-apiauthme) (`BE-099`); editar una empresa propia es cosa del Admin por ahora (`PATCH /api/admin/lenders/:id/companies/:companyId`), no hay autoservicio de edición de empresa todavía.

- **Auth**: Autenticado, rol `LENDER`, exenta de 2FA (lectura).
- **Errores**: `401`/`403` · `404 LENDER_NOT_FOUND`.

### `POST /api/lenders/me/companies`

**¿Para qué sirve?** Para que el propio Lender se cree su primera empresa (o una adicional) sin esperar a que un Admin se la cree — un Lender recién auto-registrado nace sin ninguna, y sin al menos una no puede recibir deudores ni contratos.

`BE-101`, nuevo (`D-P4-5`). El propio Lender se crea una `LenderCompany` — mismo body/servicio que [`POST /api/admin/lenders/:id/companies`](#post-apiadminlendersidcompanies), resolviendo el `LenderProfile` desde la sesión en vez de un `:id`. Cierra el hueco de un Lender auto-registrado (`D-P2-1`) que nace con `LenderProfile` pero sin ninguna `LenderCompany` — antes no había ningún endpoint para que se diera de alta la primera.

- **Auth**: Autenticado, rol `LENDER` + 2FA activo (`D-P3-1`).
- **Request body**: igual que `POST /api/admin/lenders/:id/companies` (`companyName`/`ein`/`contactPhone`?/dirección) — **sin** `name`/`email`, esos son de la persona, no de la empresa.

  ```json
  {
    "companyName": "Lone Star Capital LLC",
    "ein": "12-3456789",
    "contactPhone": "5125550100",
    "addressLine1": "100 Congress Ave",
    "addressLine2": "Suite 200",
    "city": "Austin",
    "state": "TX",
    "postalCode": "78701"
  }
  ```

- **Response `201`**: `{ "success": true, "data": { /* LenderCompanySummary, ver forma abajo */ } }`.
- **Errores**: `400 VALIDATION_ERROR` · `401`/`403`/`403 TWO_FACTOR_REQUIRED` · `404 LENDER_NOT_FOUND` (perfil de prestamista de la sesión no encontrado) · `409 EIN_TAKEN`.

### `PATCH`/`DELETE /api/lenders/me/companies/:companyId`

**¿Para qué sirve?** Para que el Lender edite o borre una empresa suya sin pasar por un Admin — salvo suspender/reactivar (`status`), que sigue siendo exclusivo del Admin.

`D-P4-9`, nuevo. El propio Lender edita o borra una empresa suya — mismo servicio que `PATCH`/`DELETE /api/admin/lenders/:id/companies/:companyId` (`D-P4-8`), resolviendo el `LenderProfile` desde la sesión en vez de un `:id`. `:companyId` que existe pero es de otro Lender responde `404 LENDER_COMPANY_NOT_FOUND`, igual que si no existiera.

- **Auth**: Autenticado, rol `LENDER` + 2FA activo (`D-P3-1`).
- **Request body (`PATCH`)**: igual que `POST /api/lenders/me/companies` (arriba), todos opcionales, más `isOpenToDeals` (boolean) — al menos uno. **`status` no está disponible por esta vía** (`D-P4-9`): suspender/reactivar una empresa sigue siendo exclusivo del Admin (`PATCH /api/admin/lenders/:id/companies/:companyId`); si se manda igual, se descarta en vez de aplicarse — no es un error de validación.

  ```json
  { "companyName": "Lone Star Capital LLC", "isOpenToDeals": false }
  ```

- **Response `200` (`PATCH`)**: `{ "success": true, "data": { /* LenderCompanySummary */ } }`.
- **Response `200` (`DELETE`)**: `{ "success": true, "data": { "deleted": true } }` — soft-delete de esa sola empresa, no de todo el Lender ni sus otras empresas.
- **Errores**: `400 VALIDATION_ERROR` (`PATCH`) · `401`/`403`/`403 TWO_FACTOR_REQUIRED` · `404 LENDER_COMPANY_NOT_FOUND` · `409 EIN_TAKEN` (`PATCH`) · `409 LENDER_HAS_ACTIVE_CONTRACTS` (`DELETE`, esa empresa tiene un `Contract` `ACTIVE`/`DELINQUENT`).

### ~~`POST /api/lenders/me/borrowers`~~ — ⚠️ deshabilitado (`D-P5-1`, 2026-09-11)

`BE-045`, comentado en `route.ts` a pedido explícito — responde `405` (ningún handler registrado para `POST` en esa ruta). Un `LENDER` ya no puede crear un Borrower directo. El código de servicio (`lenderBorrowersService.createBorrower`) sigue intacto; se documenta el shape original acá por si se reactiva.

**Reemplazo (`D-P5-3`, 2026-09-13)**: la única forma de crear un `LenderBorrower` nuevo hoy es seleccionar una cotización de marketplace — ver [`POST /api/borrowers/me/loan-requests/:id/quotes/:quoteId/select`](#post-apiborrowersmeloan-requestsidquotesquoteidselect) más abajo y [00 — `D-P5-3`](plan/00-contradicciones-y-decisiones.md#decisión-2026-09-13-d-p5-3-cierra-d-p5-1--el-vínculo-lenderborrower-nuevo-solo-se-crea-vía-match-de-marketplace).

- ~~**Request body**~~: `name`, `email`, `phone?`, `lenderCompanyId?` (obligatorio solo con más de una `LenderCompany`).
- ~~**Response `201`**~~: `{ "success": true, "data": { "borrower": { /* ver forma abajo */ }, "emailSent": true } }`.

### `GET /api/lenders/me/borrowers`

**¿Para qué sirve?** Para que un Lender vea y busque todos los deudores vinculados a cualquiera de sus empresas — la pantalla de "mis deudores".

Lista + búsqueda (nombre/email) + paginación, a través de **todas** las `LenderCompany` del Lender (`D-P4-1`) — cada fila trae `lenderCompanies` con las empresas del Lender de las que ese deudor es parte, para distinguirlas si tiene más de una.

- **Auth**: Autenticado, rol `LENDER` (lectura, exenta de 2FA).
- **Response `200`**: `data` = [resultado paginado](#convenciones) de objetos con la forma de `Borrower` (ver abajo).

### `GET /api/lenders/me/borrowers/:id`

**¿Para qué sirve?** Ver el detalle de un deudor puntual vinculado al Lender (ficha del deudor).

`:id` = `BorrowerProfile.id`. Mismo criterio anti-enumeración que [`requireContractAccess`](plan/07-autenticacion-y-autorizacion.md#75-rbac--aislamiento-multi-tenant--cómo-se-evita-que-un-prestamista-acceda-a-datos-de-otro): un deudor que existe pero no es del Lender responde `404`, nunca `403`.

- **Auth**: Autenticado, rol `LENDER` (lectura, exenta de 2FA).
- **Response `200`**:
  ```jsonc
  {
    "success": true,
    "data": {
      "id": "...",                // BorrowerProfile.id
      "user": /* SafeUser */ {},
      "addressLine1": null, "city": null, "state": null, "postalCode": null,
      "lenderCompanies": [ { "id": "...", "companyName": "..." } ]
    }
  }
  ```
- **Errores**: `401`/`403` · `404 NOT_FOUND`.

### ~~`PATCH /api/lenders/me/borrowers/:id`~~ — ⚠️ deshabilitado (`D-P5-1`, 2026-09-11)

`BE-048`, comentado en `route.ts` a pedido explícito — responde `405`. Editaba campos de contacto del `BorrowerProfile` (`addressLine1`/`city`/`state`/`postalCode` — `phone` ya no vive acá, `D-P5-2`); el código de servicio (`lenderBorrowersService.updateBorrower`) sigue intacto.

### `DELETE /api/lenders/me/borrowers/:id`

**¿Para qué sirve?** Desvincular a un deudor de las empresas del Lender (sin borrar su perfil — puede seguir teniendo contratos con otros lenders). Bloqueado si hay un contrato activo de por medio.

`BE-049` (`M-3`). **Desvincula** (`LenderBorrower.removedAt`+`status=REMOVED`) — nunca borra el `BorrowerProfile`, el deudor puede tener otros lenders. Bloqueado si tiene un `Contract` `ACTIVE`/`DELINQUENT` con alguna de las empresas de las que se lo está desvinculando.

- **Auth**: Autenticado, rol `LENDER` + 2FA activo (escritura).
- **Response `200`**: `{ "success": true, "data": { "removed": true } }`.
- **Errores**: `401`/`403`/`403 TWO_FACTOR_REQUIRED` · `404 NOT_FOUND` · `409 BORROWER_HAS_ACTIVE_CONTRACTS`.

### `GET /api/borrowers/me` / `PATCH /api/borrowers/me`

**¿Para qué sirve?** Para que el propio Deudor vea o edite su dirección de contacto — el `/me` equivalente a lo que hace un Lender con sus propios datos.

`BE-050`. Perfil propio del Deudor — campos de contacto propios, nunca `lenderCompanyId`.

- **Auth**: Autenticado, rol `BORROWER` (`BORROWER` nunca exige 2FA, `D-P3-1`).
- **`PATCH` bloqueado con `403 PASSWORD_CHANGE_REQUIRED`** mientras `mustChangePassword=true` (`D-P4-2`) — un deudor recién creado por un Lender tiene que cambiar su contraseña temporal antes de poder editar su perfil. `GET` no está bloqueado (necesita poder ver el estado del flag).
- **Response `200` (`GET`)**:
  ```jsonc
  {
    "success": true,
    "data": {
      "user": /* SafeUser */ {},
      "borrowerProfile": { "id": "...", "addressLine1": null, "city": null, "state": null, "postalCode": null },
      "lenderCompanies": [ { "id": "...", "companyName": "..." } ]
    }
  }
  ```
- **Request body (`PATCH`)**: `addressLine1`/`city`/`state`/`postalCode` — `phone` se edita por [`PATCH /api/auth/me`](#patch-apiauthme) (`D-P5-2`, ya no vive en `BorrowerProfile`).

  ```json
  {
    "addressLine1": "500 Lamar Blvd",
    "city": "Austin",
    "state": "TX",
    "postalCode": "78701"
  }
  ```

- **Errores**: `400 VALIDATION_ERROR` (solo `PATCH`) · `401 UNAUTHENTICATED`/`INVALID_TOKEN` · `403 PASSWORD_CHANGE_REQUIRED` (solo `PATCH`) · `404 BORROWER_NOT_FOUND`.

### `POST /api/borrowers/me/password`

**¿Para qué sirve?** Para que el Deudor cambie su contraseña estando ya logueado — es también la única forma de apagar el aviso "tenés que cambiar tu contraseña temporal" (`mustChangePassword`).

`BE-050`. Cambia la contraseña mientras el usuario ya está autenticado — exige la contraseña actual (defensa en profundidad, mismo criterio que `/2fa/disable`, `BE-034`). **Siempre accesible**, incluso con `mustChangePassword:true` — es el único camino para apagarlo.

- **Auth**: Autenticado, rol `BORROWER`.
- **Request body**: `{ "currentPassword": string, "newPassword": string (8–72 chars) }`.

  ```json
  { "currentPassword": "DevPass!2026", "newPassword": "NewPass!2026" }
  ```

- **Response `200`**: `{ "success": true, "data": { "changed": true } }`.
- **Errores**: `400 VALIDATION_ERROR` · `401 UNAUTHENTICATED`/`INVALID_TOKEN` · `401 INVALID_CREDENTIALS` (`currentPassword` incorrecta) · `404 USER_NOT_FOUND`.
- **Efecto secundario**: apaga `mustChangePassword`, revoca todos los refresh tokens del usuario — igual que `password/reset` (`BE-032`).

### Formas de `Lender`, `LenderCompanySummary` y `Borrower`

```jsonc
// Lender (GET /api/admin/lenders*, GET /api/lenders/me)
{
  "id": "...",                 // LenderProfile.id
  "user": /* SafeUser */ {},
  "lenderCompanies": [ /* LenderCompanySummary[] */ ]
  // GET /api/admin/lenders/:id y GET /api/lenders/me además traen borrowersCount/activeContractsCount
}

// LenderCompanySummary — un ítem de "lenderCompanies" arriba, y también la
// respuesta directa de POST/PATCH /api/admin/lenders/:id/companies[/:companyId]
// y POST /api/lenders/me/companies
{
  "id": "...", "companyName": "...", "ein": "...", "contactPhone": null,
  "addressLine1": "...", "addressLine2": null, "city": "...", "state": "TX", "postalCode": "...",
  "isOpenToDeals": true, "status": "ACTIVE"
}

// Borrower (GET /api/lenders/me/borrowers* — POST/PATCH deshabilitados, D-P5-1)
{
  "id": "...",                 // BorrowerProfile.id
  "user": /* SafeUser */ {},   // el teléfono vive acá (user.phone), no en BorrowerProfile (D-P5-2)
  "addressLine1": null, "city": null, "state": null, "postalCode": null,
  "lenderCompanies": [ { "id": "...", "companyName": "..." } ]  // solo las que comparte con el Lender que consulta
}
```

---

## Contratos (`src/app/api/contracts/`)

Fase 6 (`BE-051..064`, `PB-020`). Sin endpoint propio de `Property` en el plan (`D-P6-2`): `POST /api/contracts` recibe la dirección/valuación embebida en el mismo body y crea `Property`+`Contract(DRAFT)`+`ContractTerms(v1, DRAFT)` en una sola transacción. Todo endpoint de este módulo pasa por [`requireContractAccess`](plan/07-autenticacion-y-autorizacion.md#75-rbac--aislamiento-multi-tenant--cómo-se-evita-que-un-prestamista-acceda-a-datos-de-otro) (`BE-038`) — `LENDER` dueño de la `LenderCompany` (contra **todas** sus empresas) o `BORROWER` asociado vía `ContractBorrower` activo; un contrato ajeno responde `404`, nunca `403`.

### Cómo funciona: el flujo completo de un contrato

Un `Contract` tiene **dos estados que avanzan juntos pero no son lo mismo**: el del contrato (`Contract.status`) y el de la versión de términos vigente (`ContractTerms.status`). Casi toda la confusión de este módulo viene de no separar esos dos conceptos, así que van los dos diagramas:

```
Contract.status
────────────────
DRAFT ──(submit + todos aceptan)──► ACTIVE ──(atraso de pago)──► DELINQUENT
  │         │                          │                             │
  │         │ (algún borrower rechaza) │                             │
  │         └──────────◄───────────────┘                             │
  │                                    │                             │
  │ DELETE (sin Transaction)           └────────► CANCELLED ◄─────────┘
  ▼                                        (POST .../cancel, en cualquiera de los 3 estados de arriba)
(borrado)

ContractTerms.status (una fila por versión — v1, v2, v3...)
────────────────────
DRAFT ──POST .../submit──► PENDING_ACCEPTANCE ──todos ACCEPT──► ACCEPTED
  ▲                                │                                │
  │                                └──algún REJECT──► REJECTED      │
  │ (PATCH mientras sigue DRAFT)                                    │
  └── al crear una v(n+1) con POST .../terms, la versión ACCEPTED vigente pasa a SUPERSEDED de inmediato
```

Paso a paso, quién hace qué y con qué endpoint:

1. **El Lender crea el contrato** — [`POST /api/contracts`](#post-apicontracts). En un solo llamado nace la propiedad, el contrato en `DRAFT` y su primera versión de términos (`ContractTerms` v1, también `DRAFT`). Todavía no hay ningún compromiso: es un borrador que solo ve el Lender.
2. **El Lender lo termina de armar mientras está en `DRAFT`** — [`PATCH /api/contracts/:id`](#patch-apicontractsid) para ajustar propiedad/términos, [`POST`/`DELETE /api/contracts/:id/borrowers`](#post-apicontractsidborrowers--delete-apicontractsidborrowersborrowerid) para sumar o sacar codeudores, [`POST`/`DELETE .../fees`](#getpost-apicontractsidtermstermsidfees--delete-feesfeeid) para cargar puntos de originación u otros cargos. Todo esto se puede tirar abajo con [`DELETE /api/contracts/:id`](#delete-apicontractsid) mientras nadie lo haya aceptado y no tenga movimientos de dinero.
3. **El Lender manda los términos a firma** — [`POST /api/contracts/:id/terms/:termsId/submit`](#post-apicontractsidtermstermsidsubmit): la versión pasa `DRAFT → PENDING_ACCEPTANCE`, se les avisa por correo a todos los deudores asociados, y (si es la primera vez) el contrato entero pasa `Contract.status: DRAFT → PENDING_ACCEPTANCE`. A partir de acá el Lender ya no puede tocar los términos con `PATCH` — quedaron "congelados" esperando respuesta.
4. **Cada deudor acepta o rechaza** — [`POST .../terms/:termsId/accept`](#post-apicontractsidtermstermsidaccept--reject) o `.../reject`. Si **todos** los codeudores aceptan (quórum), esa versión pasa a `ACCEPTED`, se genera el calendario de pagos completo y el contrato pasa a `ACTIVE` (ya es un préstamo en curso). Si **cualquiera** rechaza, la versión pasa a `REJECTED` y el contrato vuelve a `DRAFT` para que el Lender la corrija y la vuelva a mandar (vuelve al paso 2/3).
5. **Con el contrato `ACTIVE`**, se puede consultar en cualquier momento el calendario y el saldo — [`GET .../schedule`](#get-apicontractsidschedule--balance) / `.../balance`.
6. **Renegociar un contrato ya activo** (cambiar tasa, plazo, etc.): [`POST /api/contracts/:id/terms`](#get-apicontractsidterms--post-apicontractsidterms) crea una versión nueva (`DRAFT`) y **supersede de inmediato** a la versión `ACCEPTED` vigente. Esa versión nueva repite el mismo circuito que un contrato nuevo: se edita (paso 2), se manda a firma (paso 3), se acepta o rechaza (paso 4) — y si se acepta, regenera el calendario desde ahí (anulando las cuotas futuras que quedaron pendientes de la versión anterior).
7. **Cancelar** — [`POST /api/contracts/:id/cancel`](#post-apicontractsidcancel) corta el contrato en cualquiera de los tres estados "en curso" (`PENDING_ACCEPTANCE`/`ACTIVE`/`DELINQUENT`), con motivo obligatorio auditado. Nunca borra el calendario ni los pagos ya hechos.

**Quién puede hacer qué**: casi todas las escrituras (crear, editar, cancelar, borrar, subir términos) son del `LENDER` y exigen 2FA activo. La única acción del lado `BORROWER` es aceptar/rechazar términos, y nunca exige 2FA.

### `POST /api/contracts`

**¿Para qué sirve?** Es el punto de partida de todo el módulo: el Lender crea un contrato desde cero (propiedad + términos financieros) para un deudor que ya tiene vinculado. Ver el flujo completo arriba.

Crea el contrato en un solo paso.

- **Auth**: Autenticado, rol `LENDER` + 2FA activo (escritura).
- **Request body**:

  | Campo | Tipo | Notas |
  |---|---|---|
  | `lenderCompanyId` | string | Obligatorio solo si el Lender tiene más de una `LenderCompany` (mismo patrón que `BE-045`) |
  | `property` | object | `addressLine1`/`city`/`state`/`postalCode`/`propertyType` obligatorios; resto de campos de valuación (`bedrooms`, `estimatedMarketValue`, `afterRepairValue`, etc.) opcionales, carga manual |
  | `terms` | object | `structure` (`INTEREST_ONLY`/`AMORTIZED`/`BALLOON`), `principalAmount`, `interestRate`, `amortizationTermMonths`, `firstPaymentDate`, `paymentDueDay` (1–31), `maturityDate` (> `firstPaymentDate`, es la fecha del **último** pago, inclusive), `lateFeeType`/`lateFeeAmount`, `gracePeriodDays` (default 10), `prePayPenaltyType`/`prePayPenaltyAmount` (opcionales, juntos o ninguno) |
  | `insuranceCompanyId` | string | Opcional |
  | `borrowerProfileIds` | string[] | Opcional — cada uno debe tener un `LenderBorrower` `ACTIVE` con la `LenderCompany` resuelta |

  ```json
  {
    "lenderCompanyId": "01a0c1e2-3b4d-7e5f-8a9b-0c1d2e3f4a5b",
    "property": {
      "addressLine1": "500 Lamar Blvd",
      "addressLine2": "Unit 3",
      "city": "Austin",
      "state": "TX",
      "postalCode": "78701",
      "county": "Travis",
      "parcelNumber": "01-2345-6789",
      "propertyType": "SINGLE_FAMILY",
      "bedrooms": 3,
      "bathrooms": 2,
      "squareFootage": 1800,
      "lotSize": 6000,
      "yearBuilt": 1998,
      "conditionScale": 3,
      "estimatedRepairCost": 15000,
      "estimatedMarketValue": 320000,
      "afterRepairValue": 350000,
      "lastSalePrice": 280000,
      "lastSaleDate": "2020-06-15",
      "annualPropertyTax": 6500,
      "annualInsuranceEstimate": 1800
    },
    "terms": {
      "structure": "AMORTIZED",
      "principalAmount": 200000,
      "interestRate": 9.5,
      "dayCountConvention": "THIRTY_360",
      "amortizationTermMonths": 24,
      "firstPaymentDate": "2026-11-01",
      "paymentDueDay": 1,
      "maturityDate": "2028-10-01",
      "lateFeeType": "FLAT",
      "lateFeeAmount": 50,
      "gracePeriodDays": 10,
      "prePayPenaltyType": "PERCENTAGE",
      "prePayPenaltyAmount": 2
    },
    "insuranceCompanyId": "01a0c1e2-3b4d-7e5f-8a9b-0c1d2e3f4a5c",
    "borrowerProfileIds": ["01a0c1e2-3b4d-7e5f-8a9b-0c1d2e3f4a5d"]
  }
  ```

  Notas: `lenderCompanyId` solo hace falta si el Lender tiene más de una `LenderCompany`; `insuranceCompanyId` y `borrowerProfileIds` son opcionales; `prePayPenaltyType`/`prePayPenaltyAmount` viajan juntos o ninguno de los dos.

- **Response `201`**: `Contract` completo (ver forma abajo), `status: "DRAFT"`, `currentTerms` con `versionNumber: 1` y `status: "DRAFT"`.
- **Errores**: `400 VALIDATION_ERROR` · `400 LENDER_COMPANY_REQUIRED` · `401`/`403`/`403 TWO_FACTOR_REQUIRED` · `404 NOT_FOUND` (`lenderCompanyId`/`insuranceCompanyId`/algún `borrowerProfileId` ajeno o no vinculado) · `409 NO_LENDER_COMPANY`.

### `GET /api/contracts`

**¿Para qué sirve?** Listar los contratos propios — la pantalla de "mis contratos", tanto para el Lender (todos los de sus empresas) como para el Borrower (todos donde es codeudor activo).

Lista + filtro `status` + paginación. `LENDER` ve todas sus `LenderCompany`; `BORROWER` ve donde es `ContractBorrower` activo.

- **Auth**: Autenticado, rol `LENDER` o `BORROWER` (lectura, exenta de 2FA).
- **Response `200`**: `data` = [resultado paginado](#convenciones) de `Contract`.

### `GET /api/contracts/:id`

**¿Para qué sirve?** Ver el detalle completo de un contrato puntual (propiedad, términos vigentes, codeudores, saldo) — la ficha del contrato.

- **Auth**: Autenticado, rol `LENDER` o `BORROWER` asociado.
- **Errores**: `401`/`403` · `404 NOT_FOUND`.

### `PATCH /api/contracts/:id`

**¿Para qué sirve?** Corregir datos de la propiedad o de la aseguradora en cualquier momento, y ajustar los términos financieros **solo mientras siguen en borrador** (paso 2 del flujo de arriba). Para cambiar términos de un contrato ya enviado/activo hay que abrir una versión nueva (`POST .../terms`, paso 6).

`property`/`insuranceCompanyId` editables en cualquier estado del contrato; `terms` solo si la `ContractTerms` vigente está `DRAFT` — para cambiar términos financieros de un contrato ya enviado/activo, usar `POST .../terms` (nueva versión).

- **Auth**: Autenticado, rol `LENDER` + 2FA activo.
- **Request body**: `property` (parcial, mismos campos que la creación), `terms` (parcial, mismos campos que la creación), `insuranceCompanyId` (`string`, o `null` para quitarlo) — todos opcionales, al menos uno.

  ```json
  {
    "property": { "estimatedMarketValue": 325000, "conditionScale": 4 },
    "terms": { "interestRate": 9 },
    "insuranceCompanyId": null
  }
  ```

- **Errores**: `400 VALIDATION_ERROR` · `401`/`403`/`403 TWO_FACTOR_REQUIRED` · `404 NOT_FOUND` · `409 TERMS_NOT_EDITABLE` · `409 NO_CURRENT_TERMS`.

### `DELETE /api/contracts/:id`

**¿Para qué sirve?** Descartar un borrador de contrato que todavía no se le mandó a nadie a firmar y no tiene ningún movimiento de dinero — por ejemplo si se cargó por error o el negocio se cayó antes de arrancar.

Solo `status=DRAFT` y sin ninguna `Transaction` (08-contratos.md §8.1).

- **Auth**: Autenticado, rol `LENDER` + 2FA activo.
- **Response `200`**: `{ "success": true, "data": { "deleted": true } }`.
- **Errores**: `401`/`403`/`403 TWO_FACTOR_REQUIRED` · `404 NOT_FOUND` · `409 CONTRACT_NOT_DELETABLE` · `409 CONTRACT_HAS_TRANSACTIONS`.

### `POST /api/contracts/:id/cancel`

**¿Para qué sirve?** Terminar anticipadamente un contrato que ya estaba en curso (esperando firma, activo, o en mora) — por ejemplo un acuerdo de cancelación entre las partes. A diferencia de `DELETE`, no borra nada: deja el rastro completo (calendario, pagos) y exige un motivo auditado.

Permitido en `PENDING_ACCEPTANCE`/`ACTIVE`/`DELINQUENT`; nunca borra `ScheduledPayment`/`Transaction`.

- **Auth**: Autenticado, rol `LENDER` + 2FA activo.
- **Request body**: `{ "reason": string }` (obligatorio, auditado).

  ```json
  { "reason": "Borrower requested to cancel before closing." }
  ```

- **Errores**: `400 VALIDATION_ERROR` · `401`/`403`/`403 TWO_FACTOR_REQUIRED` · `404 NOT_FOUND` · `409 CONTRACT_NOT_CANCELLABLE`.

### `POST /api/contracts/:id/borrowers` / `DELETE /api/contracts/:id/borrowers/:borrowerId`

**¿Para qué sirve?** Sumar o sacar codeudores de un contrato puntual — por ejemplo agregar al cónyuge como co-firmante, o corregir un contrato armado con la persona equivocada antes de mandarlo a firma.

Asocia/retira (soft) un `BorrowerProfile` — validado contra `LenderBorrower ACTIVE` de la `LenderCompany` del contrato (07 §7.5 punto 4), nunca contra un `lenderId` directo (no existe desde `D-P1-4`).

- **Auth**: Autenticado, rol `LENDER` + 2FA activo.
- **Request body (`POST`)**: `{ "borrowerProfileId": string, "isPrimary"?: boolean }`.

  ```json
  { "borrowerProfileId": "01a0c1e2-3b4d-7e5f-8a9b-0c1d2e3f4a5d", "isPrimary": true }
  ```

- **Errores**: `400 VALIDATION_ERROR` · `401`/`403`/`403 TWO_FACTOR_REQUIRED` · `404 NOT_FOUND` (deudor no vinculado, o ya no asociado en el `DELETE`) · `409 ALREADY_ASSOCIATED`.

### `GET /api/contracts/:id/terms` / `POST /api/contracts/:id/terms`

**¿Para qué sirve?** `GET` muestra el historial de todas las versiones de términos que tuvo el contrato (para auditar cambios). `POST` es el paso 6 del flujo de arriba: abre una versión nueva para **renegociar** un contrato cuya versión vigente ya fue aceptada — nunca se usa para el ajuste inicial de un borrador (eso es `PATCH /api/contracts/:id`).

`GET`: historial completo de versiones, más reciente primero. `POST`: propone una nueva versión — solo si la vigente **no** está `DRAFT` (si lo está, usar `PATCH /api/contracts/:id`); mismo shape de `terms` que la creación, sin copiar los `ContractFeeItem` de la versión anterior. La versión anterior pasa a `SUPERSEDED` de inmediato.

- **Auth**: `GET` — `LENDER`/`BORROWER` asociado, lectura. `POST` — `LENDER` + 2FA.
- **Request body (`POST`)**: mismo shape completo que `terms` en [`POST /api/contracts`](#post-apicontracts) (arriba) — no admite parcial.

  ```json
  {
    "structure": "AMORTIZED",
    "principalAmount": 195000,
    "interestRate": 9,
    "dayCountConvention": "THIRTY_360",
    "amortizationTermMonths": 24,
    "firstPaymentDate": "2027-01-01",
    "paymentDueDay": 1,
    "maturityDate": "2028-12-01",
    "lateFeeType": "FLAT",
    "lateFeeAmount": 50,
    "gracePeriodDays": 10,
    "changeSummary": "Rate reduced after refinance negotiation."
  }
  ```

- **Errores (`POST`)**: `400 VALIDATION_ERROR` · `401`/`403`/`403 TWO_FACTOR_REQUIRED` · `404 NOT_FOUND` · `409 NO_CURRENT_TERMS` · `409 TERMS_STILL_DRAFT`.

### `POST /api/contracts/:id/terms/:termsId/submit`

**¿Para qué sirve?** El Lender "envía a firma" una versión de términos que ya terminó de armar — paso 3 del flujo de arriba. Antes de este llamado, los deudores no ven ni saben nada del contrato; después, quedan esperando que acepten o rechacen.

`DRAFT → PENDING_ACCEPTANCE`, notifica por correo a todos los `ContractBorrower` activos (`terms-updated`). Si el contrato nunca se activó, también mueve `Contract.status → PENDING_ACCEPTANCE`.

- **Auth**: Autenticado, rol `LENDER` + 2FA activo.
- **Errores**: `401`/`403`/`403 TWO_FACTOR_REQUIRED` · `404 NOT_FOUND` · `409 TERMS_NOT_DRAFT` · `409 NO_BORROWERS`.

### `POST /api/contracts/:id/terms/:termsId/accept` / `.../reject`

**¿Para qué sirve?** Es la "firma digital" del deudor — paso 4 del flujo de arriba. `accept` es dar el visto bueno a los términos propuestos; si es el último codeudor en aceptar, el contrato queda activo automáticamente (se genera todo el calendario de pagos ahí mismo, sin ningún paso extra). `reject` es rechazarlos con un comentario opcional — basta con que **un solo** codeudor rechace para tumbar toda la versión, aunque el resto ya hubiera aceptado.

`accept`: registra `ContractTermsAcceptance(ACCEPTED)`; al completar el quórum (todos los `ContractBorrower` activos), `ContractTerms.status → ACCEPTED` y, en la misma transacción: si el contrato nunca se activó, genera el calendario completo y `Contract.status → ACTIVE`; si ya estaba `ACTIVE` (renegociación), anula las filas futuras `PENDING`/`PARTIALLY_PAID` de la versión anterior y genera el calendario de la nueva. `reject`: registra `ContractTermsAcceptance(REJECTED)` — un solo rechazo termina la versión (`ContractTerms.status → REJECTED`) sin esperar al resto de co-deudores; si el contrato nunca se activó, `Contract.status → DRAFT`; notifica al Lender por correo (`terms-rejected`).

- **Auth**: Autenticado, rol `BORROWER` asociado (nunca exige 2FA).
- **Request body (`reject`)**: `{ "comment"?: string }`.

  ```json
  { "comment": "Interest rate is higher than what we discussed." }
  ```

- **Errores**: `401`/`403` · `404 NOT_FOUND` · `409 TERMS_NOT_PENDING` · `409 ALREADY_DECIDED`.

### `GET /api/contracts/:id/schedule` / `.../balance`

**¿Para qué sirve?** `schedule` es la tabla de amortización completa (todas las cuotas, pasadas y futuras) de un contrato activo. `balance` es la foto rápida de "cuánto se debe hoy" — pensados para la pantalla de detalle del préstamo, tanto para el Lender como para el Borrower.

`schedule`: `ScheduledPayment[]` completo (incluye filas `VOIDED` de versiones superadas). `balance`: `{ principalBalance, accruedInterestNotYetBilled, nextPaymentDueDate, asOf }` — el interés devengado se calcula desde `activatedAt` con `calculateAccruedInterest`; sin un `Transaction` real todavía (Fase 7), es el mejor ancla disponible.

- **Auth**: Autenticado, rol `LENDER`/`BORROWER` asociado (lectura).
- **Errores**: `401`/`403` · `404 NOT_FOUND`.

### `GET`/`POST /api/contracts/:id/terms/:termsId/fees` · `DELETE .../fees/:feeId`

**¿Para qué sirve?** Cargar los cargos de cierre de una versión de términos puntual (puntos de originación, procesamiento, suscripción, etc.) — es la tabla que arma el desglose de costos que el deudor ve antes de firmar. Solo se puede tocar mientras esa versión sigue en `DRAFT` (paso 2 del flujo).

`PB-020` — Closing Fee Summary Table. Solo editable (`POST`/`DELETE`) mientras `ContractTerms.status=DRAFT`. `computedAmount` se resuelve al crear la fila (`amountValue` si `FLAT`, o `amountValue`% × `principalAmount` de esa versión si `PERCENTAGE`) y nunca se recalcula. `code=MARKETPLACE_CONNECTION` está reservado — lo inserta automáticamente el propio servicio desde Fase 13 (`D-S2-5`), nunca este endpoint.

- **Auth**: `GET` — `LENDER`/`BORROWER` asociado. `POST`/`DELETE` — `LENDER` + 2FA.
- **Request body (`POST`)**: `{ "category": "LENDER"|"PLATFORM", "code": "ORIGINATION_POINTS"|"PROCESSING"|"UNDERWRITING"|"DOC_PREP"|"CUSTOM"|"MARKETPLACE_CONNECTION", "label"?: string (obligatorio si code=CUSTOM), "amountType": "FLAT"|"PERCENTAGE", "amountValue": number }`.

  ```json
  { "category": "LENDER", "code": "ORIGINATION_POINTS", "amountType": "PERCENTAGE", "amountValue": 2 }
  ```

  ```json
  { "category": "PLATFORM", "code": "CUSTOM", "label": "Wire fee", "amountType": "FLAT", "amountValue": 35 }
  ```

- **Errores**: `400 VALIDATION_ERROR` · `400 RESERVED_FEE_CODE` (`code=MARKETPLACE_CONNECTION`) · `401`/`403`/`403 TWO_FACTOR_REQUIRED` · `404 NOT_FOUND` · `409 TERMS_NOT_EDITABLE`.

### Forma de `Contract`

```jsonc
{
  "id": "...", "contractNumber": "PML-2026-000001", "status": "DRAFT",
  "lenderCompanyId": "...", "insuranceCompanyId": null,
  "property": { "id": "...", "addressLine1": "...", "propertyType": "SINGLE_FAMILY", /* ... */ },
  "currentTerms": {
    "id": "...", "versionNumber": 1, "status": "DRAFT", "structure": "AMORTIZED",
    "principalAmount": "200000", "interestRate": "6", "calculatedMonthlyPayment": null,
    "feeItems": [ /* ContractFeeItem[] */ ]
  },
  "borrowers": [ { "borrowerProfileId": "...", "isPrimary": true, "addedAt": "..." } ],
  "currentPrincipalBalance": null, "nextPaymentDueDate": null,
  "activatedAt": null, "paidOffAt": null, "cancelledAt": null, "createdAt": "..."
}
```

Los montos (`Decimal` de Prisma) serializan como string en el JSON de respuesta.

---

## Marketplace / Loan Requests (`src/app/api/borrowers/me/loan-requests`, `src/app/api/marketplace/loan-requests`)

Fase 13 parcial (`PB-011`/`PB-026`/`PB-017`, reescrito 2026-09-11 — `D-S2-21`/`D-S2-22`, ver [00](plan/00-contradicciones-y-decisiones.md#decisiones-2026-09-11-ronda-fase-13--cotizaciones-de-marketplace-antes-de-implementar)). El Deudor publica un `LoanRequest` (con su `Property` embebida, sin endpoint propio — mismo criterio que `POST /api/contracts`, `D-P6-2`/`D-S2-25`), elige a qué Prestamistas pedirles cotización (o lo publica abierto), cada Prestamista interesado responde con su propia `LoanQuote`, y el Deudor selecciona una — esa selección es la que crea el `Contract`. **No implementado en esta ronda**: `LoanRequestInvite` (invitar por correo a alguien sin cuenta todavía), fotos, RentCast, `BorrowerApplication`, `BorrowerSubscription`, pitch deck PDF.

### Cómo funciona: el flujo completo de Marketplace

Piensen a Marketplace como una "licitación": el Deudor pide plata contando su proyecto, varios Lenders le ofrecen condiciones distintas, y el Deudor elige una — esa elección **crea automáticamente un `Contract`** en el módulo de [Contratos](#contratos-srcappapicontracts) (arranca en `DRAFT`, en el paso 1 de ese flujo). Es el único puente entre ambos módulos hoy: no hay otra forma de originar un contrato "de mercado".

Dos objetos con estados independientes:

```
LoanRequest.status (lo publica el Deudor — "estoy buscando plata para esto")
──────────────────
DRAFT ──POST .../publish──► PUBLISHED ──el Deudor selecciona una LoanQuote──► MATCHED
  │                              │                                      (acá nace el Contract)
  │ PATCH (editable)             │ POST .../withdraw
  ▼                              ▼
(sigue en DRAFT)              WITHDRAWN (declina todas las quotes SUBMITTED que tuviera)

LoanQuote.status (una fila por cada LenderCompany que cotiza ese LoanRequest)
─────────────────
SUBMITTED ──el Deudor elige ESTA──► SELECTED
    │
    ├──Lender la borra (DELETE)────► WITHDRAWN
    └──el Deudor elige OTRA, o retira el LoanRequest──► DECLINED
```

Paso a paso:

1. **El Deudor arma la solicitud** — [`POST /api/borrowers/me/loan-requests`](#post-apiborrowersmeloan-requests). Un solo llamado con la propiedad embebida (igual que un contrato), el tipo de proyecto, cuánto necesita, y la **visibilidad** (`PUBLIC` o `PRIVATE`) — esto último se fija acá y no cambia después. Nace en `DRAFT`, invisible para cualquier Lender todavía.
2. **El Deudor la termina de editar y, opcionalmente, la dirige a Lenders puntuales** — [`PATCH .../loan-requests/:id`](#getpatch-apiborrowersmeloan-requestsid) mientras sigue en `DRAFT`, y [`POST`/`DELETE .../targets`](#post-apiborrowersmeloan-requestsidtargets--delete-targetslendercompanyid) para armar una lista de `LenderCompany` invitadas puntualmente. **Ojo**: `targets` es independiente de `visibility` — sirve tanto para invitar a alguien puntual a una solicitud `PUBLIC` (que igual es visible para todos los demás) como para una `PRIVATE` (que solo ven los targeteados; una `PRIVATE` sin ningún target no la ve ningún Lender).
3. **El Deudor la publica** — [`POST .../loan-requests/:id/publish`](#post-apiborrowersmeloan-requestsidpublish--withdraw): `DRAFT → PUBLISHED`. Recién acá empieza a ser visible para Lenders.
4. **Los Lenders la descubren** — [`GET /api/marketplace/loan-requests`](#get-apimarketplaceloan-requests--get-apimarketplaceloan-requestsid) (listado) o `/:id` (detalle). Una `PUBLIC` aparece para **cualquier** Lender, pero con la dirección exacta y el dueño ocultos, salvo que ese Lender puntual esté en `targets` (ahí la ve completa). Una `PRIVATE` solo aparece — completa — para los Lenders que están en `targets`; para el resto, ni siquiera existe (`404`).
5. **Cada Lender interesado cotiza** — [`POST /api/marketplace/loan-requests/:id/quotes`](#post-apimarketplaceloan-requestsidquotes--delete-quotes): crea su propia `LoanQuote` (`SUBMITTED`) con tasa/plazo/estructura propuestos. Puede reemplazarla mientras siga `SUBMITTED` (volver a mandar el `POST`), o retirarla con `DELETE`.
6. **El Deudor compara todas las ofertas** — [`GET .../loan-requests/:id/quotes`](#get-apiborrowersmeloan-requestsidquotes).
7. **El Deudor elige una** — [`POST .../quotes/:quoteId/select`](#post-apiborrowersmeloan-requestsidquotesquoteidselect). Esto dispara, en una sola transacción:
   - el resto de cotizaciones `SUBMITTED` de ese `LoanRequest` quedan `DECLINED`;
   - el `LoanRequest` pasa a `MATCHED`;
   - se crea un `Contract` nuevo en `DRAFT` (paso 1 del flujo de Contratos) con los términos pre-cargados desde la cotización ganadora;
   - se crea (o reactiva) el vínculo `LenderBorrower` entre el Deudor y la empresa del Lender ganador — **hoy es la única forma de crear ese vínculo**, porque el alta directa (`POST /api/lenders/me/borrowers`) está deshabilitada;
   - se le agrega automáticamente un cargo `MARKETPLACE_CONNECTION` al contrato;
   - se le avisa por correo al Lender que tiene un contrato nuevo esperando que lo termine de completar.
8. **De acá en adelante es un contrato normal**: el Lender sigue el flujo de [Contratos](#contratos-srcappapicontracts) desde el paso 2 en adelante (completar/editar términos, mandar a firma, esperar aceptación).

En cualquier punto entre el paso 3 y el 7, el Deudor puede arrepentirse y bajar toda la solicitud con [`POST .../withdraw`](#post-apiborrowersmeloan-requestsidpublish--withdraw), lo que además declina cualquier cotización pendiente.

### `POST /api/borrowers/me/loan-requests`

**¿Para qué sirve?** Es el punto de partida del flujo de arriba: el Deudor describe qué proyecto quiere financiar y cuánto necesita, para empezar a recibir cotizaciones de Lenders.

- **Auth**: Autenticado, rol `BORROWER` (nunca exige 2FA).
- **Request body**: `property` (mismo shape que `POST /api/contracts`, ver [arriba](#post-apicontracts)), `projectType` (`RENTAL`/`FIX_AND_FLIP`/`SLOW_FLIP`/`COMMERCIAL`/`NEW_CONSTRUCTION`), `purchasePrice`/`rehabAmount`/`totalLoanAmountRequested`, `requestedClosingDate`, `requestedTimelineNotes`?, `visibility` (`PUBLIC`/`PRIVATE` — se fija acá, no en `publish`).

  ```json
  {
    "property": {
      "addressLine1": "500 Lamar Blvd",
      "city": "Austin",
      "state": "TX",
      "postalCode": "78701",
      "propertyType": "SINGLE_FAMILY",
      "bedrooms": 3,
      "bathrooms": 2,
      "squareFootage": 1800,
      "estimatedMarketValue": 320000,
      "afterRepairValue": 350000
    },
    "projectType": "FIX_AND_FLIP",
    "purchasePrice": 250000,
    "rehabAmount": 40000,
    "totalLoanAmountRequested": 260000,
    "requestedClosingDate": "2026-11-15",
    "requestedTimelineNotes": "Looking to close within 30 days of an accepted offer.",
    "visibility": "PUBLIC"
  }
  ```

- **Response `201`**: `LoanRequest` completo, `status: "DRAFT"`, `property.lenderCompanyId: null`.
- **Errores**: `400 VALIDATION_ERROR` · `401`/`403` · `404 BORROWER_NOT_FOUND`.

### `GET`/`PATCH /api/borrowers/me/loan-requests/:id`

**¿Para qué sirve?** Ver o corregir una solicitud propia mientras todavía está en borrador (paso 2 del flujo) — una vez publicada, ya no se puede editar (habría que retirarla y crear una nueva).

Propios. `PATCH` (incluye `property`) solo mientras `status=DRAFT`.

- **Auth**: Autenticado, rol `BORROWER`.
- **Request body (`PATCH`)**: cualquier subconjunto no vacío de los campos de la creación (`property` parcial incluida).

  ```json
  { "totalLoanAmountRequested": 270000, "requestedTimelineNotes": "Flexible on closing date, 30-45 days." }
  ```

- **Errores**: `400 VALIDATION_ERROR` (`PATCH`) · `401`/`403` · `404 NOT_FOUND` · `409 LOAN_REQUEST_NOT_EDITABLE` (`PATCH` fuera de `DRAFT`).

### `POST /api/borrowers/me/loan-requests/:id/publish` / `.../withdraw`

**¿Para qué sirve?** `publish` es lo que hace visible la solicitud para los Lenders (paso 3) — antes de esto, nadie más que el Deudor la ve. `withdraw` es bajarla de circulación (por ejemplo si ya no necesita el préstamo), declinando de paso cualquier cotización que hubiera recibido.

`publish`: `DRAFT → PUBLISHED`. `withdraw`: `PUBLISHED → WITHDRAWN`, declina (`DECLINED`) cualquier `LoanQuote` `SUBMITTED` recibida.

- **Auth**: Autenticado, rol `BORROWER`.
- **Errores**: `401`/`403` · `404 NOT_FOUND` · `409 LOAN_REQUEST_NOT_DRAFT` (`publish`) · `409 LOAN_REQUEST_NOT_PUBLISHED` (`withdraw`).

### `POST /api/borrowers/me/loan-requests/:id/targets` / `DELETE .../targets/:lenderCompanyId`

**¿Para qué sirve?** Invitar puntualmente a Lenders específicos a cotizar una solicitud — útil tanto para una solicitud `PRIVATE` (que si no, nadie la ve) como para "avisarle" a un Lender de confianza sobre una `PUBLIC` que igual es visible para todos.

`D-S2-22`. Elige (o quita) `LenderCompany` ya registradas a quienes pedirles cotización puntualmente — reemplaza al viejo `invitedLenderCompanyId` singular. Independiente de la visibilidad (`PUBLIC` también puede targetear).

- **Auth**: Autenticado, rol `BORROWER`.
- **Request body (`POST`)**: `{ "lenderCompanyId": string }`.

  ```json
  { "lenderCompanyId": "01a0c1e2-3b4d-7e5f-8a9b-0c1d2e3f4a5b" }
  ```

- **Errores**: `400 VALIDATION_ERROR` · `401`/`403` · `404 NOT_FOUND` (loan request ajeno, o `lenderCompanyId` inexistente) · `409 LOAN_REQUEST_NOT_TARGETABLE` · `409 ALREADY_TARGETED`.

### `GET /api/marketplace/loan-requests` / `GET /api/marketplace/loan-requests/:id`

**¿Para qué sirve?** Es la vitrina del Lender: listar (o ver el detalle de) las solicitudes de préstamo disponibles para cotizar — las públicas de todo el mercado, más las privadas donde fue invitado puntualmente (paso 4 del flujo).

Para `LENDER`: `PUBLIC` visibles a todos + `PRIVATE` donde su `LenderCompany` está en `LoanRequestLenderTarget`. `PUBLIC` enmascara `borrowerProfileId` y la dirección exacta (`addressLine1`/`addressLine2`/`county`/`parcelNumber` vacíos) — regla 17 de [04 §4.7](plan/04-base-de-datos.md#reglas-de-negocio-nuevas-extiende-46); `PRIVATE` targeteado se ve completo (el Deudor ya eligió compartirlo con ese Lender puntual).

- **Auth**: Autenticado, rol `LENDER` (lectura, exenta de 2FA).
- **Errores**: `401`/`403`/`404 LENDER_NOT_FOUND` · `404 NOT_FOUND` (`:id` inexistente, no `PUBLISHED`, o `PRIVATE` sin target).

### `POST /api/marketplace/loan-requests/:id/quotes` / `DELETE .../quotes`

**¿Para qué sirve?** Es la "oferta" del Lender: proponer sus propias condiciones (tasa, plazo, estructura) para una solicitud que le interesa financiar (paso 5). `DELETE` retira esa oferta si se arrepiente antes de que el Deudor la elija.

`PB-026`. Crea o reemplaza (mientras `status=SUBMITTED`) la `LoanQuote` propia — una fila por `(loanRequestId, lenderCompanyId)`. `DELETE` la retira (`status → WITHDRAWN`).

- **Auth**: Autenticado, rol `LENDER` + 2FA activo (escritura).
- **Request body (`POST`)**: `{ "lenderCompanyId"?: string, "structure": "INTEREST_ONLY"|"AMORTIZED"|"BALLOON", "principalAmount": number, "interestRate": number, "amortizationTermMonths": number, "estimatedClosingCostsAmount"?: number, "message"?: string, "expiresAt"?: string }`. `lenderCompanyId` obligatorio solo si el Lender tiene más de una `LenderCompany` (mismo patrón que `BE-045`).

  ```json
  {
    "lenderCompanyId": "01a0c1e2-3b4d-7e5f-8a9b-0c1d2e3f4a5b",
    "structure": "INTEREST_ONLY",
    "principalAmount": 255000,
    "interestRate": 10.5,
    "amortizationTermMonths": 12,
    "estimatedClosingCostsAmount": 5500,
    "message": "Can close in 3 weeks, no prepayment penalty.",
    "expiresAt": "2026-10-01T00:00:00.000Z"
  }
  ```

- **Response `201`**: `LoanQuote`.
- **Errores**: `400 VALIDATION_ERROR` · `400 LENDER_COMPANY_REQUIRED` · `401`/`403`/`403 TWO_FACTOR_REQUIRED` · `404 NOT_FOUND` (loan request no visible para este Lender) · `409 LOAN_REQUEST_ALREADY_MATCHED`.

### `GET /api/borrowers/me/loan-requests/:id/quotes`

**¿Para qué sirve?** Para que el Deudor compare todas las ofertas que recibió sobre una solicitud (paso 6) antes de elegir una.

Todas las cotizaciones recibidas (cualquier `status`), para comparar.

- **Auth**: Autenticado, rol `BORROWER`.
- **Errores**: `401`/`403` · `404 NOT_FOUND`.

### `POST /api/borrowers/me/loan-requests/:id/quotes/:quoteId/select`

**¿Para qué sirve?** Es el paso decisivo del flujo (paso 7): el Deudor acepta la oferta de un Lender puntual y eso **crea el contrato automáticamente** — de acá en adelante el negocio sigue como un contrato normal, en el módulo de Contratos.

`PB-017`. El Deudor elige una cotización: en una sola transacción, declina el resto `SUBMITTED` de ese `LoanRequest`, backfillea `Property.lenderCompanyId` con la `LenderCompany` ganadora (`D-S2-25`), mueve `LoanRequest.status → MATCHED`, y crea `Contract(DRAFT, originationSource=MARKETPLACE, loanRequestId)` (mismo servicio que `BE-051`) con `ContractTerms` v1 pre-llenada desde la cotización — `structure`/`principalAmount`/`interestRate`/`amortizationTermMonths` vienen de la `LoanQuote`; `firstPaymentDate` se deriva como un mes después de `requestedClosingDate`, `maturityDate` a partir de ahí + `amortizationTermMonths`, mora `FLAT $50`/10 días de gracia por default — todo editable por el Lender después (`PATCH /api/contracts/:id`, mientras `ContractTerms` siga `DRAFT`). Inserta automáticamente `ContractFeeItem(MARKETPLACE_CONNECTION)` (1pt del `principalAmount`, mínimo $999, `D-S2-5`).

**`D-P5-3` (2026-09-13)**: en la misma transacción crea (o reactiva si estaba `REMOVED`) el `LenderBorrower(ACTIVE)` entre el Deudor y la `LenderCompany` ganadora — `invitedByUserId` queda en el usuario Lender que mandó esa cotización — y agrega al Deudor como `ContractBorrower(isPrimary: true)` del `Contract` recién creado. Es la única forma de crear un `LenderBorrower` nuevo con `POST /api/lenders/me/borrowers` deshabilitado (`D-P5-1`). Después de crear el contrato, envía al Lender el correo `loan-quote-selected` avisándole que tiene un contrato en `DRAFT` listo para revisar/completar.

- **Auth**: Autenticado, rol `BORROWER`.
- **Response `201`**: `{ "success": true, "data": { "contractId": "..." } }`.
- **Errores**: `401`/`403` · `404 NOT_FOUND` · `409 LOAN_REQUEST_NOT_PUBLISHED` · `409 QUOTE_NOT_SUBMITTED` (ya `SELECTED`/`DECLINED`/`WITHDRAWN`/`EXPIRED`, o perdió la carrera contra otra selección).

---

## Catálogo de códigos de error

`code` es estable entre versiones; `message` es texto en **inglés** (convención fijada 2026-09-08 — toda respuesta de la API, éxito o error, va en inglés; el resto del código/documentación sigue en español) pensado para mostrarse tal cual, no para parsearse.

| `code` | HTTP | Cuándo |
|---|---|---|
| `INVALID_JSON` | 400 | El body no es JSON válido |
| `VALIDATION_ERROR` | 400 | El body no cumple el schema Zod del endpoint (primer error de validación) |
| `LENDER_COMPANY_REQUIRED` | 400 | `POST /api/marketplace/loan-requests/:id/quotes`, y (mientras estuvo activo) `POST /api/lenders/me/borrowers` (`D-P5-1`, deshabilitado) — el Lender tiene más de una `LenderCompany` y no mandó `lenderCompanyId` |
| `INVALID_TOKEN` | 400 o 401 | Refresh token / pending token / access token / token de reset: inválido, manipulado o expirado. `password/reset` usa 400 (es un dato del body); el resto usa 401 |
| `UNAUTHENTICATED` | 401 | Falta el header `Authorization: Bearer` en un endpoint que lo exige |
| `INVALID_CREDENTIALS` | 401 | Login: correo inexistente o contraseña incorrecta (mismo código para ambos). También: 2FA con sesión de verificación inválida, o `disable`/`recovery-codes` con password/código incorrectos |
| `INVALID_2FA_CODE` | 401 | Código TOTP y recovery code, ambos inválidos, en `/login/2fa` o `/2fa/verify` |
| `ACCOUNT_INACTIVE` | 403 | Login con contraseña correcta pero `User.isActive=false`. También: un ADMIN/LENDER con `isActive=false` intenta una escritura de negocio con un access token todavía vigente (`withRole` lo revisa en vivo, `BE-036`) |
| `FORBIDDEN` | 403 | Sesión válida pero el rol no tiene permiso para el endpoint (p.ej. un BORROWER llamando a `/2fa/setup`, o un LENDER llamando a `/admin/users/:id/activate`); también el caso de `requireContractAccess` para un rol sin modelo de acceso a contratos definido todavía |
| `TWO_FACTOR_REQUIRED` | 403 | ADMIN/LENDER sin 2FA activo intenta una escritura de negocio (`D-P3-1`) — hoy: `POST`/`PATCH`/`DELETE /api/users`, `POST /api/admin/users/:id/activate\|deactivate`, `POST /api/admin/lenders/:id/companies`, `PATCH`/`DELETE /api/admin/lenders/:id/companies/:companyId`, `DELETE /api/admin/lenders/:id`, `POST /api/lenders/me/companies`, `PATCH`/`DELETE /api/lenders/me/companies/:companyId` (`D-P4-9`), `DELETE /api/lenders/me/borrowers/:id` (`POST`/`PATCH` de ese mismo módulo deshabilitados, `D-P5-1`), todo endpoint de escritura de `LENDER` bajo `/api/contracts/**` (crear/editar/borrar/cancelar contrato, borrowers, terms, fees — nunca `accept`/`reject`, esos son `BORROWER`), y `POST`/`DELETE /api/marketplace/loan-requests/:id/quotes` (Fase 13). No aplica a lecturas, autoservicio sin rol específico, ni a `/api/auth/2fa/*`. Puede desactivarse temporalmente con `REQUIRE_TWO_FACTOR=false` (`D-P4-4`, ver [Variables de entorno](#variables-de-entorno)) |
| `PASSWORD_CHANGE_REQUIRED` | 403 | `PATCH /api/borrowers/me` con `mustChangePassword=true` (`D-P4-2`) — el Deudor todavía no cambió la contraseña temporal que se le generó al crearlo |
| `USER_NOT_FOUND` | 404 | `:id` no corresponde a ningún usuario (o está borrado lógicamente) |
| `NOT_FOUND` | 404 | `requireContractAccess` (`BE-038`, usado por todo el módulo de Contratos): el contrato no existe, o existe pero no pertenece a la sesión. También (mientras estuvo activo) `POST /api/lenders/me/borrowers` con un `lenderCompanyId` que no es del Lender (`D-P5-1`, deshabilitado), `POST /api/contracts` con un `insuranceCompanyId`/`borrowerProfileId` ajeno, `POST /api/contracts/:id/borrowers` con un deudor no vinculado, `.../terms/:termsId*` con un `termsId` que no es de ese contrato, `.../fees/:feeId` con un fee que no es de esa versión. También en el módulo de marketplace (Fase 13): un `LoanRequest` ajeno o inexistente, un `lenderCompanyId` inexistente en `.../targets`, un `LoanRequest` `PRIVATE` que el Lender no puede ver (sin `target`/no `PUBLISHED`), una `LoanQuote` que no es de ese `LoanRequest`. Mismo código para "no existe" y "existe pero no es tuyo" a propósito (anti-enumeración, §7.5); los casos de tenant mismatch además quedan auditados (`AuditLog.action=ACCESS_DENIED`, `BE-039`) |
| `LENDER_NOT_FOUND` | 404 | `:id` de `/api/admin/lenders*` no corresponde a ningún `LenderProfile` ni `User.id` de un Lender (o está borrado lógicamente, `D-P4-7`); o el `User` autenticado en `/api/lenders/me*` no tiene `LenderProfile` |
| `LENDER_COMPANY_NOT_FOUND` | 404 | `:companyId` de `PATCH`/`DELETE /api/admin/lenders/:id/companies/:companyId` no es una `LenderCompany` de ese `:id` (o está borrada lógicamente); mismo código en `PATCH`/`DELETE /api/lenders/me/companies/:companyId` (`D-P4-9`) si `:companyId` no es del Lender de la sesión |
| `BORROWER_NOT_FOUND` | 404 | El `User` autenticado en `/api/borrowers/me*` no tiene `BorrowerProfile` |
| `EMAIL_TAKEN` | 409 | `POST`/`PATCH /api/users`, y (mientras estuvo activo) `POST /api/lenders/me/borrowers` (`D-P5-1`, deshabilitado) con un correo que ya existe |
| `EIN_TAKEN` | 409 | `POST /api/admin/lenders/:id/companies`, `POST /api/lenders/me/companies`, o `PATCH /api/admin\|lenders/.../companies/:companyId` (incluido `D-P4-9`) con un `ein` que ya usa otra `LenderCompany` |
| `LENDER_HAS_ACTIVE_CONTRACTS` | 409 | `DELETE /api/admin/lenders/:id` (alguna de sus `LenderCompany` tiene un `Contract` `ACTIVE`/`DELINQUENT`) o `DELETE .../companies/:companyId` (esa empresa puntual lo tiene) — Admin o autoservicio (`D-P4-9`) |
| `NO_LENDER_COMPANY` | 409 | `POST /api/marketplace/loan-requests/:id/quotes`, y (mientras estuvo activo) `POST /api/lenders/me/borrowers` (`D-P5-1`, deshabilitado) — el Lender todavía no tiene ninguna `LenderCompany` |
| `BORROWER_HAS_ACTIVE_CONTRACTS` | 409 | `DELETE /api/lenders/me/borrowers/:id` — el deudor tiene un `Contract` `ACTIVE`/`DELINQUENT` con alguna de las empresas de las que se lo está desvinculando |
| `TWO_FACTOR_ALREADY_ENABLED` | 409 | `/2fa/setup` o `/2fa/verify` cuando el usuario ya tiene 2FA activo |
| `TWO_FACTOR_NOT_ENABLED` | 409 | `/2fa/disable` o `/2fa/recovery-codes` cuando el usuario no tiene 2FA activo |
| `TWO_FACTOR_SETUP_REQUIRED` | 409 | `/2fa/verify` sin haber llamado antes a `/2fa/setup` |
| `CONTRACT_NOT_DELETABLE` | 409 | `DELETE /api/contracts/:id` con `status` distinto de `DRAFT` |
| `CONTRACT_HAS_TRANSACTIONS` | 409 | `DELETE /api/contracts/:id` — el contrato (aunque `DRAFT`) ya tiene alguna `Transaction` |
| `CONTRACT_NOT_CANCELLABLE` | 409 | `POST /api/contracts/:id/cancel` con `status` fuera de `PENDING_ACCEPTANCE`/`ACTIVE`/`DELINQUENT` |
| `ALREADY_ASSOCIATED` | 409 | `POST /api/contracts/:id/borrowers` — ese `borrowerProfileId` ya está asociado (activo) a ese contrato |
| `NO_CURRENT_TERMS` | 409 | `PATCH /api/contracts/:id` o `POST .../terms` sobre un contrato sin `currentTermsId` (no debería ocurrir en la práctica — `POST /api/contracts` siempre deja uno) |
| `TERMS_NOT_EDITABLE` | 409 | `PATCH /api/contracts/:id` (campo `terms`) o `POST`/`DELETE .../fees*` cuando la `ContractTerms` vigente no está `DRAFT` |
| `TERMS_STILL_DRAFT` | 409 | `POST /api/contracts/:id/terms` cuando la vigente todavía está `DRAFT` — usar `PATCH /api/contracts/:id` en su lugar |
| `TERMS_NOT_DRAFT` | 409 | `POST .../terms/:termsId/submit` sobre una versión que no está `DRAFT` |
| `TERMS_NOT_PENDING` | 409 | `POST .../terms/:termsId/accept\|reject` sobre una versión que no está `PENDING_ACCEPTANCE` |
| `ALREADY_DECIDED` | 409 | `POST .../terms/:termsId/accept\|reject` — ese `BorrowerProfile` ya registró una decisión (`ContractTermsAcceptance`) sobre esa versión |
| `NO_BORROWERS` | 409 | `POST .../terms/:termsId/submit` — el contrato no tiene ningún `ContractBorrower` activo a quién notificar |
| `SCHEDULE_ALREADY_GENERATED` | 409 | Intento de generar el calendario (`generateAmortizationSchedule`) dos veces para la misma `ContractTerms` |
| `RESERVED_FEE_CODE` | 400 | `POST .../fees` con `code=MARKETPLACE_CONNECTION` — reservada para inserción automática (Fase 13) |
| `LOAN_REQUEST_NOT_EDITABLE` | 409 | `PATCH /api/borrowers/me/loan-requests/:id` con `status` distinto de `DRAFT` |
| `LOAN_REQUEST_NOT_DRAFT` | 409 | `POST .../publish` con `status` distinto de `DRAFT` |
| `LOAN_REQUEST_NOT_PUBLISHED` | 409 | `POST .../withdraw` o `.../quotes/:quoteId/select` con `status` distinto de `PUBLISHED` |
| `LOAN_REQUEST_NOT_TARGETABLE` | 409 | `POST .../targets` sobre un `LoanRequest` que ya no es `DRAFT`/`PUBLISHED` |
| `ALREADY_TARGETED` | 409 | `POST .../targets` — esa `LenderCompany` ya está en la lista |
| `LOAN_REQUEST_ALREADY_MATCHED` | 409 | `POST /api/marketplace/loan-requests/:id/quotes` sobre un `LoanRequest` ya `MATCHED`/`WITHDRAWN`/`EXPIRED` |
| `QUOTE_NOT_SUBMITTED` | 409 | `POST .../quotes/:quoteId/select` sobre una cotización que ya no está `SUBMITTED` (incluye la carrera de dos selecciones casi simultáneas) |
| `RATE_LIMITED` | 429 | Se superó `RATE_LIMIT_LOGIN_MAX` intentos en la ventana, para el bucket+IP correspondiente |
| `INTERNAL_ERROR` | 500 | Cualquier excepción no prevista — se loguea con `requestId` para rastrearla en los logs del servidor |

---

[← Docs](README.md)
