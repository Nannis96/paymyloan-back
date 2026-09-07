[← Índice del plan](README.md)  ·  [Anterior: 12. Docker / despliegue](12-docker-y-despliegue.md)  ·  [Siguiente: 14. Roadmap recomendado](14-roadmap.md)

---

# 13. Backlog detallado

Convención de cada ítem: **Objetivo**, **Archivos/componentes afectados**, **Dependencias**, **Prioridad** (P0 bloqueante / P1 core / P2 importante / P3 opcional), **Complejidad** (S/M/L), **Implementación**, **Validaciones**, **Tests**, **Criterios de aceptación**.

> **Fase 1 reescrita 2026-09-04**: [fases/fase-01-database.md](fases/fase-01-database.md) quedó superado por el nuevo contexto funcional (roles `BOOKKEEPER`/`INSURANCE_COMPANY`, `LenderCompany`, `Property`). El backlog vigente de Fase 1 es **[16. Fase 1 — plan actualizado](16-fase-1-actualizada.md)**.
>
> **Fase 2 reescrita 2026-09-06/07**: [fases/fase-02-authentication.md](fases/fase-02-authentication.md) quedó superado por la corrección de `PB-013` (auto-registro de `LENDER`/`BORROWER`, sin contraseña) y el ticket nuevo `BE-097` (activación por Admin). El backlog vigente de Fase 2 es **[17. Fase 2 — plan actualizado](17-fase-2-actualizada.md)**; el resto de las fases (3 en adelante) no se tocó todavía — ver riesgo #18 en [15](15-riesgos-y-decisiones-pendientes.md) sobre su impacto pendiente (ya acotado por `D-P2-2`, pero no cerrado del todo).

Los 85 ítems originales viven en un documento por fase, bajo [`fases/`](fases/) —
[índice completo de tickets aquí](fases/README.md#índice-de-tickets):

| Fase | Documento | Tickets |
|---|---|---|
| 0 | [Foundation](fases/fase-00-foundation.md) | BE-001 → BE-007 |
| 1 | [Database](fases/fase-01-database.md) | BE-008 → BE-023 |
| 2 | [Authentication](fases/fase-02-authentication.md) | BE-024 → BE-034 |
| 3 | [Authorization](fases/fase-03-authorization.md) | BE-035 → BE-039 |
| 4 | [Users / Admin / Lenders](fases/fase-04-admin-lenders.md) | BE-040 → BE-044 |
| 5 | [Borrowers](fases/fase-05-borrowers.md) | BE-045 → BE-050 |
| 6 | [Contracts](fases/fase-06-contracts.md) | BE-051 → BE-064 |
| 7 | [Payments](fases/fase-07-payments.md) | BE-065 → BE-072 |
| 8 | [Testing](fases/fase-08-testing.md) | BE-073 → BE-079 |
| 9 | [Docker / Deployment](fases/fase-09-docker-deployment.md) | BE-080 → BE-084 |
| 10 | [Opcional / fuera del roadmap mínimo](fases/fase-10-opcional.md) | BE-085 |

El orden de implementación no es el de numeración — ver [14. Roadmap recomendado](14-roadmap.md).

---

[← Índice del plan](README.md)  ·  [Anterior: 12. Docker / despliegue](12-docker-y-despliegue.md)  ·  [Siguiente: 14. Roadmap recomendado](14-roadmap.md)
