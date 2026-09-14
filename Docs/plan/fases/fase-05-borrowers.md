[← Índice de fases](README.md)  ·  [Backlog](../13-backlog.md)  ·  [Anterior: Fase 4 — Users / Admin / Lenders](fase-04-admin-lenders.md)  ·  [Siguiente: Fase 6 — Contracts](fase-06-contracts.md)

---

# Fase 5 — Borrowers

> **Nota 2026-09-10**: las dependencias `BE-037` de abajo son del texto **original** de este documento, ya implementado sin ellas (`D-P4-1`, resuelto con `lenderCompanyId` explícito en el body en vez de un middleware — ver [17](../17-fase-2-actualizada.md) y `IMPLEMENTATION_PROGRESS.md`). `BE-037` queda formalmente descartado (`D-P6-1`, ver [00](../00-contradicciones-y-decisiones.md#decisión-2026-09-10-ronda-fase-6--arranque-d-p6-1-withtenantscope-descartado)) — no se reintroduce en ninguna fase futura.

## BE-045 — `POST /api/lenders/me/borrowers`
- **Prioridad/Complejidad/Dependencias**: P0 / M / ~~BE-037~~ (descartado, `D-P6-1`), BE-010, BE-006
- **Implementación**: crea `User(role=BORROWER)` + `BorrowerProfile(lenderId=session.lenderId)` en `$transaction`; contraseña temporal por correo, igual que BE-040.
- **Tests**: el `lenderId` del nuevo `BorrowerProfile` siempre es `session.lenderId`, nunca uno enviado en el body (aunque se envíe, se ignora).

## BE-046 — `GET /api/lenders/me/borrowers` (lista + búsqueda + paginación)
- **Prioridad/Complejidad/Dependencias**: P0 / M / BE-045

## BE-047 — `GET /api/lenders/me/borrowers/:id`
- **Prioridad/Complejidad/Dependencias**: P0 / S / BE-045

## BE-048 — `PATCH /api/lenders/me/borrowers/:id`
- **Prioridad/Complejidad/Dependencias**: P1 / S / BE-045

## BE-049 — `DELETE /api/lenders/me/borrowers/:id`
- **Prioridad/Complejidad/Dependencias**: P1 / M / BE-045
- **Validaciones**: bloqueado si el deudor tiene `ContractBorrower` activo en un contrato `ACTIVE`/`DELINQUENT`.

## BE-050 — `GET /api/borrowers/me`, `PATCH /api/borrowers/me`, `POST /api/borrowers/me/password`
- **Prioridad/Complejidad/Dependencias**: P0 / M / ~~BE-037~~ (descartado, `D-P6-1`)
- **Implementación**: incluye el flujo de "primer login con contraseña temporal" — el backend marca `mustChangePassword` (campo derivado, no columna: se infiere de un flag simple `passwordSetAt IS NULL` o similar) y bloquea otros endpoints hasta que se cambie.

---

[← Índice de fases](README.md)  ·  [Backlog](../13-backlog.md)  ·  [Anterior: Fase 4 — Users / Admin / Lenders](fase-04-admin-lenders.md)  ·  [Siguiente: Fase 6 — Contracts](fase-06-contracts.md)
