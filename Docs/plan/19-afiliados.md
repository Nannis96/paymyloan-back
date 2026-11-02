# 19. Afiliados (Fase 21)

> **Estado**: diseño aprobado e **implementado 2026-11-02** (`AFF-01`..`AFF-08`). **Única fuente de verdad** del módulo: si algo contradice a [04](04-base-de-datos.md), [06](06-api-endpoints.md) o [15](15-riesgos-y-decisiones-pendientes.md), gana este documento.
> **Depende de**: [18. Suscripciones](18-suscripciones.md) — la comisión nace del primer pago de suscripción (`onFirstSubscriptionPayment`, §18.6), ya implementado como función vacía.
> **Reemplaza** a `AB-06` de [TAREAS_ADMIN_BACK.md](../TAREAS_ADMIN_BACK.md) y a `AD-007` de [fase-16](fases/fase-16-admin-overview.md). Decisiones: [`D-AF-*`](00-contradicciones-y-decisiones.md#decisiones-2026-11-02-ronda-afiliados).

---

## 19.1 Reglas de negocio

1. **Afiliado no es un rol** (`D-AF-1`). Cualquier usuario autenticado, sea cual sea su `UserRole` o roles duales, puede serlo. No toca `UserRole` ni el JWT.
2. **Todos nacen no afiliados.** No existe `AffiliateProfile` hasta que el usuario lo pide (`apply`).
3. **`isAffiliate` es un booleano calculado**: `true` solo si existe `AffiliateProfile` con `status = APPROVED` (`D-AF-2`). No se guarda duplicado en `User`; así no puede desincronizarse del estado.
4. **Quién autoriza queda abierto** con `AFFILIATE_APPROVAL_MODE` (`D-AF-3`):
   - `admin` (default): `apply` deja `PENDING`; el Admin aprueba o rechaza.
   - `self`: `apply` aprueba al instante; el usuario se apaga con `DELETE /api/affiliates/me`. El Admin puede suspender en cualquiera de los dos modos.
5. **Estados** (`AffiliateStatus`): `PENDING` · `APPROVED` · `REJECTED` · `SUSPENDED` (lo decide el Admin) · `INACTIVE` (lo apagó el propio usuario).

| Desde | Acción | Hasta |
|---|---|---|
| — | `apply` modo `admin` | `PENDING` |
| — | `apply` modo `self` | `APPROVED` |
| `PENDING` / `SUSPENDED` / `REJECTED` | Admin `approve` | `APPROVED` |
| `PENDING` | Admin `reject` (con `reason`) | `REJECTED` |
| `APPROVED` | Admin `suspend` (con `reason`) | `SUSPENDED` |
| `APPROVED` | usuario `DELETE /me` | `INACTIVE` |
| `INACTIVE` | usuario `apply` | `APPROVED` (ya fue aprobado antes: no vuelve a pedir permiso) |
| `REJECTED` | usuario `apply` | `PENDING` (o `APPROVED` en modo `self`) |
| `SUSPENDED` | usuario `apply` | `409 AFFILIATE_SUSPENDED` — solo el Admin lo reabre |

6. **Código y link** (`D-AF-4`): al aprobarse por primera vez se genera `code` (8 caracteres A–Z/2–9 sin ambiguos, único, aleatorio) y no cambia nunca, ni al suspender ni al reactivar. El link es `{CORS_ORIGIN}/register?ref={code}` (mismo origen del front que ya usa el link de reset).
7. **Referido**: `POST /api/auth/register` acepta `referralCode` opcional. Si corresponde a un afiliado `APPROVED` se guarda `User.referredByAffiliateId`. Un código inexistente o de un afiliado no aprobado **se ignora en silencio** (no bloquea el registro ni revela qué códigos existen). El vínculo es inmutable.
8. **Comisión** (`D-AF-5`): se genera **una sola vez por referido**, en su **primer pago de suscripción con monto > 0** (§18.6). Como solo los Borrowers tienen suscripción, un afiliado Lender o Borrower cobra únicamente cuando la persona referida se suscribe como Borrower. Los `ADMIN_GRANT` (monto 0) nunca generan comisión.
   - Debe cumplirse al momento del pago: el referente sigue `APPROVED` (un suspendido o inactivo no devenga comisiones nuevas) y la comisión calculada es > 0.
   - Monto: `PERCENT` → `round(amountCents × commissionValue / 100)`; `FIXED` → `round(commissionValue × 100)` centavos. Se guarda la comisión ya calculada y una copia de la tarifa usada, así cambiar la tarifa después no altera el historial.
9. **Tarifa por afiliado** (`D-AF-6`): el Admin define `commissionType` + `commissionValue` + `payoutDelayDays?` de cada afiliado. Si no se define, rigen los defaults de `.env` (hasta que el negocio fije números, `AFFILIATE_DEFAULT_COMMISSION_VALUE=0` ⇒ no se genera comisión; no se inventa un porcentaje).
10. **Cuándo se paga** (`D-AF-7`): cada comisión nace con `payableAt`: `now` si el afiliado no tiene `payoutDelayDays`, o `now + N días` si lo tiene. El Admin puede fijarle otra fecha a una comisión puntual. **El pago siempre lo ejecuta el Admin**: ninguna comisión se paga sola al llegar su fecha.
    - `mark-paid` responde `409 AFFILIATE_COMMISSION_NOT_PAYABLE_YET` si `payableAt` está en el futuro, salvo que el Admin envíe `force: true`.
    - En la etapa 1 `mark-paid` solo registra el pago hecho por fuera; con Stripe (etapa 2) pasará a ejecutar la transferencia sin cambiar la API.
11. **Anti-abuso**: no hay auto-referencia posible (el vínculo se fija al crear el usuario nuevo). `subscriptionPaymentId` único en la comisión ⇒ el mismo pago nunca genera dos comisiones (idempotente ante reintentos).

---

## 19.2 Variables de entorno

| Variable | Default | Para qué |
|---|---|---|
| `AFFILIATE_APPROVAL_MODE` | `admin` | `admin` o `self` (regla 4) |
| `AFFILIATE_DEFAULT_COMMISSION_TYPE` | `PERCENT` | Tipo para afiliados sin tarifa propia |
| `AFFILIATE_DEFAULT_COMMISSION_VALUE` | `0` | Valor por defecto; `0` = sin comisión hasta que el Admin la defina |
| `AFFILIATE_DEFAULT_PAYOUT_DELAY_DAYS` | *(vacío)* | Retraso por defecto; vacío = pagable de inmediato |

---

## 19.3 Modelo de datos

**`AffiliateProfile`** — una por usuario que alguna vez pidió ser afiliado.

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| id | Uuid (`uuidv7()`) | Sí | PK |
| userId | Uuid → User | Sí (único) | |
| status | enum `AffiliateStatus` | Sí | default `PENDING` |
| code | String | No (único) | se genera en la primera aprobación (regla 6) |
| commissionType | enum `AffiliateCommissionType` (`PERCENT`/`FIXED`) | No | nulo ⇒ default de `.env` |
| commissionValue | Decimal(10,2) | No | `PERCENT` 0–100; `FIXED` en dólares |
| payoutDelayDays | Int | No | nulo ⇒ default de `.env`; `0` = inmediato |
| statusReason | String | No | motivo de `reject` / `suspend` |
| approvedById | Uuid → User | No | Admin, o el propio usuario en modo `self` |
| approvedAt | DateTime | No | primera aprobación |
| createdAt / updatedAt | DateTime | Sí | |

**`User.referredByAffiliateId`** — Uuid? → `AffiliateProfile` (`onDelete: SetNull`), índice. Inmutable tras el registro.

**`AffiliateCommission`** — un registro por comisión; los montos nunca se recalculan.

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| id | Uuid | Sí | PK |
| affiliateId | Uuid → AffiliateProfile | Sí | índice `(affiliateId, status)` |
| referredUserId | Uuid → User | No | nulo solo en ajustes manuales |
| subscriptionPaymentId | Uuid → SubscriptionPayment | No (único) | idempotencia (regla 11) |
| source | enum `AffiliateCommissionSource` (`SUBSCRIPTION`/`MANUAL`) | Sí | |
| baseAmountCents | Int | No | monto del pago que la originó |
| commissionType / commissionValue | enum / Decimal | No | copia de la tarifa usada |
| amountCents | Int | Sí | comisión final |
| currency | String | Sí | |
| status | enum `AffiliateCommissionStatus` (`PENDING`/`PAID`/`VOID`) | Sí | default `PENDING` |
| payableAt | DateTime | Sí | regla 10; índice `(status, payableAt)` |
| paidAt / paidById / paymentReference | DateTime? / Uuid? / String? | No | |
| voidedAt / voidedById / note | DateTime? / Uuid? / String? | No | |
| createdAt | DateTime | Sí | |

**Auditoría** (`AuditLog.action` es `String`): `AFFILIATE_REQUESTED`, `AFFILIATE_APPROVED`, `AFFILIATE_REJECTED`, `AFFILIATE_SUSPENDED`, `AFFILIATE_DEACTIVATED`, `AFFILIATE_TERMS_UPDATED`, `AFFILIATE_COMMISSION_EARNED`, `AFFILIATE_COMMISSION_PAID`, `AFFILIATE_COMMISSION_VOIDED`.

**Notificaciones** (`notify()`, al afiliado): `AFFILIATE_APPROVED`, `AFFILIATE_REJECTED`, `AFFILIATE_SUSPENDED`, `AFFILIATE_COMMISSION_EARNED`, `AFFILIATE_COMMISSION_PAID`. Al Admin no se le notifica (mismo criterio que `AB-15`): ve las solicitudes con `GET /api/admin/affiliates?status=PENDING`.

---

## 19.4 Enganche con suscripciones

`onFirstSubscriptionPayment(event)` (en `subscription.service.ts`, hoy vacía) pasa a llamar a `affiliates.service#accrueCommissionForSubscription(event)`:

1. Busca `User.referredByAffiliateId`; si es nulo, termina.
2. Carga el `AffiliateProfile`; si no está `APPROVED`, termina.
3. Resuelve la tarifa (propia o default de `.env`) y calcula el monto (regla 8); si es ≤ 0, termina.
4. Inserta `AffiliateCommission` (`SUBSCRIPTION`, `PENDING`, `payableAt` según regla 10). Un `P2002` sobre `subscriptionPaymentId` se trata como "ya generada".
5. Audita y notifica `AFFILIATE_COMMISSION_EARNED`.

Corre **después** de confirmar el pago y **nunca lanza**: un fallo se registra en el log y no revierte la suscripción (mismo criterio que `notify()`).

---

## 19.5 API

Formato de respuesta y errores: el del resto de la API. Endpoints de Admin con 2FA obligatorio (`D-P3-1`); los de usuario solo exigen sesión (no son escrituras de negocio de ADMIN/LENDER sobre terceros).

### Público (sin sesión)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/affiliates/validate?code=` | `{ valid: boolean }`: `true` solo si el código es de un afiliado `APPROVED`. No devuelve datos del afiliado; un código mal formado da `valid:false`. Límite por IP: 30 consultas / 15 min → `429 RATE_LIMITED`. Es solo comodidad para el front; `register` no la necesita (`D-AF-8`) |

### Usuario (cualquier sesión autenticada)

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/affiliates/me/apply` | Pide ser afiliado (reglas 4–5). `201` con el perfil. `409 AFFILIATE_ALREADY_ACTIVE` si ya está `APPROVED` o `PENDING`; `409 AFFILIATE_SUSPENDED` |
| DELETE | `/api/affiliates/me` | Se apaga (`APPROVED → INACTIVE`). `409 AFFILIATE_NOT_ACTIVE` si no estaba aprobado |
| GET | `/api/affiliates/me` | `{ isAffiliate, status, code, link, commissionType, commissionValue, payoutDelayDays, referralsCount, subscribedCount, pendingCents, paidCents }`; sin perfil: `{ isAffiliate:false, status:null }` |
| GET | `/api/affiliates/me/referrals` | Paginado: `{ name, joinedAt, subscribed }` (sin correo ni teléfono) |
| GET | `/api/affiliates/me/commissions` | Paginado, filtro `status`: sus comisiones |

### Admin (`withRole ADMIN`)

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/api/admin/affiliates` | Paginado. Filtros `status`, `search` (nombre/correo/código). Ítem: `{ id, user:{id,name,email}, status, code, commissionType, commissionValue, payoutDelayDays, referralsCount, pendingCents, paidCents, createdAt }` |
| GET | `/api/admin/affiliates/:id` | Detalle + referidos + últimas comisiones |
| POST | `/api/admin/affiliates/:id/approve` | Body opcional `{ commissionType, commissionValue, payoutDelayDays }` (si se envían, `commissionType` y `commissionValue` van juntos). Genera `code` si no tiene. Válido desde `PENDING`/`REJECTED`/`SUSPENDED` |
| POST | `/api/admin/affiliates/:id/reject` | Body `{ reason }`; solo desde `PENDING` |
| POST | `/api/admin/affiliates/:id/suspend` | Body `{ reason }`; solo desde `APPROVED` |
| PATCH | `/api/admin/affiliates/:id/commission` | Body `{ commissionType, commissionValue, payoutDelayDays }` (`payoutDelayDays: null` = inmediato). Solo afecta comisiones futuras |
| POST | `/api/admin/affiliates/:id/commissions` | Comisión manual `{ amountCents (>0), referredUserId?, note, payableAt? }` (`MANUAL`) |
| GET | `/api/admin/affiliates/commissions` | Paginado. Filtros `status`, `affiliateId`, `payable=true` (`PENDING` con `payableAt ≤ ahora`) |
| PATCH | `/api/admin/affiliates/commissions/:id` | Body `{ payableAt }`; solo `PENDING` |
| POST | `/api/admin/affiliates/commissions/:id/mark-paid` | Body `{ paymentReference?, force? }`; solo `PENDING` |
| POST | `/api/admin/affiliates/commissions/:id/void` | Body `{ note }`; solo `PENDING` |

### Cambios en endpoints existentes

- `POST /api/auth/register`: `referralCode` opcional (string, 4–16 caracteres, se normaliza a mayúsculas).
- `GET /api/auth/me`: agrega `isAffiliate` y `affiliateStatus` (`null` si nunca pidió serlo).

### Errores nuevos

| Código | HTTP | Cuándo |
|---|---|---|
| `AFFILIATE_NOT_FOUND` | 404 | id de afiliado o comisión inexistente |
| `AFFILIATE_ALREADY_ACTIVE` | 409 | `apply` estando `APPROVED` o `PENDING` |
| `AFFILIATE_SUSPENDED` | 409 | `apply` estando `SUSPENDED` |
| `AFFILIATE_NOT_ACTIVE` | 409 | `DELETE /me` sin estar `APPROVED` |
| `AFFILIATE_INVALID_STATE` | 409 | transición no permitida (p. ej. `reject` fuera de `PENDING`); comisión manual a un afiliado que nunca fue aprobado (sin `code`) |
| `AFFILIATE_COMMISSION_NOT_PENDING` | 409 | `mark-paid` / `void` / `PATCH` sobre una comisión ya `PAID` o `VOID` |
| `AFFILIATE_COMMISSION_NOT_PAYABLE_YET` | 409 | `mark-paid` con `payableAt` futuro y sin `force` |

---

## 19.6 Tickets

| ID | Qué | Notas |
|---|---|---|
| **AFF-01** | Variables de entorno + schema + migración | 3 enums + 2 modelos + `User.referredByAffiliateId`; sin backfill |
| **AFF-02** | `affiliates.service.ts`: apply, deactivate, approve/reject/suspend, tarifa, generación de `code` | Máquina de estados de §19.1; test unitario del cálculo de comisión |
| **AFF-03** | Endpoints de usuario (§19.5) | `GET /me` con totales |
| **AFF-04** | Endpoints de Admin sobre afiliados | lista, detalle, approve/reject/suspend, tarifa |
| **AFF-05** | `referralCode` en `register` + `isAffiliate`/`affiliateStatus` en `auth/me` | Código inválido se ignora |
| **AFF-06** | `accrueCommissionForSubscription` y conexión con `onFirstSubscriptionPayment` | Idempotente, nunca lanza |
| **AFF-07** | Endpoints de comisiones del Admin (listar, `payableAt`, `mark-paid`, `void`, manual) | `force` y `payable=true` |
| **AFF-08** | Tests de integración, Bruno, `API_REFERENCE.md`, `IMPLEMENTATION_PROGRESS.md` | Casos: modo `admin` vs `self`; suspendido no devenga; comisión una sola vez; `ADMIN_GRANT` no comisiona; tarifa cambiada no altera comisiones previas; `mark-paid` antes de fecha → `409`, con `force` OK; referido por código inválido se registra igual |

---

## 19.7 Fuera de alcance / abierto

- **Comisión recurrente** (cada mensualidad): no; hoy es solo el primer pago. Si el negocio la pide, `AffiliateCommission` no cambia: se llamaría la acumulación en cada pago, con un tope de meses.
- **Reembolsos** (`SubscriptionPayment.REFUNDED`): no anulan comisiones solas; el Admin usa `void` si aún está `PENDING`. Recuperar una comisión ya `PAID` queda fuera.
- **Pago real vía Stripe** y datos fiscales/bancarios del afiliado (W-9, cuenta): etapa 2; hoy el Admin paga por fuera y registra `paymentReference`.
- **Valor real de la comisión por defecto**: pendiente de negocio (`AFFILIATE_DEFAULT_COMMISSION_VALUE=0` mientras tanto).
- **Dashboard de ingresos** (`AB-05` / `AD-006`): la línea "Affiliate payouts" se alimenta de `AffiliateCommission` con `status=PAID`.
- Notificar al Admin de solicitudes pendientes: no en v1.

---

[← Índice del plan](README.md)  ·  [Anterior: 18. Suscripciones](18-suscripciones.md)
