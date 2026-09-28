# jobs/

Tareas programadas fuera del ciclo request/response.

**Programadas** (`scheduler.ts`, AD-002): recómputo de mora
(`recomputeContractDelinquency.ts`, BE-063) — `node-cron` dentro del propio
proceso, todos los días a las 02:00 UTC y una vez al arrancar (para
converger si el servidor estuvo caído a esa hora). Se registra desde
`src/instrumentation.ts`, el hook de arranque de Next. Asume **una sola
instancia** de `api`; con réplicas, mover a un cron externo o a un advisory
lock de Postgres.

**Sin programar a propósito**: cargos por atraso (`assessLateFees.ts`,
BE-064) — cobra dinero, así que activarlo automáticamente es una decisión de
negocio, no de infraestructura. Sigue siendo una función exportada,
invocable a mano (y así la prueba su `*.integration.test.ts`).

Pendiente, sin implementar: expiración de tokens viejos
(`expireStaleTokens.ts`).
