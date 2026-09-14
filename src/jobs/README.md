# jobs/

Tareas programadas fuera del ciclo request/response: recómputo de mora
(`recomputeContractDelinquency.ts`, BE-063), cargos por atraso
(`assessLateFees.ts`, BE-064). Corren por cron externo o `node-cron` dentro
del contenedor — decisión de implementación pendiente, no bloqueante; hoy
son funciones exportadas normales, invocables directamente (y así las
prueban sus `*.integration.test.ts`), sin ningún disparador automático
todavía.

Pendiente, sin implementar: expiración de tokens viejos
(`expireStaleTokens.ts`).
