[← Índice de fases](README.md)  ·  [Backlog](../13-backlog.md)  ·  [Anterior: Fase 15 — Exports contables](fase-15-exports-reporting.md)

---

# Fase 16 — Admin Overview

> **Nueva 2026-09-25** — respaldo de la vista `pml_v4/admin/admin-panel.html` (dashboard del Admin). Se analizó la vista contra el schema y los servicios reales, y se implementó solo lo que ya tiene fuente de datos (`AD-001`); el resto queda documentado abajo con su bloqueo concreto. Decisiones en [00 §Decisiones 2026-09-25](../00-contradicciones-y-decisiones.md#decisiones-2026-09-25-ronda-admin-overview) (`D-A1`..`D-A12`), pendientes de negocio en [15 §30–34](../15-riesgos-y-decisiones-pendientes.md).
>
> **Estado**: 🟡 parcial — `AD-001`, `AD-002` y `AD-003` implementados y verificados; `AD-004`..`AD-011` pendientes.

## Qué pide la vista y de dónde sale cada bloque

Leyenda: ✅ ya sale de datos reales (`AD-001`) · 🟡 sale parcial · ❌ no hay fuente de datos todavía (viaja `null`, el front muestra "N/D").

| Bloque de la vista | Fuente | Estado |
|---|---|---|
| Nombre del admin / "All systems operational" | `GET /api/auth/me`, `GET /api/health` | ✅ ya existían (el health no consulta Postgres — `BE-082`) |
| KPI **Active deals** (+N this week) | `Contract` `ACTIVE`/`DELINQUENT`; tendencia por `activatedAt` de 7 días | ✅ `kpis.activeDeals` |
| KPI **Total funded** | Suma de `ContractTerms.principalAmount` (términos vigentes) de contratos `ACTIVE`/`DELINQUENT`/`PAID_OFF` | ✅ `kpis.totalFunded` |
| KPI **Late payments** | `Contract` `DELINQUENT` | ✅ `kpis.lateContracts` — se mantiene al día con el job de mora programado (`AD-002`) |
| KPI **MRR** | Depende del modelo de ingresos | ❌ sin campo; ver `AD-006` |
| KPI **Pending verif.** | `VerificationRequest` `PENDING` (lender + borrower) | ✅ `kpis.pendingVerifications` (`AD-003`) |
| **Revenue** — Closing fees | `ContractFeeItem` `PLATFORM`/`MARKETPLACE_CONNECTION` (`D-S2-5`) de contratos activados en el mes | ✅ `revenue.closingFees` |
| **Revenue** — gráfico de 6 meses | Igual, mes a mes | 🟡 `revenue.last6Months` (solo closing fees) |
| **Revenue** — Subscriptions / Interest share / Affiliate payouts / Net | `BorrowerSubscription` (`PB-019`), "interest share" (sin definición), afiliados (no existen) | ❌ `null` (`AD-006`, `AD-007`) |
| Tabla **Active deals** | Últimos 5 contratos `PENDING_ACCEPTANCE`/`ACTIVE`/`DELINQUENT` con dirección, monto, estado, próximo pago y `daysPastDue` | ✅ `activeDeals[]` |
| **Needs attention** — mora | Contratos `DELINQUENT` (máx. 10) | ✅ `needsAttention[]` (`type=LATE_PAYMENT`) |
| **Needs attention** — verificaciones (1 alerta agregada) | `VerificationRequest` `PENDING` | ✅ `needsAttention[]` (`type=VERIFICATIONS_PENDING`, `AD-003`) |
| **Needs attention** — PML fee sin confirmar, payout de afiliados, draw requests | No existe ninguna tabla ni estado | ❌ (`AD-004`, `AD-007`, `AD-008`) |
| **Recent signups** — nombre, tipo, fecha, deals | `User` (`LENDER`/`BORROWER`) + conteo de contratos | ✅ `recentSignups[]` |
| **Recent signups** — Verified | Estado de verificación más reciente por precedencia `APPROVED > PENDING > REJECTED` | ✅ `recentSignups[].verification` (`AD-003`) |
| **Recent signups** — Revenue | No existe | ❌ (`AD-006`) |
| Sidebar: All Deals, Lenders | `GET /api/contracts` (ADMIN), `GET /api/admin/lenders` | ✅ ya existían |
| Sidebar: Verifications | `GET /api/admin/verifications` (cola con filtros y paginación) | ✅ endpoint listo (`AD-003`); sin vista propia en el front todavía |
| Sidebar: Borrowers, Revenue, Affiliates, Promo Codes, Settings | — | ❌ (`AD-010`, `AD-006`, `AD-007`, `AD-009`) |

---

## AD-001 — `GET /api/admin/overview` ✅

- **Objetivo**: un solo endpoint de agregación pura (sin tablas nuevas, mismo criterio que los dashboards de §6.12) que alimenta toda la pantalla `admin-panel.html`.
- **Prioridad/Complejidad/Dependencias**: P1 / M / `Contract`, `ContractTerms`, `ContractFeeItem`, `ScheduledPayment`, `User` (Fases 1, 6, 13)
- **Archivos afectados**: `src/app/api/admin/overview/route.ts`, `src/controllers/adminOverview.controller.ts`, `src/services/adminOverview.service.ts`, `src/app/api/admin/overview/admin-overview-routes.integration.test.ts`. Sin migraciones ni cambios de schema.
- **Implementación**: `withAuth` + `withRole(["ADMIN"], { requireTwoFactor: false })` (lectura, exenta de 2FA — mismo criterio que `GET /api/users`/`GET /api/audit-logs`). El servicio dispara 13 consultas en una sola `Promise.all` (`count`/`aggregate`/`findMany`, incluidas las 6 de closing fees por mes), más un `groupBy` de `ScheduledPayment` para los días de atraso y hasta 2 conteos de deals por cada signup. Closing fees solo suma la versión de términos **vigente** (`currentForContract`): cada versión nueva inserta su propia fila de fee (`D-S2-5`) y sumarlas todas duplicaría el cobro. Lo que no tiene fuente (`pendingVerifications`, `subscriptions`, `interestShare`, `affiliatePayouts`, `net`) viaja `null`.
- **Respuesta** (montos como string, igual que el resto de la API):
  ```jsonc
  {
    "kpis": { "activeDeals": { "count": 34, "addedLast7d": 3 }, "totalFunded": "3800000", "lateContracts": 3, "pendingVerifications": null },
    "revenue": {
      "month": "2026-09", "closingFees": "1725",
      "subscriptions": null, "interestShare": null, "affiliatePayouts": null, "net": null,
      "last6Months": [ { "month": "2026-04", "total": "0" } /* ... 6 meses, el último es el actual */ ]
    },
    "activeDeals": [ { "contractId": "...", "contractNumber": "PML-...", "property": { "addressLine1": "...", "city": "...", "state": "TX" },
                       "principalAmount": "115000", "status": "ACTIVE", "daysPastDue": null, "nextPaymentDueDate": "2026-11-01T00:00:00.000Z" } ],
    "needsAttention": [ { "type": "LATE_PAYMENT", "severity": "red", "title": "5521 Germantown Rd", "detail": "15 days past due",
                          "entityType": "Contract", "entityId": "...", "occurredAt": "..." } ],
    "recentSignups": [ { "userId": "...", "name": "...", "role": "BORROWER", "isActive": true, "createdAt": "...", "dealsCount": 1 } ]
  }
  ```
- **Tests**: `admin-overview-routes.integration.test.ts` (Postgres real, sin mocks) — sin token → 401, `LENDER` → 403; y el camino dorado: siembra un contrato `ACTIVE` con fee de marketplace, uno `DELINQUENT` con un pago vencido hace 15 días, uno `PENDING_ACCEPTANCE` y un `DRAFT`, y verifica los deltas de KPIs, closing fees, `daysPastDue = 15`, la alerta, que el `DRAFT` no aparece, y `dealsCount = 3`.
- **Criterios de aceptación**: ✅ ADMIN recibe la agregación completa · ✅ otro rol → 403, sin token → 401 · ✅ un contrato `DRAFT` no cuenta en ningún número · ✅ closing fees no se duplican por versión de términos · ✅ `type-check` (de los archivos nuevos)/`lint` limpios, verificado por `curl` contra el contenedor `api` con el seed.
- **Techos conocidos** (marcados con `ponytail:` en el código): `recentSignups` hace una consulta de conteo por usuario (5 filas) — pasar a un `groupBy` si esa lista se pagina; `activeDeals` es "los 5 más recientes", no "los 5 más urgentes" (las morosas igual salen en `needsAttention`).

---

## AD-002 — Programar el job de mora ✅

- **Objetivo**: que `Contract.status = DELINQUENT` se mantenga solo. `AD-001` (KPI *Late payments*, alerta de mora) y todo el resto del sistema leen ese estado, y `recomputeContractDelinquencyStatus` (`BE-063`) no tenía ningún disparador.
- **Prioridad/Complejidad/Dependencias**: P0 / S / `BE-063` (ya implementado)
- **Archivos afectados**: `src/jobs/scheduler.ts` (nuevo), `src/instrumentation.ts` (nuevo), `src/jobs/scheduler.integration.test.ts` (nuevo), `package.json`/`pnpm-lock.yaml` (`node-cron` 4.6), `src/jobs/README.md`. Sin migraciones ni variables de entorno nuevas.
- **Implementación**: `register()` de `src/instrumentation.ts` (hook de arranque de Next, solo si `NEXT_RUNTIME === "nodejs"`; `node-cron` no carga en edge) llama a `startJobs()`. Este agenda `runDelinquencyJob` con `0 2 * * *` en UTC (los vencimientos caen a medianoche UTC) y dispara **una corrida inmediata** al arrancar, sin bloquear el arranque: si el contenedor estuvo caído a las 02:00, no espera un día más. `runDelinquencyJob` atrapa y loguea cualquier error (`logger.error`) para que un fallo no tumbe el proceso ni la siguiente corrida. Un flag de módulo evita registrar la tarea dos veces.
- **Deliberadamente fuera**: `assessLateFees` (`BE-064`) **no** se programó — cobra dinero, así que activarlo solo es una decisión de negocio, no de infraestructura. Sigue invocable a mano.
- **Techo conocido** (`ponytail:` en el código): asume **una sola instancia** de `api` (así está `docker-compose.yml`). Con réplicas, cada una correría el job — es idempotente, pero duplicaría el audit de un mismo cambio; pasar a un cron externo o a un advisory lock de Postgres.
- **Tests**: `scheduler.integration.test.ts` (Postgres real) — la corrida programada marca `DELINQUENT` un contrato `ACTIVE` con una cuota vencida más allá de la gracia; `startJobs` registra exactamente una tarea `delinquency` con el patrón `0 2 * * *`, aunque se llame dos veces. La lógica de mora en sí sigue cubierta por `recomputeContractDelinquency.integration.test.ts`.
- **Criterios de aceptación**: ✅ el cron se registra una vez al levantar el servidor (verificado con `next dev`, con `next build` + servidor `standalone` — confirma que `node-cron` entra en la imagen `runner` — y con el contenedor de desarrollo) · ✅ una corrida al arrancar antes de `Ready` · ✅ un error del job se loguea sin tumbar el proceso.
- **Operativo**: al agregar la dependencia hay que reconstruir el contenedor de desarrollo (`docker compose -f docker-compose.dev.yml up -d --build api`) o correr `pnpm install` dentro y reiniciarlo — su `node_modules` es un volumen propio, y sin `node-cron` adentro todo request responde 500. Además, `instrumentation.ts` solo se lee al arrancar: un `next dev` ya levantado no lo toma sin reinicio.

---

## AD-003 — Verificación de entidad ("Business") ✅

- **Objetivo**: cubrir el tier **Business Verified** de `lender/verification.html` (entidad + EIN) para Lender y Borrower, y alimentar `kpis.pendingVerifications`, la alerta agregada y la columna *Verified* de `recentSignups`. **No** cubre el tier **Fully Verified** (SSN + ID + background check): eso es `BorrowerApplication`/`PB-018` (identidad, con proveedor de credit pull/background check todavía sin elegir, riesgos #22/#23) — mezclar ambos en una tabla habría acoplado un flujo sin bloqueo (entidad) a uno bloqueado por proveedor (identidad).
- **Prioridad/Complejidad/Dependencias**: P1 / M / `LenderCompany`, `BorrowerProfile` (Fase 1)
- **Archivos afectados**: `prisma/schema.prisma` (`VerificationRequest`, enums `VerificationStatus`/`EntityType`, migración `20260926001016_ad003_verification_requests`), `src/validations/verifications.validation.ts`, `src/services/verifications.service.ts`, `src/controllers/verifications.controller.ts`, 5 rutas nuevas, `src/app/api/admin/verifications/verifications-routes.integration.test.ts`, `src/services/adminOverview.service.ts` (conecta `pendingVerifications`/la alerta/`recentSignups[].verification`, antes `null`), `src/lib/audit.ts` (3 acciones nuevas), `src/validations/lenders.validation.ts` (`ein`/`state` pasan a exportados, para no duplicarlos).
- **Modelo**: `VerificationRequest` — `lenderCompanyId?`/`borrowerProfileId?` (exactamente uno, regla de servicio, mismo criterio que `Document` en `D-S2-8`), `status` (`PENDING`/`APPROVED`/`REJECTED`), `entityName`/`entityType`/`ein`/`stateOfFormation`/`signatoryName?`/`signatoryTitle?`, `submittedByUserId`, `reviewedByUserId?`/`reviewedAt?`/`rejectionReason?`. Sin archivos (Articles of Organization, ID) — no existe `Document`/S3 todavía (Fase 11); el Admin revisa contra lo que el propio Lender/Borrower ya tiene cargado (dirección, EIN) más lo que declara acá. Sin SSN en ningún campo — eso es identidad, no entidad (`D-A9`).
- **"Verificado" no es una columna**: es "existe una `VerificationRequest` `APPROVED` para ese sujeto" — mismo criterio que `LenderCompany.deployedCapital`/`averageRating` (`D-S2-11`/`D-S2-13`, derivado, no una columna que se pueda desincronizar).
- **Endpoints**:
  | Método | Ruta | Rol | Notas |
  |---|---|---|---|
  | POST/GET | `/api/lenders/me/companies/:companyId/verification` | LENDER (dueño de la empresa) | POST es escritura de negocio (2FA, `D-P3-1`); GET no |
  | POST/GET | `/api/borrowers/me/verification` | BORROWER | ninguno de los dos exige 2FA (`D-P3-1` no alcanza a BORROWER) |
  | GET | `/api/admin/verifications` | ADMIN | cola paginada, filtros `status`/`subject`/`search` (por `entityName`); `status=PENDING` ordena la más vieja primero (cola), el resto la más reciente primero |
  | POST | `/api/admin/verifications/:id/approve` | ADMIN | 2FA (escritura) |
  | POST | `/api/admin/verifications/:id/reject` | ADMIN | body `{ reason }` obligatorio; 2FA |
- **Reglas de servicio**: una solicitud `PENDING` o `APPROVED` existente bloquea un nuevo envío (`409 VERIFICATION_PENDING`/`VERIFICATION_ALREADY_APPROVED` — reenviar solo tiene sentido tras un `REJECTED`). Aprobar/rechazar usa `updateMany` con `status: PENDING` en el `WHERE`: si dos Admins revisan la misma solicitud a la vez, solo uno gana, el otro recibe `409 VERIFICATION_NOT_PENDING` (no una carrera silenciosa). Toda transición audita (`VERIFICATION_SUBMITTED`/`_APPROVED`/`_REJECTED`).
- **Techo conocido** (`ponytail:` en el código): "una `PENDING` por sujeto a la vez" se valida con *check-then-insert*, no con un índice único parcial (Prisma no lo expresa sin generar drift en `migrate dev`) — dos envíos exactamente simultáneos podrían dejar dos `PENDING`; no rompe nada (aprobar una no invalida la otra), solo duplica una fila. Agregar el índice a mano si llega a pasar.
- **Tests**: `verifications-routes.integration.test.ts` (Postgres real, sin mocks) — camino dorado completo (Lender envía → aparece en la cola y en `GET /api/admin/overview` → se aprueba → ya no se puede reenviar → aprobar de nuevo da 409), rechazo con motivo + reenvío tras rechazo, y control de acceso (EIN inválido 400, empresa ajena 404, rol equivocado 403, sin token 401, solicitud inexistente 404). `admin-overview-routes.integration.test.ts` ampliado para cubrir que `verification` sea `null` sin solicitudes.
- **Criterios de aceptación**: ✅ `pendingVerifications`/la alerta/`recentSignups[].verification` de `AD-001` dejan de ser `null` · ✅ ningún flujo existente cambia de comportamiento (verificar es informativo, no bloquea nada — `D-A10`) · ✅ `type-check`/`lint`/`next build` limpios, 3 tests de integración nuevos en verde, migración aplicada y verificada por `curl` contra el contenedor `api` con el seed.

---

## Lo que falta (pendiente, en orden sugerido)

| ID | Qué | Por qué falta / bloqueo | Prioridad |
|---|---|---|---|
| **AD-004** | **Confirmación del PML fee** — `Contract.platformFeeConfirmedAt` (+ quién) y acción de admin | `ContractFeeItem` es de solo inserción (regla 16 de [04 §4.7](../04-base-de-datos.md#47-modelo-extendido--marketplace-fees-vetting-notificaciones-ratings-revisión-2026-09-10)), no puede llevar estado. Hay que confirmar con Spencer qué significa "confirmado" (¿cobrado en el cierre por el abogado/titulación?). | P2 |
| **AD-005** | **Nombre de entidad del borrower** — `BorrowerProfile.entityName?` | Los signups del mock mezclan personas ("Marcus Johnson") con entidades ("Rivera Holdings"); `LenderCompany.companyName` existe pero `BorrowerProfile` no tiene equivalente. Hoy `recentSignups.name` es `User.name`. | P2 |
| **AD-006** | **Líneas de ingreso restantes** — Subscriptions, Interest share, Net, MRR, columna *Revenue* de signups | Suscripciones = `BorrowerSubscription` (`PB-019`, cobro bloqueado por Stripe Connect `A-3`); "interest share" **no está definido en ningún documento** ([15 #31](../15-riesgos-y-decisiones-pendientes.md)); "MRR" en el mock es el total mensual, no lo recurrente ([15 #32](../15-riesgos-y-decisiones-pendientes.md)). Ver [`D-A4`](../00-contradicciones-y-decisiones.md#decisiones-2026-09-25-ronda-admin-overview). No crear un ledger de ingresos antes de que exista el cobro. | P2 |
| **AD-007** | **Afiliados** — `referralCode` en el registro, tabla de referidos/comisiones/payouts, rol o perfil de afiliado, "Confirm bank accounts" | No existe ni en el plan ni en el schema (`UserRole` no tiene `AFFILIATE`). La vista `lender/affiliate-dashboard.html` sugiere comisiones por suscripción + interest share + closing fee, pero no hay reglas escritas. Payouts reales dependen de Stripe (`A-3`). | P3 |
| **AD-008** | **Draw requests** — alerta "N draw requests awaiting lender approval" | `D-S2-15`: Construction Draw es `FUTURE FEATURE`; `borrower/draw-request.html` describe un proceso **manual** (el borrower solo registra el draw ya recibido), sin aprobación del lender. La alerta del admin contradice ese diseño ([15 #33](../15-riesgos-y-decisiones-pendientes.md)). Decidir antes de modelar `DrawRequest`. | P3 |
| **AD-009** | **Promo codes** — `PromoCode`/`PromoRedemption` | Solo aparece en el sidebar; ningún documento lo define. | P3 |
| **AD-010** | **Listados admin de las otras pantallas del sidebar** — `GET /api/admin/borrowers`; paginar `GET /api/users` (hoy devuelve todos sin paginar) | Cada pantalla del sidebar necesita su endpoint; solo All Deals y Lenders están cubiertas. | P2 |
| **AD-011** | **Acciones implícitas de la vista** — "Send lender alert" (aviso al lender por un contrato moroso), "Clear all" | El aviso necesita `Notification` (`PB-022`, Fase 11) o al menos `sendEmail`. "Clear all" queda fuera de v1 (`D-A7`): las alertas se derivan de los datos, no se persisten. | P3 |
| — | Índices (`Contract.status`, `ScheduledPayment(status, dueDate)`) | **No agregar hasta medir.** Con decenas de contratos no se nota. | — |

---

[← Índice de fases](README.md)  ·  [Backlog](../13-backlog.md)  ·  [Anterior: Fase 15 — Exports contables](fase-15-exports-reporting.md)
