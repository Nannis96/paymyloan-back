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

| Método | Ruta | Rol | Tenant |
|---|---|---|---|
| POST | `/api/admin/lenders` | ADMIN | N/A |
| GET | `/api/admin/lenders` | ADMIN | N/A (ve todos) |
| GET | `/api/admin/lenders/:id` | ADMIN | N/A |
| PATCH | `/api/admin/lenders/:id` | ADMIN | N/A |
| DELETE | `/api/admin/lenders/:id` | ADMIN | N/A — soft delete, bloqueado si tiene contratos `ACTIVE` |
| POST | `/api/admin/users/:id/activate` | ADMIN | `BE-097`, nuevo (`D-P2-1`) — primera activación genera y envía contraseña temporal; reactivación solo reabre acceso |
| POST | `/api/admin/users/:id/deactivate` | ADMIN | `BE-097`, nuevo — además revoca los refresh tokens vigentes del usuario |

## 6.3 Lenders (perfil propio y borrowers)

| Método | Ruta | Rol | Tenant |
|---|---|---|---|
| GET | `/api/lenders/me` | LENDER | propio |
| PATCH | `/api/lenders/me` | LENDER | propio (campos no sensibles: teléfono, dirección de negocio) |
| POST | `/api/lenders/me/borrowers` | LENDER | crea `User(role=BORROWER)` + `BorrowerProfile(lenderId=session)` |
| GET | `/api/lenders/me/borrowers` | LENDER | `WHERE lenderId = session.lenderId` |
| GET | `/api/lenders/me/borrowers/:id` | LENDER | verifica `borrower.lenderId === session.lenderId` |
| PATCH | `/api/lenders/me/borrowers/:id` | LENDER | idem |
| DELETE | `/api/lenders/me/borrowers/:id` | LENDER | idem, soft delete, bloqueado si tiene contratos activos |

## 6.4 Borrowers (autoservicio)

| Método | Ruta | Rol | Tenant |
|---|---|---|---|
| GET | `/api/borrowers/me` | BORROWER | propio |
| PATCH | `/api/borrowers/me` | BORROWER | campos de contacto propios, nunca `lenderId` |
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

[← Índice del plan](README.md)  ·  [Anterior: 5. Qué NO debemos copiar de Owner](05-que-no-copiar-de-owner.md)  ·  [Siguiente: 7. Autenticación y autorización](07-autenticacion-y-autorizacion.md)
