# PayMyLoan Backend — Progreso de ejecución

Checklist de seguimiento del [plan aprobado](plan/) + deltas del
[Product Board](PML%20—%20PayMyLoan.ai%20Product%20Board.pdf) del 3 sep 2026.
Se va marcando a medida que se completa cada fase — no es el plan en sí, es el
estado de avance.

Leyenda: ✅ hecho y verificado · 🚧 en progreso · ⬜ pendiente

---

## Decisiones que reescriben el plan original

| # | Decisión | Efecto |
|---|---|---|
| C-1 | Deudor a nivel plataforma, no atado a un solo prestamista | Se quita `lenderId` de `BorrowerProfile`; entra tabla puente `LenderBorrower` |
| C-2 | Alcance = backlog completo + Core Features del board | Se agregan payoff, documentos/PDF, rating PML, alta propia del deudor. "Coming Soon" del board queda fuera de esta ronda |
| C-3 | Autopay se modela en el schema, no se activa | Tabla y enums entran ahora; el cobro recurrente queda bloqueado por la decisión de Stripe Connect |
| C-4 | 2026-09-04: nuevo contexto funcional de Spencer + Product Board — roles `BOOKKEEPER`/`INSURANCE_COMPANY`, tenant real = `LenderCompany` (no `LenderProfile`), entidad `Property`, `User.isActive` | `C-1`/`M-1`/`M-4`/`M-5`/`M-6` (abajo) quedan **formalizados** dentro del plan base — ver [00. Decisiones 2026-09-04](plan/00-contradicciones-y-decisiones.md#decisiones-2026-09-04-ronda-fase-1) y el backlog reescrito en [16. Fase 1 — plan actualizado](plan/16-fase-1-actualizada.md) |

Ver detalle completo en el plan aprobado y, para la ronda 2026-09-04, en [16. Fase 1 — plan actualizado](plan/16-fase-1-actualizada.md).

---

## ✅ Fase 0 — Foundation (completa, verificada)

| # | Ítem | Notas |
|---|---|---|
| ✅ BE-001 | UUIDv7 como estrategia de IDs | Postgres 16→18, `User.id` con `dbgenerated("uuidv7()")`. **Hallazgo no previsto en el plan:** Postgres 18 cambió la convención de volumen (`/var/lib/postgresql`, ya no `.../data`) — corregido en ambos `docker-compose*.yml`. Verificado con test de integración real. |
| ✅ BE-002 | Validación fail-fast de entorno | `env.ts` corta el proceso si faltan `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET`/`DATABASE_URL` en producción. **Dos hallazgos:** (1) `next build` fuerza `NODE_ENV=production`, hubo que distinguir la fase de build (`PHASE_PRODUCTION_BUILD`); (2) un `throw` no tumbaba el proceso (Next lo atrapaba y el contenedor quedaba "Up" sirviendo 500 en bucle) — se forzó `process.exit(1)`. Verificado arrancando la imagen `runner` con y sin secretos. |
| ✅ BE-003 | CORS | `src/middlewares/cors.ts` + `src/proxy.ts`, restringido a `CORS_ORIGIN`. |
| ✅ BE-004 | Logger estructurado + requestId | `src/lib/logger.ts`, propagado por `src/proxy.ts` y logueado en `errorHandler.ts`. |
| ✅ BE-005 | Rate limiting (primitiva) | `src/middlewares/rateLimit.ts`, en memoria por proceso. Falta conectarlo a endpoints reales (Fase 2, aún no existen). |
| ✅ BE-006 | Cliente de correo transaccional | `src/lib/email.ts`, `sendEmail()` agnóstico de proveedor (Resend como placeholder — proveedor real sigue sin confirmar). |
| ✅ BE-007 | Reestructura de carpetas | `src/auth/`, `src/repositories/`, `src/jobs/` creadas (vacías, con README). |
| ✅ — | Entorno de testing (adelantado de Fase 8) | `vitest` unit + integración, servicio `db-test` en `docker-compose.dev.yml`. 14 tests unitarios + 1 de integración, todos verdes. |

**Verificado end-to-end:** `type-check`, `lint`, build de `dev` y `runner`, camino dorado por `curl` (health, CORS permitido/rechazado, alta/listado/borrado de usuario con `id` UUIDv7 real).

---

## ✅ Fase 1 — Database (completa, verificada)

> **Backlog reescrito 2026-09-04** — implementado contra el plan vigente en [16. Fase 1 — plan actualizado](plan/16-fase-1-actualizada.md), no el original de [fases/fase-01-database.md](plan/fases/fase-01-database.md) (histórico). Los deltas `M-1`, `M-4`, `M-5`, `M-6` ya no son notas sueltas — cada uno tuvo ticket propio, todos aplicados en la misma migración `20260904204328_phase1_database_model` (decisión de implementación: una migración cohesiva para toda la fase en vez de 19 micro-migraciones — dev-only, sin consumidores externos entre pasos, riesgo bajo).
>
> **Ajuste posterior el mismo día (`D-P1-10`)**: Spencer aclaró que `LENDER` y `BORROWER` pueden auto-registrarse (adicional a los flujos existentes, no en reemplazo — ver [00](plan/00-contradicciones-y-decisiones.md#decisiones-2026-09-04-ronda-fase-1)). Esto forzó `LenderProfile.createdByAdminId` de obligatorio a opcional, aplicado en una segunda migración: `20260904234340_lender_profile_self_registration`.

| # | Ítem | Notas |
|---|---|---|
| ✅ BE-008 | Enum `UserRole` (5 valores: + `BOOKKEEPER`, `INSURANCE_COMPANY`) + `User.role` + `User.isActive` | Fila de prueba `fase0@example.com` sin `role` se eliminó antes de migrar (dato descartable de la Fase 0). `createUserSchema`/`users.service.ts` actualizados para exigir `role` — sin esto el endpoint `POST /api/users` existente hubiera roto el build. |
| ✅ BE-009 | Tabla `LenderProfile` (reducida — identidad de la persona) | `createdByAdminId` es opcional (`D-P1-10`) — nulo cuando el Prestamista se auto-registra. |
| ✅ BE-090 | Tabla `LenderCompany` (el tenant real; `ein` único + M-4 `isOpenToDeals`) | |
| ✅ BE-010 | Tabla `BorrowerProfile` (**sin** `lenderId` — plataforma, ver M-1) | |
| ✅ BE-091 | Tabla `LenderBorrower` (N:M, formaliza M-1) | |
| ✅ BE-092 | Tabla `BookkeeperProfile` | |
| ✅ BE-093 | Tabla `LenderCompanyBookkeeper` (N:M) | |
| ✅ BE-094 | Tabla `InsuranceCompanyProfile` (directorio de plataforma) | |
| ✅ BE-095 | Tabla `Property` (dirección + ARV/valuation/taxes — revierte A-4) | Campos de valuation modelados sobre el precedente de `Owner/app/api/analyze/route.ts`, todos `nullable`/carga manual. |
| ✅ BE-011 | Enums de contrato + tabla `Contract` (`lenderCompanyId`, `propertyId`, `insuranceCompanyId`) | |
| ✅ BE-012 | Tabla `ContractTerms` + FK circular `Contract.currentTermsId` | Prisma resolvió la referencia circular automáticamente (crea ambas tablas, agrega el `ALTER TABLE ... ADD CONSTRAINT` al final de la misma migración) — verificado en el SQL generado. |
| ✅ BE-013 | Tabla `ContractTermsAcceptance` | |
| ✅ BE-014 | Tabla `ContractBorrower` | |
| ✅ BE-015 | Enums de pago + tabla `ScheduledPayment` | |
| ✅ BE-016 | Tabla `Transaction` (+ M-5: repuesto `TransactionType.PAYOFF_PAYMENT`) | |
| ✅ BE-017 | Tabla `TransactionAllocation` | |
| ✅ BE-018 | Tabla `PaymentMethod` | |
| ✅ BE-096 | Tabla `Autopay` y sus enums, sin activar (formaliza M-6) | Ningún servicio la referencia todavía, por diseño. |
| ✅ BE-019 | Tabla `WebhookEvent` | |
| ✅ BE-020 | Tabla `AuditLog` (`lenderCompanyId` + `contractId` + acciones nuevas) + helper `logAuditEvent()` en `src/lib/audit.ts` | Se agregó `contractId` a `AuditLog`: el ERD de `04-base-de-datos.md` ya mostraba la relación `Contract ↔ AuditLog` pero la tabla de campos nunca la había listado — inconsistencia heredada del plan original, corregida durante la implementación. |
| ✅ BE-021 | Tablas `RefreshToken`, `PasswordResetToken`, `TwoFactorRecoveryCode` | |
| ⬜ BE-022 | Tabla `Document` (opcional) | Diferida a Fase 11, según lo planeado — no implementada. |
| ✅ BE-023 | Seed inicial (`prisma/seed.ts`, `pnpm run db:seed`) | Admin + 3 Lenders (uno con 2 `LenderCompany`, una `isOpenToDeals=false`; uno auto-registrado sin Admin — `lender3@paymyloan.dev`, `D-P1-10`) + 3 Borrowers auto-registrados (uno vinculado a 2 lenders) + 1 Bookkeeper + 1 Insurance Company + 3 `Property` + 2 `Contract` (`DRAFT` y `ACTIVE` con calendario simplificado, `Transaction`+`TransactionAllocation` de ejemplo). Idempotente: corrido dos veces seguidas, la segunda detecta el admin existente y no repite nada. |

**Verificado end-to-end:** `type-check`, `lint`, 14 tests unitarios + 32 de integración (contra Postgres real en `db-test`, nunca mocks — cubren unicidad de `role`/`ein`/`contractNumber`/tokens, el vínculo N:M multi-lender de `LenderBorrower`/`LenderCompanyBookkeeper`, `LenderProfile.createdByAdminId` nulo (auto-registro, `D-P1-10`), la FK circular `Contract.currentTermsId`, `Transaction.type=PAYOFF_PAYMENT`, `AuditLog` sin `updatedAt`, y `logAuditEvent()`), seed corrido dos veces contra la base de desarrollo, y camino dorado por `curl` contra el contenedor `api` real (`POST /api/users` rechaza sin `role`, acepta con `role` y devuelve `role`/`isActive` en la respuesta).

Detalle ticket por ticket (objetivo, Prisma, migración, tests, criterios de aceptación, riesgos, decisiones pendientes) en [16. Fase 1 — plan actualizado](plan/16-fase-1-actualizada.md).

---

## ⬜ Fase 2 — Auth

| # | Ítem |
|---|---|
| ⬜ BE-024 | `src/auth/password.ts` (bcrypt) |
| ⬜ BE-025 | `src/auth/jwt.ts` (access + refresh) |
| ⬜ BE-026 | `src/auth/totp.ts` (2FA) |
| ⬜ BE-027 | `POST /api/auth/login` |
| ⬜ BE-028 | `POST /api/auth/login/2fa` |
| ⬜ BE-029 | `POST /api/auth/refresh` |
| ⬜ BE-030 | `POST /api/auth/logout` y `/logout-all` |
| ⬜ BE-031 | `GET /api/auth/me` |
| ⬜ BE-032 | `POST /api/auth/password/forgot` y `/reset` |
| ⬜ BE-033 | `POST /api/auth/2fa/setup` y `/verify` |
| ⬜ BE-034 | `POST /api/auth/2fa/disable` y `/recovery-codes` |
| ⬜ PB-013 | `POST /api/auth/register` (alta propia del deudor, rol BORROWER) |

---

## ⬜ Fase 3 — Authorization

| # | Ítem |
|---|---|
| ⬜ BE-035 | Middleware `withAuth` |
| ⬜ BE-036 | Middleware `withRole` (incluye 2FA obligatorio) |
| ⬜ BE-037 | Middleware `withTenantScope` |
| ⬜ BE-038 | Helper `requireContractAccess` (+ M-2: `requireBorrowerAccess`) |
| ⬜ BE-039 | Auditoría automática de accesos denegados |

---

## ⬜ Fase 4 — Admin / Lenders

| # | Ítem |
|---|---|
| ⬜ BE-040 | `POST /api/admin/lenders` |
| ⬜ BE-041 | `GET /api/admin/lenders` (lista + búsqueda) |
| ⬜ BE-042 | `GET /api/admin/lenders/:id` |
| ⬜ BE-043 | `PATCH /api/admin/lenders/:id` |
| ⬜ BE-044 | `DELETE /api/admin/lenders/:id` |

## ⬜ Fase 5 — Borrowers

| # | Ítem |
|---|---|
| ⬜ BE-045 | `POST /api/lenders/me/borrowers` (+ M-3: invitar deudor ya existente en la plataforma) |
| ⬜ BE-046 | `GET /api/lenders/me/borrowers` |
| ⬜ BE-047 | `GET /api/lenders/me/borrowers/:id` |
| ⬜ BE-048 | `PATCH /api/lenders/me/borrowers/:id` |
| ⬜ BE-049 | `DELETE /api/lenders/me/borrowers/:id` (+ M-3: solo quita el vínculo, no el perfil) |
| ⬜ BE-050 | `GET/PATCH /api/borrowers/me`, `POST /api/borrowers/me/password` |

## ⬜ Fase 6 — Contracts

| # | Ítem |
|---|---|
| ⬜ BE-051 | `POST /api/contracts` |
| ⬜ BE-052 | `GET /api/contracts` (lista + filtros) |
| ⬜ BE-053 | `GET /api/contracts/:id` |
| ⬜ BE-054 | `PATCH /api/contracts/:id` |
| ⬜ BE-055 | `DELETE /api/contracts/:id` |
| ⬜ BE-056 | `POST /api/contracts/:id/cancel` |
| ⬜ BE-057 | `POST/DELETE /api/contracts/:id/borrowers` |
| ⬜ BE-058 | Servicio de amortización (PMT, interest-only, balloon, interés devengado) |
| ⬜ BE-059 | Servicio `generateAmortizationSchedule` + activación automática |
| ⬜ BE-060 | `POST /api/contracts/:id/terms` (proponer + submit) |
| ⬜ BE-061 | `POST /api/contracts/:id/terms/:termsId/accept` y `/reject` |
| ⬜ BE-062 | `GET /api/contracts/:id/schedule` y `/balance` |
| ⬜ BE-063 | Job `recomputeContractDelinquencyStatus` |
| ⬜ BE-064 | Job `assessLateFee` |

## ⬜ Fase 7 — Pagos manuales

| # | Ítem |
|---|---|
| ⬜ BE-067 | `POST /api/contracts/:id/payments/manual` |
| ⬜ BE-068 | Servicio `calculatePaymentAllocation` + `applyTransaction` (waterfall) |
| ⬜ BE-069 | `GET /api/contracts/:id/transactions` y `GET /api/transactions/:id` |
| ⬜ BE-071 | Servicio `reverseTransaction` + `POST /api/transactions/:id/reverse` |
| ⬜ BE-072 | `GET /api/audit-logs` |
| 🔒 BE-065/066/070 | Stripe (SetupIntent, ACH del deudor, webhook) — **bloqueado por decisión Connect vs cuenta única** |

---

## ⬜ Fase 11 — Documentos y generación de PDF

| # | Ítem |
|---|---|
| ⬜ PB-001 | Motor de PDF (`src/lib/pdf.ts`) — pendiente decisión: Chromium en imagen vs API externa |
| ⬜ PB-002 | Tabla `Document` + storage S3 privado + URLs firmadas |
| ⬜ PB-003 | Commitment letter (la aceptación en plataforma es la firma) |
| ⬜ PB-004 | Envío del documento por correo a las partes |

## ⬜ Fase 12 — Payoff request

| # | Ítem |
|---|---|
| ⬜ PB-005 | Tabla `PayoffRequest` |
| ⬜ PB-006 | Servicio `calculatePayoff` |
| ⬜ PB-007 | `POST/GET /api/contracts/:id/payoff-requests` (incluye envío a titulación) |
| ⬜ PB-008 | Aplicación: `Contract.status → PAID_OFF` |

## ⬜ Fase 13 — Rating PML y solicitud de préstamo

| # | Ítem |
|---|---|
| ⬜ PB-009 | `GET /api/borrowers/:id/rating` |
| ⬜ PB-010 | `GET /api/lenders/:id/stats` (sin `avg response time`, ver plan) |
| ⬜ PB-011 | Tabla `LoanRequest` + CRUD propio del deudor |
| ⬜ PB-012 | Pitch deck en PDF desde `LoanRequest` |
| ⬜ PB-013 | *(ver Fase 2)* |

## ⬜ Fase 15 — Exports contables

| # | Ítem |
|---|---|
| ⬜ PB-015 | Export CSV de transacciones por contrato + reporte año fiscal por prestamista |

## ⬜ Fase 9 — Docker / Deployment (cierre)

| # | Ítem |
|---|---|
| ⬜ BE-083 | Documentar variables de producción y secretos en README |
| ⬜ BE-084 | Definir networking de producción (nginx compartido vs subdominio) — decisión pendiente |

---

## Fuera de esta ronda (Coming Soon del board — solo diseño, no se construye)

Marketplace de prestamistas · Directorio con filtro Near Me · Mapa de deals a
nivel zip · Integración de seguros **avanzada** (solicitud de EOI dentro de la
plataforma, bidding de carriers, mortgagee clause auto-rellenado) ·
Verificación del deudor (crédito, entidad, background check) ·
Suscripciones y facturación de la plataforma.

*(La asociación básica aseguradora↔contrato al momento de la firma **sí**
entra en esta ronda — `InsuranceCompanyProfile` + `Contract.insuranceCompanyId`,
ver BE-094/BE-011 en [16. Fase 1 — plan actualizado](plan/16-fase-1-actualizada.md).
Lo que queda afuera es el flujo de EOI/bidding en sí, no la tabla.)*

## Decisiones que siguen abiertas (bloquean partes concretas)

| Pendiente | Bloquea |
|---|---|
| Stripe Connect vs cuenta única | BE-065/066/070 y activar Autopay |
| Proveedor de correo real (SendGrid / Postmark / Resend) | Confirmar BE-006 |
| Motor de PDF (Chromium en imagen vs API externa) | PB-001 y toda la Fase 11 |
| Precio de suscripción / modelo de cobro | Módulo de facturación (fuera de esta ronda) |
| Préstamos "blanket" (una propiedad, varios contratos) | Riesgo aceptado, dirección embebida en `Contract` |
| Networking de producción | BE-084 |
