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

**Acceso multi-empresa sin selector de tenant** (`D-P4-1`, confirmado definitivo por `D-P6-1`): un `LENDER` puede tener más de una `LenderCompany`. No existe (ni se va a construir — `withTenantScope` quedó descartado, no solo diferido) ningún mecanismo para indicar "con cuál empresa estoy operando" que persista entre requests: las lecturas de `/api/lenders/me/borrowers*` devuelven resultados de **todas** las empresas del Lender, y la creación (`POST .../borrowers`) resuelve la empresa destino sola si hay una sola, o exige `lenderCompanyId` explícito si hay más de una. Mismo patrón que usan `POST /api/contracts` (Fase 6) y el matching de marketplace (Fase 13) una vez implementados.

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

Lista los usuarios **no eliminados lógicamente** (`deletedAt IS NULL`) — incluye tanto activos como inactivos, es lo que el Admin necesita ver para decidir a quién activar/desactivar.

- **Auth**: Autenticado, rol `ADMIN`.
- **Response `200`**: `data` = array de `SafeUser` (ver forma abajo), orden `createdAt desc`.
- **Errores**: `401 UNAUTHENTICATED`/`INVALID_TOKEN` · `403 FORBIDDEN` (sesión válida pero no es ADMIN).

### `POST /api/users`

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

Edición parcial — cualquier subconjunto no vacío de `name`/`email`/`phone`/`password`/`isActive`.

- **Auth**: Autenticado, rol `ADMIN` + 2FA activo (`D-P3-1`, es una escritura de negocio).
- **Request body**: mismos campos que `POST` (todos opcionales), pero **al menos uno** debe venir.
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

Auto-registro de `LENDER` o `BORROWER` — el usuario crea su propia cuenta, sin que un Admin/Lender lo haya dado de alta antes (`D-P1-10`). **No pide contraseña.** La cuenta nace `isActive=false`; solo un Admin puede activarla (`POST /api/admin/users/:id/activate`, más abajo), momento en el que recién se genera una contraseña y se envía por correo.

- **Auth**: Público.
- **Request body**:

  | Campo | Tipo | Validación |
  |---|---|---|
  | `name` | string | 1–120 caracteres |
  | `email` | string | formato email, se normaliza a minúsculas |
  | `phone` | string | opcional — exactamente 10 dígitos (`^\d{10}$`) |
  | `role` | string | **solo** `LENDER` o `BORROWER` — `ADMIN`/`BOOKKEEPER`/`INSURANCE_COMPANY` no pueden auto-registrarse |

- **Response `202`** (siempre, exista o no ya el correo — anti-enumeración, misma postura que `password/forgot`):
  ```json
  { "success": true, "data": { "message": "Si los datos son válidos, tu cuenta quedará pendiente de activación. Una vez que un administrador la active, recibirás un correo con tu contraseña temporal." } }
  ```
- **Errores**: `400 VALIDATION_ERROR` (rol inválido, campos faltantes).
- **Qué pasa por dentro**: crea `User(isActive=false, password=hash de un valor aleatorio que nadie conoce)` + `LenderProfile(createdByAdminId=null)` o `BorrowerProfile(createdByUserId=null)`, en una transacción. Si el correo ya existe, no hace nada — responde igual.

### `POST /api/auth/login`

Paso 1 de login. Si el usuario tiene 2FA activo, no emite tokens todavía — hay que completar el paso 2.

- **Auth**: Público. **Rate limit**: bucket `login` (`RATE_LIMIT_LOGIN_MAX` intentos por `RATE_LIMIT_LOGIN_WINDOW_MS`, por IP).
- **Request body**: `{ "email": string, "password": string (1–72 chars) }`.
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

Paso 2, solo alcanzable con un `pendingToken` válido del paso 1. Acepta un código TOTP **o** un recovery code de un solo uso.

- **Auth**: Público (el `pendingToken` hace de credencial). **Rate limit**: bucket `login2fa`, independiente del bucket `login` — un código incorrecto acá nunca consume el cupo de `/login`.
- **Request body**: `{ "pendingToken": string, "code": string }` — `code` puede ser un TOTP de 6 dígitos o uno de los 8 recovery codes entregados al activar 2FA.
- **Response `200`**: igual que el login exitoso sin 2FA (`requiresTwoFactor: false, accessToken, refreshToken, user`).
- **Errores**: `401 INVALID_TOKEN` (pendingToken inválido/expirado) · `401 INVALID_CREDENTIALS` (el usuario detrás del pendingToken ya no es válido — desactivado, borrado, o perdió el 2FA entre el paso 1 y el 2) · `401 INVALID_2FA_CODE` (código y recovery code, ambos inválidos) · `429 RATE_LIMITED`.
- **Nota**: un recovery code usado una vez queda marcado (`usedAt`) y no vuelve a funcionar.

### `POST /api/auth/refresh`

Rota el refresh token en cada uso — nunca se puede reusar uno ya canjeado.

- **Auth**: Público (el `refreshToken` hace de credencial).
- **Request body**: `{ "refreshToken": string }`.
- **Response `200`**: nuevo par `{ accessToken, refreshToken, user }` — el `refreshToken` viejo queda revocado (`revokedAt`), enlazado al nuevo vía `replacedByTokenId`.
- **Errores**:
  - `401 INVALID_TOKEN` — token inexistente, expirado, o ya revocado.
  - **Detección de robo**: si el token presentado ya había sido **rotado** antes (alguien más lo canjeó primero — `replacedByTokenId` seteado) y se reintenta el original, se revocan **todos** los refresh tokens vigentes de ese usuario, en todas sus sesiones/dispositivos. Un token revocado por un `logout()` normal (sin rotación previa) no dispara esta cascada — solo se rechaza ese token puntual.

### `POST /api/auth/logout`

Revoca un refresh token puntual.

- **Auth**: Autenticado (`Authorization: Bearer <accessToken>`) + el `refreshToken` a revocar en el body.
- **Request body**: `{ "refreshToken": string }`.
- **Response `200`**: `{ "loggedOut": true }`.
- **Errores**: `401 UNAUTHENTICATED` (sin access token) · `401 INVALID_TOKEN` (access token inválido/expirado) · `400 VALIDATION_ERROR`.

### `POST /api/auth/logout-all`

Revoca **todos** los refresh tokens vigentes del usuario autenticado (todas sus sesiones).

- **Auth**: Autenticado. Sin body.
- **Response `200`**: `{ "loggedOut": true }`.

### `GET /api/auth/me`

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
        "phone": null,
        "lenderCompanies": [ { "id": "...", "companyName": "..." } ]
      }
    }
  }
  ```
- **Errores**: `401 UNAUTHENTICATED` / `401 INVALID_TOKEN` · `404 USER_NOT_FOUND` (el usuario del token fue borrado después de emitirse).

### `PATCH /api/auth/me`

Autoservicio (`BE-099`, nuevo `D-P2-4`): el usuario edita su propia información de contacto. Deliberadamente **no** acepta `email`/`password`/`role`/`isActive` — un campo fuera de este schema se descarta en vez de aplicarse, así que no hay forma de colarlos en el mismo body.

- **Auth**: Autenticado. Sin restricción de rol — cualquiera edita lo suyo.
- **Request body**: `{ "name"?: string, "phone"?: string }` — al menos uno de los dos, `phone` con el mismo formato de 10 dígitos que el resto de la API.
- **Response `200`**:
  ```json
  { "success": true, "data": { "user": /* SafeUser actualizado */ {} } }
  ```
- **Errores**: `401 UNAUTHENTICATED`/`INVALID_TOKEN` · `400 VALIDATION_ERROR` (body vacío o `phone` inválido).

### `POST /api/auth/password/forgot`

- **Auth**: Público. **Rate limit**: bucket `password-forgot`.
- **Request body**: `{ "email": string }`.
- **Response `200`** (siempre, exista o no el correo — anti-enumeración):
  ```json
  { "success": true, "data": { "message": "Si el correo existe, vas a recibir instrucciones para restablecer tu contraseña." } }
  ```
- **Qué pasa por dentro** (si el correo existe): genera un `PasswordResetToken` opaco (expira en 1h, solo se guarda su hash SHA-256) y envía un correo (plantilla `password-reset`) con el link `{CORS_ORIGIN}/reset-password?token=<token-en-claro>`.

### `POST /api/auth/password/reset`

- **Auth**: Público (el `token` del correo hace de credencial).
- **Request body**: `{ "token": string, "newPassword": string (8–72 chars) }`.
- **Response `200`**: `{ "message": "Contraseña actualizada." }`.
- **Errores**: `400 INVALID_TOKEN` (token inexistente, ya usado, o expirado) · `400 VALIDATION_ERROR`.
- **Efecto secundario importante**: revoca **todos** los refresh tokens del usuario — fuerza a volver a loguearse en todos los dispositivos.

### `POST /api/auth/2fa/setup`

Genera el secreto TOTP — **no activa 2FA todavía**, eso pasa recién en `/verify`.

- **Auth**: Autenticado, rol `ADMIN` o `LENDER`. Sin body.
- **Response `200`**:
  ```json
  { "success": true, "data": { "secret": "4Z3E3OZW...", "otpAuthUrl": "otpauth://totp/PayMyLoan:user%40example.com?secret=...&issuer=PayMyLoan" } }
  ```
  `otpAuthUrl` es lo que se codifica como QR para escanear con Google Authenticator / Authy / etc.
- **Errores**: `403 FORBIDDEN` (rol no permitido) · `409 TWO_FACTOR_ALREADY_ENABLED`.

### `POST /api/auth/2fa/verify`

Confirma que el usuario efectivamente pudo generar un código con el secreto de `/setup` — recién ahí activa 2FA.

- **Auth**: Autenticado, rol `ADMIN` o `LENDER`.
- **Request body**: `{ "code": string }` (código TOTP de 6 dígitos).
- **Response `200`**:
  ```json
  { "success": true, "data": { "recoveryCodes": ["IqM0k63iCI", "UJspkfptW2", "...8 en total..."] } }
  ```
  Los 8 recovery codes se muestran **una única vez** — solo se guarda su hash SHA-256, no hay forma de volver a consultarlos en claro (si se pierden, hay que regenerarlos con `/recovery-codes`).
- **Errores**: `403 FORBIDDEN` · `401 INVALID_2FA_CODE` (código incorrecto — 2FA sigue sin activarse) · `409 TWO_FACTOR_ALREADY_ENABLED` · `409 TWO_FACTOR_SETUP_REQUIRED` (no se llamó a `/setup` antes).

### `POST /api/auth/2fa/disable`

Exige contraseña **y** código TOTP vigente — nunca alcanza con tener la sesión activa (evita que un access token robado, por sí solo, pueda apagar 2FA).

- **Auth**: Autenticado, rol `ADMIN` o `LENDER`.
- **Request body**: `{ "password": string, "code": string }`.
- **Response `200`**: `{ "disabled": true }`.
- **Errores**: `403 FORBIDDEN` · `401 INVALID_CREDENTIALS` (password o código incorrectos) · `409 TWO_FACTOR_NOT_ENABLED`.
- **Efecto**: `isTwoFactorEnabled=false`, borra el secreto y **todos** los recovery codes existentes.

### `POST /api/auth/2fa/recovery-codes`

Regenera el set de 8 recovery codes — invalida los anteriores. Misma exigencia que `/disable`.

- **Auth**: Autenticado, rol `ADMIN` o `LENDER`.
- **Request body**: `{ "password": string, "code": string }`.
- **Response `200`**: `{ "recoveryCodes": [ /* 8 nuevos, en claro, una única vez */ ] }`.
- **Errores**: igual que `/disable`.

---

## Administración de usuarios (`src/app/api/admin/users/[id]/`)

Adelantados desde Fase 4 (`BE-097`, ver [D-P2-1](plan/00-contradicciones-y-decisiones.md#decisiones-2026-09-06-ronda-fase-2)) porque sin ellos el auto-registro (`POST /api/auth/register`) es un callejón sin salida: una cuenta que nace `isActive=false` necesita alguna forma de activarse.

### `POST /api/admin/users/:id/activate`

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

- **Auth**: Autenticado, rol `ADMIN` + 2FA activo (`D-P3-1`, es una escritura de negocio).
- **Response `200`**: `{ "success": true, "data": /* SafeUser, isActive: false */ {} }`.
- **Errores**: igual que `/activate`.
- **Efecto secundario**: revoca todos los refresh tokens vigentes del usuario — una cuenta desactivada no puede seguir usando una sesión que ya tenía abierta.

---

## Prestamistas — Admin (`src/app/api/admin/lenders/`)

`BE-041..044`, `BE-040` (rescopeado `D-P4-5`). Este módulo ya **no** da de alta personas — un `LENDER` nace por autoservicio ([`POST /api/auth/register`](#post-apiauthregister)) y un Admin lo activa ([`POST /api/admin/users/:id/activate`](#post-apiadminusersidactivate)). Lo que sí cubre este módulo es la empresa (`LenderCompany`) — el tenant real — sobre un `LenderProfile` que ya existe.

> **`:id` en las 4 rutas de abajo acepta `LenderProfile.id` o el `User.id` de la persona** (`D-P4-7`) — indistintamente. Existen porque [`GET /api/users`](#get-apiusers) (el único lugar donde un Admin ve el id de un Lender sin pasar por `GET /api/admin/lenders`) solo expone `User.id`; exigir `LenderProfile.id` ahí hacía inutilizable ese camino.

### `POST /api/admin/lenders/:id/companies`

Un Admin asocia una `LenderCompany` **nueva** a un Lender que ya existe — nunca toca `User`/`LenderProfile`, solo campos de la empresa (`D-P4-5`: rescopeo de `BE-040`, que antes creaba la persona también). Mismo servicio (`lenders.service.ts#createLenderCompany`) que usa la variante autoservicio, [`POST /api/lenders/me/companies`](#post-apilendersmecompanies), abajo.

- **Auth**: Autenticado, rol `ADMIN` + 2FA activo (`D-P3-1`).
- **Request body**:

  | Campo | Tipo | Validación |
  |---|---|---|
  | `companyName` | string | 1–200 caracteres |
  | `ein` | string | formato `XX-XXXXXXX` |
  | `contactPhone` | string | opcional, 10 dígitos — teléfono de la empresa (`LenderCompany.contactPhone`) |
  | `addressLine1` / `addressLine2` / `city` / `state` (2 letras) / `postalCode` | string | dirección de la empresa; `addressLine2` opcional |

- **Response `201`**: `{ "success": true, "data": { /* LenderCompanySummary, ver forma abajo */ } }`.
- **Errores**: `400 VALIDATION_ERROR` · `401 UNAUTHENTICATED`/`INVALID_TOKEN` · `403 FORBIDDEN`/`TWO_FACTOR_REQUIRED` · `404 LENDER_NOT_FOUND` · `409 EIN_TAKEN`.

### `PATCH /api/admin/lenders/:id/companies/:companyId`

`D-P4-8`, nuevo. Un Admin edita cualquier campo de una `LenderCompany` puntual — incluidos `status` (suspender/reactivar una empresa, `D-P1-8`) e `isOpenToDeals` (`M-4`). `:companyId` se valida contra `:id`: una empresa que existe pero es de otro Lender responde `404`, igual que si no existiera.

- **Auth**: Autenticado, rol `ADMIN` + 2FA activo (`D-P3-1`).
- **Request body**: todos los campos de `POST .../companies` (arriba), todos opcionales, más `isOpenToDeals` (boolean) y `status` (`"ACTIVE"` | `"SUSPENDED"`) — al menos uno.
- **Response `200`**: `{ "success": true, "data": { /* LenderCompanySummary */ } }`.
- **Errores**: `400 VALIDATION_ERROR` · `401`/`403`/`403 TWO_FACTOR_REQUIRED` · `404 LENDER_NOT_FOUND` · `404 LENDER_COMPANY_NOT_FOUND` · `409 EIN_TAKEN`.

### `DELETE /api/admin/lenders/:id/companies/:companyId`

`D-P4-8`, nuevo. Soft-delete de **una sola** `LenderCompany` (no del Lender ni de sus otras empresas) — bloqueado si esa empresa tiene un `Contract` `ACTIVE`/`DELINQUENT`. Puede dejar al Lender con cero empresas — estado ya válido (el mismo que un recién auto-registrado, `D-P2-1`).

- **Auth**: Autenticado, rol `ADMIN` + 2FA activo (`D-P3-1`).
- **Response `200`**: `{ "success": true, "data": { "deleted": true } }`.
- **Errores**: `401`/`403`/`403 TWO_FACTOR_REQUIRED` · `404 LENDER_NOT_FOUND` · `404 LENDER_COMPANY_NOT_FOUND` · `409 LENDER_HAS_ACTIVE_CONTRACTS`.

### `GET /api/admin/lenders`

Lista + búsqueda (por nombre/email de la persona o `companyName`) + paginación (ver [Convenciones](#convenciones)) + filtro `status` (`ACTIVE`/`SUSPENDED`, sobre alguna `LenderCompany` del Lender).

- **Auth**: Autenticado, rol `ADMIN` (lectura, exenta de 2FA).
- **Response `200`**: `data` = [resultado paginado](#convenciones) de objetos con la forma de `Lender` (ver abajo).

### `GET /api/admin/lenders/:id`

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

Soft-delete de `User` + `LenderProfile` + **todas** sus `LenderCompany` (`deletedAt`, y el `User` además `isActive=false` + revoca sus refresh tokens) — bloqueado si alguna empresa tiene un `Contract` `ACTIVE`/`DELINQUENT`.

- **Auth**: Autenticado, rol `ADMIN` + 2FA activo (escritura).
- **Response `200`**: `data` = `SafeUser` con `deletedAt` seteado.
- **Errores**: `401`/`403`/`403 TWO_FACTOR_REQUIRED` · `404 LENDER_NOT_FOUND` · `409 LENDER_HAS_ACTIVE_CONTRACTS`.

---

## Prestamistas y Deudores — autoservicio

### `GET /api/lenders/me`

`BE-100` (nuevo — el mapa de endpoints del plan lo preveía sin ningún ticket detrás, `D-P4-3`). Mismo shape que `GET /api/admin/lenders/:id` (arriba), pero sobre el `LenderProfile` de la sesión. No hay `PATCH` acá (`D-P4-8`): `LenderProfile` no tiene ningún campo propio editable — `name`/`phone` de `User` se editan por [`PATCH /api/auth/me`](#patch-apiauthme) (`BE-099`); editar una empresa propia es cosa del Admin por ahora (`PATCH /api/admin/lenders/:id/companies/:companyId`), no hay autoservicio de edición de empresa todavía.

- **Auth**: Autenticado, rol `LENDER`, exenta de 2FA (lectura).
- **Errores**: `401`/`403` · `404 LENDER_NOT_FOUND`.

### `POST /api/lenders/me/companies`

`BE-101`, nuevo (`D-P4-5`). El propio Lender se crea una `LenderCompany` — mismo body/servicio que [`POST /api/admin/lenders/:id/companies`](#post-apiadminlendersidcompanies), resolviendo el `LenderProfile` desde la sesión en vez de un `:id`. Cierra el hueco de un Lender auto-registrado (`D-P2-1`) que nace con `LenderProfile` pero sin ninguna `LenderCompany` — antes no había ningún endpoint para que se diera de alta la primera.

- **Auth**: Autenticado, rol `LENDER` + 2FA activo (`D-P3-1`).
- **Request body**: igual que `POST /api/admin/lenders/:id/companies` (`companyName`/`ein`/`contactPhone`?/dirección) — **sin** `name`/`email`, esos son de la persona, no de la empresa.
- **Response `201`**: `{ "success": true, "data": { /* LenderCompanySummary, ver forma abajo */ } }`.
- **Errores**: `400 VALIDATION_ERROR` · `401`/`403`/`403 TWO_FACTOR_REQUIRED` · `404 LENDER_NOT_FOUND` (perfil de prestamista de la sesión no encontrado) · `409 EIN_TAKEN`.

### `POST /api/lenders/me/borrowers`

`BE-045`. Crea `User(role=BORROWER)` + `BorrowerProfile` (sin `lenderId` — ya no existe, `D-P1-4`) + `LenderBorrower`, activo de inmediato con contraseña temporal por correo, **nunca en la respuesta** (mismo patrón que la activación por Admin, `BE-097`).

- **Auth**: Autenticado, rol `LENDER` + 2FA activo (escritura).
- **Request body**:

  | Campo | Tipo | Validación |
  |---|---|---|
  | `name` | string | 1–120 caracteres |
  | `email` | string | formato email |
  | `phone` | string | opcional, 10 dígitos |
  | `lenderCompanyId` | string | **obligatorio solo si el Lender tiene más de una `LenderCompany`** — con una sola, se resuelve sola (`D-P4-1`) |

- **Response `201`**: `{ "success": true, "data": { "borrower": { /* ver forma abajo */ }, "emailSent": true } }`.
- **Errores**: `400 VALIDATION_ERROR` · `400 LENDER_COMPANY_REQUIRED` (tiene más de una empresa y no mandó `lenderCompanyId`) · `401`/`403`/`403 TWO_FACTOR_REQUIRED` · `404 NOT_FOUND` (`lenderCompanyId` no es una empresa del Lender — nunca se usa, § 7.5) · `409 EMAIL_TAKEN` · `409 NO_LENDER_COMPANY` (el Lender todavía no tiene ninguna empresa).

### `GET /api/lenders/me/borrowers`

Lista + búsqueda (nombre/email) + paginación, a través de **todas** las `LenderCompany` del Lender (`D-P4-1`) — cada fila trae `lenderCompanies` con las empresas del Lender de las que ese deudor es parte, para distinguirlas si tiene más de una.

- **Auth**: Autenticado, rol `LENDER` (lectura, exenta de 2FA).
- **Response `200`**: `data` = [resultado paginado](#convenciones) de objetos con la forma de `Borrower` (ver abajo).

### `GET /api/lenders/me/borrowers/:id`

`:id` = `BorrowerProfile.id`. Mismo criterio anti-enumeración que [`requireContractAccess`](plan/07-autenticacion-y-autorizacion.md#75-rbac--aislamiento-multi-tenant--cómo-se-evita-que-un-prestamista-acceda-a-datos-de-otro): un deudor que existe pero no es del Lender responde `404`, nunca `403`.

- **Auth**: Autenticado, rol `LENDER` (lectura, exenta de 2FA).
- **Response `200`**:
  ```jsonc
  {
    "success": true,
    "data": {
      "id": "...",                // BorrowerProfile.id
      "user": /* SafeUser */ {},
      "phone": null, "addressLine1": null, "city": null, "state": null, "postalCode": null,
      "lenderCompanies": [ { "id": "...", "companyName": "..." } ]
    }
  }
  ```
- **Errores**: `401`/`403` · `404 NOT_FOUND`.

### `PATCH /api/lenders/me/borrowers/:id`

Campos de contacto del `BorrowerProfile` (`phone`/`addressLine1`/`city`/`state`/`postalCode`) — nunca `lenderCompanyId`.

- **Auth**: Autenticado, rol `LENDER` + 2FA activo (escritura).
- **Response `200`**: mismo shape que `GET .../borrowers/:id`.
- **Errores**: `400 VALIDATION_ERROR` · `401`/`403`/`403 TWO_FACTOR_REQUIRED` · `404 NOT_FOUND`.

### `DELETE /api/lenders/me/borrowers/:id`

`BE-049` (`M-3`). **Desvincula** (`LenderBorrower.removedAt`+`status=REMOVED`) — nunca borra el `BorrowerProfile`, el deudor puede tener otros lenders. Bloqueado si tiene un `Contract` `ACTIVE`/`DELINQUENT` con alguna de las empresas de las que se lo está desvinculando.

- **Auth**: Autenticado, rol `LENDER` + 2FA activo (escritura).
- **Response `200`**: `{ "success": true, "data": { "removed": true } }`.
- **Errores**: `401`/`403`/`403 TWO_FACTOR_REQUIRED` · `404 NOT_FOUND` · `409 BORROWER_HAS_ACTIVE_CONTRACTS`.

### `GET /api/borrowers/me` / `PATCH /api/borrowers/me`

`BE-050`. Perfil propio del Deudor — campos de contacto propios, nunca `lenderCompanyId`.

- **Auth**: Autenticado, rol `BORROWER` (`BORROWER` nunca exige 2FA, `D-P3-1`).
- **`PATCH` bloqueado con `403 PASSWORD_CHANGE_REQUIRED`** mientras `mustChangePassword=true` (`D-P4-2`) — un deudor recién creado por un Lender tiene que cambiar su contraseña temporal antes de poder editar su perfil. `GET` no está bloqueado (necesita poder ver el estado del flag).
- **Response `200` (`GET`)**:
  ```jsonc
  {
    "success": true,
    "data": {
      "user": /* SafeUser */ {},
      "borrowerProfile": { "id": "...", "phone": null, "addressLine1": null, "city": null, "state": null, "postalCode": null },
      "lenderCompanies": [ { "id": "...", "companyName": "..." } ]
    }
  }
  ```
- **Errores**: `400 VALIDATION_ERROR` (solo `PATCH`) · `401 UNAUTHENTICATED`/`INVALID_TOKEN` · `403 PASSWORD_CHANGE_REQUIRED` (solo `PATCH`) · `404 BORROWER_NOT_FOUND`.

### `POST /api/borrowers/me/password`

`BE-050`. Cambia la contraseña mientras el usuario ya está autenticado — exige la contraseña actual (defensa en profundidad, mismo criterio que `/2fa/disable`, `BE-034`). **Siempre accesible**, incluso con `mustChangePassword:true` — es el único camino para apagarlo.

- **Auth**: Autenticado, rol `BORROWER`.
- **Request body**: `{ "currentPassword": string, "newPassword": string (8–72 chars) }`.
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

// Borrower (POST/GET/PATCH /api/lenders/me/borrowers*)
{
  "id": "...",                 // BorrowerProfile.id
  "user": /* SafeUser */ {},
  "phone": null, "addressLine1": null, "city": null, "state": null, "postalCode": null,
  "lenderCompanies": [ { "id": "...", "companyName": "..." } ]  // solo las que comparte con el Lender que consulta
}
```

---

## Catálogo de códigos de error

`code` es estable entre versiones; `message` es texto en **inglés** (convención fijada 2026-09-08 — toda respuesta de la API, éxito o error, va en inglés; el resto del código/documentación sigue en español) pensado para mostrarse tal cual, no para parsearse.

| `code` | HTTP | Cuándo |
|---|---|---|
| `INVALID_JSON` | 400 | El body no es JSON válido |
| `VALIDATION_ERROR` | 400 | El body no cumple el schema Zod del endpoint (primer error de validación) |
| `LENDER_COMPANY_REQUIRED` | 400 | `POST /api/lenders/me/borrowers` — el Lender tiene más de una `LenderCompany` y no mandó `lenderCompanyId` |
| `INVALID_TOKEN` | 400 o 401 | Refresh token / pending token / access token / token de reset: inválido, manipulado o expirado. `password/reset` usa 400 (es un dato del body); el resto usa 401 |
| `UNAUTHENTICATED` | 401 | Falta el header `Authorization: Bearer` en un endpoint que lo exige |
| `INVALID_CREDENTIALS` | 401 | Login: correo inexistente o contraseña incorrecta (mismo código para ambos). También: 2FA con sesión de verificación inválida, o `disable`/`recovery-codes` con password/código incorrectos |
| `INVALID_2FA_CODE` | 401 | Código TOTP y recovery code, ambos inválidos, en `/login/2fa` o `/2fa/verify` |
| `ACCOUNT_INACTIVE` | 403 | Login con contraseña correcta pero `User.isActive=false`. También: un ADMIN/LENDER con `isActive=false` intenta una escritura de negocio con un access token todavía vigente (`withRole` lo revisa en vivo, `BE-036`) |
| `FORBIDDEN` | 403 | Sesión válida pero el rol no tiene permiso para el endpoint (p.ej. un BORROWER llamando a `/2fa/setup`, o un LENDER llamando a `/admin/users/:id/activate`); también el caso de `requireContractAccess` para un rol sin modelo de acceso a contratos definido todavía |
| `TWO_FACTOR_REQUIRED` | 403 | ADMIN/LENDER sin 2FA activo intenta una escritura de negocio (`D-P3-1`) — hoy: `POST`/`PATCH`/`DELETE /api/users`, `POST /api/admin/users/:id/activate\|deactivate`, `POST /api/admin/lenders/:id/companies`, `PATCH`/`DELETE /api/admin/lenders/:id/companies/:companyId`, `DELETE /api/admin/lenders/:id`, `POST /api/lenders/me/companies`, `POST /api/lenders/me/borrowers`, `PATCH`/`DELETE /api/lenders/me/borrowers/:id`. No aplica a lecturas, autoservicio sin rol específico, ni a `/api/auth/2fa/*`. Puede desactivarse temporalmente con `REQUIRE_TWO_FACTOR=false` (`D-P4-4`, ver [Variables de entorno](#variables-de-entorno)) |
| `PASSWORD_CHANGE_REQUIRED` | 403 | `PATCH /api/borrowers/me` con `mustChangePassword=true` (`D-P4-2`) — el Deudor todavía no cambió la contraseña temporal que se le generó al crearlo |
| `USER_NOT_FOUND` | 404 | `:id` no corresponde a ningún usuario (o está borrado lógicamente) |
| `NOT_FOUND` | 404 | `requireContractAccess` (`BE-038`, sin endpoint consumidor todavía): el contrato no existe, o existe pero no pertenece a la sesión. También `POST /api/lenders/me/borrowers` con un `lenderCompanyId` que no es del Lender. Mismo código para "no existe" y "existe pero no es tuyo" a propósito (anti-enumeración, §7.5); los casos de tenant mismatch además quedan auditados (`AuditLog.action=ACCESS_DENIED`, `BE-039`) |
| `LENDER_NOT_FOUND` | 404 | `:id` de `/api/admin/lenders*` no corresponde a ningún `LenderProfile` ni `User.id` de un Lender (o está borrado lógicamente, `D-P4-7`); o el `User` autenticado en `/api/lenders/me*` no tiene `LenderProfile` |
| `LENDER_COMPANY_NOT_FOUND` | 404 | `:companyId` de `PATCH`/`DELETE /api/admin/lenders/:id/companies/:companyId` no es una `LenderCompany` de ese `:id` (o está borrada lógicamente) |
| `BORROWER_NOT_FOUND` | 404 | El `User` autenticado en `/api/borrowers/me*` no tiene `BorrowerProfile` |
| `EMAIL_TAKEN` | 409 | `POST`/`PATCH /api/users`, `POST /api/lenders/me/borrowers` con un correo que ya existe |
| `EIN_TAKEN` | 409 | `POST /api/admin/lenders/:id/companies` o `POST /api/lenders/me/companies` con un `ein` que ya usa otra `LenderCompany` |
| `LENDER_HAS_ACTIVE_CONTRACTS` | 409 | `DELETE /api/admin/lenders/:id` (alguna de sus `LenderCompany` tiene un `Contract` `ACTIVE`/`DELINQUENT`) o `DELETE /api/admin/lenders/:id/companies/:companyId` (esa empresa puntual lo tiene) |
| `NO_LENDER_COMPANY` | 409 | `POST /api/lenders/me/borrowers` — el Lender todavía no tiene ninguna `LenderCompany` |
| `BORROWER_HAS_ACTIVE_CONTRACTS` | 409 | `DELETE /api/lenders/me/borrowers/:id` — el deudor tiene un `Contract` `ACTIVE`/`DELINQUENT` con alguna de las empresas de las que se lo está desvinculando |
| `TWO_FACTOR_ALREADY_ENABLED` | 409 | `/2fa/setup` o `/2fa/verify` cuando el usuario ya tiene 2FA activo |
| `TWO_FACTOR_NOT_ENABLED` | 409 | `/2fa/disable` o `/2fa/recovery-codes` cuando el usuario no tiene 2FA activo |
| `TWO_FACTOR_SETUP_REQUIRED` | 409 | `/2fa/verify` sin haber llamado antes a `/2fa/setup` |
| `RATE_LIMITED` | 429 | Se superó `RATE_LIMIT_LOGIN_MAX` intentos en la ventana, para el bucket+IP correspondiente |
| `INTERNAL_ERROR` | 500 | Cualquier excepción no prevista — se loguea con `requestId` para rastrearla en los logs del servidor |

---

[← Docs](README.md)
