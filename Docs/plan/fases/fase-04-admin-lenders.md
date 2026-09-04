[← Índice de fases](README.md)  ·  [Backlog](../13-backlog.md)  ·  [Anterior: Fase 3 — Authorization](fase-03-authorization.md)  ·  [Siguiente: Fase 5 — Borrowers](fase-05-borrowers.md)

---

# Fase 4 — Users / Admin / Lenders

## BE-040 — `POST /api/admin/lenders`
- **Prioridad/Complejidad/Dependencias**: P0 / M / BE-036, BE-009, BE-006
- **Implementación**: crea `User(role=LENDER, isTwoFactorEnabled=false)` + `LenderProfile` en una `$transaction`; genera contraseña temporal, la envía por correo (nunca la devuelve en la respuesta de la API).
- **Validaciones**: `email` único, `companyName` obligatorio.
- **Tests**: email duplicado → 409; el usuario creado no puede hacer nada fuera de `/auth/*` hasta cambiar contraseña + activar 2FA (ver BE-033).
- **Criterios de aceptación**: `AuditLog` registra `LENDER_CREATED` con `actorUserId=admin`.

## BE-041 — `GET /api/admin/lenders` (lista + búsqueda + paginación)
- **Prioridad/Complejidad/Dependencias**: P0 / M / BE-040
- **Validaciones**: query params `page`, `pageSize`, `search` (por `companyName`/`email`), `status`.

## BE-042 — `GET /api/admin/lenders/:id`
- **Prioridad/Complejidad/Dependencias**: P0 / S / BE-040
- **Implementación**: incluye conteo de deudores y contratos activos del tenant (resumen, no el detalle completo).

## BE-043 — `PATCH /api/admin/lenders/:id`
- **Prioridad/Complejidad/Dependencias**: P1 / S / BE-040

## BE-044 — `DELETE /api/admin/lenders/:id`
- **Prioridad/Complejidad/Dependencias**: P1 / M / BE-040
- **Validaciones**: bloqueado (`409`) si tiene `Contract` en estado `ACTIVE`/`DELINQUENT` — un tenant con deuda viva no se puede desactivar sin resolver antes.

---

[← Índice de fases](README.md)  ·  [Backlog](../13-backlog.md)  ·  [Anterior: Fase 3 — Authorization](fase-03-authorization.md)  ·  [Siguiente: Fase 5 — Borrowers](fase-05-borrowers.md)
