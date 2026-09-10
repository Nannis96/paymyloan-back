[← Índice de fases](README.md)  ·  [Backlog](../13-backlog.md)  ·  [Anterior: Fase 5 — Borrowers](fase-05-borrowers.md)  ·  [Siguiente: Fase 7 — Payments](fase-07-payments.md)

---

# Fase 6 — Contracts

> **Ampliada 2026-09-10** (`D-S2-2`, ver [00](../00-contradicciones-y-decisiones.md#decisiones-2026-09-10-ronda-product-spec-v2--commitment-letter-spec)): se agrega `PB-020` (estructura de fees de cierre, requerida por el Commitment Letter Spec para *cualquier* contrato, no solo los de marketplace).
>
> **`BE-051` NO gana `originationSource`/`loanRequestId` en esta fase** — corregido 2026-09-10 (`D-S2-19`, autorrevisión post-commit): esos dos campos son una FK a `LoanRequest`, tabla que recién existe en Fase 13 — agregarlos aquí hubiera dejado una FK contra una tabla inexistente. Fase 6 es completamente autónoma: todo lo de abajo se implementa y se da por cerrado sin que Fase 13 exista, cubriendo el flujo directo Lender→Contract. Fase 13 (`PB-017`) agrega esas dos columnas después, vía su propia migración, sobre el `Contract` que esta fase ya dejó listo.
>
> **`BE-051` tampoco depende de `BE-037`** (`withTenantScope`, descartado 2026-09-10, `D-P6-1` — ver [00](../00-contradicciones-y-decisiones.md#decisión-2026-09-10-ronda-fase-6--arranque-d-p6-1-withtenantscope-descartado)): la dependencia original quedó reemplazada por la misma regla de `lenderCompanyId` explícito ya usada en `BE-045`/`PB-017`.

## BE-051 — `POST /api/contracts`
- **Prioridad/Complejidad/Dependencias**: P0 / L / BE-012 (`ContractTerms`)
- **Multi-empresa** (corregido 2026-09-10, `D-P6-1` — ya no depende de `BE-037`, descartado): mismo patrón que `BE-045` (Fase 5) y `PB-017` (Fase 13, `D-S2-20`) — `lenderCompanyId` opcional en el body si el Lender tiene una sola `LenderCompany` (se resuelve sola), obligatorio si tiene más de una (`400 LENDER_COMPANY_REQUIRED`), `404` si la enviada no es propia.
- **Implementación**: sección [8.2](../08-contratos.md#82-creación--edición--consulta--eliminación); genera `contractNumber`; opcionalmente asocia deudores iniciales en el mismo payload.
- **Validaciones**: Zod exhaustivo sobre dirección + términos financieros (montos positivos, `maturityDate > firstPaymentDate`, `paymentDueDay` 1–31).
- **Tests**: contrato creado siempre tiene `status=DRAFT` y una `ContractTerms` v1 `DRAFT` asociada; un Lender con 2 `LenderCompany` sin `lenderCompanyId` en el body → 400; con una ajena → 404.

## BE-052 — `GET /api/contracts` (lista + filtros + paginación, por rol)
- **Prioridad/Complejidad/Dependencias**: P0 / M / BE-051
- **Implementación**: para `LENDER`, `WHERE lenderId=session.lenderId`; para `BORROWER`, join con `ContractBorrower`.

## BE-053 — `GET /api/contracts/:id`
- **Prioridad/Complejidad/Dependencias**: P0 / M / BE-038

## BE-054 — `PATCH /api/contracts/:id`
- **Prioridad/Complejidad/Dependencias**: P1 / M / BE-051
- **Validaciones**: campos financieros solo editables si `currentTerms.status=DRAFT`.

## BE-055 — `DELETE /api/contracts/:id`
- **Prioridad/Complejidad/Dependencias**: P1 / S / BE-051
- **Validaciones**: sección [8.1](../08-contratos.md#81-ciclo-de-vida-y-estados).

## BE-056 — `POST /api/contracts/:id/cancel`
- **Prioridad/Complejidad/Dependencias**: P1 / M / BE-051
- **Validaciones**: `reason` obligatorio, auditado.

## BE-057 — `POST/DELETE /api/contracts/:id/borrowers`
- **Prioridad/Complejidad/Dependencias**: P0 / M / BE-014, BE-038
- **Validaciones**: `borrowerProfile.lenderId === contract.lenderId` — sección [7.5](../07-autenticacion-y-autorizacion.md#75-rbac--aislamiento-multi-tenant--cómo-se-evita-que-un-prestamista-acceda-a-datos-de-otro) punto 4.

## BE-058 — Servicio de amortización (`calculateAmortizedPayment`, `calculateInterestOnlyPayment`, `calculateBalloonPayment`, `calculateAccruedInterest`)
- **Prioridad/Complejidad/Dependencias**: P0 / L / ninguna (funciones puras, se pueden implementar en paralelo a la DB)
- **Tests**: sección [11](../11-testing.md), casos contra referencia externa (calculadora de amortización conocida).

## BE-059 — Servicio `generateAmortizationSchedule` + activación automática
- **Prioridad/Complejidad/Dependencias**: P0 / L / BE-058, BE-013, BE-015
- **Implementación**: disparado por el último `ContractTermsAcceptance` que completa el quórum (sección [4.3](../04-base-de-datos.md#43-tablas), regla 3); crea todas las `ScheduledPayment` en una sola `$transaction`; mueve `Contract.status → ACTIVE`, `ContractTerms.status → ACCEPTED`.
- **Tests**: última fila del calendario cierra el saldo en $0.00 exacto; no se puede generar dos veces para la misma versión (constraint único).

## BE-060 — `POST /api/contracts/:id/terms` (proponer nueva versión) + `submit`
- **Prioridad/Complejidad/Dependencias**: P1 / M / BE-059
- **Nota 2026-09-10**: los `ContractFeeItem` (Lender) **no** se copian automáticamente de la versión anterior al crear una nueva — el Prestamista los vuelve a cargar si siguen aplicando. En esta fase no hay nada más que hacer respecto a fees — la lógica de `MARKETPLACE_CONNECTION` (recalcularla en cada versión nueva, `D-S2-5`) todavía no aplica porque `Contract.originationSource` no existe hasta Fase 13.
- **Ampliado por `PB-017` (Fase 13)**: una vez que Fase 13 agrega `Contract.originationSource`/`loanRequestId` (`D-S2-19`), este mismo endpoint gana la regla: si `originationSource=MARKETPLACE`, inserta de nuevo `ContractFeeItem(code=MARKETPLACE_CONNECTION)` recalculado sobre el `principalAmount` de la versión nueva (`D-S2-5`). Esa ampliación se implementa y prueba en Fase 13, no aquí.

## BE-061 — `POST /api/contracts/:id/terms/:termsId/accept` y `/reject`
- **Prioridad/Complejidad/Dependencias**: P0 / L / BE-013, BE-059, BE-006
- **Implementación**: sección [4.3](../04-base-de-datos.md#43-tablas) regla 3; `accept` dispara `generateAmortizationSchedule` cuando completa el quórum; `reject` regresa `ContractTerms.status → REJECTED` y notifica al Prestamista por correo.
- **Tests**: contrato con 2 borrowers, 1 acepta y 1 rechaza → permanece `PENDING_ACCEPTANCE`/regresa a revisión, no se activa; ambos aceptan → se activa y genera calendario en el mismo flujo.

## BE-062 — `GET /api/contracts/:id/schedule` y `/balance`
- **Prioridad/Complejidad/Dependencias**: P0 / M / BE-059

## BE-063 — Job `recomputeContractDelinquencyStatus`
- **Prioridad/Complejidad/Dependencias**: P2 / M / BE-059
- **Implementación**: `src/jobs/recomputeContractDelinquency.ts`, corre diario (cron externo o `node-cron` dentro del contenedor — decisión de implementación, no bloqueante para el resto).

## BE-064 — Job `assessLateFee`
- **Prioridad/Complejidad/Dependencias**: P2 / M / BE-059, BE-063

## PB-020 — `ContractFeeItem` — Closing Fee Summary Table (nuevo, `D-S2-2`)
- **Objetivo**: modelar la tabla de fees que el Commitment Letter Spec exige mostrar antes de aceptar los términos — origination points, processing, underwriting, doc prep, custom, más el fee de plataforma cuando aplica (`PB-017`).
- **Prioridad/Complejidad/Dependencias**: P0 / L / BE-012 (`ContractTerms`)
- **Archivos afectados**: `prisma/schema.prisma` (tabla `ContractFeeItem`, enums `ContractFeeCategory`/`ContractFeeCode`/`FeeAmountType`), `src/services/contractFees.service.ts` (nuevo), `src/validations/contracts.validation.ts`, `src/app/api/contracts/[id]/terms/[termsId]/fees/route.ts`.
- **Implementación**: ver [04 §4.7](../04-base-de-datos.md#47-modelo-extendido--marketplace-fees-vetting-notificaciones-ratings-revisión-2026-09-10). `computedAmount` se resuelve al crear la fila (`amountValue` flat, o `%` × `ContractTerms.principalAmount` en ese instante) y nunca se recalcula — una versión nueva de términos exige filas nuevas (copiadas o reingresadas a mano por el Prestamista). `prePayPenaltyType`/`prePayPenaltyAmount` se agregan directo a `ContractTerms` (mismo patrón que `lateFeeType`/`lateFeeAmount`, ya existente), no como fila de esta tabla. Los enums `ContractFeeCategory`/`ContractFeeCode` se crean completos en esta fase — **incluido** el valor `MARKETPLACE_CONNECTION` — aunque ningún contrato de Fase 6 lo use todavía.
- **`MARKETPLACE_CONNECTION` NO se implementa en esta fase** (corregido 2026-09-10, `D-S2-19`): su inserción automática depende de `Contract.originationSource`, columna que no existe hasta Fase 13 (`D-S2-19`, ver nota de cabecera de este documento). `PB-017` (Fase 13) es quien construye ese servicio, ampliando `BE-060` para que recién ahí empiece a insertarla/recalcularla. Este ticket solo deja la tabla y los enums listos para recibirla.
- **Validaciones**: fees de Lender solo editables mientras `ContractTerms.status=DRAFT`; `amountValue > 0`; `label` obligatorio cuando `code=CUSTOM`.
- **Tests**: creación/edición/borrado de fees de Lender sobre una `ContractTerms DRAFT`; editar un fee tras `PENDING_ACCEPTANCE` → 409. Los tests de `MARKETPLACE_CONNECTION` (auto-inserción, recálculo por versión) viven en `PB-017`/Fase 13, no aquí.
- **Criterios de aceptación**: `GET /api/contracts/:id/terms/:termsId/fees` devuelve la misma tabla que se le muestra al Deudor antes de aceptar (§6.10).

---

[← Índice de fases](README.md)  ·  [Backlog](../13-backlog.md)  ·  [Anterior: Fase 5 — Borrowers](fase-05-borrowers.md)  ·  [Siguiente: Fase 7 — Payments](fase-07-payments.md)
