[← Índice de fases](README.md)  ·  [Backlog](../13-backlog.md)  ·  [Anterior: Fase 13 — Marketplace / Loan Requests / Vetting](fase-13-rating-loan-requests.md)  ·  [Siguiente: Fase 15 — Exports contables](fase-15-exports-reporting.md)

---

# Fase 14 — Dashboards y Ratings

> **Nueva 2026-09-10** — el número estaba libre (`IMPLEMENTATION_PROGRESS.md` saltaba de Fase 13 a Fase 15). Agrupa `PB-009`/`PB-010` (ya estaban en el checklist de progreso, sin detalle, bajo la vieja "Fase 13") con dos conceptos que trae [pml_product_spec_v2.pdf](../../pml_product_spec_v2.pdf) sin precedente en ningún plan anterior: las reseñas explícitas del Deudor sobre el Prestamista (`LenderReview`, distinto de un cálculo — ver `D-S2-13`) y los dashboards de ambos roles. Ver [00 §D-S2-11/13](../00-contradicciones-y-decisiones.md#decisiones-2026-09-10-ronda-product-spec-v2--commitment-letter-spec) y el modelo en [04 §4.7](../04-base-de-datos.md#47-modelo-extendido--marketplace-fees-vetting-notificaciones-ratings-revisión-2026-09-10).
>
> **Depende de** Fase 6 (Contracts, para contar activos/return rate), Fase 11 (`PB-022`, notificaciones) y Fase 12 (Payoff, para "Completed Loans"/"Upcoming payoffs").

## PB-009 — `GET /api/borrowers/:id/rating`
- **Objetivo**: "Borrowing score (public)" del Product Spec v2 — métrica calculada, no una reseña.
- **Prioridad/Complejidad/Dependencias**: P1 / M / historial de `Contract`/`ScheduledPayment` del Deudor (Fase 6/7)
- **Implementación**: fórmula sin decidir todavía — candidatos razonables: % de `ScheduledPayment` pagados a tiempo, número de `Contract` `PAID_OFF` sin `DELINQUENT`, antigüedad en la plataforma. **No se inventa la fórmula exacta sin confirmarla** — este ticket entrega el endpoint y la estructura (`score`, `completedLoans`, `activeLoans`, `projectTypeHistory` derivado de `LoanRequest.projectType`/`Contract` asociados), con un placeholder documentado hasta que el negocio confirme el cálculo real.
- **Decisión pendiente**: fórmula exacta del "Borrowing Score" — no especificada en ningún documento fuente más allá del nombre.

## PB-010 — `GET /api/lenders/:id/stats`
- **Objetivo**: estadísticas públicas del Prestamista para el marketplace (sin "avg response time", según el plan original ya lo excluía).
- **Prioridad/Complejidad/Dependencias**: P1 / M / historial de `Contract` de la `LenderCompany`
- **Implementación**: `activeLoans`, `completedLoans`, `totalDeployed` (derivado, `D-S2-11`), `averageRating` (derivado de `LenderReview`, `PB-023`), preferencias públicas (`ratePreferenceMinPercent`/`MaxPercent`, `loanTypePreferences`, `geographicAreaStates` — todos ya en `LenderCompany`, `D-S2-11`).

## PB-023 — `LenderReview` (el Deudor califica al Prestamista)
- **Objetivo**: implementar `D-S2-13`.
- **Prioridad/Complejidad/Dependencias**: P2 / M / Contract `PAID_OFF` o `ACTIVE` (a confirmar si se permite calificar antes de terminar el préstamo)
- **Archivos afectados**: `prisma/schema.prisma` (tabla `LenderReview`), rutas de §6.14.
- **Implementación**: `POST /api/contracts/:id/lender-review` (BORROWER asociado) — `rating` 1–5 + `comment?`. `@@unique([contractId, borrowerProfileId])` evita reseñas duplicadas sobre el mismo contrato.
- **Validaciones**: ¿se permite reseñar un contrato `ACTIVE` o solo `PAID_OFF`/`CANCELLED`? No especificado por el documento fuente — se implementa sin restricción de estado (cualquier `ContractBorrower` activo puede reseñar en cualquier momento), revisable si el negocio prefiere limitarlo a préstamos completados.
- **Tests**: segundo intento del mismo Deudor sobre el mismo contrato → 409.

## PB-024 — Dashboards de Borrower y Lender
- **Objetivo**: los dos dashboards descritos explícitamente en el Product Spec v2.
- **Prioridad/Complejidad/Dependencias**: P1 / L / Fase 6, Fase 7, Fase 11 (`PB-022`), Fase 12, `PB-016`
- **Implementación**: dos endpoints de agregación pura (§6.12) — sin tabla propia, todo derivado en el momento de la consulta:
  - **Borrower** (`GET /api/borrowers/me/dashboard`): `LoanRequest` propios por estado ("Need Funding" = `PUBLISHED`/`MATCHED` sin convertir), `Contract` por estado ("Loan Approved" = `PENDING_ACCEPTANCE` con todos los términos ya `ACCEPTED` salvo activación — a confirmar el mapeo exacto contra la máquina de estados de [8.1](../08-contratos.md#81-ciclo-de-vida-y-estados); "Current Loans" = `ACTIVE`/`DELINQUENT`; "Completed Loans" = `PAID_OFF`), `Notification` recientes/sin leer (`PB-022`), próximos cierres (`Contract.nextPaymentDueDate` o `LoanRequest.requestedClosingDate` según corresponda).
  - **Lender** (`GET /api/lenders/me/dashboard`): conteo de Commitment Letters enviadas (`Document(type=COMMITMENT_LETTER)` de sus contratos), `availableCapital`/`deployedCapital` (`D-S2-11`), `activeLoans` + return rate (definición de "return rate" no especificada — candidato razonable: tasa de interés ponderada por saldo de los contratos `ACTIVE`, a confirmar), próximos cierres/payoffs (`PayoffRequest` `REQUESTED`/`APPROVED`, Fase 12), `Notification` recientes/sin leer.
- **Decisión pendiente**: definición exacta de "return rate" del Lender Dashboard — no especificada más allá del nombre.

---

[← Índice de fases](README.md)  ·  [Backlog](../13-backlog.md)  ·  [Anterior: Fase 13 — Marketplace / Loan Requests / Vetting](fase-13-rating-loan-requests.md)  ·  [Siguiente: Fase 15 — Exports contables](fase-15-exports-reporting.md)
