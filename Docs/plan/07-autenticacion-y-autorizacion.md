[← Índice del plan](README.md)  ·  [Anterior: 6. API — Endpoints por módulo](06-api-endpoints.md)  ·  [Siguiente: 8. Contratos](08-contratos.md)

---

# 7. Autenticación y autorización

## 7.1 Estrategia de sesión

**JWT propio, access + refresh** (ver A-1). Access token de vida corta (15 min, `JWT_ACCESS_TTL`), payload mínimo: `{ sub: userId, role }`. Refresh token de vida larga (30 días), opaco (no JWT), hash almacenado en `refresh_tokens` (nunca el valor en claro), con rotación en cada uso (`replacedByTokenId`) para detectar reuso de un token robado.

> **Corregido 2026-09-06 (`D-P2-2`)**: la versión original de este payload incluía `lenderId?`, resuelto en el login. Eso dejó de ser implementable desde `D-P1-3` (el tenant real es `LenderCompany`, y un `LenderProfile` puede tener N) — no hay un único `lenderId` que resolver en el momento de loguearse. El JWT implementado en Fase 2 lleva **solo `{ sub, role }`**; `GET /api/auth/me` (§7.7) devuelve la lista completa de empresas asociadas para que el cliente elija. Cómo esa elección viaja en requests posteriores es explícitamente trabajo de Fase 3 (`withTenantScope`, `BE-037`) — ver riesgo #18 en [15](15-riesgos-y-decisiones-pendientes.md), acotado pero no cerrado del todo.

## 7.2 Login / logout / refresh

```
POST /api/auth/login
  body: { email, password }
  → si password inválida: 401 INVALID_CREDENTIALS
  → si isTwoFactorEnabled=false (solo posible para BORROWER): emite access+refresh directo
  → si isTwoFactorEnabled=true: emite un "pending token" de corta vida (2 min) y responde
    { requiresTwoFactor: true, pendingToken }

POST /api/auth/login/2fa
  body: { pendingToken, code }
  → verifica TOTP contra twoFactorSecret; también acepta un recovery code (uso único)
  → emite access+refresh, actualiza lastLoginAt, AuditLog(USER_LOGIN_SUCCESS)

POST /api/auth/refresh
  body: { refreshToken }
  → valida hash+expiresAt+revokedAt; si el token ya fue usado antes (replacedByTokenId
    no nulo y se reintenta el original) revoca TODA la cadena de ese usuario — señal de robo

POST /api/auth/logout
  body: { refreshToken } → revokedAt = now()
```

## 7.3 Password hashing y recuperación

Se mantiene bcrypt costo 12 (ya establecido en `users.service.ts`). Recuperación:

```
POST /api/auth/password/forgot { email }
  → genera PasswordResetToken (hash del token, expira en 1h), envía correo con el token
    en claro en el link; responde 200 siempre, exista o no el email (anti-enumeración)

POST /api/auth/password/reset { token, newPassword }
  → valida hash+expiresAt+usedAt=null, actualiza password, usedAt=now(),
    revoca todos los refresh tokens del usuario (fuerza re-login en todos lados)
```

## 7.4 2FA obligatorio para ADMIN y LENDER

Los campos ya existen en `User` (`twoFactorSecret`, `isTwoFactorEnabled`). Flujo:

```
POST /api/auth/2fa/setup        (autenticado, aún sin 2FA activo)
  → genera secreto TOTP (@otplib, igual que Owner), lo guarda SIN activar
    (isTwoFactorEnabled sigue false), devuelve otpauth:// URL para el QR

POST /api/auth/2fa/verify { code }
  → verifica el código contra el secreto pendiente; si es válido,
    isTwoFactorEnabled=true, genera 8 TwoFactorRecoveryCode, los devuelve UNA
    sola vez (nunca se pueden volver a consultar en claro)
```

**Regla dura**: un `User` con `role ∈ {ADMIN, LENDER}` y `isTwoFactorEnabled=false` puede iniciar sesión (paso 1) pero el middleware de negocio (`withRole`) rechaza **cualquier** operación de escritura fuera de `/api/auth/2fa/*` con `403 TWO_FACTOR_REQUIRED` — no es solo una recomendación de UI, se aplica server-side. Esto reemplaza al enfoque de [PAYMYLOAN_DATABASE_DESIGN.md](../PAYMYLOAN_DATABASE_DESIGN.md) (que lo verificaba solo al aceptar un `LoanParty`) porque aquí no existe ese punto único de entrada — el Admin/Lender puede intentar cualquier endpoint desde el día uno.

> **Acotado 2026-09-08 (`D-P3-1`, implementado en Fase 3)**: "cualquier operación de escritura" se refiere a **endpoints de negocio** — los que ya exigen `withRole(["ADMIN"|"LENDER"], ...)` para una acción administrativa (hoy: `POST`/`PATCH`/`DELETE /api/users`, `POST /api/admin/users/:id/activate|deactivate`). El autoservicio de cualquier rol (`POST /api/auth/logout`/`logout-all`, `GET`/`PATCH /api/auth/me`) **no** exige un rol específico, así que la regla nunca lo alcanza — y las propias rutas `/api/auth/2fa/*` la apagan explícitamente (`requireTwoFactor: false`), porque ahí es donde justamente se activa el 2FA que la regla exige en el resto. `GET /api/users` también queda exento por ser lectura, no escritura.

Un Prestamista creado por un Admin (sección [6.2](06-api-endpoints.md#62-admin--lenders)) nace con `isTwoFactorEnabled=false` y una contraseña temporal — debe cambiar la contraseña **y** activar 2FA antes de poder usar el resto de la API (ver BE-050).

## 7.5 RBAC + aislamiento multi-tenant — cómo se evita que un Prestamista acceda a datos de otro

Este es el requisito de seguridad más importante del encargo. Mecanismo, en capas:

1. **El JWT nunca contiene un `lenderId` que el cliente pueda influir.** Se calcula en el login, leyendo `LenderProfile.id` (o `BorrowerProfile.lenderId`) desde la base de datos — no viaja en el body del login.
2. **Middleware `withTenantScope`** se ejecuta después de `withAuth`+`withRole` en todo endpoint bajo `/api/lenders/me/*`, `/api/contracts/*`, `/api/payment-methods/*`, `/api/transactions/*`: inyecta `req.tenant = { lenderId: session.lenderId }` en el contexto de la request. Ningún controller lee `lenderId` de otro lado.
3. **Todo query de un LENDER incluye `lenderId` en el `WHERE`**, sin excepción, tanto para listar (`findMany({ where: { lenderId } })`) como para leer/editar/borrar un recurso puntual: primero se hace `findUnique({ where: { id } })`, y si `resource.lenderId !== session.lenderId` se responde **`404 NOT_FOUND`** (no `403`) — se elige 404 deliberadamente para no confirmarle a un atacante que el ID que probó *existe* pero pertenece a otro tenant (evita enumeración).
4. **Nunca se confía en un `lenderId`/`contractId`/`borrowerId` del body para decidir a quién pertenece algo que se está creando.** Ej: `POST /api/contracts/:id/borrowers { borrowerProfileId }` — el servicio primero resuelve `contract.lenderId` desde `:id`, y separadamente resuelve `borrowerProfile.lenderId` desde `borrowerProfileId`; si no coinciden entre sí y con `session.lenderId`, `404`/`409 TENANT_MISMATCH`. Ningún campo `lenderId` es aceptado como input directo en ningún endpoint de negocio — siempre se deriva.
5. **Para `BORROWER`**: el aislamiento no es por `lenderId` propio (un deudor no "es" un tenant) sino por pertenencia vía `ContractBorrower`. Todo acceso a `/api/contracts/:id/*` para un `BORROWER` verifica `EXISTS(ContractBorrower WHERE contractId=:id AND borrowerProfileId=session.borrowerProfileId AND removedAt IS NULL)`.
6. **Tests dedicados** (sección [11](11-testing.md)) prueban explícitamente el caso descrito en el encargo: Lender A autenticado, IDs de Lender B manipulados a mano en la URL/body → se espera `404` en cada endpoint tenant-scoped, en un test parametrizado que recorre todos los endpoints del módulo `contracts`/`borrowers`/`payment-methods`.

> **`withTenantScope` diferido a Fase 4 (`D-P3-2`)**: no tiene todavía ningún endpoint consumidor real (`/api/lenders/me/*`, `/api/contracts/*` — Fase 4/5/6 no están construidos). Se decide su mecanismo (header, path, etc.) cuando exista el primero. Lo que sí se construyó en Fase 3, sin depender de eso: `requireContractAccess(session, contractId)` (`BE-038`) — resuelve acceso a un `Contract` puntual comparando `contract.lenderCompanyId` contra **todas** las `LenderCompany` del `LenderProfile` de la sesión (no contra una "empresa activa" todavía sin definir), y por `ContractBorrower` activo para `BORROWER`. Mismo criterio anti-enumeración: siempre `404`, nunca `403`, y cada rechazo por tenant mismatch queda en `AuditLog` (`action=ACCESS_DENIED`, `BE-039`).

## 7.6 Middlewares/guards

| Middleware | Qué hace |
|---|---|
| `withAuth` | **Implementado (`src/middlewares/withAuth.ts`, BE-035)**. Verifica el access token (firma+expiración), devuelve `session = { userId, role }` |
| `withRole(session, roles, options?)` | **Implementado (`src/middlewares/withRole.ts`, BE-036)**. 403 `FORBIDDEN` si `session.role` no está en la lista; para ADMIN/LENDER, adicionalmente 403 `TWO_FACTOR_REQUIRED` si no tiene 2FA activo — default `true`, se apaga con `{ requireTwoFactor: false }` (ver acotación `D-P3-1` en §7.4) |
| `requireContractAccess(session, contractId)` | **Implementado (`src/middlewares/requireContractAccess.ts`, BE-038)**, sin consumidor todavía — ver nota arriba |
| `withTenantScope` | **Diferido a Fase 4 (`D-P3-2`)** — inyectará la empresa activa una vez que se decida el mecanismo |
| `rateLimit(bucket)` | **Implementado desde Fase 0** (`src/middlewares/rateLimit.ts`, BE-005). Limita intentos en `login`, `login/2fa`, `password/forgot` |

## 7.7 Auto-registro y activación (`D-P2-1`, nuevo 2026-09-06)

`LENDER` y `BORROWER` pueden auto-registrarse — adicional a los flujos existentes (Admin crea Lender, Lender crea/vincula Borrower), no en reemplazo (`D-P1-10`). `ADMIN`, `BOOKKEEPER` e `INSURANCE_COMPANY` no tienen este endpoint.

```
POST /api/auth/register  (Público)
  body: { name, email, role }   — role ∈ { LENDER, BORROWER }, sin contraseña
  → crea User(isActive=false, password=hash de un valor aleatorio que nadie conoce)
    + LenderProfile(createdByAdminId=null) o BorrowerProfile(createdByUserId=null)
  → responde 202 siempre con el mismo mensaje genérico, exista o no ya el correo
    (misma postura anti-enumeración que password/forgot)

POST /api/admin/users/:id/activate   (ADMIN)
  → si el usuario nunca inició sesión (lastLoginAt=null): genera una contraseña
    temporal, la guarda hasheada (bcrypt) y la envía por correo (plantilla
    account-activated); responde { user, emailSent }
  → si ya había iniciado sesión antes (reactivación): solo isActive=true, no
    toca la contraseña ni reenvía correo — este mismo endpoint es el
    reintento si el primer envío falló (desactivar + activar de nuevo)

POST /api/admin/users/:id/deactivate   (ADMIN)
  → isActive=false + revoca todos los refresh tokens vigentes del usuario
```

La cuenta nace inactiva porque el negocio quiere poder revisarla antes de dejarla operar (riesgo #20, resuelto). El registro no pide contraseña porque nadie la va a escribir en ese momento — se genera recién al activar, y se entrega por el único canal que en ese punto ya se verificó que el usuario controla: su correo.

---

[← Índice del plan](README.md)  ·  [Anterior: 6. API — Endpoints por módulo](06-api-endpoints.md)  ·  [Siguiente: 8. Contratos](08-contratos.md)
