# 18. Suscripciones (Fase 20)

> **Estado**: **etapa 1 (cobro simulado) implementada 2026-11-02** (`SU-01`..`SU-07`). **Única fuente de verdad** del módulo: si algo contradice a [04](04-base-de-datos.md), [06](06-api-endpoints.md) o [15](15-riesgos-y-decisiones-pendientes.md), gana este documento.
> **Reemplaza** a `BorrowerSubscription` (`D-S2-3`, `PB-019`): la tabla pasa a llamarse `Subscription`, cuelga de `User` y trae reglas de acceso. Ver [decisiones `D-SU-*`](00-contradicciones-y-decisiones.md#decisiones-2026-11-02-ronda-suscripciones).
> **Consumidor posterior**: [19. Afiliados](19-afiliados.md) (la comisión nace del primer pago de suscripción).

---

## 18.1 Reglas de negocio

1. **Solo se suscribe quien tiene `BorrowerProfile`.** Un Lender que no es Borrower no paga nada (Product Spec v2: "Lenders do not pay fees").
2. **Lender dual** (`D-P7-1`, `POST /api/lenders/me/become-borrower`): al adquirir el rol BORROWER nace su `Subscription` igual que la de cualquier Borrower, con trial. Como Lender sigue sin pagar y sus acciones de Lender nunca se bloquean.
3. **Precio único para todos los Borrowers**, fijo en `.env` (`D-SU-3`). Cambiarlo = editar la variable y redesplegar; afecta solo a los cobros futuros — cada `SubscriptionPayment` guarda el monto realmente cobrado.
4. **Trial**: `SUBSCRIPTION_TRIAL_DAYS` (7) desde que se crea la suscripción. Una sola vez por usuario (`userId` único).
5. **Acceso (`hasAccess`)** = `now < trialEndsAt` **o** (`currentPeriodEnd` existe y `now < currentPeriodEnd`). Es lo único que consulta el gate.
6. **Bloqueo suave (`D-SU-4`)**: sin `hasAccess`, el Borrower **no puede iniciar préstamos nuevos**. Nunca se bloquea pagar un préstamo existente, ni leer, ni descargar, ni mensajería/notificaciones.
7. **Estado efectivo derivado, sin cron (`D-SU-2`)**: se guarda solo lo que cambia por una acción (`TRIALING`/`ACTIVE`/`CANCELLED`); `EXPIRED` se calcula al leer cuando `hasAccess=false`. Un job de vencimiento no hace falta porque nada depende de una transición automática.
8. **Cancelar** no corta el acceso: queda `CANCELLED` y sigue valiendo hasta `currentPeriodEnd` (o `trialEndsAt`). Pagar de nuevo la reactiva (`ACTIVE`, `cancelledAt=null`).
9. **Cobro simulado** (`D-SU-5`, `BILLING_MODE=simulated`): el propio Borrower dispara `POST /api/subscription/me/pay` y se registra un pago exitoso sin pasarela. La etapa 2 reemplaza el cuerpo de ese endpoint por Stripe Checkout + webhook sin cambiar rutas ni respuestas (§18.7).
10. **Comisión de afiliado**: el primer pago con monto > 0 dispara `onFirstSubscriptionPayment` (§18.6). Los `ADMIN_GRANT` (monto 0) nunca la generan.

### Cálculo de periodos

- Pago/renovación: `base = max(now, currentPeriodEnd ?? trialEndsAt)`; `currentPeriodStart = base`; `currentPeriodEnd = base + 1 mes`. Pagar durante el trial no pierde los días de trial restantes; pagar antes de que venza el periodo no pierde los días restantes.
- Grant del Admin de `N` días: mismo `base`, `currentPeriodEnd = base + N días`.
- Cancelación inmediata del Admin (`immediate=true`): `trialEndsAt = now` y `currentPeriodEnd = now`.
- `SUBSCRIPTION_TRIAL_DAYS=0` deja la suscripción en `EXPIRED` desde el primer instante (útil para exigir pago desde el día uno).

---

## 18.2 Variables de entorno

| Variable | Default | Para qué |
|---|---|---|
| `SUBSCRIPTION_PRICE_CENTS` | `900` | Precio mensual en centavos ($9.00) |
| `SUBSCRIPTION_TRIAL_DAYS` | `7` | Días de trial al crear la suscripción |
| `SUBSCRIPTION_CURRENCY` | `usd` | Moneda guardada en cada pago |
| `BILLING_MODE` | `simulated` | `simulated` (etapa 1) o `stripe` (etapa 2). Con `stripe` el endpoint `pay` responde `409 BILLING_NOT_SIMULATED` |

Se agregan a `src/config/env.ts` (validadas con Zod como el resto) y a la tabla de [03](03-arquitectura-backend.md) y de `API_REFERENCE.md`. Las `STRIPE_*` ya existen reservadas.

---

## 18.3 Modelo de datos

**`Subscription`** — una por usuario con rol BORROWER.

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| id | Uuid (`uuidv7()`) | Sí | PK |
| userId | Uuid → User | Sí (único) | |
| status | enum `SubscriptionStatus` (`TRIALING`/`ACTIVE`/`CANCELLED`) | Sí | default `TRIALING`. `EXPIRED` **no** se persiste (§18.1 regla 7) |
| priceCents | Int | Sí | precio vigente al crearse; informativo, el cobro usa el monto de cada pago |
| trialEndsAt | DateTime | Sí | `createdAt + SUBSCRIPTION_TRIAL_DAYS` |
| currentPeriodStart | DateTime? | No | |
| currentPeriodEnd | DateTime? | No | |
| cancelledAt | DateTime? | No | |
| stripeCustomerId / stripeSubscriptionId | String? | No | reservados, vacíos en etapa 1 |
| createdAt / updatedAt | DateTime | Sí | |

**`SubscriptionPayment`** — un registro por cobro; solo inserción (como `AuditLog`).

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| id | Uuid | Sí | PK |
| subscriptionId | Uuid → Subscription | Sí | índice |
| amountCents | Int | Sí | `0` para `ADMIN_GRANT` |
| currency | String | Sí | |
| status | enum `SubscriptionPaymentStatus` (`SUCCEEDED`/`FAILED`/`REFUNDED`) | Sí | etapa 1 solo escribe `SUCCEEDED` |
| source | enum `SubscriptionPaymentSource` (`SIMULATED`/`ADMIN_GRANT`/`STRIPE`) | Sí | |
| isFirstPayment | Boolean | Sí | `true` solo en el primer `SUCCEEDED` con `amountCents > 0` de esa suscripción |
| periodStart / periodEnd | DateTime | Sí | el periodo que cubrió |
| grantedById | Uuid? → User | No | Admin, solo `ADMIN_GRANT` |
| reason | String? | No | obligatorio en `ADMIN_GRANT` |
| stripeInvoiceId | String? | No | reservado |
| paidAt / createdAt | DateTime | Sí | |

**Auditoría** (`AuditLog.action`, es `String` — no requiere migración de enum): `SUBSCRIPTION_STARTED`, `SUBSCRIPTION_PAID`, `SUBSCRIPTION_CANCELLED`, `SUBSCRIPTION_GRANTED`.

### Migración

1. Tablas y enums nuevos.
2. **Backfill**: una `Subscription` `TRIALING` con `trialEndsAt = now() + 7 días` por cada `User` activo con `BorrowerProfile` (`D-SU-7`). Los Borrower existentes no quedan bloqueados de golpe.
3. `BorrowerSubscription` nunca se llegó a crear en `schema.prisma`, no hay nada que migrar ni borrar.

---

## 18.4 Cuándo se crea la suscripción

`ensureSubscription(userId)` — idempotente (`upsert` por `userId`), nunca crea una segunda.

| Punto de llamada | Por qué |
|---|---|
| `activateUserAccount` (`userActivation.service.ts`), si el usuario tiene `BorrowerProfile` | El trial arranca al activar la cuenta, no al registrarse (`D-S2-3` se conserva en esto) |
| `POST /api/lenders/me/become-borrower` | Lender dual (regla 2) |
| `requireActiveSubscription` y `GET /api/subscription/me` | Red de seguridad: un Borrower sin fila (p. ej. creado por una ruta futura) se repara solo |

---

## 18.5 Gate de acceso

`requireActiveSubscription(session)` — `src/middlewares/requireActiveSubscription.ts`, mismo estilo que `requireContractAccess`.

- Llama a `ensureSubscription` y evalúa `hasAccess`. Si es `false` → `403 SUBSCRIPTION_REQUIRED` (el front consulta `GET /api/subscription/me` para mostrar la pantalla de pago; `AppError` no lleva datos extra).
- Se aplica **solo** a las acciones que inician un préstamo nuevo del Borrower (la lista exacta se confirma contra las rutas en SU-05):
  - crear/publicar un `LoanRequest` (`/api/borrowers/me/loan-requests`),
  - seleccionar una cotización (`.../quotes/:quoteId/select`),
  - aceptar los términos de un contrato nuevo: `POST /api/contracts/:id/terms/:termsId/accept` solo cuando el contrato está en `PENDING_ACCEPTANCE`; las enmiendas de un préstamo ya `ACTIVE`/`DELINQUENT` no se bloquean.
  - publicar (`publish`) el `LoanRequest`, además de crearlo.
- **Nunca** se aplica a: pagos y payoff (`/api/contracts/:id/payments/*`, `/api/transactions/*`), lecturas, documentos, mensajería, notificaciones, reseñas, perfil, `/api/subscription/*`.
- Un usuario dual solo se evalúa cuando actúa como Borrower; sus rutas de Lender no llaman al gate.

---

## 18.6 Enganche con afiliados

Tras confirmar un pago (`SUBSCRIPTION_PAID`) con `isFirstPayment=true`, el servicio llama **fuera de la transacción** a `onFirstSubscriptionPayment({ userId, subscriptionId, subscriptionPaymentId, amountCents })`. `subscription.service.ts` la exporta y delega en `accrueCommissionForSubscription` del módulo [19](19-afiliados.md). Un fallo de la comisión nunca revierte el pago (mismo criterio que `notify()`).

---

## 18.7 API

Formato de respuesta y errores: igual que el resto (`{ success, data }` / `{ success:false, error:{ code, message } }`). Los endpoints de Admin siguen `D-P3-1` (2FA obligatorio).

### Borrower (cualquier usuario con `BorrowerProfile`; sin gate)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/subscription/me` | `{ status (efectivo), hasAccess, daysLeftInTrial, trialEndsAt, currentPeriodEnd, cancelledAt, priceCents, currency, billingMode }`. Llama a `ensureSubscription` |
| POST | `/api/subscription/me/pay` | Cobro simulado: crea `SubscriptionPayment` (`SIMULATED`, `SUCCEEDED`, monto = `SUBSCRIPTION_PRICE_CENTS`), recalcula el periodo (§18.1) y deja `ACTIVE`. `201` con la suscripción y el pago. `409 BILLING_NOT_SIMULATED` si `BILLING_MODE≠simulated` |
| POST | `/api/subscription/me/cancel` | Marca `CANCELLED`; el acceso sigue hasta el fin del periodo. `409 SUBSCRIPTION_ALREADY_CANCELLED` |
| GET | `/api/subscription/me/payments` | Historial paginado (`page`/`pageSize`), más reciente primero |

### Admin (`withRole ADMIN`)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/admin/subscriptions` | Paginado. Filtros: `status` (efectivo: `TRIALING`/`ACTIVE`/`CANCELLED`/`EXPIRED`), `search` (nombre/correo). Ítem: `{ id, user:{id,name,email}, status, hasAccess, trialEndsAt, currentPeriodEnd, lastPaymentAt, priceCents }` |
| GET | `/api/admin/subscriptions/:id` | Detalle + pagos |
| POST | `/api/admin/subscriptions/:id/grant` | Body `{ days (1–365), reason }`. Extiende acceso, inserta pago `ADMIN_GRANT` de monto 0 |
| POST | `/api/admin/subscriptions/:id/cancel` | Body `{ immediate?: boolean }` (default `false`, §18.1) |

Estado efectivo (también el filtro `status`): si `hasAccess=false` → `EXPIRED`, sea cual sea el `status` guardado; si `hasAccess=true` → el `status` guardado. Por eso `CANCELLED` en las respuestas significa "cancelada pero aún con acceso".

### Errores nuevos

| Código | HTTP | Cuándo |
|---|---|---|
| `SUBSCRIPTION_REQUIRED` | 403 | El gate (§18.5) |
| `SUBSCRIPTION_NOT_FOUND` | 404 | Admin con id inexistente; usuario sin `BorrowerProfile` en `/api/subscription/me/*` |
| `SUBSCRIPTION_ALREADY_CANCELLED` | 409 | Cancelar una ya cancelada |
| `BILLING_NOT_SIMULATED` | 409 | `pay` con `BILLING_MODE=stripe` |

### Etapa 2 — Stripe (fuera de esta entrega)

- `POST /api/subscription/me/pay` pasa a devolver la URL de Stripe Checkout; se agrega `POST /api/webhooks/stripe` reutilizando `WebhookEvent` (idempotencia) para `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted`.
- Se agrega el estado `PAST_DUE` y reintentos de cobro; se llenan `stripeCustomerId`/`stripeSubscriptionId`/`stripeInvoiceId`.
- Las rutas, los nombres de campo y el gate no cambian. Ver riesgo #3 en [15](15-riesgos-y-decisiones-pendientes.md).

---

## 18.8 Tickets

| ID | Qué | Notas |
|---|---|---|
| **SU-01** | Variables de entorno en `env.ts` + schema + migración (con backfill) | `SubscriptionStatus`, `SubscriptionPaymentStatus`, `SubscriptionPaymentSource`, 2 tablas |
| **SU-02** | `subscription.service.ts`: `ensureSubscription`, `getEffective`, `pay`, `cancel`, `grant`, `onFirstSubscriptionPayment` (vacío) | Toda la aritmética de §18.1 vive acá; test unitario de periodos |
| **SU-03** | Crear la suscripción en `activateUserAccount` y `become-borrower` | §18.4 |
| **SU-04** | Endpoints de Borrower (§18.7) + validaciones + controller + rutas | |
| **SU-05** | `requireActiveSubscription` + aplicarlo a las rutas de préstamo nuevo | Confirmar la lista exacta contra `src/app/api/borrowers/me/loan-requests/**` y `contracts` |
| **SU-06** | Endpoints de Admin (§18.7) | Filtro `status` efectivo |
| **SU-07** | Tests de integración, colección de Bruno, `API_REFERENCE.md`, `IMPLEMENTATION_PROGRESS.md` | Casos: trial→gate abierto; vencido→`403`; vencido pero pagando un préstamo→OK; Lender puro→`404`; Lender dual conserva sus rutas de Lender; pagar durante el trial no pierde días; grant no dispara comisión |

---

## 18.9 Fuera de alcance / decisiones abiertas

- Stripe real (etapa 2) y `PAST_DUE`.
- Cambiar el precio sin redesplegar (un `Plan` editable por el Admin): no hasta que exista más de un plan.
- Recordatorios de vencimiento por correo/notificación (requerirían un job): no en v1.
- Impacto del bloqueo en los ratings, la mensajería y el marketplace del lado Lender: ninguno por diseño.
- Si el `BILLING_MODE=simulated` puede quedar activo en producción: hoy sí (el Admin decide); es un riesgo de configuración que se cierra al activar la etapa 2.

---

[← Índice del plan](README.md)  ·  [Anterior: 17. Fase 2 — plan actualizado](17-fase-2-actualizada.md)  ·  [Siguiente: 19. Afiliados](19-afiliados.md)
