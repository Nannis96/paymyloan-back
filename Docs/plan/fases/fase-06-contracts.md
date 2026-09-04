[← Índice de fases](README.md)  ·  [Backlog](../13-backlog.md)  ·  [Anterior: Fase 5 — Borrowers](fase-05-borrowers.md)  ·  [Siguiente: Fase 7 — Payments](fase-07-payments.md)

---

# Fase 6 — Contracts

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

---

[← Índice de fases](README.md)  ·  [Backlog](../13-backlog.md)  ·  [Anterior: Fase 5 — Borrowers](fase-05-borrowers.md)  ·  [Siguiente: Fase 7 — Payments](fase-07-payments.md)
