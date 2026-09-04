# repositories/

Acceso a Prisma detrás de una función con nombre de intención, solo para los
módulos cuyas queries mezclan múltiples `include`/filtros por tenant
(`contracts`, `payments`). Los módulos simples (`users`, `lenders`,
`borrowers`) siguen llamando a Prisma directo desde su `service`, como ya
hace `users.service.ts` — no se fuerza el patrón donde no aporta.

Vacío por ahora. Se llena a partir de la
[Fase 6 (Contracts)](../../Docs/plan/fases/fase-06-contracts.md) del plan de
backend (ver [§3.1](../../Docs/plan/03-arquitectura-backend.md)).
