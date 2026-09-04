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

Ver detalle completo en el plan aprobado.

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

## ⬜ Fase 1 — Database

Con los deltas M-1, M-4, M-5, M-6 incorporados directamente (no después).

| # | Ítem |
|---|---|
| ⬜ BE-008 | Enum `UserRole` + campo `role` en `User` |
| ⬜ BE-009 | Tabla `LenderProfile` (+ M-4: campo `isOpenToDeals`) |
| ⬜ BE-010 | Tabla `BorrowerProfile` (**sin** `lenderId` — ver M-1) |
| ⬜ M-1 | Tabla nueva `LenderBorrower` (vínculo prestamista↔deudor, N:M) |
| ⬜ BE-011 | Enums de contrato + tabla `Contract` |
| ⬜ BE-012 | Tabla `ContractTerms` + FK circular `Contract.currentTermsId` |
| ⬜ BE-013 | Tabla `ContractTermsAcceptance` |
| ⬜ BE-014 | Tabla `ContractBorrower` |
| ⬜ BE-015 | Enums de pago + tabla `ScheduledPayment` |
| ⬜ BE-016 | Tabla `Transaction` (+ M-5: reponer `TransactionType.PAYOFF_PAYMENT`) |
| ⬜ BE-017 | Tabla `TransactionAllocation` |
| ⬜ BE-018 | Tabla `PaymentMethod` (+ M-6: tabla `Autopay` y sus enums, sin activar) |
| ⬜ BE-019 | Tabla `WebhookEvent` |
| ⬜ BE-020 | Tabla `AuditLog` + helper `logAuditEvent()` |
| ⬜ BE-021 | Tablas `RefreshToken`, `PasswordResetToken`, `TwoFactorRecoveryCode` |
| ⬜ BE-023 | Seed inicial (admin + 2-3 lenders/borrowers + 1-2 contratos de ejemplo) |

*(BE-022 Document queda absorbido por la Fase 11, no como ítem opcional aparte)*

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
nivel zip · Integración de seguros (EOI + bidding de carriers) · Verificación
del deudor (crédito, entidad, background check) · Suscripciones y
facturación de la plataforma.

## Decisiones que siguen abiertas (bloquean partes concretas)

| Pendiente | Bloquea |
|---|---|
| Stripe Connect vs cuenta única | BE-065/066/070 y activar Autopay |
| Proveedor de correo real (SendGrid / Postmark / Resend) | Confirmar BE-006 |
| Motor de PDF (Chromium en imagen vs API externa) | PB-001 y toda la Fase 11 |
| Precio de suscripción / modelo de cobro | Módulo de facturación (fuera de esta ronda) |
| Préstamos "blanket" (una propiedad, varios contratos) | Riesgo aceptado, dirección embebida en `Contract` |
| Networking de producción | BE-084 |
