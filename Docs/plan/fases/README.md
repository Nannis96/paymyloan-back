# Backlog — Fases de implementación

Sección 13 del [plan de backend](../README.md), repartida en un documento por
fase. Cada ticket conserva su convención original: **Objetivo**, **Archivos
afectados**, **Dependencias**, **Prioridad** (P0 bloqueante / P1 core / P2
importante / P3 opcional), **Complejidad** (S/M/L), **Implementación**,
**Validaciones**, **Tests**, **Criterios de aceptación**.

El orden de ejecución **no** es el orden de numeración — ver
[14. Roadmap recomendado](../14-roadmap.md): el testing (Fase 8) va
intercalado en cada fase, no al final, y parte de Pagos (Fase 7) está
bloqueada por la decisión de Stripe Connect.

---

## Fases

| Fase | Documento | Tickets | Nota |
|---|---|---|---|
| 0 | [Foundation](fase-00-foundation.md) | BE-001 → BE-007 | Completa — ver [progreso](../../IMPLEMENTATION_PROGRESS.md) |
| 1 | [Database](fase-01-database.md) | BE-008 → BE-023 | Todo el schema, en migraciones por bloque lógico |
| 2 | [Authentication](fase-02-authentication.md) | BE-024 → BE-034 | Completa — histórico, reemplazado por [17. Fase 2 — plan actualizado](../17-fase-2-actualizada.md) (agrega `PB-013` corregido + `BE-097`) |
| 3 | [Authorization](fase-03-authorization.md) | BE-035 → BE-039 | RBAC + aislamiento multi-tenant |
| 4 | [Users / Admin / Lenders](fase-04-admin-lenders.md) | BE-040 → BE-044 | El Admin (o el propio Lender, `D-P4-5`) da de alta empresas (`LenderCompany`) |
| 5 | [Borrowers](fase-05-borrowers.md) | BE-045 → BE-050 | CRUD de deudores + autoservicio |
| 6 | [Contracts](fase-06-contracts.md) | BE-051 → BE-064 | Núcleo del producto: términos, aceptación, amortización |
| 7 | [Payments](fase-07-payments.md) | BE-065 → BE-072 | BE-065/066/070 bloqueados por Stripe Connect |
| 8 | [Testing](fase-08-testing.md) | BE-073 → BE-079 | Transversal, en paralelo a cada fase |
| 9 | [Docker / Deployment](fase-09-docker-deployment.md) | BE-080 → BE-084 | Cierre |
| 10 | [Opcional](fase-10-opcional.md) | BE-085 | Fuera del roadmap mínimo — `Document`/S3, absorbida por Fase 11 |
| 11 | [Documentos, Commitment Letter y Notificaciones](fase-11-documentos-pdf.md) | PB-001 → PB-004, PB-021, PB-022, PB-025 | Formalizada 2026-09-10, ver [00 §D-S2-9/12](../00-contradicciones-y-decisiones.md#decisiones-2026-09-10-ronda-product-spec-v2--commitment-letter-spec) |
| 12 | [Payoff](fase-12-payoff.md) | PB-005 → PB-008 | Formalizada 2026-09-10 |
| 13 | [Marketplace / Loan Requests / Vetting](fase-13-rating-loan-requests.md) | PB-011, PB-012, PB-016 → PB-019 | Formalizada y ampliada 2026-09-10 (marketplace, RentCast, vetting) |
| 14 | [Dashboards y Ratings](fase-14-dashboards-ratings.md) | PB-009, PB-010, PB-023, PB-024 | Nueva 2026-09-10 |
| 15 | [Exports contables](fase-15-exports-reporting.md) | PB-015 | Formalizada 2026-09-10 |

---

## Índice de tickets

Los ítems se citan entre sí por ID (`BE-0XX`) a lo largo de todo el plan;
esta tabla dice en qué documento vive cada uno.

| ID | Título | Prioridad | Complejidad |
|---|---|---|---|
| [BE-001](fase-00-foundation.md#be-001--adoptar-uuidv7-como-estrategia-de-ids) | Adoptar UUIDv7 como estrategia de IDs | P0 | S |
| [BE-002](fase-00-foundation.md#be-002--validación-fail-fast-de-variables-de-entorno) | Validación fail-fast de variables de entorno | P0 | S |
| [BE-003](fase-00-foundation.md#be-003--configurar-cors) | Configurar CORS | P0 | S |
| [BE-004](fase-00-foundation.md#be-004--logger-estructurado--requestid) | Logger estructurado + requestId | P1 | S |
| [BE-005](fase-00-foundation.md#be-005--rate-limiting-en-endpoints-sensibles) | Rate limiting en endpoints sensibles | P1 | M |
| [BE-006](fase-00-foundation.md#be-006--cliente-de-correo-transaccional) | Cliente de correo transaccional | P1 | M |
| [BE-007](fase-00-foundation.md#be-007--reestructurar-carpetas-por-dominio) | Reestructurar carpetas por dominio | P1 | S |
| [BE-008](fase-01-database.md#be-008--enum-userrole--campo-role-en-user) | Enum `UserRole` + campo `role` en `User` | P0 | S |
| [BE-009](fase-01-database.md#be-009--tabla-lenderprofile) | Tabla `LenderProfile` | P0 | M |
| [BE-010](fase-01-database.md#be-010--tabla-borrowerprofile) | Tabla `BorrowerProfile` | P0 | M |
| [BE-011](fase-01-database.md#be-011--enums-de-contrato--tabla-contract) | Enums de contrato + tabla `Contract` | P0 | M |
| [BE-012](fase-01-database.md#be-012--tabla-contractterms--resolver-fk-circular-con-contractcurrenttermsid) | Tabla `ContractTerms` + resolver FK circular con `Contract.currentTermsId` | P0 | M |
| [BE-013](fase-01-database.md#be-013--tabla-contracttermsacceptance) | Tabla `ContractTermsAcceptance` | P0 | S |
| [BE-014](fase-01-database.md#be-014--tabla-contractborrower) | Tabla `ContractBorrower` | P0 | S |
| [BE-015](fase-01-database.md#be-015--enums-de-pago--tabla-scheduledpayment) | Enums de pago + tabla `ScheduledPayment` | P1 | M |
| [BE-016](fase-01-database.md#be-016--tabla-transaction) | Tabla `Transaction` | P1 | M |
| [BE-017](fase-01-database.md#be-017--tabla-transactionallocation) | Tabla `TransactionAllocation` | P1 | S |
| [BE-018](fase-01-database.md#be-018--tabla-paymentmethod) | Tabla `PaymentMethod` | P1 | S |
| [BE-019](fase-01-database.md#be-019--tabla-webhookevent) | Tabla `WebhookEvent` | P1 | S |
| [BE-020](fase-01-database.md#be-020--tabla-auditlog) | Tabla `AuditLog` | P0 | M |
| [BE-021](fase-01-database.md#be-021--tablas-refreshtoken-passwordresettoken-twofactorrecoverycode) | Tablas `RefreshToken`, `PasswordResetToken`, `TwoFactorRecoveryCode` | P0 | M |
| [BE-022](fase-01-database.md#be-022--opcionalfase-2-tabla-document) | (Opcional/fase 2) Tabla `Document` | P3 | M |
| [BE-023](fase-01-database.md#be-023--seed-inicial) | Seed inicial | P0 | M |
| [BE-024](fase-02-authentication.md#be-024--módulo-srcauthpasswordts) | Módulo `src/auth/password.ts` | P0 | S |
| [BE-025](fase-02-authentication.md#be-025--módulo-srcauthjwtts) | Módulo `src/auth/jwt.ts` | P0 | M |
| [BE-026](fase-02-authentication.md#be-026--módulo-srcauthtotpts) | Módulo `src/auth/totp.ts` | P0 | S |
| [BE-027](fase-02-authentication.md#be-027--post-apiauthlogin) | `POST /api/auth/login` | P0 | M |
| [BE-028](fase-02-authentication.md#be-028--post-apiauthlogin2fa) | `POST /api/auth/login/2fa` | P0 | M |
| [BE-029](fase-02-authentication.md#be-029--post-apiauthrefresh) | `POST /api/auth/refresh` | P0 | M |
| [BE-030](fase-02-authentication.md#be-030--post-apiauthlogout-y-logout-all) | `POST /api/auth/logout` y `/logout-all` | P1 | S |
| [BE-031](fase-02-authentication.md#be-031--get-apiauthme) | `GET /api/auth/me` | P0 | S |
| [BE-032](fase-02-authentication.md#be-032--post-apiauthpasswordforgot-y-reset) | `POST /api/auth/password/forgot` y `/reset` | P1 | M |
| [BE-033](fase-02-authentication.md#be-033--post-apiauth2fasetup-y-verify) | `POST /api/auth/2fa/setup` y `/verify` | P0 | M |
| [BE-034](fase-02-authentication.md#be-034--post-apiauth2fadisable-y-recovery-codes) | `POST /api/auth/2fa/disable` y `/recovery-codes` | P1 | M |
| [BE-097](../17-fase-2-actualizada.md) | `POST /api/admin/users/:id/activate` y `/deactivate` (nuevo, `D-P2-1`) | P0 | M |
| [BE-098](../13-backlog.md#be-098--restringir-apiusers-a-admin--isactive-administrable--userphone) | `/api/users` restringido a ADMIN + `isActive`/`phone` (nuevo, `D-P2-4`) | P0 | M |
| [BE-099](../13-backlog.md#be-099--patch-apiauthme-autoservicio-de-perfil-propio) | `PATCH /api/auth/me` — autoservicio de perfil propio (nuevo, `D-P2-4`) | P1 | S |
| [BE-035](fase-03-authorization.md#be-035--middleware-withauth) | Middleware `withAuth` | P0 | M |
| [BE-036](fase-03-authorization.md#be-036--middleware-withrole) | Middleware `withRole` | P0 | M |
| [BE-037](fase-03-authorization.md#be-037--middleware-withtenantscope) | Middleware `withTenantScope` | P0 | M |
| [BE-038](fase-03-authorization.md#be-038--helper-requirecontractaccesssession-contractid) | Helper `requireContractAccess(session, contractId)` | P0 | M |
| [BE-039](fase-03-authorization.md#be-039--auditoría-automática-de-accesos-denegados) | Auditoría automática de accesos denegados | P2 | S |
| [BE-040](../00-contradicciones-y-decisiones.md#decisión-2026-09-08-rescopeo-post-fase-4-d-p4-5) | `POST /api/admin/lenders/:id/companies` (rescopeado, `D-P4-5` — ya no crea la persona) | P0 | M |
| [BE-041](fase-04-admin-lenders.md#be-041--get-apiadminlenders-lista--búsqueda--paginación) | `GET /api/admin/lenders` (lista + búsqueda + paginación) | P0 | M |
| [BE-042](fase-04-admin-lenders.md#be-042--get-apiadminlendersid) | `GET /api/admin/lenders/:id` | P0 | S |
| ~~[BE-043](fase-04-admin-lenders.md#be-043--patch-apiadminlendersid)~~ | ~~`PATCH /api/admin/lenders/:id`~~ — eliminado (`D-P4-8`), reemplazado por `PATCH /api/admin/lenders/:id/companies/:companyId` | P1 | S |
| [BE-044](fase-04-admin-lenders.md#be-044--delete-apiadminlendersid) | `DELETE /api/admin/lenders/:id` | P1 | M |
| [BE-045](fase-05-borrowers.md#be-045--post-apilendersmeborrowers) | `POST /api/lenders/me/borrowers` | P0 | M |
| [BE-046](fase-05-borrowers.md#be-046--get-apilendersmeborrowers-lista--búsqueda--paginación) | `GET /api/lenders/me/borrowers` (lista + búsqueda + paginación) | P0 | M |
| [BE-047](fase-05-borrowers.md#be-047--get-apilendersmeborrowersid) | `GET /api/lenders/me/borrowers/:id` | P0 | S |
| [BE-048](fase-05-borrowers.md#be-048--patch-apilendersmeborrowersid) | `PATCH /api/lenders/me/borrowers/:id` | P1 | S |
| [BE-049](fase-05-borrowers.md#be-049--delete-apilendersmeborrowersid) | `DELETE /api/lenders/me/borrowers/:id` | P1 | M |
| [BE-050](fase-05-borrowers.md#be-050--get-apiborrowersme-patch-apiborrowersme-post-apiborrowersmepassword) | `GET /api/borrowers/me`, `PATCH /api/borrowers/me`, `POST /api/borrowers/me/password` | P0 | M |
| [BE-100](../00-contradicciones-y-decisiones.md#decisiones-2026-09-08-ronda-fase-45) | `GET /api/lenders/me` (nuevo, `D-P4-3`) — sin `PATCH`, eliminado por `D-P4-8` | P1 | S |
| [BE-101](../00-contradicciones-y-decisiones.md#decisión-2026-09-08-rescopeo-post-fase-4-d-p4-5) | `POST /api/lenders/me/companies` (nuevo, `D-P4-5`) — el propio Lender se crea una empresa | P0 | S |
| [BE-102](../00-contradicciones-y-decisiones.md#decisión-2026-09-08-lenderprofilecontactphone-eliminado--patchdelete-de-lendercompany-puntual-d-p4-8) | `PATCH`/`DELETE /api/admin/lenders/:id/companies/:companyId` (nuevo, `D-P4-8`) — Admin edita/borra una empresa puntual | P1 | M |
| [BE-051](fase-06-contracts.md#be-051--post-apicontracts) | `POST /api/contracts` | P0 | L |
| [BE-052](fase-06-contracts.md#be-052--get-apicontracts-lista--filtros--paginación-por-rol) | `GET /api/contracts` (lista + filtros + paginación, por rol) | P0 | M |
| [BE-053](fase-06-contracts.md#be-053--get-apicontractsid) | `GET /api/contracts/:id` | P0 | M |
| [BE-054](fase-06-contracts.md#be-054--patch-apicontractsid) | `PATCH /api/contracts/:id` | P1 | M |
| [BE-055](fase-06-contracts.md#be-055--delete-apicontractsid) | `DELETE /api/contracts/:id` | P1 | S |
| [BE-056](fase-06-contracts.md#be-056--post-apicontractsidcancel) | `POST /api/contracts/:id/cancel` | P1 | M |
| [BE-057](fase-06-contracts.md#be-057--postdelete-apicontractsidborrowers) | `POST/DELETE /api/contracts/:id/borrowers` | P0 | M |
| [BE-058](fase-06-contracts.md#be-058--servicio-de-amortización-calculateamortizedpayment-calculateinterestonlypayment-calculateballoonpayment-calculateaccruedinterest) | Servicio de amortización (`calculateAmortizedPayment`, `calculateInterestOnlyPayment`, `calculateBalloonPayment`, `calculateAccruedInterest`) | P0 | L |
| [BE-059](fase-06-contracts.md#be-059--servicio-generateamortizationschedule--activación-automática) | Servicio `generateAmortizationSchedule` + activación automática | P0 | L |
| [BE-060](fase-06-contracts.md#be-060--post-apicontractsidterms-proponer-nueva-versión--submit) | `POST /api/contracts/:id/terms` (proponer nueva versión) + `submit` | P1 | M |
| [BE-061](fase-06-contracts.md#be-061--post-apicontractsidtermstermsidaccept-y-reject) | `POST /api/contracts/:id/terms/:termsId/accept` y `/reject` | P0 | L |
| [BE-062](fase-06-contracts.md#be-062--get-apicontractsidschedule-y-balance) | `GET /api/contracts/:id/schedule` y `/balance` | P0 | M |
| [BE-063](fase-06-contracts.md#be-063--job-recomputecontractdelinquencystatus) | Job `recomputeContractDelinquencyStatus` | P2 | M |
| [BE-064](fase-06-contracts.md#be-064--job-assesslatefee) | Job `assessLateFee` | P2 | M |
| [BE-065](fase-07-payments.md#be-065--post-apipayment-methods-setupintent-y-getdelete) | `POST /api/payment-methods` (SetupIntent) y `GET`/`DELETE` | P1 | L |
| [BE-066](fase-07-payments.md#be-066--post-apicontractsidpayments-ach-del-deudor) | `POST /api/contracts/:id/payments` (ACH del deudor) | P1 | L |
| [BE-067](fase-07-payments.md#be-067--post-apicontractsidpaymentsmanual) | `POST /api/contracts/:id/payments/manual` | P1 | M |
| [BE-068](fase-07-payments.md#be-068--servicio-calculatepaymentallocation--applytransaction) | Servicio `calculatePaymentAllocation` + `applyTransaction` | P0 | L |
| [BE-069](fase-07-payments.md#be-069--get-apicontractsidtransactions-y-get-apitransactionsid) | `GET /api/contracts/:id/transactions` y `GET /api/transactions/:id` | P1 | M |
| [BE-070](fase-07-payments.md#be-070--post-apiwebhooksstripe--webhookevent) | `POST /api/webhooks/stripe` + `WebhookEvent` | P1 | L |
| [BE-071](fase-07-payments.md#be-071--servicio-reversetransaction--post-apitransactionsidreverse) | Servicio `reverseTransaction` + `POST /api/transactions/:id/reverse` | P1 | M |
| [BE-072](fase-07-payments.md#be-072--get-apiaudit-logs) | `GET /api/audit-logs` | P2 | M |
| [BE-073](fase-08-testing.md#be-073--configurar-entorno-de-test-db-de-test-vitestjest-scripts-pnpm-test) | Configurar entorno de test (DB de test, `vitest`/`jest`, scripts `pnpm test`) | P0 | M |
| [BE-074](fase-08-testing.md#be-074--suite-unit-amortización-y-allocation) | Suite unit: amortización y allocation | P0 | M |
| [BE-075](fase-08-testing.md#be-075--suite-integration-contratos--calendario) | Suite integration: contratos + calendario | P0 | L |
| [BE-076](fase-08-testing.md#be-076--suite-integration-pagos--waterfall--duplicados) | Suite integration: pagos + waterfall + duplicados | P0 | L |
| [BE-077](fase-08-testing.md#be-077--suite-api-auth--2fa) | Suite API: auth + 2FA | P0 | L |
| [BE-078](fase-08-testing.md#be-078--suite-multi-tenancy-parametrizada) | Suite multi-tenancy parametrizada | P0 | L |
| [BE-079](fase-08-testing.md#be-079--suite-de-seguridad-negativa-rate-limit-jwt-manipulado-tokens-reusados) | Suite de seguridad negativa (rate limit, JWT manipulado, tokens reusados) | P1 | M |
| [BE-080](fase-09-docker-deployment.md#be-080--actualizar-docker-composeymldevyml-a-postgres-18) | Actualizar `docker-compose.yml`/`.dev.yml` a Postgres 18 | P0 | S |
| [BE-081](fase-09-docker-deployment.md#be-081--servicio-db-test-en-docker-composedevyml) | Servicio `db-test` en `docker-compose.dev.yml` | P1 | S |
| [BE-082](fase-09-docker-deployment.md#be-082--healthcheck-con-verificación-real-de-conectividad-a-postgres) | `HEALTHCHECK` con verificación real de conectividad a Postgres | P1 | S |
| [BE-083](fase-09-docker-deployment.md#be-083--documentar-variables-de-entorno-de-producción-y-secretos) | Documentar variables de entorno de producción y secretos | P1 | S |
| [BE-084](fase-09-docker-deployment.md#be-084--definir-networking-de-producción-nginx-compartido-vs-subdominio-propio) | Definir networking de producción (nginx compartido vs subdominio propio) | P2 | M |
| [BE-085](fase-10-opcional.md#be-085--módulo-de-documentos-s3-privado-urls-firmadas) | Módulo de Documentos (S3 privado, URLs firmadas) | P3 | L |
| [PB-020](fase-06-contracts.md#pb-020--contractfeeitem--closing-fee-summary-table-nuevo-d-s2-2) | `ContractFeeItem` — Closing Fee Summary Table (nuevo, `D-S2-2`) | P0 | L |
| [PB-001](fase-11-documentos-pdf.md#pb-001--motor-de-pdf) | Motor de PDF (`src/lib/pdf.ts`) | P1 | M |
| [PB-002](fase-11-documentos-pdf.md#pb-002--tabla-document--storage-s3-privado--urls-firmadas) | Tabla `Document` + storage S3 privado + URLs firmadas | P0 | L |
| [PB-003](fase-11-documentos-pdf.md#pb-003--commitment-letter--generación--distribución-automática) | Commitment Letter — generación + distribución automática | P0 | L |
| [PB-004](fase-11-documentos-pdf.md#pb-004--envío-de-documentos-por-correo-a-las-partes) | Envío de documentos por correo a las partes | P1 | S |
| [PB-021](fase-11-documentos-pdf.md#pb-021--ach-draft-mode-tras-la-commitment-letter) | ACH draft mode tras la Commitment Letter | P2 | M |
| [PB-022](fase-11-documentos-pdf.md#pb-022--notification-in-app--disparadores) | `Notification` (in-app) + disparadores | P1 | M |
| [PB-025](fase-11-documentos-pdf.md#pb-025--extra-disclosures-documentos-del-lender-para-firma-del-borrower) | Extra disclosures (documentos del Lender para firma del Borrower) | P2 | M |
| [PB-005](fase-12-payoff.md#pb-005--tabla-payoffrequest) | Tabla `PayoffRequest` | P0 | M |
| [PB-006](fase-12-payoff.md#pb-006--servicio-calculatepayoff) | Servicio `calculatePayoff` | P0 | M |
| [PB-007](fase-12-payoff.md#pb-007--postget-apicontractsidpayoff-requests) | `POST`/`GET /api/contracts/:id/payoff-requests` | P0 | L |
| [PB-008](fase-12-payoff.md#pb-008--aplicación-contractstatus--paid_off) | Aplicación: `Contract.status → PAID_OFF` | P0 | M |
| [PB-011](fase-13-rating-loan-requests.md#pb-011--tabla-loanrequest--crud-propio-del-deudor) | Tabla `LoanRequest` + CRUD propio del Deudor | P0 | L |
| [PB-012](fase-13-rating-loan-requests.md#pb-012--pitch-deck-en-pdf-desde-loanrequest) | Pitch deck en PDF desde `LoanRequest` | P2 | M |
| [PB-016](fase-13-rating-loan-requests.md#pb-016--integración-rentcast-comps-de-renta-y-venta-sobre-property) | Integración RentCast (comps de renta y venta) sobre `Property` | P1 | M |
| [PB-017](fase-13-rating-loan-requests.md#pb-017--matching-de-marketplace-públicoprivado--conversión-a-contract) | Matching de marketplace (público/privado) + conversión a `Contract` | P0 | L |
| [PB-018](fase-13-rating-loan-requests.md#pb-018--borrowerapplication-vetting-99--endpoints) | `BorrowerApplication` (vetting, $99) + endpoints | P1 | L |
| [PB-019](fase-13-rating-loan-requests.md#pb-019--borrowersubscription-9mes-trial-7-días--endpoints) | `BorrowerSubscription` ($9/mes, trial 7 días) + endpoints | P2 | M |
| [PB-009](fase-14-dashboards-ratings.md#pb-009--get-apiborrowersidrating) | `GET /api/borrowers/:id/rating` | P1 | M |
| [PB-010](fase-14-dashboards-ratings.md#pb-010--get-apilendersidstats) | `GET /api/lenders/:id/stats` | P1 | M |
| [PB-023](fase-14-dashboards-ratings.md#pb-023--lenderreview-el-deudor-califica-al-prestamista) | `LenderReview` (el Deudor califica al Prestamista) | P2 | M |
| [PB-024](fase-14-dashboards-ratings.md#pb-024--dashboards-de-borrower-y-lender) | Dashboards de Borrower y Lender | P1 | L |
| [PB-015](fase-15-exports-reporting.md#pb-015--export-csv--reporte-fiscal--envío-automático-a-cpabookkeepers) | Export CSV + reporte fiscal + envío automático a CPA/Bookkeepers | P2 | M |

---

[← Índice del plan](../README.md)  ·  [13. Backlog detallado](../13-backlog.md)  ·  [14. Roadmap recomendado](../14-roadmap.md)
