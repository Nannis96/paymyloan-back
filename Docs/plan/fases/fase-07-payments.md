[← Índice de fases](README.md)  ·  [Backlog](../13-backlog.md)  ·  [Anterior: Fase 6 — Contracts](fase-06-contracts.md)  ·  [Siguiente: Fase 8 — Testing](fase-08-testing.md)

---

# Fase 7 — Payments

## BE-065 — `POST /api/payment-methods` (SetupIntent) y `GET`/`DELETE`
- **Prioridad/Complejidad/Dependencias**: P1 / L / BE-018, integración Stripe (ver sección [15](../15-riesgos-y-decisiones-pendientes.md), bloqueado hasta cerrar A-3)
- **Nota**: bloqueado por decisión de negocio pendiente — ver sección [15](../15-riesgos-y-decisiones-pendientes.md).

## BE-066 — `POST /api/contracts/:id/payments` (ACH del deudor)
- **Prioridad/Complejidad/Dependencias**: P1 / L / BE-065
- **Nota**: mismo bloqueo.

## BE-067 — `POST /api/contracts/:id/payments/manual`
- **Prioridad/Complejidad/Dependencias**: P1 / M / BE-016, BE-038
- **Implementación**: no depende de Stripe — se puede implementar antes que BE-065/066, útil para reconciliación manual desde el día uno.

## BE-068 — Servicio `calculatePaymentAllocation` + `applyTransaction`
- **Prioridad/Complejidad/Dependencias**: P0 / L / BE-017, BE-059
- **Tests**: sección [11](../11-testing.md), waterfall.

## BE-069 — `GET /api/contracts/:id/transactions` y `GET /api/transactions/:id`
- **Prioridad/Complejidad/Dependencias**: P1 / M / BE-067

## BE-070 — `POST /api/webhooks/stripe` + `WebhookEvent`
- **Prioridad/Complejidad/Dependencias**: P1 / L / BE-019, BE-065
- **Nota**: bloqueado por A-3.

## BE-071 — Servicio `reverseTransaction` + `POST /api/transactions/:id/reverse`
- **Prioridad/Complejidad/Dependencias**: P1 / M / BE-068

## BE-072 — `GET /api/audit-logs`
- **Prioridad/Complejidad/Dependencias**: P2 / M / BE-020 (~~BE-037~~ descartado, `D-P6-1` — el filtro por Lender es `WHERE lenderCompanyId IN (mis empresas)`, igual que cualquier otro listado tenant-scoped)

> **Nota 2026-09-10**: `Transaction.platformFeeAmount` (`D-S2-4`, ver [00](../00-contradicciones-y-decisiones.md#decisiones-2026-09-10-ronda-product-spec-v2--commitment-letter-spec) y [04 §4.7](../04-base-de-datos.md#47-modelo-extendido--marketplace-fees-vetting-notificaciones-ratings-revisión-2026-09-10)) se calcula dentro de `applyTransaction` (`BE-068`) — resuelve el riesgo #2 de [15](../15-riesgos-y-decisiones-pendientes.md) con un número concreto (ACH cost + $9, tope $99/mes/contrato). No agrega un ticket nuevo a esta fase — es un campo más que `BE-068` debe poblar.

---

[← Índice de fases](README.md)  ·  [Backlog](../13-backlog.md)  ·  [Anterior: Fase 6 — Contracts](fase-06-contracts.md)  ·  [Siguiente: Fase 8 — Testing](fase-08-testing.md)
