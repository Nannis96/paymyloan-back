[← Índice del plan](README.md)  ·  [Anterior: 15. Riesgos y decisiones pendientes](15-riesgos-y-decisiones-pendientes.md)

---

# 16. Fase 1 — Database (plan actualizado, 2026-09-04)

> **Reemplaza** a [fases/fase-01-database.md](fases/fase-01-database.md) (histórico, no editado, con aviso al inicio). El modelo de datos de referencia para todo lo de abajo es [04. Base de datos](04-base-de-datos.md); el razonamiento de cada decisión está en [00. Contradicciones y decisiones — ronda 2026-09-04](00-contradicciones-y-decisiones.md#decisiones-2026-09-04-ronda-fase-1).
>
> **Estado**: plan de trabajo para revisión. **No implementado.** No se modificó `schema.prisma`, migraciones, código TypeScript, APIs, servicios, tests ni seeders como parte de este documento — ver instrucción explícita del encargo que originó esta revisión.
>
> **Por qué existe este documento en vez de editar el original**: el original (`fases/fase-01-database.md`) tenía 16 tickets (BE-008 a BE-023) sobre un modelo de identidad que el nuevo contexto funcional cambia de fondo (tenant = empresa, no persona; deudor de plataforma, no de un solo prestamista; roles nuevos; entidad `Property` nueva). Reescribirlo en el lugar hubiera perdido el registro de qué se decidió antes y por qué cambió — se prefirió una revisión nueva, versionada, que declara explícitamente el estado de cada ticket original.

## 16.1 Resumen — qué pasó con cada ticket original

| Ticket original | Estado | Se convierte en |
|---|---|---|
| BE-008 | **Se modifica** | BE-008 (este documento) — 2 valores nuevos de `UserRole`, campo `isActive` nuevo |
| BE-009 | **Se divide** | BE-009 (`LenderProfile`, reducido) + BE-090 (`LenderCompany`, nueva) |
| BE-010 | **Se modifica** | BE-010 (`BorrowerProfile`, sin `lenderId`) |
| — | **Se agrega** (formaliza `M-1`) | BE-091 (`LenderBorrower`) |
| — | **Se agrega** (formaliza `D-P1-6`) | BE-092 (`BookkeeperProfile`) + BE-093 (`LenderCompanyBookkeeper`) |
| — | **Se agrega** (formaliza `D-P1-7`) | BE-094 (`InsuranceCompanyProfile`) |
| — | **Se agrega** (formaliza `D-P1-5`) | BE-095 (`Property`) |
| BE-011 | **Se modifica** | BE-011 (`Contract` — `lenderCompanyId`, `propertyId`, `insuranceCompanyId`, sin dirección embebida) |
| BE-012 | **Permanece igual** | BE-012 |
| BE-013 | **Permanece igual** | BE-013 |
| BE-014 | **Permanece igual** (cambia solo la regla de servicio que la rodea, no la tabla) | BE-014 |
| BE-015 | **Permanece igual** | BE-015 |
| BE-016 | **Se modifica** (formaliza `M-5`) | BE-016 (`Transaction` + `PAYOFF_PAYMENT`) |
| BE-017 | **Permanece igual** | BE-017 |
| BE-018 | **Permanece igual** en `PaymentMethod`, se agrega tabla nueva al lado | BE-018 + BE-096 (`Autopay`, formaliza `M-6`) |
| BE-019 | **Permanece igual** | BE-019 |
| BE-020 | **Se modifica** | BE-020 (`AuditLog` — `lenderCompanyId`, acciones nuevas) |
| BE-021 | **Permanece igual** | BE-021 |
| BE-022 | **Permanece igual** (opcional, diferido a Fase 11) | BE-022 |
| BE-023 | **Se modifica** | BE-023 (seed — nuevas entidades) |

Ningún ticket original **se elimina** ni **se mueve a otra fase**. Ninguna tabla del plan anterior deja de existir; `LenderProfile` reduce su alcance de campos (no desaparece).

## 16.2 Orden de ejecución dentro de la fase

Sigue el orden de migración de [04 §... / 10.1](10-migraciones-y-seeders.md#101-orden-de-creación-de-tablas-una-migración-por-bloque-lógico-no-una-gigante):

```
BE-008 (User.role + isActive)
  │
BE-009 (LenderProfile) ── BE-090 (LenderCompany)
  │                            │
BE-010 (BorrowerProfile) ── BE-091 (LenderBorrower) ◄──┘
  │
BE-092 (BookkeeperProfile) ── BE-093 (LenderCompanyBookkeeper) ◄── BE-090
  │
BE-094 (InsuranceCompanyProfile)
  │
BE-095 (Property) ◄── BE-090
  │
BE-011 (Contract) ◄── BE-090, BE-095, BE-094
  │
BE-012 (ContractTerms) → BE-013 (ContractTermsAcceptance) → BE-014 (ContractBorrower)
  │
BE-015 (ScheduledPayment)
  │
BE-016 (Transaction) → BE-017 (TransactionAllocation)
  │
BE-018 (PaymentMethod) → BE-096 (Autopay)
  │
BE-019 (WebhookEvent)
  │
BE-020 (AuditLog) ◄── BE-090
  │
BE-021 (RefreshToken / PasswordResetToken / TwoFactorRecoveryCode)
  │
(BE-022 — opcional, diferido)
  │
BE-023 (Seed inicial)
```

---

## BE-008 — Enum `UserRole` (5 valores) + `User.role` + `User.isActive`

- **Objetivo**: base de toda la autorización posterior; incorpora los 2 roles nuevos del Product Board y separa activación de eliminación lógica.
- **Prioridad**: P0 · **Complejidad**: S · **Dependencias**: BE-001 (UUIDv7, ya hecho)
- **Estado respecto al plan anterior**: se modifica (el ticket original solo tenía 3 valores de rol y no tenía `isActive`).
- **Archivos afectados**: `prisma/schema.prisma`, `prisma/migrations/<ts>_add_user_role_and_active/migration.sql`.
- **Cambios de Prisma**: `enum UserRole { ADMIN LENDER BORROWER BOOKKEEPER INSURANCE_COMPANY }`; `User.role UserRole` (sin default, obligatorio explícito en cada `create()`); `User.isActive Boolean @default(true)`.
- **Cambios de migración**: `ALTER TABLE users ADD COLUMN role ...` requiere que la tabla esté vacía o se le asigne un valor a las filas existentes antes de forzar `NOT NULL` (hoy solo hay usuarios de prueba, sin impacto real — mismo caso que ya preveía el ticket original). `isActive` no necesita migración de datos (default `true` cubre las filas existentes).
- **Tests necesarios**: migración corre limpio contra `db-test`; `prisma.user.create()` sin `role` falla en tiempo de compilación (TS) y en runtime si se fuerza vía `any`; un usuario con `isActive=false` sigue siendo `SELECT`-eable (no lo oculta ningún filtro por defecto, a diferencia de `deletedAt`).
- **Criterios de aceptación**: `prisma studio` muestra `role` con los 5 valores y `isActive` con default `true`.
- **Riesgos**: ninguno nuevo — mismo perfil de riesgo que el ticket original (BD de desarrollo vacía).
- **Decisiones pendientes**: `D-P1-1` (¿`CPA`/`Title Company` entran al enum más adelante?) — no bloquea este ticket, ver riesgo #11 en [15](15-riesgos-y-decisiones-pendientes.md).

## BE-009 — Tabla `LenderProfile` (reducida)

- **Objetivo**: identidad de la persona Prestamista, separada de sus empresas.
- **Prioridad**: P0 · **Complejidad**: S · **Dependencias**: BE-008
- **Estado respecto al plan anterior**: se modifica — pierde `companyName`, dirección de negocio, `status`/`LenderStatus`, `stripeConnectedAccountId` (se van a BE-090). **Actualizado dos veces**: además, `createdByAdminId` pasó de obligatorio a opcional (`D-P1-10`) para soportar auto-registro.
- **Archivos afectados**: `prisma/schema.prisma`, migración.
- **Cambios de Prisma**: campos de [04 §4.3](04-base-de-datos.md#lenderprofile-existente--se-reduce-de-alcance) (`userId` único, `contactPhone?`, `createdByAdminId?` — **opcional**, `notes?`, `deletedAt?`).
- **Cambios de migración**: implementado en dos migraciones — `20260904204328_phase1_database_model` (creación de la tabla, `createdByAdminId` todavía obligatorio) y `20260904234340_lender_profile_self_registration` (`ALTER COLUMN "createdByAdminId" DROP NOT NULL` + recrea la FK con `ON DELETE SET NULL`, al confirmarse `D-P1-10` después de la primera pasada de implementación).
- **Tests necesarios**: `@@unique([userId])` se respeta; se puede crear un `LenderProfile` con `createdByAdminId: null` (auto-registro, `D-P1-10`) — cubierto en `src/db/phase1-identity.integration.test.ts`.
- **Criterios de aceptación**: migración aplica sin error contra `db-test`; el seed (`BE-023`) incluye un Prestamista auto-registrado (`lender3@paymyloan.dev`) como ejemplo navegable.
- **Riesgos**: ninguno.
- **Decisiones pendientes**: riesgos #20/#21 (aprobación/KYC del auto-registro, orden del formulario) — ver [15](15-riesgos-y-decisiones-pendientes.md).

## BE-090 — Tabla `LenderCompany` (nueva)

- **Objetivo**: modelar el tenant real — la entidad que efectivamente presta el dinero, de la que un `LenderProfile` puede poseer varias.
- **Prioridad**: P0 · **Complejidad**: M · **Dependencias**: BE-009
- **Estado**: nueva (formaliza `D-P1-3`, y reubica aquí el delta `M-4` — `isOpenToDeals` — que `IMPLEMENTATION_PROGRESS.md` había anotado sobre `LenderProfile`).
- **Archivos afectados**: `prisma/schema.prisma`, migración.
- **Cambios de Prisma**: `enum LenderCompanyStatus { ACTIVE SUSPENDED }`; tabla con campos de [04 §4.3](04-base-de-datos.md#lendercompany-nueva--es-el-tenant-real) — `lenderProfileId` (FK, no único), `companyName`, `ein` (único), dirección de negocio (`addressLine1/city/state/postalCode` requeridos, `addressLine2` opcional), `isOpenToDeals Boolean @default(true)`, `status LenderCompanyStatus @default(ACTIVE)`, `stripeConnectedAccountId?`, `createdByUserId`, `notes?`, `deletedAt?`.
- **Cambios de migración**: creación de tabla + índice único en `ein` + índices `[lenderProfileId]`, `[status]`.
- **Tests necesarios**: un mismo `lenderProfileId` puede tener 2+ filas en `LenderCompany` (a diferencia de `LenderProfile.userId`, que es único); `ein` duplicado → constraint violation; borrar (soft) una `LenderCompany` con `Contract` en `ACTIVE`/`DELINQUENT` está bloqueado — **regla de servicio, se testea en Fase 4, aquí solo se documenta el constraint que la tabla no impide a nivel de FK** (Prisma no puede expresar esa condición en el schema).
- **Criterios de aceptación**: se puede crear 2 `LenderCompany` para el mismo `LenderProfile` en `prisma studio`, cada una con su propio `ein`.
- **Riesgos**: `ein` único a nivel de plataforma puede rechazar un caso legítimo de "misma empresa, dos socios" — ver riesgo #13/#14 en [15](15-riesgos-y-decisiones-pendientes.md). No se resuelve en este ticket.
- **Decisiones pendientes**: `D-P1-3` (impacto en `withTenantScope`, fuera de esta fase), riesgos #13/#14.

## BE-010 — Tabla `BorrowerProfile` (sin `lenderId`)

- **Objetivo**: identidad del Deudor a nivel de plataforma, ya no atada a un único prestamista.
- **Prioridad**: P0 · **Complejidad**: M · **Dependencias**: BE-008
- **Estado respecto al plan anterior**: se modifica — el ticket original dependía de BE-009 y forzaba `lenderId NOT NULL`; ahora depende solo de BE-008 (`User`) y no tiene `lenderId` en absoluto.
- **Archivos afectados**: `prisma/schema.prisma`, migración.
- **Cambios de Prisma**: campos de [04 §4.3](04-base-de-datos.md#borrowerprofile-existente--pasa-a-ser-a-nivel-de-plataforma) — `userId` único, `phone?`, dirección personal opcional, `createdByUserId?` (nulo permitido — auto-registro confirmado, `D-P1-10`), `deletedAt?`. **Sin** `notes` (se movió a BE-091) y **sin** `lenderId`.
- **Cambios de migración**: creación limpia (no hay datos previos que migrar en este repo).
- **Tests necesarios**: no se puede crear un `BorrowerProfile` con un `lenderId` — el campo directamente no existe, por lo que cualquier intento de enviarlo es ignorado por Prisma Client (test que confirma que el campo no forma parte del tipo generado).
- **Criterios de aceptación**: tabla creada sin FK a `LenderCompany`/`LenderProfile`.
- **Riesgos**: ninguno propio de esta tabla — el riesgo de aislamiento entre tenants se mitiga en BE-091, no aquí.
- **Decisiones pendientes**: riesgo #19 (¿`BorrowerProfile` debe representar una LLC además de la persona?).

## BE-091 — Tabla `LenderBorrower` (nueva — formaliza `M-1`)

- **Objetivo**: vínculo N:M entre `LenderCompany` y `BorrowerProfile` — reemplaza la relación 1:N que existía antes vía `BorrowerProfile.lenderId`.
- **Prioridad**: P0 · **Complejidad**: M · **Dependencias**: BE-090, BE-010
- **Estado**: nueva (formaliza `C-1`/`M-1` de [IMPLEMENTATION_PROGRESS.md](../IMPLEMENTATION_PROGRESS.md), que ya estaba decidido pero nunca se había traducido a un ticket de Fase 1 concreto).
- **Archivos afectados**: `prisma/schema.prisma`, migración.
- **Cambios de Prisma**: `enum TenantLinkStatus { ACTIVE REMOVED }`; tabla con `lenderCompanyId`, `borrowerProfileId`, `status TenantLinkStatus @default(ACTIVE)`, `notes?` (aquí, no en `BorrowerProfile` — `D-P1-9`), `invitedByUserId`, `createdAt`, `removedAt?`.
- **Cambios de migración**: `@@unique([lenderCompanyId, borrowerProfileId])`; índice `[borrowerProfileId]` (para resolver "todos los prestamistas de este deudor").
- **Tests necesarios**: el mismo par `(lenderCompanyId, borrowerProfileId)` no se puede insertar dos veces (constraint único); un mismo `borrowerProfileId` sí puede tener filas con 2+ `lenderCompanyId` distintos (caso central que motiva esta tabla); "quitar" un vínculo (`removedAt` + `status=REMOVED`) no borra la fila ni el `BorrowerProfile`.
- **Criterios de aceptación**: se puede vincular un mismo deudor de prueba a 2 empresas prestamistas distintas del seed sin error.
- **Riesgos**: ninguno nuevo — mismo perfil que cualquier tabla puente.
- **Decisiones pendientes**: ninguna directa (la pregunta de quién invita — Lender vs Admin — es de Fase 4/5, no de esta tabla).

## BE-092 — Tabla `BookkeeperProfile` (nueva)

- **Objetivo**: identidad del rol Bookkeeper.
- **Prioridad**: P1 · **Complejidad**: S · **Dependencias**: BE-008
- **Estado**: nueva (formaliza `D-P1-6`).
- **Archivos afectados**: `prisma/schema.prisma`, migración.
- **Cambios de Prisma**: campos de [04 §4.3](04-base-de-datos.md#bookkeeperprofile-nueva) — `userId` único, `phone?`, `createdByUserId`, `notes?`, `deletedAt?`.
- **Cambios de migración**: creación de tabla simple, sin FK a `LenderCompany` (esa relación vive en BE-093).
- **Tests necesarios**: `@@unique([userId])`.
- **Criterios de aceptación**: tabla creada, sin dependencia de `LenderCompany`.
- **Riesgos**: ninguno.
- **Decisiones pendientes**: riesgo #12 (¿quién puede crear un Bookkeeper — Admin, Lender, o ambos?) — no bloquea el schema, sí a los endpoints de Fase 4/5.

## BE-093 — Tabla `LenderCompanyBookkeeper` (nueva)

- **Objetivo**: vínculo N:M entre `LenderCompany` y `BookkeeperProfile`, mismo patrón que BE-091.
- **Prioridad**: P1 · **Complejidad**: S · **Dependencias**: BE-090, BE-092
- **Estado**: nueva.
- **Archivos afectados**: `prisma/schema.prisma`, migración.
- **Cambios de Prisma**: tabla con `lenderCompanyId`, `bookkeeperProfileId`, `status TenantLinkStatus @default(ACTIVE)` (reutiliza el enum de BE-091, no crea uno nuevo), `invitedByUserId`, `createdAt`, `removedAt?`.
- **Cambios de migración**: `@@unique([lenderCompanyId, bookkeeperProfileId])`; índice `[bookkeeperProfileId]`.
- **Tests necesarios**: mismos que BE-091, adaptados a Bookkeeper.
- **Criterios de aceptación**: se puede vincular un mismo Bookkeeper de prueba a 2 empresas del seed.
- **Riesgos**: ninguno.
- **Decisiones pendientes**: ninguna directa — la regla "Bookkeeper no decide préstamos" es de autorización (Fase 3), no de esta tabla; se documenta en [04 §4.6](04-base-de-datos.md#46-reglas-de-negocio-a-nivel-de-datos) regla 14 para que quede visible, no se implementa aquí.

## BE-094 — Tabla `InsuranceCompanyProfile` (nueva)

- **Objetivo**: identidad del rol Insurance Company, como directorio de plataforma.
- **Prioridad**: P1 · **Complejidad**: S · **Dependencias**: BE-008
- **Estado**: nueva (formaliza `D-P1-7`).
- **Archivos afectados**: `prisma/schema.prisma`, migración.
- **Cambios de Prisma**: campos de [04 §4.3](04-base-de-datos.md#insurancecompanyprofile-nueva--directorio-de-plataforma-no-tenant-scoped) — `userId` único, `companyName`, `contactPhone?`, `licenseNumber?`, `createdByAdminId`, `notes?`, `deletedAt?`.
- **Cambios de migración**: creación de tabla simple, **sin** FK a `LenderCompany` (a propósito — no es tenant-scoped).
- **Tests necesarios**: `@@unique([userId])`.
- **Criterios de aceptación**: tabla creada, visible/consultable sin filtrar por tenant.
- **Riesgos**: ninguno.
- **Decisiones pendientes**: riesgo #16 (`licenseNumber`, campo propuesto sin confirmar).

## BE-095 — Tabla `Property` (nueva — formaliza `D-P1-5`)

- **Objetivo**: modelar la propiedad en garantía como entidad propia, separada de `Contract`; revierte la decisión `A-4` del plan anterior.
- **Prioridad**: P0 · **Complejidad**: M · **Dependencias**: BE-090
- **Estado**: nueva.
- **Archivos afectados**: `prisma/schema.prisma`, migración.
- **Cambios de Prisma**: `PropertyType` se **mueve** aquí desde donde iba a vivir en `Contract` (mismos 7 valores, sin cambio); tabla con los campos de [04 §4.3](04-base-de-datos.md#property-nueva) — dirección, `propertyType`, `bedrooms?`/`bathrooms?`/`squareFootage?`/`lotSize?`/`yearBuilt?`, `conditionScale?`, `estimatedRepairCost?`, `estimatedMarketValue?`, `afterRepairValue?`, `lastSalePrice?`/`lastSaleDate?`, `annualPropertyTax?`, `annualInsuranceEstimate?`, `createdByUserId`, `lenderCompanyId`, `deletedAt?`.
- **Cambios de migración**: creación de tabla + índices `[lenderCompanyId]`, `[createdByUserId]`. Todos los campos de valuation/ARV/taxes son `nullable` — no requiere backfill.
- **Tests necesarios**: se puede crear una `Property` sin ningún campo de valuation (todos opcionales, solo dirección + `propertyType` son obligatorios); `deletedAt` no se puede setear si existe un `Contract` no `CANCELLED` que la referencia — **regla de servicio, se testea junto con BE-011, aquí solo se confirma que el schema no la impide por sí solo**.
- **Criterios de aceptación**: `prisma studio` permite crear una `Property` de prueba con solo los campos obligatorios.
- **Riesgos**: los campos de ARV/valuation quedan sin fuente de dato automatizada (riesgo #15) — aceptado para esta fase, son de carga manual.
- **Decisiones pendientes**: riesgo #15 (fuente de datos de valuation — manual vs. API tipo RentCast).

## BE-011 — Enums de contrato + tabla `Contract` (modificada)

- **Objetivo**: identidad y ciclo de vida del contrato, ahora referenciando `LenderCompany`/`Property`/`InsuranceCompanyProfile` en vez de dirección embebida y `LenderProfile`.
- **Prioridad**: P0 · **Complejidad**: M · **Dependencias**: BE-090, BE-095, BE-094
- **Estado respecto al plan anterior**: se modifica — mismo propósito, distintas FKs y sin los 8 campos de dirección embebidos.
- **Archivos afectados**: `prisma/schema.prisma`, migración.
- **Cambios de Prisma**: enums `ContractStatus`, `ContractTermsStatus`, `AcceptanceDecision`, `LoanStructure`, `DayCountConvention`, `LateFeeType` sin cambios; `Contract.lenderId` → `Contract.lenderCompanyId` (FK a `LenderCompany`); se agregan `propertyId` (FK obligatoria a `Property`) e `insuranceCompanyId` (FK opcional a `InsuranceCompanyProfile`); se eliminan `addressLine1/2`, `city`, `state`, `postalCode`, `county`, `propertyType`, `parcelNumber` (migran a `Property`, BE-095).
- **Cambios de migración**: sin la FK circular `currentTermsId` todavía resuelta (se agrega en BE-012 con `ALTER`, patrón estándar de Prisma para referencias mutuas).
- **Tests necesarios**: `contractNumber` único se respeta; no se puede crear un `Contract` sin `propertyId`; `insuranceCompanyId` acepta `null`.
- **Criterios de aceptación**: tabla creada, sin FK circular rota, sin ningún campo de dirección propio.
- **Riesgos**: ninguno nuevo respecto al ticket original más allá de los ya cubiertos por BE-095/BE-090.
- **Decisiones pendientes**: ninguna directa sobre esta tabla puntual.

## BE-012 — Tabla `ContractTerms` + resolver FK circular con `Contract.currentTermsId`

- **Estado**: **permanece igual** — sin cambios respecto al ticket original.
- **Prioridad/Complejidad/Dependencias**: P0 / M / BE-011
- Resto del ticket: sin cambios, ver [04 §4.3](04-base-de-datos.md#contractterms-contracttermsacceptance-contractborrower).

## BE-013 — Tabla `ContractTermsAcceptance`

- **Estado**: **permanece igual**.
- **Prioridad/Complejidad/Dependencias**: P0 / S / BE-010, BE-012
- Sin cambios.

## BE-014 — Tabla `ContractBorrower`

- **Estado**: **permanece igual** en estructura. Cambia únicamente la regla de servicio que la rodea (Fase 6, fuera de esta tabla): la verificación "`borrowerProfile` y `contract` pertenecen al mismo tenant" pasa de comparar `BorrowerProfile.lenderId === Contract.lenderId` (campo que ya no existe) a `EXISTS(LenderBorrower WHERE lenderCompanyId = contract.lenderCompanyId AND borrowerProfileId = ... AND status = 'ACTIVE')`.
- **Prioridad/Complejidad/Dependencias**: P0 / S / BE-010, BE-011
- **Nota para Fase 6** (no se implementa aquí): esta es la regla de servicio que reemplaza a la anterior; se deja anotada para que no se pierda al llegar a esa fase.

## BE-015 — Enums de pago + tabla `ScheduledPayment`

- **Estado**: **permanece igual**.
- **Prioridad/Complejidad/Dependencias**: P1 / M / BE-012

## BE-016 — Tabla `Transaction` (modificada — formaliza `M-5`)

- **Objetivo**: sin cambio de propósito; se repone `TransactionType.PAYOFF_PAYMENT`, eliminado en el plan anterior y restituido como delta `M-5` que nunca se había aplicado al backlog formal.
- **Prioridad/Complejidad/Dependencias**: P1 / M / BE-011
- **Archivos afectados**: `prisma/schema.prisma`, migración.
- **Cambios de Prisma**: `enum TransactionType { SCHEDULED_PAYMENT PRINCIPAL_PREPAYMENT PAYOFF_PAYMENT LATE_FEE_PAYMENT REFUND ADJUSTMENT }` — un valor más que el plan anterior.
- **Tests necesarios**: los mismos del ticket original (`stripePaymentIntentId` único permite múltiples `null`), más: se puede crear una `Transaction` con `type=PAYOFF_PAYMENT`.
- **Criterios de aceptación**: igual al original.
- **Riesgos**: ninguno — es un valor de enum adicional, no un cambio estructural.
- **Decisiones pendientes**: ninguna.

## BE-017 — Tabla `TransactionAllocation`

- **Estado**: **permanece igual**.
- **Prioridad/Complejidad/Dependencias**: P1 / S / BE-015, BE-016

## BE-018 — Tabla `PaymentMethod`

- **Estado**: **permanece igual** en su propia estructura (sin cambios de campos respecto al plan anterior). Se agrega una tabla nueva relacionada al lado — ver BE-096.
- **Prioridad/Complejidad/Dependencias**: P1 / S / BE-008

## BE-096 — Tablas/enums `Autopay` (nueva — formaliza `M-6`, sin activar)

- **Objetivo**: modelar el cobro recurrente sin activarlo — decisión `A-2` sigue vigente (el alcance no confirma que el MVP lo requiera).
- **Prioridad**: P3 · **Complejidad**: M · **Dependencias**: BE-011, BE-018
- **Estado**: nueva (formaliza el delta `M-6` de [IMPLEMENTATION_PROGRESS.md](../IMPLEMENTATION_PROGRESS.md)).
- **Archivos afectados**: `prisma/schema.prisma`, migración.
- **Cambios de Prisma**: `enum AutopayStatus { ACTIVE PAUSED CANCELLED }`, `enum AutopayAmountType { SCHEDULED_AMOUNT_DUE FIXED_AMOUNT }`; tabla `Autopay` con campos de [04 §4.3](04-base-de-datos.md#paymentmethod-sin-cambios-de-forma--autopay-nueva-sin-activar).
- **Cambios de migración**: `@@unique([contractId, borrowerProfileId])`.
- **Tests necesarios**: la tabla acepta inserción manual de prueba; ningún servicio la referencia todavía (verificación negativa: no debe existir ningún import de `prisma.autopay` fuera de tests en esta fase).
- **Criterios de aceptación**: tabla creada, sin ningún endpoint ni job que la use — existe solo como schema.
- **Riesgos**: ninguno — tabla sin tráfico.
- **Decisiones pendientes**: si el MVP termina necesitando autopay activo, es trabajo de una fase posterior (no de este ticket).

## BE-019 — Tabla `WebhookEvent`

- **Estado**: **permanece igual**.
- **Prioridad/Complejidad/Dependencias**: P1 / S / ninguna adicional

## BE-020 — Tabla `AuditLog` (modificada)

- **Objetivo**: sin cambio de propósito; ajusta la clave de tenant y amplía la lista de eventos mínimos a auditar con las entidades nuevas de esta fase.
- **Prioridad/Complejidad/Dependencias**: P0 / M / BE-090
- **Archivos afectados**: `prisma/schema.prisma`, migración, `src/lib/audit.ts` (helper `logAuditEvent()`, incluido en este mismo ticket como en el plan original).
- **Cambios de Prisma**: `AuditLog.lenderId` → `AuditLog.lenderCompanyId` (FK a `LenderCompany`, `onDelete: SetNull`); se agrega `contractId` (FK opcional a `Contract`, `onDelete: SetNull`) — cierra una inconsistencia del plan original entre el ERD (que ya mostraba `Contract ↔ AuditLog`) y esta tabla de campos, que nunca lo había listado.
- **Tests necesarios**: los del ticket original (insertar y verificar que no tiene `updatedAt`), más: `lenderCompanyId` acepta `null` (eventos sin contexto de empresa, ej. `USER_ACTIVATED` sobre un Admin).
- **Criterios de aceptación**: igual al original.
- **Riesgos**: ninguno.
- **Decisiones pendientes**: ninguna — la lista de acciones nuevas está en [04 §4.3](04-base-de-datos.md#auditlog-modificada), es de referencia para Fase 4/5/6, no bloquea este ticket.

## BE-021 — Tablas `RefreshToken`, `PasswordResetToken`, `TwoFactorRecoveryCode`

- **Estado**: **permanece igual**.
- **Prioridad/Complejidad/Dependencias**: P0 / M / BE-008

## BE-022 — (Opcional/fase 2) Tabla `Document`

- **Estado**: **permanece igual** — sigue diferido, absorbido por la futura Fase 11 (Documentos), no forma parte del roadmap mínimo.
- **Prioridad/Complejidad/Dependencias**: P3 / M / BE-011

## BE-023 — Seed inicial (modificado)

- **Objetivo**: mismo propósito — poder probar el backend end-to-end tras la fase — ampliado para cubrir las entidades nuevas.
- **Prioridad/Complejidad/Dependencias**: P0 / M / BE-090, BE-091, BE-095, BE-011, BE-012
- **Archivos afectados**: `prisma/seed.ts`, `prisma/seed-data.json` (si se opta por externalizar datos de prueba, como ya hace el seed de blog).
- **Implementación**: ver [10.2 Seeders](10-migraciones-y-seeders.md#102-seeders) actualizado — Admin, 3 `LenderProfile` (dos dados de alta por el Admin, uno auto-registrado sin Admin — `D-P1-10`) con 1–2 `LenderCompany` cada uno, 3 `BorrowerProfile` (los 3 auto-registrados; uno vinculado a 2 empresas), 1 `BookkeeperProfile`, 1 `InsuranceCompanyProfile`, 3 `Property`, 2 `Contract` de ejemplo.
- **Tests necesarios**: `pnpm run db:seed` corre limpio dos veces seguidas (idempotente); tras el seed, existe al menos un `BorrowerProfile` con 2 filas `ACTIVE` en `LenderBorrower` apuntando a `LenderCompany` distintas (verifica que el caso multi-lender quedó cubierto desde el primer día), y al menos un `LenderProfile` con `createdByAdminId = null` (verifica el caso de auto-registro, `D-P1-10`).
- **Criterios de aceptación**: tras el seed, se puede hacer login con el Admin de desarrollo y ver al menos un contrato de ejemplo con su `Property` asociada vía API (cuando exista el endpoint, Fase 6 — para esta fase el criterio se verifica vía `prisma studio`/query directa).
- **Riesgos**: ninguno nuevo.
- **Decisiones pendientes**: ninguna.

---

[← Índice del plan](README.md)  ·  [Anterior: 15. Riesgos y decisiones pendientes](15-riesgos-y-decisiones-pendientes.md)
