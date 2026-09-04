[← Índice de fases](README.md)  ·  [Backlog](../13-backlog.md)  ·  [Anterior: Fase 2 — Authentication](fase-02-authentication.md)  ·  [Siguiente: Fase 4 — Users / Admin / Lenders](fase-04-admin-lenders.md)

---

# Fase 3 — Authorization

## BE-035 — Middleware `withAuth`
- **Prioridad/Complejidad/Dependencias**: P0 / M / BE-025
- **Tests**: sin header → 401; token expirado → 401; token válido → adjunta `session`.

## BE-036 — Middleware `withRole`
- **Prioridad/Complejidad/Dependencias**: P0 / M / BE-035, BE-033
- **Implementación**: incluye la verificación de `TWO_FACTOR_REQUIRED` de sección [7.4](../07-autenticacion-y-autorizacion.md#74-2fa-obligatorio-para-admin-y-lender).
- **Tests**: ADMIN sin 2FA activo → 403 en cualquier endpoint fuera de `/2fa/*`; BORROWER nunca requiere 2FA.

## BE-037 — Middleware `withTenantScope`
- **Prioridad/Complejidad/Dependencias**: P0 / M / BE-036
- **Implementación**: sección [7.5](../07-autenticacion-y-autorizacion.md#75-rbac--aislamiento-multi-tenant--cómo-se-evita-que-un-prestamista-acceda-a-datos-de-otro).
- **Tests**: la suite parametrizada multi-tenant descrita en sección [11](../11-testing.md).

## BE-038 — Helper `requireContractAccess(session, contractId)`
- **Prioridad/Complejidad/Dependencias**: P0 / M / BE-037
- **Implementación**: resuelve acceso tanto para `LENDER` (`contract.lenderId`) como para `BORROWER` (`ContractBorrower` activo) — usado por todo el módulo de contratos y pagos.
- **Tests**: cubre los 4 casos (lender dueño, lender ajeno, borrower asociado, borrower no asociado).

## BE-039 — Auditoría automática de accesos denegados
- **Prioridad/Complejidad/Dependencias**: P2 / S / BE-020, BE-037
- **Objetivo**: todo 403/404 por mismatch de tenant queda en `AuditLog` con `action='ACCESS_DENIED'` — señal temprana de un intento de acceso indebido o de un bug de frontend.

---

[← Índice de fases](README.md)  ·  [Backlog](../13-backlog.md)  ·  [Anterior: Fase 2 — Authentication](fase-02-authentication.md)  ·  [Siguiente: Fase 4 — Users / Admin / Lenders](fase-04-admin-lenders.md)
