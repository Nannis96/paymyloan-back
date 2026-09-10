[← Índice del plan](README.md)  ·  [Anterior: 5. Qué NO debemos copiar de Owner](05-que-no-copiar-de-owner.md)  ·  [Siguiente: 7. Autenticación y autorización](07-autenticacion-y-autorizacion.md)

---

# 6. API — Endpoints por módulo

Convención: toda ruta requiere `Authorization: Bearer <access_token>` salvo que se indique "Público". "Rol" indica el/los roles permitidos; "Tenant" indica cómo se resuelve el aislamiento. Los detalles de request/response/validaciones/errores de cada endpoint viven en el ítem de backlog correspondiente (sección [13](13-backlog.md)) para no duplicar contenido — aquí se listan todos para tener el mapa completo del módulo.

## 6.1 Auth

| Método | Ruta | Rol | Notas |
|---|---|---|---|
| POST | `/api/auth/register` | Público | `D-P2-1`, nuevo — auto-registro de LENDER/BORROWER (`D-P1-10`), sin contraseña; siempre 202 con el mismo mensaje, ver [§7.7](07-autenticacion-y-autorizacion.md#77-auto-registro-y-activación-d-p2-1-nuevo-2026-09-06) |
| POST | `/api/auth/login` | Público | paso 1: credenciales; si `isTwoFactorEnabled`, responde `2FA_REQUIRED` sin emitir tokens |
| POST | `/api/auth/login/2fa` | Público (con token temporal de paso 1) | paso 2: código TOTP |
| POST | `/api/auth/refresh` | Público (con refresh token) | rota el refresh token |
| POST | `/api/auth/logout` | Autenticado | revoca el refresh token actual |
| POST | `/api/auth/logout-all` | Autenticado | revoca todos los refresh tokens del usuario |
| GET | `/api/auth/me` | Autenticado | perfil propio + perfil de rol (`LenderProfile`/`BorrowerProfile`) |
| PATCH | `/api/auth/me` | Autenticado | `BE-099`, nuevo (`D-P2-4`) — autoservicio, solo `name`/`phone` |
| POST | `/api/auth/password/forgot` | Público | siempre responde 200 (no filtra si el email existe) |
| POST | `/api/auth/password/reset` | Público (con token) | |
| POST | `/api/auth/2fa/setup` | ADMIN, LENDER | genera secreto + QR, no activa todavía |
| POST | `/api/auth/2fa/verify` | ADMIN, LENDER | activa 2FA, genera recovery codes |
| POST | `/api/auth/2fa/disable` | ADMIN, LENDER | requiere contraseña + código vigente |
| POST | `/api/auth/2fa/recovery-codes` | ADMIN, LENDER | regenera el set de códigos |

## 6.2 Admin / Lenders

> **Rescopeado 2026-09-08 (`D-P4-5`)**: `POST /api/admin/lenders` (creaba `User`+`LenderProfile`+`LenderCompany` de una) se elimina — la persona ya nace por auto-registro (`POST /api/auth/register`, `D-P2-1`); asociarle una empresa es ahora `POST .../:id/companies`, abajo. Ver `D-P4-5` en [00](00-contradicciones-y-decisiones.md#decisión-2026-09-08-rescopeo-post-fase-4-d-p4-5).
>
> **`:id` acepta `LenderProfile.id` o `User.id` (`D-P4-7`)**: `GET /api/users` — el único lugar donde un Admin ve el id de un Lender sin pasar por `GET /api/admin/lenders` — solo expone `User.id`; exigir `LenderProfile.id` ahí lo hacía inutilizable para las rutas de abajo con `:id`. Ver `D-P4-7` en [00](00-contradicciones-y-decisiones.md#decisión-2026-09-08-id-de-apiadminlenders-acepta-también-userid-d-p4-7).
>
> **Sin `PATCH /api/admin/lenders/:id` (`D-P4-8`)**: `LenderProfile.contactPhone` — su único campo propio editable — se eliminó por redundante con `User.phone` (`D-P2-4`). Editar los datos de una empresa puntual es ahora `PATCH .../:id/companies/:companyId`, abajo. Ver `D-P4-8` en [00](00-contradicciones-y-decisiones.md#decisión-2026-09-08-lenderprofilecontactphone-eliminado--patchdelete-de-lendercompany-puntual-d-p4-8).

| Método | Ruta | Rol | Tenant |
|---|---|---|---|
| GET | `/api/admin/lenders` | ADMIN | N/A (ve todos) |
| GET | `/api/admin/lenders/:id` | ADMIN | N/A |
| POST | `/api/admin/lenders/:id/companies` | ADMIN | `D-P4-5`, nuevo — asocia una `LenderCompany` nueva a un Lender que ya existe (`:id`=`LenderProfile.id` o `User.id`, `D-P4-7`); solo campos de empresa, sin `name`/`email` |
| PATCH | `/api/admin/lenders/:id/companies/:companyId` | ADMIN | `D-P4-8`, nuevo — edita cualquier campo de una empresa puntual (incluido `status`/`isOpenToDeals`); `:companyId` validado contra `:id` |
| DELETE | `/api/admin/lenders/:id/companies/:companyId` | ADMIN | `D-P4-8`, nuevo — soft-delete de una sola empresa, bloqueado con contratos `ACTIVE`/`DELINQUENT` |
| DELETE | `/api/admin/lenders/:id` | ADMIN | N/A — soft delete de `User`+`LenderProfile`+todas sus `LenderCompany`, bloqueado si alguna tiene contratos `ACTIVE`/`DELINQUENT` |
| POST | `/api/admin/users/:id/activate` | ADMIN | `BE-097`, nuevo (`D-P2-1`) — primera activación genera y envía contraseña temporal; reactivación solo reabre acceso |
| POST | `/api/admin/users/:id/deactivate` | ADMIN | `BE-097`, nuevo — además revoca los refresh tokens vigentes del usuario |

## 6.3 Lenders (perfil propio y borrowers)

> **Corregido 2026-09-08 (`D-P4-1`)**: escrito antes de `D-P1-3`/`D-P1-4` — hablaba de `BorrowerProfile.lenderId` y "el tenant" como si fuera uno solo. Hoy el tenant es `LenderCompany` (N por `LenderProfile`) y el vínculo es `LenderBorrower` (N:M). La columna "Tenant" de abajo ya refleja cómo se resuelve de verdad — ver `D-P4-1` en [00](00-contradicciones-y-decisiones.md#decisiones-2026-09-08-ronda-fase-45) para el razonamiento completo.

| Método | Ruta | Rol | Tenant |
|---|---|---|---|
| GET | `/api/lenders/me` | LENDER | `BE-100`, nuevo — propio `LenderProfile` + todas sus `LenderCompany`. Sin `PATCH` (`D-P4-8`) — `LenderProfile` no tiene campo propio editable; `name`/`phone` de `User` van por `PATCH /api/auth/me`, `BE-099` |
| POST | `/api/lenders/me/companies` | LENDER | `BE-101`, nuevo (`D-P4-5`) — el propio Lender se crea una empresa, mismo shape que `POST /api/admin/lenders/:id/companies`; cierra el hueco de un Lender auto-registrado sin ninguna `LenderCompany` |
| POST | `/api/lenders/me/borrowers` | LENDER | crea `User(role=BORROWER)` + `BorrowerProfile` (sin `lenderId`) + `LenderBorrower(lenderCompanyId, ...)` — una sola empresa se resuelve sola, más de una exige `lenderCompanyId` en el body, validado contra las propias |
| GET | `/api/lenders/me/borrowers` | LENDER | across **todas** las `LenderCompany` del Lender |
| GET | `/api/lenders/me/borrowers/:id` | LENDER | `EXISTS(LenderBorrower WHERE borrowerProfileId=:id AND lenderCompanyId IN (mis empresas) AND status=ACTIVE)` |
| PATCH | `/api/lenders/me/borrowers/:id` | LENDER | idem |
| DELETE | `/api/lenders/me/borrowers/:id` | LENDER | **desvincula** (`LenderBorrower.removedAt`, `M-3`) — nunca borra el `BorrowerProfile`, el deudor puede tener otros lenders; bloqueado si tiene contratos `ACTIVE`/`DELINQUENT` con esa empresa |

## 6.4 Borrowers (autoservicio)

| Método | Ruta | Rol | Tenant |
|---|---|---|---|
| GET | `/api/borrowers/me` | BORROWER | propio |
| PATCH | `/api/borrowers/me` | BORROWER | campos de contacto propios, nunca `lenderId`. Bloqueado (`403 PASSWORD_CHANGE_REQUIRED`) mientras `mustChangePassword=true` (`D-P4-2`) |
| POST | `/api/borrowers/me/password` | BORROWER | `BE-050` — cambia la contraseña temporal del primer login; exige `currentPassword`, revoca todos los refresh tokens, apaga `mustChangePassword` |
| POST | `/api/borrowers/me/password` | BORROWER | cambia la contraseña temporal en primer login |

## 6.5 Contracts

| Método | Ruta | Rol | Tenant |
|---|---|---|---|
| POST | `/api/contracts` | LENDER | crea `Contract(DRAFT)` + `ContractTerms(v1, DRAFT)` |
| GET | `/api/contracts` | LENDER (propios), BORROWER (donde es `ContractBorrower`) | filtrado por sesión |
| GET | `/api/contracts/:id` | LENDER (propio), BORROWER (asociado) | verificado |
| PATCH | `/api/contracts/:id` | LENDER | solo dirección/metadatos mientras `ContractTerms` vigente está `DRAFT` |
| DELETE | `/api/contracts/:id` | LENDER | solo si `status ∈ {DRAFT}` sin actividad — ver [8.1](08-contratos.md#81-ciclo-de-vida-y-estados) |
| POST | `/api/contracts/:id/cancel` | LENDER | cancela `ACTIVE`/`PENDING_ACCEPTANCE`, regla de negocio ver [8.1](08-contratos.md#81-ciclo-de-vida-y-estados) |
| POST | `/api/contracts/:id/borrowers` | LENDER | asocia un `BorrowerProfile` propio |
| DELETE | `/api/contracts/:id/borrowers/:borrowerId` | LENDER | retira (soft) |
| GET | `/api/contracts/:id/terms` | LENDER, BORROWER asociado | historial de versiones |
| POST | `/api/contracts/:id/terms` | LENDER | propone nueva versión (solo si la vigente no está `DRAFT`) |
| POST | `/api/contracts/:id/terms` (submit) → `/api/contracts/:id/terms/:termsId/submit` | LENDER | `DRAFT → PENDING_ACCEPTANCE`, notifica a deudores |
| POST | `/api/contracts/:id/terms/:termsId/accept` | BORROWER asociado | registra `ContractTermsAcceptance`, dispara activación si completa quórum |
| POST | `/api/contracts/:id/terms/:termsId/reject` | BORROWER asociado | idem, con `comment` |
| GET | `/api/contracts/:id/schedule` | LENDER, BORROWER asociado | `ScheduledPayment[]` |
| GET | `/api/contracts/:id/balance` | LENDER, BORROWER asociado | saldo vivo + interés devengado no facturado |

## 6.6 Payments

| Método | Ruta | Rol | Tenant |
|---|---|---|---|
| POST | `/api/payment-methods` | BORROWER | adjunta método vía `SetupIntent` |
| GET | `/api/payment-methods` | BORROWER | propios |
| DELETE | `/api/payment-methods/:id` | BORROWER | propio |
| POST | `/api/contracts/:id/payments` | BORROWER asociado | crea `Transaction` (ACH puntual) |
| POST | `/api/contracts/:id/payments/manual` | LENDER | registro administrativo (wire/cheque) |
| GET | `/api/contracts/:id/transactions` | LENDER, BORROWER asociado | historial |
| GET | `/api/transactions/:id` | LENDER, BORROWER del contrato asociado | detalle + allocations |
| POST | `/api/transactions/:id/reverse` | ADMIN | ACH return manual/soporte |
| POST | `/api/webhooks/stripe` | Público, verificado por firma | ciclo ACH asíncrono |

## 6.7 Audit

| Método | Ruta | Rol | Tenant |
|---|---|---|---|
| GET | `/api/audit-logs` | ADMIN (todo), LENDER (acotado a `lenderId` propio) | filtros por `entityType`/`actorUserId`/rango de fecha |

## 6.8 Infraestructura

| Método | Ruta | Notas |
|---|---|---|
| GET | `/api/health` | ya existe, sin cambios |

---

## 6.9 Loan Requests / Marketplace (nuevo, `D-S2-1`)

> Ver [00 §D-S2-1](00-contradicciones-y-decisiones.md#decisiones-2026-09-10-ronda-product-spec-v2--commitment-letter-spec) y [04 §4.7](04-base-de-datos.md#47-modelo-extendido--marketplace-fees-vetting-notificaciones-ratings-revisión-2026-09-10). Detalle de tickets en [fases/fase-13-rating-loan-requests.md](fases/fase-13-rating-loan-requests.md).

| Método | Ruta | Rol | Notas |
|---|---|---|---|
| POST | `/api/borrowers/me/loan-requests` | BORROWER | crea `LoanRequest(DRAFT)`, requiere `propertyId` propio |
| GET | `/api/borrowers/me/loan-requests` | BORROWER | propios, cualquier `status` |
| GET | `/api/borrowers/me/loan-requests/:id` | BORROWER | propio |
| PATCH | `/api/borrowers/me/loan-requests/:id` | BORROWER | solo mientras `status=DRAFT` |
| POST | `/api/borrowers/me/loan-requests/:id/publish` | BORROWER | `DRAFT → PUBLISHED`, exige `visibility` |
| POST | `/api/borrowers/me/loan-requests/:id/withdraw` | BORROWER | `PUBLISHED → WITHDRAWN` |
| POST | `/api/borrowers/me/loan-requests/:id/invites` | BORROWER | `D-S2-14` — invita a un Prestamista por email (`LoanRequestInvite`) |
| POST | `/api/borrowers/me/loan-requests/:id/photos` | BORROWER | sube `Document(type=LOAN_REQUEST_PHOTO)` |
| GET | `/api/marketplace/loan-requests` | LENDER | listado público (`visibility=PUBLIC`, `status=PUBLISHED`) — identidad del Deudor y dirección exacta ocultas |
| GET | `/api/marketplace/loan-requests/:id` | LENDER | detalle público (mismo enmascarado) |
| POST | `/api/marketplace/loan-requests/:id/match` | LENDER | `PUBLISHED → MATCHED`, crea `Contract(DRAFT, originationSource=MARKETPLACE, loanRequestId)` |
| POST | `/api/loan-requests/invites/:token/accept` | Público (con token) | acepta una invitación privada (`D-S2-14`); si el invitado no tiene cuenta, lo deriva al auto-registro (`D-P2-1`) con el `LoanRequest` pre-vinculado |
| POST | `/api/properties/:id/rentcast-comps` | LENDER, BORROWER dueño | dispara `fetchRentCastComps(propertyId)` (`D-S2-7`), actualiza `Property.rentCompsSnapshot`/`saleCompsSnapshot` |

## 6.10 Fees de contrato (nuevo, `D-S2-2`/`D-S2-5`)

| Método | Ruta | Rol | Notas |
|---|---|---|---|
| GET | `/api/contracts/:id/terms/:termsId/fees` | LENDER, BORROWER asociado | lista `ContractFeeItem[]` de esa versión — la "Closing Fee Summary Table" |
| POST | `/api/contracts/:id/terms/:termsId/fees` | LENDER | agrega un `ContractFeeItem` (incluye `CUSTOM`); solo mientras `ContractTerms.status=DRAFT` |
| DELETE | `/api/contracts/:id/terms/:termsId/fees/:feeId` | LENDER | solo mientras `DRAFT` |

`ContractFeeItem(code=MARKETPLACE_CONNECTION)` se inserta automáticamente por el servicio (no vía este endpoint) cuando `Contract.originationSource=MARKETPLACE` — ver `D-S2-5`.

## 6.11 Borrower Application / Vetting (nuevo, `D-S2-6`)

| Método | Ruta | Rol | Notas |
|---|---|---|---|
| POST | `/api/lenders/me/borrowers/:id/applications` | LENDER | exige la aplicación completa a un deudor vinculado |
| GET | `/api/borrowers/me/applications` | BORROWER | propias, cualquier Prestamista |
| GET | `/api/lenders/me/borrowers/:id/applications` | LENDER | de ese deudor, para su empresa |
| POST | `/api/borrowers/me/applications/:id/submit` | BORROWER | adjunta `Document(type=BORROWER_APPLICATION_DOCUMENT)`, `SUBMITTED` |
| POST | `/api/borrowers/me/applications/:id/pay` | BORROWER | marca `feePaidAt` (integración de cobro real bloqueada por `A-3`, ver [15](15-riesgos-y-decisiones-pendientes.md)) |
| POST | `/api/lenders/me/borrowers/:id/applications/:appId/review` | LENDER | `APPROVED`/`REJECTED` + `rejectionReason` |

## 6.12 Dashboards (nuevo)

| Método | Ruta | Rol | Notas |
|---|---|---|---|
| GET | `/api/borrowers/me/dashboard` | BORROWER | agregados: loan requests activos, contratos por estado, próximos cierres, notificaciones sin leer |
| GET | `/api/lenders/me/dashboard` | LENDER | agregados: Commitment Letters enviadas, `availableCapital`/`deployedCapital` derivado (`D-S2-11`), contratos activos + return rate, próximos cierres/payoffs, notificaciones sin leer |

## 6.13 Notificaciones (nuevo, `D-S2-12`)

| Método | Ruta | Rol | Notas |
|---|---|---|---|
| GET | `/api/notifications` | Autenticado | propias, paginado, filtro `isRead` |
| POST | `/api/notifications/:id/read` | Autenticado | propia |
| POST | `/api/notifications/read-all` | Autenticado | propias |

## 6.14 Lender Reviews (nuevo, `D-S2-13`)

| Método | Ruta | Rol | Notas |
|---|---|---|---|
| POST | `/api/contracts/:id/lender-review` | BORROWER asociado | crea `LenderReview`; `409` si ya existe una para ese `(contractId, borrowerProfileId)` |
| GET | `/api/lenders/:id/reviews` | Público o Autenticado (a definir con frontend) | reseñas de un `LenderCompany`, paginado |

## 6.15 Commitment Letter (nuevo, `D-S2-9`)

No agrega rutas propias — reutiliza el flujo ya existente de `ContractTerms` (§6.5): `POST /api/contracts/:id/terms/:termsId/accept` (último borrower que completa el quórum) dispara, en la misma operación que `generateAmortizationSchedule` (`BE-059`): generación del PDF (`Document(type=COMMITMENT_LETTER)`) y el envío automático a `Contract.closingAttorneyEmail` + `Contract.insuranceCompanyId` (si está asignado). Endpoint de solo lectura:

| Método | Ruta | Rol | Notas |
|---|---|---|---|
| GET | `/api/contracts/:id/commitment-letter` | LENDER, BORROWER asociado | URL firmada de corta vida al `Document(type=COMMITMENT_LETTER)` vigente |

---

[← Índice del plan](README.md)  ·  [Anterior: 5. Qué NO debemos copiar de Owner](05-que-no-copiar-de-owner.md)  ·  [Siguiente: 7. Autenticación y autorización](07-autenticacion-y-autorizacion.md)
