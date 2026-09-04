[← Índice de fases](README.md)  ·  [Backlog](../13-backlog.md)  ·  [Anterior: Fase 0 — Foundation](fase-00-foundation.md)  ·  [Siguiente: Fase 2 — Authentication](fase-02-authentication.md)

---

# Fase 1 — Database

## BE-008 — Enum `UserRole` + campo `role` en `User`
- **Prioridad/Complejidad/Dependencias**: P0 / S / BE-001
- **Objetivo**: base de toda la autorización posterior.
- **Archivos**: `prisma/schema.prisma`, migración.
- **Tests**: migración corre limpio; `User` requiere `role` explícito en `create()`.
- **Criterios de aceptación**: `prisma studio` muestra la columna `role` con los 3 valores posibles.

## BE-009 — Tabla `LenderProfile`
- **Prioridad/Complejidad/Dependencias**: P0 / M / BE-008
- **Objetivo**: modelar el tenant.
- **Implementación**: campos de sección [4.3](../04-base-de-datos.md#43-tablas), `@@unique([userId])`, `createdByAdminId` FK a `User`.
- **Tests**: constraint 1:1 con `User` se respeta (no se puede crear un segundo `LenderProfile` para el mismo `userId`).
- **Criterios de aceptación**: migración aplica sin downtime en la DB de desarrollo (está vacía, no es un riesgo real todavía).

## BE-010 — Tabla `BorrowerProfile`
- **Prioridad/Complejidad/Dependencias**: P0 / M / BE-009
- **Implementación**: `lenderId` `NOT NULL`, índice `[lenderId]`.
- **Tests**: no se puede crear un `BorrowerProfile` con un `lenderId` inexistente (FK).
- **Criterios de aceptación**: igual que BE-009.

## BE-011 — Enums de contrato + tabla `Contract`
- **Prioridad/Complejidad/Dependencias**: P0 / M / BE-009
- **Implementación**: campos de sección [4.3](../04-base-de-datos.md#43-tablas), sin `currentTermsId` resuelto todavía (se agrega en BE-012 con `ALTER` por la referencia circular).
- **Tests**: `contractNumber` único se respeta.
- **Criterios de aceptación**: tabla creada, sin FK circular rota.

## BE-012 — Tabla `ContractTerms` + resolver FK circular con `Contract.currentTermsId`
- **Prioridad/Complejidad/Dependencias**: P0 / M / BE-011
- **Implementación**: patrón estándar de Prisma para referencias mutuas (crear ambas tablas, luego `ALTER TABLE contracts ADD CONSTRAINT ...`).
- **Tests**: se puede setear `Contract.currentTermsId` a una `ContractTerms` de ese mismo `contractId` sin error; se puede dejar `null` mientras está en `DRAFT` sin `ContractTerms` todavía... (en la práctica siempre existe v1 desde la creación, ver BE-030).
- **Criterios de aceptación**: `prisma migrate dev` no reporta ciclo irresoluble.

## BE-013 — Tabla `ContractTermsAcceptance`
- **Prioridad/Complejidad/Dependencias**: P0 / S / BE-010, BE-012
- **Tests**: `@@unique([contractTermsId, borrowerProfileId])` bloquea doble aceptación.
- **Criterios de aceptación**: constraint verificado con un test de integración.

## BE-014 — Tabla `ContractBorrower`
- **Prioridad/Complejidad/Dependencias**: P0 / S / BE-010, BE-011
- **Implementación**: PK compuesta `[contractId, borrowerProfileId]`.
- **Tests**: no permite asociar dos veces el mismo par.

## BE-015 — Enums de pago + tabla `ScheduledPayment`
- **Prioridad/Complejidad/Dependencias**: P1 / M / BE-012
- **Tests**: `@@unique([contractTermsId, sequenceNumber])`.

## BE-016 — Tabla `Transaction`
- **Prioridad/Complejidad/Dependencias**: P1 / M / BE-011
- **Tests**: `stripePaymentIntentId` único permite múltiples `null` (varias transacciones manuales sin Stripe).

## BE-017 — Tabla `TransactionAllocation`
- **Prioridad/Complejidad/Dependencias**: P1 / S / BE-015, BE-016

## BE-018 — Tabla `PaymentMethod`
- **Prioridad/Complejidad/Dependencias**: P1 / S / BE-008

## BE-019 — Tabla `WebhookEvent`
- **Prioridad/Complejidad/Dependencias**: P1 / S / ninguna adicional
- **Tests**: `externalEventId` único rechaza inserción duplicada.

## BE-020 — Tabla `AuditLog`
- **Prioridad/Complejidad/Dependencias**: P0 / M / BE-009
- **Implementación**: incluye helper `logAuditEvent()` en `src/lib/audit.ts` desde este mismo ticket (la tabla sin el helper no se usa en ningún lado).
- **Tests**: insertar y verificar que no tiene `updatedAt`.

## BE-021 — Tablas `RefreshToken`, `PasswordResetToken`, `TwoFactorRecoveryCode`
- **Prioridad/Complejidad/Dependencias**: P0 / M / BE-008
- **Tests**: `tokenHash`/`codeHash` únicos.

## BE-022 — (Opcional/fase 2) Tabla `Document`
- **Prioridad/Complejidad/Dependencias**: P3 / M / BE-011
- **Nota**: no forma parte del roadmap mínimo — ver sección [15](../15-riesgos-y-decisiones-pendientes.md).

## BE-023 — Seed inicial
- **Prioridad/Complejidad/Dependencias**: P0 / M / BE-009, BE-010, BE-011, BE-012
- **Implementación**: sección [10.2](../10-migraciones-y-seeders.md#102-seeders).
- **Tests**: `pnpm run db:seed` corre limpio dos veces seguidas (idempotente o falla explícitamente si ya existe, decisión a tomar en implementación).
- **Criterios de aceptación**: tras el seed, se puede hacer login con el Admin de desarrollo y ver al menos un contrato de ejemplo vía API.

---

[← Índice de fases](README.md)  ·  [Backlog](../13-backlog.md)  ·  [Anterior: Fase 0 — Foundation](fase-00-foundation.md)  ·  [Siguiente: Fase 2 — Authentication](fase-02-authentication.md)
