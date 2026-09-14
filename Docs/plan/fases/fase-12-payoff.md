[← Índice de fases](README.md)  ·  [Backlog](../13-backlog.md)  ·  [Anterior: Fase 11 — Documentos, Commitment Letter y Notificaciones](fase-11-documentos-pdf.md)  ·  [Siguiente: Fase 13 — Marketplace / Loan Requests / Vetting](fase-13-rating-loan-requests.md)

---

# Fase 12 — Payoff

> **Formalizada 2026-09-10**: antes solo existía como una fila suelta en [IMPLEMENTATION_PROGRESS.md](../../IMPLEMENTATION_PROGRESS.md) (`PB-005`..`PB-008`, sin detalle). El flujo de distribución (a quién se envía, qué contiene) estaba completamente sin especificar hasta [pml_product_spec_v2.pdf](../../pml_product_spec_v2.pdf), sección "Payoff Flow" — esta ronda lo trae a `Docs/plan/`. Ver [00](../00-contradicciones-y-decisiones.md#decisiones-2026-09-10-ronda-product-spec-v2--commitment-letter-spec).
>
> **Depende de** Fase 11 (`PB-001`/`PB-002`/`PB-004`, motor de PDF + storage + envío de correo — la Payoff Letter reusa exactamente esa infraestructura).

## PB-005 — Tabla `PayoffRequest`
- **Objetivo**: registrar la solicitud/cotización de liquidación total de un `Contract`.
- **Prioridad/Complejidad/Dependencias**: P0 / M / BE-011 (`Contract`)
- **Archivos afectados**: `prisma/schema.prisma` (tabla nueva + enum `PayoffRequestStatus`).
- **Implementación**: campos base ya diseñados en [PAYMYLOAN_DATABASE_DESIGN.md §5.9](../../PAYMYLOAN_DATABASE_DESIGN.md) (reutilizable tal cual, es lógica financiera, no de identidad — ver `D0-1`): `contractId`, `requestedByUserId` (Deudor), `effectiveDate`, `expirationDate`, `principalBalance`/`accruedInterest`/`outstandingLateFees`/`otherCharges`/`totalPayoffAmount` (snapshot al momento del cálculo), `status` (`REQUESTED`/`UNDER_REVIEW`/`APPROVED`/`REJECTED`/`SIGNED`/`EXPIRED`/`COMPLETED`/`CANCELLED`), `reviewedByUserId`/`reviewedAt` (Prestamista), `rejectionReason`, `modifiedAmount`/`modificationNote`, `signedAt`, `completedAt`. **No versionado propio** — cada recotización es una fila nueva, mismo razonamiento que la fuente original (una cotización es efímera, no un acuerdo vivo que se edita).
- **Tests**: `@@index([contractId, status])`.

## PB-006 — Servicio `calculatePayoff`
- **Objetivo**: calcular `totalPayoffAmount` a una `effectiveDate` dada.
- **Prioridad/Complejidad/Dependencias**: P0 / M / BE-058 (`calculateAccruedInterest`, ya diseñado en Fase 6)
- **Implementación**: `principalBalance` (de `Contract.currentPrincipalBalance` a la fecha) + `calculateAccruedInterest(...)` desde el último `ScheduledPayment` pagado hasta `effectiveDate` + `outstandingLateFees` (suma de `ScheduledPayment.lateFeeAssessed` no cobrado) + `otherCharges` (manual, si el Prestamista ajusta antes de aprobar, `modifiedAmount`).
- **Tests**: mismo caso de referencia que `calculateAccruedInterest` (sección [11](../11-testing.md)), aplicado a una fecha intermedia del calendario.

## PB-007 — `POST`/`GET /api/contracts/:id/payoff-requests`
- **Objetivo**: exponer el flujo completo de payoff descrito en el Product Spec v2.
- **Prioridad/Complejidad/Dependencias**: P0 / L / PB-005, PB-006, PB-004 (envío de documento)
- **Archivos afectados**: `src/services/payoff.service.ts`, `src/app/api/contracts/[id]/payoff-requests/route.ts`, `src/app/api/contracts/[id]/payoff-requests/[payoffId]/route.ts`, `src/app/api/contracts/[id]/payoff-requests/[payoffId]/approve|reject|sign/route.ts`.
- **Implementación** (flujo del documento fuente, "Payoff Flow"): (1) `POST` (Deudor) crea `PayoffRequest(REQUESTED)` con `effectiveDate` deseada → dispara `Notification` (`PB-022`) + correo al Prestamista con la fecha de cierre esperada; (2) el sistema auto-genera la Payoff Letter en `UNDER_REVIEW`/`APPROVED` (`Document(type=PAYOFF_LETTER)`, reusa `PB-001`/`PB-002`) con: info de la empresa Prestamista, `LenderCompany.wireBankAccountLast4`/`wireVerificationPhone` (**solo últimos 4 dígitos** + teléfono de verificación antes del wire — mismo dato que la Commitment Letter, `D-S2-18`, mismo criterio de nunca persistir información bancaria completa que ya aplica a `Transaction.last4`/sección [3.6](../03-arquitectura-backend.md#36-seguridad-transversal)); (3) el Prestamista firma (`POST .../sign`, misma semántica de "firma = aceptación in-app" que D0-3) → `SIGNED`, dispara `PB-004` para auto-enviar a `Contract.closingAttorneyEmail` + aseguradora, igual que la Commitment Letter (`PB-003`); (4) al completarse el cierre real (pago del monto de payoff registrado, `BE-067`/`BE-068`), `status → COMPLETED`, dispara `PB-008`.
- **Validaciones**: solo un `PayoffRequest` en estado activo (`REQUESTED`/`UNDER_REVIEW`/`APPROVED`) por contrato a la vez — una recotización nueva exige cancelar o dejar expirar la anterior.
- **Tests**: `effectiveDate` pasada → 400; solo el Prestamista dueño puede aprobar/firmar; solo el Deudor asociado puede solicitar.
- **Criterios de aceptación**: camino dorado — Deudor solicita → Prestamista aprueba y firma → Payoff Letter llega (modo dev) a la bandeja simulada de la parte de cierre y la aseguradora, con bank info enmascarada.

## PB-008 — Aplicación: `Contract.status → PAID_OFF`
- **Objetivo**: cerrar el ciclo de vida del contrato cuando un `PayoffRequest` se completa.
- **Prioridad/Complejidad/Dependencias**: P0 / M / PB-007, BE-068 (`applyTransaction`)
- **Implementación**: cuando una `Transaction(type=PAYOFF_PAYMENT)` liquida el `totalPayoffAmount` del `PayoffRequest` vigente, el servicio marca `PayoffRequest.status=COMPLETED`, `Contract.status=PAID_OFF`, `Contract.paidOffAt=now()`, y detiene cualquier `Autopay`/`ScheduledPayment` `PENDING` restante (`VOIDED`).
- **Tests**: un pago parcial no dispara el cierre; el monto exacto (o mayor, con vuelto registrado como `ADJUSTMENT`) sí.
- **Criterios de aceptación**: tras `PAID_OFF`, el contrato desaparece de "Active Loans" y aparece en "Completed Loans" en ambos dashboards (`PB-024`).

---

[← Índice de fases](README.md)  ·  [Backlog](../13-backlog.md)  ·  [Anterior: Fase 11 — Documentos, Commitment Letter y Notificaciones](fase-11-documentos-pdf.md)  ·  [Siguiente: Fase 13 — Marketplace / Loan Requests / Vetting](fase-13-rating-loan-requests.md)
