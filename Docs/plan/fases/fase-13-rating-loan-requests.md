[← Índice de fases](README.md)  ·  [Backlog](../13-backlog.md)  ·  [Anterior: Fase 12 — Payoff](fase-12-payoff.md)  ·  [Siguiente: Fase 14 — Dashboards y Ratings](fase-14-dashboards-ratings.md)

---

# Fase 13 — Marketplace / Loan Requests / Vetting

> **Formalizada y ampliada 2026-09-10**: `IMPLEMENTATION_PROGRESS.md` la llamaba "Fase 13 — Rating PML y solicitud de préstamo" y solo tenía `PB-009`..`PB-013` sin detalle (`PB-013` ya se implementó en Fase 2, ver [17](../17-fase-2-actualizada.md)). `PB-009`/`PB-010` (rating/stats calculados) se movieron a [Fase 14](fase-14-dashboards-ratings.md) junto con `LenderReview` (reseñas enviadas por el Deudor, concepto distinto — ver `D-S2-13`) para no mezclar "publicar un deal" con "calificar/medir" en el mismo documento. Esta fase se queda con el marketplace en sí: `LoanRequest`, comps de RentCast, matching público/privado, y el vetting del Deudor (`BorrowerApplication`) — ver [00 §D-S2-1/6/7/14](../00-contradicciones-y-decisiones.md#decisiones-2026-09-10-ronda-product-spec-v2--commitment-letter-spec) y el modelo en [04 §4.7](../04-base-de-datos.md#47-modelo-extendido--marketplace-fees-vetting-notificaciones-ratings-revisión-2026-09-10).
>
> **No bloquea ni es bloqueada por Fase 6/7/11/12** — un `LoanRequest` enganchado crea un `Contract` normal (`BE-051`) que sigue el mismo ciclo de vida de siempre; ver [14. Roadmap](../14-roadmap.md) punto 3.

## PB-011 — Tabla `LoanRequest` + CRUD propio del Deudor
- **Objetivo**: publicación de un deal por el Deudor — la pieza central del marketplace.
- **Prioridad/Complejidad/Dependencias**: P0 / L / BE-010 (`BorrowerProfile`), BE-095 (`Property`)
- **Archivos afectados**: `prisma/schema.prisma` (tabla `LoanRequest` + enums `LoanRequestVisibility`/`LoanRequestStatus`/`ProjectType`, ver [04 §4.7](../04-base-de-datos.md)), `src/services/loanRequests.service.ts`, `src/validations/loanRequests.validation.ts`, `src/app/api/borrowers/me/loan-requests/route.ts` y sub-rutas (§6.9).
- **Implementación**: campos del documento fuente — dirección (vía `propertyId`, reutiliza `Property` de `D-P1-5`), `purchasePrice`/`rehabAmount`/`totalLoanAmountRequested`, `requestedClosingDate`, `projectType`, `visibility`. `DRAFT → PUBLISHED` vía `POST .../publish` (exige `visibility` explícito); `PUBLISHED → WITHDRAWN` vía el Deudor en cualquier momento.
- **Validaciones**: `totalLoanAmountRequested <= purchasePrice + rehabAmount` no se fuerza (el negocio puede prestar de más o de menos, no es un error) — solo se valida que los tres montos sean positivos.
- **Tests**: un `LoanRequest(PUBLISHED, visibility=PUBLIC)` de otro Deudor listado en `GET /api/marketplace/loan-requests` nunca expone `borrowerProfileId` ni la dirección exacta.
- **Criterios de aceptación**: ciclo completo `DRAFT → PUBLISHED → WITHDRAWN` por `curl`.

## PB-012 — Pitch deck en PDF desde `LoanRequest`
- **Objetivo**: generar un resumen del deal en PDF (para que el Deudor lo comparta fuera de la plataforma, o el Prestamista lo revise offline).
- **Prioridad/Complejidad/Dependencias**: P2 / M / PB-011, PB-001 (motor de PDF, Fase 11)
- **Implementación**: reusa `PB-001`; contenido = los mismos campos de `LoanRequest` + comps (`PB-016`) + fotos (`Document(type=LOAN_REQUEST_PHOTO)`), sin datos financieros del Deudor más allá del `borrowingScore` público (`PB-009`, Fase 14).

## PB-016 — Integración RentCast (comps de renta y venta) sobre `Property`
- **Objetivo**: implementar `D-S2-7` — comps automáticos que el Product Spec v2 pide ("AI generates 3–4 rental comps y 3–4 sale comps").
- **Prioridad/Complejidad/Dependencias**: P1 / M / BE-095 (`Property`)
- **Archivos afectados**: `src/services/rentcast.service.ts` (nuevo, aislado — ver `D-S2-7`), `src/app/api/properties/[id]/rentcast-comps/route.ts` (§6.9).
- **Implementación**: llama a la API de RentCast (key ya disponible según el documento fuente — no es un riesgo bloqueante, a diferencia de crédito/background/e-signature) con los parámetros del propio spec: radio 0.5mi, mismo `squareFootage` aprox., últimos 6 meses + días en mercado. Guarda el resultado crudo en `Property.rentCompsSnapshot`/`saleCompsSnapshot` (`Json`, sin tabla relacional — ver justificación en `D-S2-7`), actualiza `Property.estimatedRentAmount`/`rentCastFetchedAt`/`valuationSource=RENTCAST`.
- **Validaciones**: rate-limit propio del bucket (mismo mecanismo que `BE-005`) para no agotar la cuota de la API por refrescos repetidos del frontend.
- **Tests**: con la API mockeada, el snapshot se persiste tal cual; una `Property` sin dirección completa no dispara la llamada (400, no un 500 de la API externa).
- **Decisión pendiente**: `estimatedMarketValue`/`afterRepairValue` (`D-P1-5`, carga manual) siguen sin fuente automatizada — RentCast informa renta/ventas comparables, no un ARV definitivo. Confirmar con Spencer si el negocio espera que la AI también proponga un ARV a partir de estos comps (mencionado como "AI generates... comps", no "AI calcula ARV") — no se asume, se deja igual que antes (riesgo #15 solo parcialmente cerrado).

## PB-017 — Matching de marketplace (público/privado) + conversión a `Contract`
- **Objetivo**: el paso donde un Prestamista "engancha" un `LoanRequest` y eso produce un `Contract` real.
- **Prioridad/Complejidad/Dependencias**: P0 / L / PB-011, BE-051 (`POST /api/contracts`), `D-S2-14` (`LoanRequestInvite`)
- **Implementación**: `POST /api/marketplace/loan-requests/:id/match` (LENDER) — `status: PUBLISHED → MATCHED`, crea `Contract(DRAFT, originationSource=MARKETPLACE, loanRequestId)` reusando el mismo servicio de `BE-051` (no un segundo camino de creación de contrato), con `ContractTerms` v1 **pre-llenada** desde `LoanRequest.totalLoanAmountRequested`/`requestedClosingDate` — confirmado con Spencer (`D-S2-1`): es un punto de partida editable, no una oferta en blanco ni un valor fijo; el Prestamista ajusta tasa/plazo/estructura/fees antes de someter la versión a aceptación (`BE-060`/submit). También inserta el `ContractFeeItem(MARKETPLACE_CONNECTION)` inicial (`PB-020`). Para `visibility=PRIVATE`: si `invitedLenderCompanyId` ya está en la plataforma, el flujo es el mismo `match`, restringido a esa empresa (sin invitación por token — camino separado del de abajo, confirmado con Spencer); si se invitó por email a alguien sin cuenta (`LoanRequestInvite`), aceptar el token (`POST /api/loan-requests/invites/:token/accept`) lo deriva al auto-registro (`D-P2-1`) y, tras activarse, puede hacer el `match`.
- **Validaciones**: un Prestamista sin 2FA activo no puede hacer `match` (mismo criterio `D-P3-1` que cualquier escritura de negocio de LENDER); un `LoanRequest` ya `MATCHED`/`WITHDRAWN`/`EXPIRED` responde 409 a un segundo intento de match.
- **Tests**: dos Prestamistas intentando `match` sobre el mismo `LoanRequest` casi simultáneamente — solo uno gana (transacción con verificación de `status` en el mismo `$transaction`, mismo patrón que evita doble-aceptación en `ContractTermsAcceptance`).
- **Criterios de aceptación**: `Contract.loanRequestId`/`originationSource` correctos tras el match; el `LoanRequest` original queda en `CONVERTED` recién cuando el `Contract` llega a `ACTIVE` (no en `MATCHED` — puede fallar la aceptación de términos y el deal caerse).

## PB-018 — `BorrowerApplication` (vetting, $99) + endpoints
- **Objetivo**: implementar `D-S2-6` — verificación completa del Deudor a pedido del Prestamista.
- **Prioridad/Complejidad/Dependencias**: P1 / L / BE-010 (`BorrowerProfile`), PB-002 (storage de documentos, Fase 11)
- **Archivos afectados**: `prisma/schema.prisma` (tabla `BorrowerApplication` + enum `BorrowerApplicationStatus`), `src/services/borrowerApplications.service.ts`, rutas de §6.11.
- **Implementación**: ver [04 §4.7](../04-base-de-datos.md). Documentos (entity docs, bank statement, ID) como `Document(type=BORROWER_APPLICATION_DOCUMENT, applicationId)`. `creditPullStatus`/`backgroundCheckStatus` quedan como campos libres sin integración real hasta resolver el riesgo #22/#23 de [15](../15-riesgos-y-decisiones-pendientes.md) — el Prestamista puede aprobar/rechazar manualmente sin esos datos automatizados mientras tanto.
- **Validaciones**: `POST .../submit` exige al menos un `Document` de cada tipo requerido (configurable por el Prestamista — a definir si es fijo o parametrizable, no bloqueante para este ticket, se asume fijo por ahora).
- **Tests**: un Deudor sin `feePaidAt` no puede `submit` (a confirmar si el fee se cobra antes o después de enviar — el documento fuente dice "disclosed upfront before borrower submits application", que exige mostrarlo, no necesariamente cobrarlo antes; se implementa como bloqueante por consistencia con el resto del sistema, revisable).
- **Criterios de aceptación**: camino dorado — Prestamista exige aplicación → Deudor paga → sube documentos → envía → Prestamista aprueba/rechaza.

## PB-019 — `BorrowerSubscription` ($9/mes, trial 7 días) + endpoints
- **Objetivo**: implementar `D-S2-3`.
- **Prioridad/Complejidad/Dependencias**: P2 / M / ninguna (tabla independiente), cobro real bloqueado por `A-3`
- **Implementación**: `BorrowerSubscription` se crea automáticamente al activar la cuenta del Deudor (mismo punto que ya dispara la contraseña temporal, `userActivation.service.ts`), en `TRIALING` con `trialEndsAt=createdAt+7d`. Un job (`src/jobs/expireTrials.ts`, nuevo) pasa `TRIALING → PAST_DUE` si vence sin `stripeSubscriptionId` activo — **no bloquea el uso de la plataforma** en esta fase (el documento fuente no especifica qué pasa si no se paga; no se inventa una suspensión sin confirmarlo con Spencer).
- **Decisión pendiente**: ¿qué pasa si el Deudor no paga tras el trial — se suspende la cuenta, se limita a solo-lectura, o no pasa nada hasta que el negocio lo decida? No confirmado por ningún documento fuente — se deja como pregunta abierta, no se asume.

---

[← Índice de fases](README.md)  ·  [Backlog](../13-backlog.md)  ·  [Anterior: Fase 12 — Payoff](fase-12-payoff.md)  ·  [Siguiente: Fase 14 — Dashboards y Ratings](fase-14-dashboards-ratings.md)
