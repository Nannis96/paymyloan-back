[← Índice de fases](README.md)  ·  [Backlog](../13-backlog.md)  ·  [Anterior: Fase 7 — Payments](fase-07-payments.md)  ·  [Siguiente: Fase 9 — Docker / Deployment](fase-09-docker-deployment.md)

---

# Fase 8 — Testing (transversal, se ejecuta en paralelo a cada fase, no al final)

## BE-073 — Configurar entorno de test (DB de test, `vitest`/`jest`, scripts `pnpm test`)
- **Prioridad/Complejidad/Dependencias**: P0 / M / BE-001
- **Nota**: esto va primero en la práctica, no al final — se numera aquí solo por agrupación temática del backlog.

## BE-074 — Suite unit: amortización y allocation
- **Prioridad/Complejidad/Dependencias**: P0 / M / BE-058, BE-068, BE-073

## BE-075 — Suite integration: contratos + calendario
- **Prioridad/Complejidad/Dependencias**: P0 / L / BE-059, BE-073

## BE-076 — Suite integration: pagos + waterfall + duplicados
- **Prioridad/Complejidad/Dependencias**: P0 / L / BE-068, BE-073

## BE-077 — Suite API: auth + 2FA
- **Prioridad/Complejidad/Dependencias**: P0 / L / BE-027–BE-034, BE-073

## BE-078 — Suite multi-tenancy parametrizada
- **Prioridad/Complejidad/Dependencias**: P0 / L / BE-037, BE-051, BE-045, BE-073
- **Nota**: es la suite más importante de todo el backlog de testing — ver sección [11](../11-testing.md).

## BE-079 — Suite de seguridad negativa (rate limit, JWT manipulado, tokens reusados)
- **Prioridad/Complejidad/Dependencias**: P1 / M / BE-025, BE-029, BE-005, BE-073

---

[← Índice de fases](README.md)  ·  [Backlog](../13-backlog.md)  ·  [Anterior: Fase 7 — Payments](fase-07-payments.md)  ·  [Siguiente: Fase 9 — Docker / Deployment](fase-09-docker-deployment.md)
