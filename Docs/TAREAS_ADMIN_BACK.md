# Admin Dashboard — Tareas del back (APIs por crear)

Uso: dime "ejecuta AB-02" y la hago. Cada tarea es chica y deja su test de integración. Marca `[x]` al terminar.
Contexto: Fase 16 en [IMPLEMENTATION_PROGRESS.md](IMPLEMENTATION_PROGRESS.md) y [plan/fases/fase-16-admin-overview.md](plan/fases/fase-16-admin-overview.md). Los IDs `AD-xxx` de ahí se conservan donde aplica.
Front que las consume: `paymyloan/Docs/TAREAS_ADMIN_DASHBOARD.md`. `⛔` = decisión de negocio pendiente.

## Qué ya existe para el Admin (no hay que crear)
`GET/POST/PATCH/DELETE /api/users`, `POST /api/admin/users/:id/activate|deactivate`, `/api/admin/lenders` (lista, detalle, delete, CRUD de companies), `GET /api/admin/overview`, `/api/admin/verifications` (+approve/reject), `GET /api/audit-logs`, `GET /api/contracts` (+detalle/schedule/balance/transactions), `PATCH /api/contracts/:id`, `POST /api/transactions/:id/reverse`, 2FA, notificaciones.

## Falta crear

### Listados que la UI ya pide
- [x] **AB-01** `GET /api/users`: paginación (`page`/`pageSize`) + filtros `role`, `isActive`, `search`. **Hecha 2026-10-19.** Compatibilidad: sin query params devuelve el array completo como antes; con cualquiera, devuelve `{items,page,pageSize,total,totalPages}`. (parte de `AD-010`)
- [x] **AB-02** **Hecha 2026-10-19.** `GET /api/admin/borrowers` — lista paginada con `search`, estado de verificación y conteo de contratos (espejo de `GET /api/admin/lenders`). (`AD-010`)
- [x] **AB-03** **Hecha 2026-10-19** (también editable en `PATCH /api/borrowers/me`). `BorrowerProfile.entityName` (migración + exponerlo en `recentSignups` y `admin/borrowers`). (`AD-005`)
- [x] **AB-04** **Hecha 2026-10-19:** `status` ya existía; se agregó `search` (número/dirección). `GET /api/contracts` (Admin): confirmar/agregar filtro `status` y `search` por dirección/número. Verificar en `contracts.service.ts#listContracts` antes de tocar nada.

### Módulos sin backend (vistas placeholder)
- [ ] **AB-05** Revenue: `GET /api/admin/revenue` con el desglose mensual (closing fees ya sale de `overview`; falta suscripciones, interest share, net). ⛔ Bloqueado por Stripe Connect (`A-3`), `PB-019` y definiciones de negocio (riesgos #31/#32). (`AD-006`)
- [ ] **AB-06** Affiliates: modelo + `GET/POST /api/admin/affiliates` (referidos, comisión, payouts). No existe en plan ni schema → ⛔ definir modelo primero. (`AD-007`)
- [ ] **AB-07** Promo codes: modelo `PromoCode` + `GET/POST/PATCH/DELETE /api/admin/promo-codes`. Solo aparece en el sidebar → ⛔ definir qué descuenta (suscripción, closing fee). (`AD-009`)
- [ ] **AB-08** Catalog: la vista tiene tabs, categoría, "pricing" y "status" → parece un catálogo de productos/planes. ⛔ definir qué es antes de modelarlo; si es el catálogo de planes de suscripción, depende de AB-05.
- [ ] **AB-09** Settings de plataforma: `GET/PATCH /api/admin/settings` (PML fee, flags). ⛔ definir qué parámetros son editables por el Admin hoy hardcodeados/en `env`.

### Overview y acciones
- [x] **AB-10** **Hecha 2026-10-19:** `POST /api/admin/lenders/:id/alerts` (`ADMIN_ALERT`). Acciones del Overview: "Send lender alert" (crear `Notification` a un lender — depende de la fase 19 de notificaciones). "Clear all" queda fuera de v1 (`D-A7`). (`AD-011`)
- [ ] **AB-11** Confirmación del PML fee (`Contract.platformFeeConfirmedAt`) + endpoint admin para confirmarlo. ⛔ falta definir qué es "confirmado" (riesgo #34). (`AD-004`)
- [ ] **AB-12** Draw requests. ⛔ contradice el diseño v1 manual (riesgo #33, `D-S2-15`); no hacer sin decisión. (`AD-008`)

## Chequeos pequeños (pueden salir al ejecutar el front)
- [x] **AB-13** **Hecha 2026-10-19:** `reason` ya era obligatorio; documentado. `POST /api/admin/verifications/:id/reject`: confirmar si acepta `reason` y que `API_REFERENCE.md` lo diga.
- [x] **AB-14** **Hecha 2026-10-19:** se agregaron `from`/`to`/`actorId`. `GET /api/audit-logs`: confirmar filtro por rango de fechas (`from`/`to`) y por `actorId`; agregarlo si falta (AF-18 lo usa).
- [x] **AB-15** **Hecha 2026-10-19:** responde a ADMIN pero no se le genera ningún evento (lista vacía); documentado. Notificaciones para ADMIN: confirmar si `GET /api/notifications` responde al rol ADMIN y qué eventos le generan (AF-22).
