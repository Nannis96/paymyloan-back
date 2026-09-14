[← Índice de fases](README.md)  ·  [Backlog](../13-backlog.md)  ·  [Anterior: Fase 8 — Testing](fase-08-testing.md)  ·  [Siguiente: Fase 10 — Opcional / fuera del roadmap mínimo](fase-10-opcional.md)

---

# Fase 9 — Docker / Deployment

## BE-080 — Actualizar `docker-compose.yml`/`.dev.yml` a Postgres 18
- **Prioridad/Complejidad/Dependencias**: P0 / S / BE-001

## BE-081 — Servicio `db-test` en `docker-compose.dev.yml`
- **Prioridad/Complejidad/Dependencias**: P1 / S / BE-073

## BE-082 — `HEALTHCHECK` con verificación real de conectividad a Postgres
- **Prioridad/Complejidad/Dependencias**: P1 / S / BE-001

## BE-083 — Documentar variables de entorno de producción y secretos
- **Prioridad/Complejidad/Dependencias**: P1 / S / BE-003 a BE-006, BE-025
- **Implementación**: actualizar `.env.example` y el README con todas las variables de la sección [3.5](../03-arquitectura-backend.md#35-configuración-y-variables-de-entorno).

## BE-084 — Definir networking de producción (nginx compartido vs subdominio propio)
- **Prioridad/Complejidad/Dependencias**: P2 / M / decisión de infraestructura pendiente (sección [15](../15-riesgos-y-decisiones-pendientes.md))

---

[← Índice de fases](README.md)  ·  [Backlog](../13-backlog.md)  ·  [Anterior: Fase 8 — Testing](fase-08-testing.md)  ·  [Siguiente: Fase 10 — Opcional / fuera del roadmap mínimo](fase-10-opcional.md)
