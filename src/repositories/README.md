# repositories/

Acceso a Prisma detrás de una función con nombre de intención, solo para los
módulos cuyas queries mezclan múltiples `include`/filtros por tenant
(`contracts`, `payments`). Los módulos simples (`users`, `lenders`,
`borrowers`) siguen llamando a Prisma directo desde su `service`, como ya
hace `users.service.ts` — no se fuerza el patrón donde no aporta.

Sigue vacío tras implementar Fase 6 (2026-09-11): `contracts.service.ts`
terminó llamando a Prisma directo (mismo criterio que `users`/`lenders`/
`borrowers`) sin necesitar esta capa — sus queries no mezclaban suficiente
complejidad como para justificarla. Se retoma si `payments` (Fase 7) sí la
necesita.
