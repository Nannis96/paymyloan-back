# jobs/

Tareas programadas fuera del ciclo request/response: recómputo de mora
(`recomputeContractDelinquency.ts`), cargos por atraso
(`assessLateFees.ts`), expiración de tokens viejos
(`expireStaleTokens.ts`). Corren por cron externo o `node-cron` dentro del
contenedor — decisión de implementación pendiente, no bloqueante.

Vacío por ahora. Se llena a partir de la
[Fase 6 (Contracts)](../../Docs/plan/fases/fase-06-contracts.md) del plan de
backend (BE-063/064).
