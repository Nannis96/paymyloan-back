# PayMyLoan — Plan de Implementación de Backend

> **Estado**: Plan de trabajo para revisión. No implementado. No se modificó `schema.prisma`, código ni configuración de Docker como parte de este documento.
> **Fuentes analizadas**: `paymyloan-alcance.html` v0.1, [PAYMYLOAN_DATABASE_DESIGN.md](../PAYMYLOAN_DATABASE_DESIGN.md), código real de `Owner` (schema.prisma, auth.ts, auth.config.ts), código real de `paymyloan-back` (schema.prisma, src/), y las decisiones tomadas explícitamente por el encargo de este plan (ver [sección 0](00-contradicciones-y-decisiones.md)).
> **Compañero de este documento**: `paymyloan/PAYMYLOAN_FRONTEND_IMPLEMENTATION_PLAN.md` (proyecto separado, consumidor de esta API).

Este plan estaba en un solo archivo de ~1.500 líneas. Se dividió en un
documento por sección, y el backlog (sección 13) en un documento por fase de
implementación. El contenido es idéntico al original — solo cambió cómo está
repartido y se convirtieron las referencias cruzadas en enlaces navegables.

---

## Secciones

| # | Documento | De qué trata |
|---|---|---|
| 0 | [Contradicciones y decisiones de partida](00-contradicciones-y-decisiones.md) | Las 3 contradicciones detectadas (D0-1/2/3) y las 5 decisiones de arquitectura (A-1..A-5) que asume todo el resto |
| 1 | [Resumen de arquitectura propuesta](01-resumen-arquitectura.md) | Vista de 10.000 pies + multi-tenancy en una frase |
| 2 | [Diferencias PayMyLoan vs Owner](02-diferencias-owner.md) | Tabla REUSE / ADAPT / NEW / REMOVE pieza por pieza |
| 3 | [Arquitectura del backend](03-arquitectura-backend.md) | Estructura de carpetas, capas, módulos, variables de entorno, seguridad transversal |
| 4 | [Base de datos](04-base-de-datos.md) | Convenciones, ERD, las 15 tablas campo por campo, enums, índices y reglas de negocio a nivel de datos |
| 5 | [Qué NO debemos copiar de Owner](05-que-no-copiar-de-owner.md) | Lista explícita de lo que se deja fuera y por qué |
| 6 | [API — Endpoints por módulo](06-api-endpoints.md) | Mapa completo de rutas con rol y resolución de tenant |
| 7 | [Autenticación y autorización](07-autenticacion-y-autorizacion.md) | JWT propio, 2FA obligatorio, RBAC y aislamiento multi-tenant |
| 8 | [Contratos](08-contratos.md) | Ciclo de vida, versionado de términos, amortización |
| 9 | [Pagos](09-pagos.md) | `ScheduledPayment` vs `Transaction`, ciclo ACH, waterfall, idempotencia |
| 10 | [Migraciones y seeders](10-migraciones-y-seeders.md) | Orden de creación de tablas y contenido del seed |
| 11 | [Testing](11-testing.md) | Categorías de test, casos negativos y de seguridad obligatorios |
| 12 | [Docker / despliegue](12-docker-y-despliegue.md) | Postgres 18, compose, health checks, build de producción |
| 13 | [Backlog detallado](13-backlog.md) | Convención de los tickets → **[una fase por documento](fases/)** |
| 14 | [Roadmap recomendado](14-roadmap.md) | Orden de ejecución y qué está bloqueado |
| 15 | [Riesgos y decisiones pendientes](15-riesgos-y-decisiones-pendientes.md) | Los pendientes que pueden cambiar el diseño (10 originales + 9 nuevos del 2026-09-04) |
| 16 | [Fase 1 — plan actualizado (2026-09-04)](16-fase-1-actualizada.md) | Backlog vigente de la Fase 1 — reemplaza a [fases/fase-01-database.md](fases/fase-01-database.md), incorpora roles nuevos, `LenderCompany`, `Property` |
| 17 | [Fase 2 — plan actualizado (2026-09-07)](17-fase-2-actualizada.md) | Backlog vigente de la Fase 2, implementado — corrige `PB-013` (auto-registro LENDER+BORROWER, sin contraseña) y agrega `BE-097` (activación por Admin) |

## Fases de implementación (backlog)

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

## Cómo leerlo

- **Si vas a implementar**: [14. Roadmap](14-roadmap.md) para el orden → la [fase](fases/) que toca → la sección de referencia que cite el ticket.
- **Si vas a revisar decisiones**: [0. Contradicciones y decisiones](00-contradicciones-y-decisiones.md) y [15. Riesgos y decisiones pendientes](15-riesgos-y-decisiones-pendientes.md).
- **Estado real de avance**: no vive aquí — está en [IMPLEMENTATION_PROGRESS.md](../IMPLEMENTATION_PROGRESS.md), que además incorpora los deltas del Product Board (tickets `PB-*`) posteriores a este plan.

---

*Fin del plan. Ningún archivo del proyecto (`schema.prisma`, migraciones, rutas de API, `docker-compose.yml`, código) fue modificado como parte de este documento — es exclusivamente material de planificación.*
