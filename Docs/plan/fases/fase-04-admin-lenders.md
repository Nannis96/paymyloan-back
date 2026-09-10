[← Índice de fases](README.md)  ·  [Backlog](../13-backlog.md)  ·  [Anterior: Fase 3 — Authorization](fase-03-authorization.md)  ·  [Siguiente: Fase 5 — Borrowers](fase-05-borrowers.md)

---

# Fase 4 — Users / Admin / Lenders

> **`BE-040` rescopeado 2026-09-08 (`D-P4-5`)**: el texto original de abajo (crear `User`+`LenderProfile` de una) quedó reemplazado — la persona nace por auto-registro (`POST /api/auth/register`, `D-P2-1`), y `POST /api/admin/lenders` (nivel raíz) **se elimina**. Lo que sí queda de este ticket es la parte de la empresa, movida a `POST /api/admin/lenders/:id/companies` (Admin asocia una `LenderCompany` a un Lender que ya existe) y a `POST /api/lenders/me/companies` (`BE-101`, nuevo — el propio Lender se crea una empresa). Ver `D-P4-5` en [00](../00-contradicciones-y-decisiones.md#decisión-2026-09-08-rescopeo-post-fase-4-d-p4-5) para el detalle completo; contrato HTTP vigente en [API_REFERENCE.md](../../API_REFERENCE.md).

## BE-040 — `POST /api/admin/lenders` (texto original, superado — ver nota arriba)
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
