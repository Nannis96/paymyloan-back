[← Índice de fases](README.md)  ·  [Backlog](../13-backlog.md)  ·  [Anterior: Fase 5 — Borrowers](fase-05-borrowers.md)  ·  [Siguiente: Fase 7 — Payments](fase-07-payments.md)

---

# Fase 6 — Contracts

> **Ampliada 2026-09-10** (`D-S2-1`/`D-S2-2`/`D-S2-5`, ver [00](../00-contradicciones-y-decisiones.md#decisiones-2026-09-10-ronda-product-spec-v2--commitment-letter-spec)): `BE-051` gana `originationSource`/`loanRequestId` (por defecto `DIRECT`/`null` — el flujo original de abajo no cambia si no viene de un match de Fase 13) y se agrega `PB-020` (estructura de fees de cierre, requerida por el Commitment Letter Spec para *cualquier* contrato, no solo los de marketplace).

## BE-051 — `POST /api/contracts`
- **Prioridad/Complejidad/Dependencias**: P0 / L / BE-012, BE-037
- **Implementación**: sección [8.2](../08-contratos.md#82-creación--edición--consulta--eliminación); genera `contractNumber`; opcionalmente asocia deudores iniciales en el mismo payload.
- **Validaciones**: Zod exhaustivo sobre dirección + términos financieros (montos positivos, `maturityDate > firstPaymentDate`, `paymentDueDay` 1–31).
- **Tests**: contrato creado siempre tiene `status=DRAFT` y una `ContractTerms` v1 `DRAFT` asociada.

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
- **Nota 2026-09-10**: si `Contract.originationSource=MARKETPLACE`, este endpoint debe insertar de nuevo `ContractFeeItem(code=MARKETPLACE_CONNECTION)` en la versión recién creada, recalculado sobre el `principalAmount` de esa versión — ver `PB-020`, confirmado con Spencer (`D-S2-5`). Los demás `ContractFeeItem` (Lender) **no** se copian automáticamente de la versión anterior — el Prestamista los vuelve a cargar si siguen aplicando.

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
- **Implementación**: ver [04 §4.7](../04-base-de-datos.md#47-modelo-extendido--marketplace-fees-vetting-notificaciones-ratings-revisión-2026-09-10). `computedAmount` se resuelve al crear la fila (`amountValue` flat, o `%` × `ContractTerms.principalAmount` en ese instante) y nunca se recalcula **para fees de Lender** — una versión nueva de términos exige filas nuevas (copiadas o reingresadas a mano por el Prestamista). `prePayPenaltyType`/`prePayPenaltyAmount` se agregan directo a `ContractTerms` (mismo patrón que `lateFeeType`/`lateFeeAmount`, ya existente), no como fila de esta tabla. **`MARKETPLACE_CONNECTION` es la excepción**: se genera automáticamente (no la crea el Prestamista a mano) y se recalcula en **cada** versión nueva sobre el `principalAmount` vigente — confirmado con Spencer, `D-S2-5` — el servicio de `BE-060` (proponer nueva versión) debe insertarla de nuevo si `Contract.originationSource=MARKETPLACE`, con el monto recalculado.
- **Validaciones**: fees de Lender solo editables mientras `ContractTerms.status=DRAFT`; `amountValue > 0`; `label` obligatorio cuando `code=CUSTOM`; `MARKETPLACE_CONNECTION` no es editable manualmente por el Prestamista (la inserta el servicio, no el endpoint de §6.10).
- **Tests**: un `Contract` con `originationSource=MARKETPLACE` siempre tiene exactamente un `ContractFeeItem(code=MARKETPLACE_CONNECTION, computedAmount=MAX(principalAmount*0.01, 999))` en cada versión de `ContractTerms` que genera (v1 al hacer match, `PB-017`; y cada versión nueva de `BE-060`, con el monto recalculado si `principalAmount` cambió); `DIRECT`/`PRIVATE_INVITE` nunca lo tienen en ninguna versión; editar un fee de Lender tras `PENDING_ACCEPTANCE` → 409.
- **Criterios de aceptación**: `GET /api/contracts/:id/terms/:termsId/fees` devuelve la misma tabla que se le muestra al Deudor antes de aceptar (§6.10).

---

[← Índice de fases](README.md)  ·  [Backlog](../13-backlog.md)  ·  [Anterior: Fase 5 — Borrowers](fase-05-borrowers.md)  ·  [Siguiente: Fase 7 — Payments](fase-07-payments.md)
