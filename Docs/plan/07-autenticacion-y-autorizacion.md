[← Índice del plan](README.md)  ·  [Anterior: 6. API — Endpoints por módulo](06-api-endpoints.md)  ·  [Siguiente: 8. Contratos](08-contratos.md)

---

# 7. Autenticación y autorización

## 7.1 Estrategia de sesión

**JWT propio, access + refresh** (ver A-1). Access token de vida corta (15 min, `JWT_ACCESS_TTL`), payload mínimo: `{ sub: userId, role }`. Refresh token de vida larga (30 días), opaco (no JWT), hash almacenado en `refresh_tokens` (nunca el valor en claro), con rotación en cada uso (`replacedByTokenId`) para detectar reuso de un token robado.

> **Corregido 2026-09-06 (`D-P2-2`)**: la versión original de este payload incluía `lenderId?`, resuelto en el login. Eso dejó de ser implementable desde `D-P1-3` (el tenant real es `LenderCompany`, y un `LenderProfile` puede tener N) — no hay un único `lenderId` que resolver en el momento de loguearse. El JWT implementado en Fase 2 lleva **solo `{ sub, role }`**; `GET /api/auth/me` (§7.7) devuelve la lista completa de empresas asociadas para que el cliente elija. **Resuelto 2026-09-10 (`D-P6-1`)**: esa elección viaja como `lenderCompanyId` explícito en el body de cada endpoint de creación tenant-ambiguo (no hay middleware que la "recuerde" entre requests) — ver riesgo #18 en [15](15-riesgos-y-decisiones-pendientes.md), ya cerrado.

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
2. **No hay middleware `withTenantScope`** (descartado, `D-P6-1`, ver [00](00-contradicciones-y-decisiones.md#decisión-2026-09-10-ronda-fase-6--arranque-d-p6-1-withtenantscope-descartado)). En su lugar, cada endpoint de creación resuelve la empresa así: lecturas y accesos a un recurso puntual verifican contra **todas** las `LenderCompany` de la sesión (`requireContractAccess`, `BE-038`); la creación de un recurso nuevo (`POST /api/contracts`, `POST /api/lenders/me/borrowers`, el match de marketplace) exige `lenderCompanyId` explícito en el body si el Lender tiene más de una empresa, se resuelve sola si tiene una. Ningún controller acepta `lenderId`/`lenderCompanyId` de otro lado que no sea ese body validado contra las empresas propias.
3. **Todo query de un LENDER incluye `lenderCompanyId` en el `WHERE`**, sin excepción, tanto para listar (`findMany({ where: { lenderCompanyId: { in: misEmpresas } } })`) como para leer/editar/borrar un recurso puntual: primero se hace `findUnique({ where: { id } })`, y si `resource.lenderCompanyId` no está entre las empresas de la sesión se responde **`404 NOT_FOUND`** (no `403`) — se elige 404 deliberadamente para no confirmarle a un atacante que el ID que probó *existe* pero pertenece a otro tenant (evita enumeración).
4. **Nunca se confía en un `lenderCompanyId`/`contractId`/`borrowerId` del body para decidir a quién pertenece algo que se está creando.** Ej: `POST /api/contracts/:id/borrowers { borrowerProfileId }` — el servicio primero resuelve `contract.lenderCompanyId` desde `:id`, y separadamente verifica `EXISTS(LenderBorrower WHERE lenderCompanyId=contract.lenderCompanyId AND borrowerProfileId=... AND status=ACTIVE)` (un `BorrowerProfile` no tiene `lenderId` propio desde `D-P1-4` — la pertenencia es vía `LenderBorrower`, N:M); si no existe esa fila, `404`/`409 TENANT_MISMATCH`. Ningún campo `lenderCompanyId` es aceptado como input directo salvo en los endpoints de creación explícitamente diseñados para eso (`D-P6-1`) — siempre validado contra las empresas propias de la sesión.
5. **Para `BORROWER`**: el aislamiento no es por pertenecer a un único Prestamista (un deudor puede tener varios, `D-P1-4`) sino por pertenencia vía `ContractBorrower`. Todo acceso a `/api/contracts/:id/*` para un `BORROWER` verifica `EXISTS(ContractBorrower WHERE contractId=:id AND borrowerProfileId=session.borrowerProfileId AND removedAt IS NULL)`.
6. **Tests dedicados** (sección [11](11-testing.md)) prueban explícitamente el caso descrito en el encargo: Lender A autenticado, IDs de Lender B manipulados a mano en la URL/body → se espera `404` en cada endpoint tenant-scoped, en un test parametrizado que recorre todos los endpoints del módulo `contracts`/`borrowers`/`payment-methods`.

> **`withTenantScope` descartado (`D-P6-1`, 2026-09-10)** — históricamente diferido Fase 3 → Fase 4 (`D-P3-2`) → Fase 6, hasta que al llegar a Fase 6 (primer consumidor real: `BE-051`) se decidió no construirlo: ningún módulo (Borrowers/Fase 5, Marketplace/Fase 13, ni Contracts/Fase 6) terminó necesitando que una "empresa activa" persista entre requests — los tres resolvieron con `lenderCompanyId` explícito en el body de creación cuando hay ambigüedad. Lo que sí se construyó en Fase 3, y sigue siendo el mecanismo vigente: `requireContractAccess(session, contractId)` (`BE-038`) — resuelve acceso a un `Contract` puntual comparando `contract.lenderCompanyId` contra **todas** las `LenderCompany` del `LenderProfile` de la sesión, y por `ContractBorrower` activo para `BORROWER`. Mismo criterio anti-enumeración: siempre `404`, nunca `403`, y cada rechazo por tenant mismatch queda en `AuditLog` (`action=ACCESS_DENIED`, `BE-039`).

## 7.6 Middlewares/guards

| Middleware | Qué hace |
|---|---|
| `withAuth` | **Implementado (`src/middlewares/withAuth.ts`, BE-035)**. Verifica el access token (firma+expiración), devuelve `session = { userId, role }` |
| `withRole(session, roles, options?)` | **Implementado (`src/middlewares/withRole.ts`, BE-036)**. 403 `FORBIDDEN` si `session.role` no está en la lista; para ADMIN/LENDER, adicionalmente 403 `TWO_FACTOR_REQUIRED` si no tiene 2FA activo — default `true`, se apaga con `{ requireTwoFactor: false }` (ver acotación `D-P3-1` en §7.4) |
| `requireContractAccess(session, contractId)` | **Implementado (`src/middlewares/requireContractAccess.ts`, BE-038)**, sin consumidor todavía — ver nota arriba |
| ~~`withTenantScope`~~ | **Descartado (`D-P6-1`, 2026-09-10)** — no se construye; cada endpoint de creación tenant-ambiguo exige `lenderCompanyId` explícito en el body en su lugar |
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
