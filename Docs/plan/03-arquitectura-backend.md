[← Índice del plan](README.md)  ·  [Anterior: 2. Diferencias PayMyLoan vs Owner](02-diferencias-owner.md)  ·  [Siguiente: 4. Base de datos](04-base-de-datos.md)

---

# 3. Arquitectura del backend

## 3.1 Estructura de proyecto (extiende la ya establecida)

```
prisma/
  schema.prisma
  migrations/
src/
  app/
    api/
      auth/
        login/route.ts
        login/2fa/route.ts
        refresh/route.ts
        logout/route.ts
        logout-all/route.ts
        me/route.ts
        password/forgot/route.ts
        password/reset/route.ts
        2fa/setup/route.ts
        2fa/verify/route.ts
        2fa/disable/route.ts
        2fa/recovery-codes/route.ts
      admin/
        lenders/route.ts
        lenders/[id]/route.ts
      lenders/
        me/borrowers/route.ts
        me/borrowers/[id]/route.ts
      contracts/
        route.ts
        [id]/route.ts
        [id]/submit/route.ts
        [id]/activate/route.ts             (interno, disparado por accept)
        [id]/cancel/route.ts
        [id]/borrowers/route.ts
        [id]/borrowers/[borrowerId]/route.ts
        [id]/terms/route.ts
        [id]/terms/[termsId]/accept/route.ts
        [id]/terms/[termsId]/reject/route.ts
        [id]/schedule/route.ts
        [id]/balance/route.ts
        [id]/transactions/route.ts
        [id]/payments/route.ts
        [id]/payments/manual/route.ts
      payment-methods/
        route.ts
        [id]/route.ts
      transactions/
        [id]/route.ts
        [id]/reverse/route.ts
      webhooks/
        stripe/route.ts
      audit-logs/route.ts
      health/route.ts
  config/
    env.ts
  middlewares/
    withAuth.ts
    withRole.ts
    withTenantScope.ts
    rateLimit.ts
  controllers/
    <módulo>.controller.ts     (uno por dominio, igual que hoy users.controller.ts)
  services/
    <módulo>.service.ts
    amortization.service.ts     (funciones puras, sin I/O)
    payment-allocation.service.ts (funciones puras, sin I/O)
  repositories/
    <módulo>.repository.ts      (solo para módulos con queries complejas: contracts, payments)
  validations/
    <módulo>.validation.ts      (esquemas Zod)
  auth/
    jwt.ts                      (firma/verificación access + refresh)
    password.ts                 (bcrypt wrapper)
    totp.ts                     (wrapper de @otplib)
  errors/
    AppError.ts
    errorHandler.ts
    domain/                     (subclases: UnauthorizedError, ForbiddenError, NotFoundError, ConflictError, TenantMismatchError)
  lib/
    apiResponse.ts
    audit.ts                    (logAuditEvent)
    email.ts                    (cliente de correo transaccional)
    stripe.ts                   (cliente de Stripe)
  db/
    prisma.ts
  types/
    api.ts
    auth.ts                     (Session, JwtPayload)
  jobs/
    assessLateFees.ts
    recomputeContractDelinquency.ts
    expireStaleTokens.ts
public/
Dockerfile
docker-compose.yml
docker-compose.dev.yml
.env.example
```

**Por qué se agrega `repositories/`** (no existe hoy): los módulos `contracts` y `payments` necesitan queries con múltiples `include`/filtros por tenant que, si viven inline en el service, lo saturan. Se aísla el acceso a Prisma detrás de una función con nombre de intención (`findActiveContractsForLender(lenderId, filters)`) — los módulos simples (`users`, `lenders`, `borrowers`) siguen llamando a Prisma directo desde el service, como ya hace `users.service.ts` hoy; no se fuerza el patrón donde no aporta.

## 3.2 Capas y flujo de una request (sin cambios de fondo respecto a hoy)

`route.ts` → middlewares (`withAuth` → `withRole` → `withTenantScope`, según el endpoint) → `controller` (Zod) → `service`/`repository` (Prisma, reglas de negocio) → `apiSuccess`/`apiError`, con `errorHandler.ts` capturando cualquier excepción no controlada. Se mantiene el patrón `SafeX`/`toSafeX()` de `users.service.ts` para cada entidad con campos sensibles (`User` ya lo tiene; se replica para `LenderProfile`, `BorrowerProfile`, `PaymentMethod`).

## 3.3 Separación por módulos

| Módulo | Responsabilidad | Tenant-scoped |
|---|---|---|
| `auth` | Login, sesión, 2FA, recuperación de contraseña | No (opera sobre el propio usuario) |
| `admin` | CRUD de `LenderProfile` (tenants) | No (Admin ve todos) |
| `lenders` | Perfil propio del Prestamista, CRUD de sus Deudores | Sí (`lenderId = session.lenderId`) |
| `borrowers` | Lectura/edición de un `BorrowerProfile` puntual | Sí |
| `contracts` | CRUD de contratos, términos, aceptación, calendario | Sí |
| `payments` | Métodos de pago, transacciones, allocations | Sí (vía `contract.lenderId`) |
| `webhooks` | Recepción de eventos de Stripe | N/A (público, verificado por firma) |
| `audit` | Consulta de bitácora | Sí para Lender (acotado a su `lenderId`), global para Admin |

## 3.4 Multi-tenancy / aislamiento entre prestamistas

Ver desarrollo completo en sección [7.5](07-autenticacion-y-autorizacion.md#75-rbac--aislamiento-multi-tenant--cómo-se-evita-que-un-prestamista-acceda-a-datos-de-otro) — resumen: cada tabla de negocio tiene `lenderId` (directo o vía `contractId → Contract.lenderId`), cada middleware de autorización inyecta `session.lenderId` en el contexto de la request, y **ningún service acepta `lenderId` como parámetro proveniente del body/query del cliente** — siempre se deriva de la sesión.

## 3.5 Configuración y variables de entorno

Extiende `.env.example` actual, mismo patrón de "un solo punto de lectura" (`src/config/env.ts`):

```
# ya existen
PORT=4000
NODE_ENV=development
DATABASE_URL=postgresql://paymyloan:paymyloan@localhost:5432/paymyloan?schema=public

# nuevas — autenticación
JWT_ACCESS_SECRET=
JWT_REFRESH_SECRET=
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=30d
BCRYPT_COST=12

# nuevas — CORS
CORS_ORIGIN=http://localhost:3000

# nuevas — 2FA
TOTP_ISSUER=PayMyLoan

# nuevas — correo transaccional (proveedor a definir, ver sección 15)
EMAIL_PROVIDER=resend
EMAIL_API_KEY=
EMAIL_FROM=servicing@paymyloan.ai

# nuevas — Stripe (pendiente de decisión Connect, ver sección 15)
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PUBLISHABLE_KEY=

# nuevas — S3 (solo si se construye el módulo de Documentos, fase 2)
S3_BUCKET=
S3_REGION=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=

# nuevas — rate limiting
RATE_LIMIT_LOGIN_MAX=5
RATE_LIMIT_LOGIN_WINDOW_MS=900000
```

`env.ts` se extiende para exponer estos valores tipados y **lanzar en el arranque** (`fail-fast`) si falta alguno de los obligatorios en producción (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `DATABASE_URL`) — hoy no valida nada al arrancar, es una brecha a cerrar (ver BE-002).

## 3.6 Seguridad transversal

- Contraseñas: bcrypt costo 12 (ya establecido), nunca se loguean ni se devuelven.
- 2FA obligatorio para `ADMIN` y `LENDER`, verificado en el login antes de emitir el access token (no basta con crear la cuenta, ver sección [7.4](07-autenticacion-y-autorizacion.md#74-2fa-obligatorio-para-admin-y-lender)).
- CORS restringido a `CORS_ORIGIN` (el dominio del frontend), nunca `*`.
- Rate limiting en `/api/auth/login`, `/api/auth/login/2fa`, `/api/auth/password/forgot` (ver BE-006).
- Ningún endpoint de negocio confía en un `lenderId`/`borrowerId`/`contractId` que llegue en el body si contradice lo que resuelve la sesión — se verifica siempre server-side (sección [7.5](07-autenticacion-y-autorizacion.md#75-rbac--aislamiento-multi-tenant--cómo-se-evita-que-un-prestamista-acceda-a-datos-de-otro)).
- Nunca se persiste información bancaria completa — solo referencias de Stripe y últimos 4 dígitos (heredado de [PAYMYLOAN_DATABASE_DESIGN.md](../PAYMYLOAN_DATABASE_DESIGN.md) sección 14, sigue aplicando tal cual).
- `AuditLog` de solo inserción, cobertura de todo evento de identidad (login, cambio de contraseña, activación/baja de 2FA) y de negocio (creación de prestamista, contrato, aceptación de términos, transacción, cambio de método de pago).
- Todas las respuestas de error usan el formato único `apiError()` existente — nunca se filtra un stack trace ni un mensaje de Prisma crudo al cliente (`errorHandler.ts` normaliza).

---

[← Índice del plan](README.md)  ·  [Anterior: 2. Diferencias PayMyLoan vs Owner](02-diferencias-owner.md)  ·  [Siguiente: 4. Base de datos](04-base-de-datos.md)
