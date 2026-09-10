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

> **Ajuste posterior 2026-09-07 (`D-P2-4`/`D-P2-5`, `BE-098`)**: el CRUD de usuarios (`GET`/`POST`/`PATCH`/`DELETE /api/users`) no verificaba sesión ni rol — cualquiera podía listar/crear/editar/borrar usuarios. Ahora exige sesión ADMIN, gana un campo `phone` (10 dígitos) y permite fijar `isActive` al crear/editar. **Corregido el mismo día (`D-P2-5`)**: la creación ya no pide `password` en absoluto — nace sin contraseña utilizable y, si termina activa, se genera y se devuelve una contraseña temporal (ahora de **8 dígitos numéricos**, antes 16 caracteres con símbolos — el generador es compartido con `BE-097`, así que el formato cambió parejo en los tres endpoints que lo usan). Detalle completo en [00 — Decisiones (`D-P2-4`/`D-P2-5`)](plan/00-contradicciones-y-decisiones.md#decisiones-2026-09-06-ronda-fase-2) y en [13. Backlog — `BE-098`](plan/13-backlog.md#be-098--restringir-apiusers-a-admin--isactive-administrable--userphone--d-p2-5-sin-password-en-la-creación).

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
| ✅ BE-098 | `/api/users` restringido a ADMIN + `isActive`/`phone` administrables, sin password en la creación (nuevo, `D-P2-4`/`D-P2-5`) | `phone String? @db.VarChar(10)` en `User` (migración `20260907213645_add_user_phone`), validado 10 dígitos en Zod. `POST /api/users` ya no acepta `password` — nace sin una utilizable y, si termina activa (default, o `isActive:true` explícito), `createUser()` reusa la misma lógica de activación que `BE-097` (`src/services/userActivation.service.ts`, compartida, no duplicada) para generar una y devolverla en la respuesta. `PATCH /api/users/:id` con `isActive: false→true` dispara ese mismo camino. `generateTemporaryPassword()` genera 8 dígitos numéricos (antes 16 caracteres con símbolos) — mientras no haya proveedor de correo real, `temporaryPassword` viaja también en la respuesta JSON de los tres endpoints que la usan. |

**Verificado end-to-end:** `type-check`, `lint`, build de `dev` y `runner`, camino dorado por `curl` (health, CORS permitido/rechazado, alta/listado/borrado de usuario con `id` UUIDv7 real). **Ajuste `BE-098` verificado aparte** (ver Fase 2 más abajo): `type-check`/`lint` limpios, 104 tests (31 unit + 73 integración, incluyendo los primeros HTTP de `/api/users`), y camino dorado por `curl` contra el contenedor `api` real: `GET /api/users` sin sesión → 401, con sesión LENDER → 403, con sesión ADMIN → 200; `POST /api/users` con `phone` inválido → 400; `PATCH /api/users/:id` con `{isActive:true}` sobre un usuario recién creado inactivo → `temporaryPassword` en la respuesta, y login exitoso con esa contraseña.

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

## ✅ Fase 2 — Auth (completa, verificada)

> **Backlog reescrito 2026-09-06/07** — implementado contra el plan vigente en [17. Fase 2 — plan actualizado](plan/17-fase-2-actualizada.md), no el original de [fases/fase-02-authentication.md](plan/fases/fase-02-authentication.md) (histórico, `BE-024`..`BE-034` sin cambios). `PB-013` se corrigió: **ambos** roles `LENDER`/`BORROWER` pueden auto-registrarse (`D-P1-10`, ya lo decía [00](plan/00-contradicciones-y-decisiones.md) — este documento tenía la versión vieja, solo `BORROWER`), sin contraseña en el registro, y se agregó `BE-097` (activación por Admin, resuelve el riesgo #20). Detalle completo de las tres decisiones en [00 — Decisiones 2026-09-06 (ronda Fase 2)](plan/00-contradicciones-y-decisiones.md#decisiones-2026-09-06-ronda-fase-2).

| # | Ítem | Notas |
|---|---|---|
| ✅ BE-024 | `src/auth/password.ts` (bcrypt) | + `generateTemporaryPassword` (para `BE-097`) y `verifyDummyPassword` (timing attack, `BE-027`) |
| ✅ BE-025 | `src/auth/jwt.ts` (access + refresh) | Payload `{ sub, role }`, sin `lenderId` (`D-P2-2`, corrige §7.1). `jose`, no `jsonwebtoken` — edge-compatible para cuando Fase 3 monte `withAuth` en `src/proxy.ts`. Refresh/reset/recovery codes: token opaco + hash SHA-256 (`D-P2-3`) |
| ✅ BE-026 | `src/auth/totp.ts` (2FA) | `otplib` v13 (API funcional, no la clase `authenticator` de v12). **Hallazgo no previsto**: `epochTolerance` se mide en segundos, no en "steps" — no está documentado así, verificado empíricamente. La ventana ±1 step de 30s es `epochTolerance: 30` |
| ✅ BE-027 | `POST /api/auth/login` | 401 `INVALID_CREDENTIALS` idéntico para correo inexistente y contraseña incorrecta, con `bcrypt.compare` contra un hash dummy en el primer caso |
| ✅ BE-028 | `POST /api/auth/login/2fa` | TOTP o recovery code de un solo uso; bucket de rate limit propio (`login2fa`, separado de `login`) |
| ✅ BE-029 | `POST /api/auth/refresh` | Rota siempre. **Hallazgo no previsto**: la primera versión revocaba toda la cadena del usuario ante *cualquier* token con `revokedAt` seteado — incluyendo uno revocado por un `logout()` normal, lo que tumbaba sesiones de otros dispositivos sin motivo. Corregido: la cascada de revocación solo dispara cuando `replacedByTokenId` está seteado (reuso de un token *rotado*, la señal de robo real que pide el ticket) |
| ✅ BE-030 | `POST /api/auth/logout` y `/logout-all` | |
| ✅ BE-031 | `GET /api/auth/me` | Devuelve `LenderProfile`/`BorrowerProfile` + lista de `LenderCompany` asociadas (reemplaza al `lenderId` que ya no viaja en el JWT, `D-P2-2`) |
| ✅ BE-032 | `POST /api/auth/password/forgot` y `/reset` | Reset revoca todos los refresh tokens del usuario |
| ✅ BE-033 | `POST /api/auth/2fa/setup` y `/verify` | `verify` exitoso genera exactamente 8 recovery codes, devueltos una única vez |
| ✅ BE-034 | `POST /api/auth/2fa/disable` y `/recovery-codes` | Exigen contraseña + código TOTP vigente, no solo la sesión |
| ✅ PB-013 | `POST /api/auth/register` | **Corregido** (ver nota arriba): `LENDER` y `BORROWER`, sin contraseña — se genera y se envía por correo al activar (`D-P2-1`) |
| ✅ BE-097 | `POST /api/admin/users/:id/activate` y `/deactivate` | Nuevo, adelantado desde Fase 4 por `D-P2-1` (resuelve riesgo #20). Primera activación genera+envía contraseña temporal; reactivación posterior no la toca — mismo endpoint sirve de reintento si el correo falló. **Actualizado 2026-09-07 (`D-P2-4`)**: la respuesta ahora incluye `temporaryPassword` directamente (mientras no haya proveedor de correo real) |
| ✅ BE-099 | `PATCH /api/auth/me` | Nuevo, 2026-09-07 (`D-P2-4`) — autoservicio: el usuario edita su propio `name`/`phone`, nunca `email`/`password`/`role`/`isActive` |

**Cambios en archivos existentes**: `src/lib/email.ts` (plantilla `account-activated`; modo dev que loguea el correo en vez de llamar a Resend cuando `EMAIL_API_KEY` está vacío — sin esto, activar una cuenta era imposible de probar en desarrollo), `src/db/testFixtures.ts` (`createTestUserWithPassword`/`createTestUserWithTwoFactor`, con contraseña bcrypt real — las fixtures de Fase 1 usaban el literal `"hash-de-prueba"`, no verificable), `src/services/users.service.ts` (`toSafeUser` exportado), `src/controllers/users.controller.ts` (usa el `parseOrThrow` compartido, extraído a `src/validations/parse.ts`).

**Verificado end-to-end**: `type-check`, `lint`, 31 tests unitarios (`src/auth/*.test.ts` nuevos: hash/compare, token expirado/manipulado, drift de TOTP) + 73 de integración (contra Postgres real en `db-test`, nunca mocks — incluye `src/app/api/auth/auth-routes.integration.test.ts`, los **primeros tests de este repo a nivel HTTP real**, invocando los route handlers en vez de Prisma/servicios directo: 401 idéntico, 429 de rate limit, camino dorado completo registro→activación→login→`/me`, y `PATCH /api/auth/me`), y camino dorado por `curl` contra el contenedor `api` real con el seed cargado: registro → login rechazado (inactivo) → activación por `admin@paymyloan.dev` → contraseña temporal capturada del log del contenedor (modo dev de `sendEmail`) → login con esa contraseña → `/me` → `refresh` con rotación → reuso del token viejo *y* del nuevo rotado ambos rechazados (cadena revocada) → `2fa/setup` → código TOTP generado a mano (HMAC-SHA1/RFC 6238) → `2fa/verify` → login en dos pasos con 2FA. Sin migraciones nuevas en esta fase — `prisma migrate status` mostraba las mismas 4 de Fase 1 (el ajuste `D-P2-4` posterior sí agregó una migración, `20260907213645_add_user_phone`, ver Fase 0 arriba).

Detalle ticket por ticket (decisiones de diseño, qué cambió respecto al backlog original, tests) en [17. Fase 2 — plan actualizado](plan/17-fase-2-actualizada.md).

---

## ✅ Fase 3 — Authorization (completa, verificada — `BE-037` diferido)

> **Implementada 2026-09-08** — reemplaza al helper provisorio de Fase 2 (`src/auth/session.ts`, ya borrado) por los middlewares definitivos en `src/middlewares/`. `BE-037` (`withTenantScope`) queda `⬜`, diferido a Fase 4 por decisión explícita (`D-P3-2`) — mismo patrón que `BE-022` en Fase 1: la fase se da por completa igual, con ese ítem puntual anotado y su motivo. Detalle de las dos decisiones de esta ronda (`D-P3-1`, `D-P3-2`) en [00 — Decisiones 2026-09-08](plan/00-contradicciones-y-decisiones.md#decisiones-2026-09-08-ronda-fase-3).
>
> **Actualización**: Fase 4/5 (abajo) ya resolvieron el acceso multi-empresa que necesitaban (`D-P4-1`) sin construir `withTenantScope` — sigue `⬜`, ahora diferido de verdad a Fase 6 (Contratos), el primer módulo con un flujo donde "operar como la Empresa A" persiste a lo largo de varias acciones seguidas.

| # | Ítem | Notas |
|---|---|---|
| ✅ BE-035 | `src/middlewares/withAuth.ts` | Reemplaza a `requireSession` (Fase 2) sin cambiar su lógica — verifica el access token, devuelve `{ userId, role }` |
| ✅ BE-036 | `src/middlewares/withRole.ts` | Agrega lo que `requireRole` (Fase 2) todavía no tenía a propósito: 2FA obligatorio para ADMIN/LENDER (§7.4), default `true`, `{ requireTwoFactor: false }` en `/api/auth/2fa/*` y en `GET /api/users` (lectura). **Acotado explícitamente a escrituras de negocio, no autoservicio** (`D-P3-1`) — sin esto, `PATCH /api/auth/me` o `logout` quedarían bloqueados para un Lender sin 2FA. De paso, en la misma consulta a `isTwoFactorEnabled`, revisa `isActive`/`deletedAt` — una cuenta desactivada a mitad de sesión no puede escribir aunque el access token siga vigente |
| ⬜ BE-037 | Middleware `withTenantScope` | **Diferido a Fase 4** (`D-P3-2`) — sin ningún endpoint bajo `/api/lenders/me/*`/`/api/contracts/*` construido todavía, no hay contra qué decidir el mecanismo (header, path, etc.). Ver riesgo #18 en [15](plan/15-riesgos-y-decisiones-pendientes.md), ahora acotado a "bloquea Fase 4" |
| ✅ BE-038 | `src/middlewares/requireContractAccess.ts` | Resuelve acceso a un `Contract` para LENDER (dueño de la `LenderCompany`, comparado contra **todas** las empresas del `LenderProfile` — no depende de `withTenantScope`) y BORROWER (`ContractBorrower` activo). Sin consumidor todavía (Fase 6), probado directo contra las fixtures de Fase 1 (`createTestLenderCompany`/`createTestBorrower`/`createTestContract`) |
| ✅ BE-039 | Auditoría de accesos denegados | `logAuditEvent(action="ACCESS_DENIED")` cableado en los dos rechazos por tenant mismatch de `requireContractAccess` (lender ajeno, borrower no asociado) — el único lugar que hoy tiene un caso real de tenant mismatch para auditar. El 403 `FORBIDDEN` de `withRole` (rol equivocado, no tenant) queda fuera de este ticket a propósito |

**Cambios en archivos existentes**: los 4 controllers de Fase 2 (`users.controller.ts`, `auth.controller.ts`, `twoFactor.controller.ts`, `adminUsers.controller.ts`) migran de `@/auth/session` a `@/middlewares/withAuth`+`@/middlewares/withRole`. `src/db/testFixtures.ts` gana `issueAccessTokenFor()` (hace login, y el paso 2 de 2FA si aplica, contra `authService` directamente) — varios tests HTTP de Fase 2 que creaban un ADMIN sin 2FA para probar una escritura tuvieron que pasar a `createTestUserWithTwoFactor` + esta fixture, porque ahora esa escritura los bloquearía. Código nuevo: `TWO_FACTOR_REQUIRED` (403) y `NOT_FOUND` (404) en el catálogo de errores.

**Verificado end-to-end**: `type-check`, `lint`, 35 tests unitarios (`src/middlewares/withAuth.test.ts` nuevo: sin header/token inválido/expirado → 401, token válido → sesión) + 87 de integración (contra Postgres real — `withRole.integration.test.ts`: rol equivocado → 403, ADMIN/LENDER sin 2FA → 403 `TWO_FACTOR_REQUIRED`, con 2FA → pasa, BORROWER nunca lo dispara, `requireTwoFactor:false` lo saltea, cuenta desactivada → 403 `ACCOUNT_INACTIVE`; `requireContractAccess.integration.test.ts`: los 4 casos del ticket — lender dueño, lender ajeno, borrower asociado, borrower no asociado — más la verificación de que los dos casos de rechazo quedan en `AuditLog`), y camino dorado por `curl` contra el contenedor `api` real con el seed cargado: `admin@paymyloan.dev` sin 2FA → `GET /api/users` funciona (lectura, exenta) pero `POST /api/users` responde `403 TWO_FACTOR_REQUIRED` → `2fa/setup`+`2fa/verify` (rutas exentas, funcionan igual sin 2FA activo todavía) → login en dos pasos → `POST /api/users` ahora sí responde `201`. Sin migraciones nuevas.

---

## ✅ Fase 4 — Admin / Lenders (completa, verificada)

> **Implementada 2026-09-08** contra el schema real (`D-P1-3`) — el ticket original solo mencionaba `LenderProfile`; `BE-040` originalmente creaba `User`+`LenderProfile`+`LenderCompany` en una transacción, porque `companyName`/`ein`/dirección son columnas `NOT NULL` de `LenderCompany`, no de `LenderProfile`. Se agrega además `BE-100` (`GET`/`PATCH /api/lenders/me`), ticket nuevo para un hueco del mapa de endpoints (`D-P4-3`). Detalle completo en [00 — Decisiones 2026-09-08 (ronda Fase 4/5)](plan/00-contradicciones-y-decisiones.md#decisiones-2026-09-08-ronda-fase-45).
>
> **`BE-040` rescopeado el mismo día (`D-P4-5`)**: Spencer señaló que ese diseño estaba mal — duplicaba el auto-registro (`D-P2-1`) y dejaba a todo Lender auto-registrado sin ninguna forma de crearse una empresa (ningún endpoint cubría "agregar una `LenderCompany` a un `LenderProfile` que ya existe"). Se separó: la persona nace por auto-registro (sin tocar), `POST /api/admin/lenders` (nivel raíz) **se eliminó**, y la parte de la empresa pasó a dos rutas nuevas sobre el mismo servicio (`lenders.service.ts#createLenderCompany`/`createOwnLenderCompany`), sin `name`/`email` en el body: `POST /api/admin/lenders/:id/companies` (Admin) y `POST /api/lenders/me/companies` (`BE-101`, nuevo — el propio Lender). Detalle completo en [00 — `D-P4-5`](plan/00-contradicciones-y-decisiones.md#decisión-2026-09-08-rescopeo-post-fase-4-d-p4-5).
>
> **`:id` acepta `User.id` (`D-P4-7`)** y **`LenderProfile.contactPhone` eliminado + PATCH/DELETE de empresa puntual (`D-P4-8`)**, el mismo día: dos correcciones más de Spencer sobre este mismo módulo, ya en pruebas manuales. `requireLenderProfile` resuelve por `LenderProfile.id` **o** `User.id` (el único que `GET /api/users` expone). `LenderProfile.contactPhone` — su único campo propio editable — resultó redundante con `User.phone` y se eliminó (migración `20260908234923_remove_lender_profile_contact_phone`); `PATCH /api/admin/lenders/:id` y `PATCH /api/lenders/me` **se eliminaron** con él (nada que editar), reemplazados por **`PATCH`/`DELETE /api/admin/lenders/:id/companies/:companyId`** (edición/borrado de una `LenderCompany` puntual, del lado Admin). Detalle completo en [00 — `D-P4-7`](plan/00-contradicciones-y-decisiones.md#decisión-2026-09-08-id-de-apiadminlenders-acepta-también-userid-d-p4-7) y [`D-P4-8`](plan/00-contradicciones-y-decisiones.md#decisión-2026-09-08-lenderprofilecontactphone-eliminado--patchdelete-de-lendercompany-puntual-d-p4-8).

| # | Ítem | Notas |
|---|---|---|
| ✅ BE-040 | `POST /api/admin/lenders/:id/companies` | Rescopeado (`D-P4-5`) — ya no crea la persona, solo asocia una `LenderCompany` nueva a un Lender que ya existe. `:id` acepta `LenderProfile.id` o `User.id` (`D-P4-7`). EIN duplicado → `409 EIN_TAKEN`; `:id` inexistente → `404 LENDER_NOT_FOUND` |
| ✅ BE-041 | `GET /api/admin/lenders` (lista + búsqueda + paginación) | Primer endpoint de este backend con paginación real — `src/validations/pagination.ts` nuevo, compartido con `BE-046` |
| ✅ BE-042 | `GET /api/admin/lenders/:id` | Incluye conteo de deudores y contratos `ACTIVE`/`DELINQUENT` de **todas** las `LenderCompany` del Lender (agregados, no depende de una empresa "activa") |
| ⬜ ~~BE-043~~ | ~~`PATCH /api/admin/lenders/:id`~~ | **Eliminado (`D-P4-8`)** — era solo `LenderProfile.contactPhone`, redundante con `User.phone`. Reemplazado por `PATCH .../companies/:companyId`, abajo |
| ✅ BE-044 | `DELETE /api/admin/lenders/:id` | Soft-delete de `User`+`LenderProfile`+todas sus `LenderCompany`; bloqueado (`409 LENDER_HAS_ACTIVE_CONTRACTS`) si alguna tiene un contrato `ACTIVE`/`DELINQUENT`. Acción de auditoría nueva: `LENDER_DELETED` |
| ✅ BE-100 | `GET /api/lenders/me` | Nuevo (`D-P4-3`) — autoservicio del Lender. Sin `PATCH` (`D-P4-8`) — mismo motivo que `BE-043` |
| ✅ BE-101 | `POST /api/lenders/me/companies` | Nuevo (`D-P4-5`) — el propio Lender se crea una empresa; cierra el hueco de un Lender auto-registrado sin ninguna `LenderCompany` |
| ✅ BE-102 | `PATCH`/`DELETE /api/admin/lenders/:id/companies/:companyId` | Nuevo (`D-P4-8`) — Admin edita cualquier campo de una empresa puntual (incluido `status`/`isOpenToDeals`) o la borra (soft-delete de esa sola empresa, bloqueado con contratos activos). `404 LENDER_COMPANY_NOT_FOUND` nuevo si `:companyId` no es del Lender |

**Verificado end-to-end**: `type-check`/`lint` limpios, 124 tests de integración (`lenders.service.integration.test.ts`, `lenders-routes.integration.test.ts`, `lender-companies-routes.integration.test.ts`) y camino dorado por `curl`: un Lender auto-registrado y activado (0 empresas) se crea su primera `LenderCompany` por autoservicio; un Admin asocia una empresa adicional a un Lender existente usando el `User.id` que le da `GET /api/users`; el viejo `POST /api/admin/lenders` ya no existe (`405`); Admin edita companyName/contactPhone/isOpenToDeals/status de una empresa puntual y la borra sin afectar al Lender ni sus otras empresas.

---

## ✅ Fase 5 — Borrowers (completa, verificada)

> **Implementada 2026-09-08** contra `D-P1-4`/`M-1` — el ticket original de `BE-045` decía `BorrowerProfile(lenderId=session.lenderId)`, que ya no existe: hoy crea `BorrowerProfile` (sin `lenderId`) + `LenderBorrower(lenderCompanyId, ...)`. `D-P4-1` resuelve cómo un Lender con N `LenderCompany` opera sobre sus deudores sin construir `withTenantScope`. `D-P4-2` agrega `User.mustChangePassword` (migración `20260908040520_add_must_change_password`), necesaria para que `BE-050` pueda bloquear de verdad hasta que se cambie la contraseña temporal.
>
> **Hueco conocido, no implementado**: el paréntesis "`+ M-3`: invitar deudor ya existente en la plataforma" de `BE-045`/`BE-049` originales — hoy `POST /api/lenders/me/borrowers` con el correo de un usuario que ya existe responde `409 EMAIL_TAKEN`, no lo vincula a la empresa del Lender. Vincular a alguien que ya tiene cuenta (sin recrearlo) implicaría algún tipo de invitación/consentimiento que ningún otro flujo de este backend modela todavía — se deja pendiente en vez de adivinar ese diseño sin pedirlo.

| # | Ítem | Notas |
|---|---|---|
| ✅ BE-045 | `POST /api/lenders/me/borrowers` | Crea `User(role=BORROWER)`+`BorrowerProfile`+`LenderBorrower`, activo con contraseña temporal (mismo patrón que `BE-097`/activación). Con una sola `LenderCompany` se resuelve sola; con más de una, exige `lenderCompanyId` en el body — un valor ajeno nunca se usa, responde `404` (§7.5) |
| ✅ BE-046 | `GET /api/lenders/me/borrowers` (lista + búsqueda + paginación) | Ve deudores de **todas** las `LenderCompany` del Lender (`D-P4-1`) |
| ✅ BE-047 | `GET /api/lenders/me/borrowers/:id` | `404`, no `403`, si el deudor existe pero no es del Lender — mismo criterio anti-enumeración de `requireContractAccess` (`BE-038`) |
| ✅ BE-048 | `PATCH /api/lenders/me/borrowers/:id` | Campos de contacto del `BorrowerProfile` |
| ✅ BE-049 | `DELETE /api/lenders/me/borrowers/:id` | Desvincula (`LenderBorrower.removedAt`, `M-3`) — nunca borra el `BorrowerProfile`. Bloqueado (`409 BORROWER_HAS_ACTIVE_CONTRACTS`) con un contrato `ACTIVE`/`DELINQUENT` con esa empresa |
| ✅ BE-050 | `GET`/`PATCH /api/borrowers/me`, `POST /api/borrowers/me/password` | `PATCH` bloqueado (`403 PASSWORD_CHANGE_REQUIRED`) mientras `mustChangePassword=true` (`D-P4-2`) — `GET` y el propio cambio de contraseña quedan exentos, si no nadie podría cambiarla. El cambio de contraseña exige `currentPassword` y revoca todos los refresh tokens, igual que `password/reset` (`BE-032`) |

**Cambios en archivos existentes**: `userActivation.service.ts` gana `issueTemporaryPassword()` (extraída de `activateUserAccount`, reusada por `BE-045`; `BE-040` ya no la usa desde el rescopeo `D-P4-5`, no genera contraseñas); `passwordReset.service.ts` apaga `mustChangePassword` al resetear; `withRole.ts` gana la opción `requirePasswordChanged`; `users.service.ts` expone `mustChangePassword` en `SafeUser` y lo apaga si un Admin fija un `password` explícito por `PATCH /api/users/:id`. Códigos de error nuevos: `EIN_TAKEN`, `LENDER_NOT_FOUND`, `LENDER_HAS_ACTIVE_CONTRACTS`, `LENDER_COMPANY_REQUIRED`, `BORROWER_NOT_FOUND`, `BORROWER_HAS_ACTIVE_CONTRACTS`, `NO_LENDER_COMPANY`, `PASSWORD_CHANGE_REQUIRED`.

**Verificado end-to-end**: `type-check`/`lint` limpios, 145 tests en total (35 unit + 110 integración — 23 nuevos de esta ronda: `lenders.service`/`lenderBorrowers.service`/`borrowerProfile.service` + 2 suites HTTP), y camino dorado por `curl` de punta a punta: Admin (2FA) crea un Lender sin contraseña en la respuesta → el Lender loguea con la temporal (del log del contenedor) → intenta crear un Borrower sin 2FA → `403 TWO_FACTOR_REQUIRED` → activa 2FA → crea el Borrower → el Borrower loguea → `PATCH /api/borrowers/me` → `403 PASSWORD_CHANGE_REQUIRED` → cambia su contraseña → `PATCH` ahora funciona. Sin migraciones nuevas en Fase 4; Fase 5 agregó la de `mustChangePassword`.

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
