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

## Ajustes posteriores a las fases (2026-09-07)

Dos tickets nuevos, fuera de la numeración de fase por fase — surgieron de un pedido puntual de Spencer sobre el CRUD de usuarios de Fase 0 y el módulo de auth de Fase 2, no de una fase completa nueva. `BE-098` se corrigió el mismo día (`D-P2-5`) para que la creación tampoco pida contraseña. Decisión y motivo completos en [00 — `D-P2-4`/`D-P2-5`](00-contradicciones-y-decisiones.md#decisiones-2026-09-06-ronda-fase-2); contrato HTTP completo en [API_REFERENCE.md](../API_REFERENCE.md).

### BE-098 — Restringir `/api/users` a ADMIN + `isActive` administrable + `User.phone` (+ `D-P2-5`: sin password en la creación)

- **Prioridad/Complejidad/Dependencias**: P0 / M / BE-025 (sesión), BE-097 (activación)
- **Objetivo**: cerrar el hueco de que el CRUD de usuarios de Fase 0 no verificaba sesión ni rol; permitir que el Admin fije `isActive` directamente al crear/editar; agregar teléfono a la identidad del usuario; que la creación no pida contraseña.
- **Archivos**: `prisma/schema.prisma` (+ migración `20260907213645_add_user_phone`), `src/auth/password.ts` (`generateTemporaryPassword`), `src/validations/users.validation.ts`, `src/services/users.service.ts`, `src/services/userActivation.service.ts` (nuevo — lógica de activación compartida con `BE-097`), `src/services/adminUsers.service.ts` (refactor para reusarla en vez de duplicarla), `src/controllers/users.controller.ts`, `src/app/api/users/route.ts`, `src/app/api/users/[id]/route.ts`.
- **Implementación**: los 4 endpoints exigen `requireSession` + `requireRole(ADMIN)`. `createUserSchema` gana `phone` (regex 10 dígitos) e `isActive` (boolean) — **y pierde `password`** (`D-P2-5`, corregido el mismo día): `POST /api/users` nunca pide contraseña, igual que el auto-registro. La cuenta nace con un valor aleatorio inutilizable; si el resultado es una cuenta activa (`isActive:true` explícito, o sin el campo — sigue siendo el default), `createUser()` reusa `activateUserAccount()` para generar+hashear+enviar por correo una contraseña temporal y **la devuelve en la respuesta** (`temporaryPassword`). `updateUserSchema` sí conserva `password` (edición directa por el Admin, caso distinto de la creación). En `PATCH /api/users/:id`, una transición `isActive: false → true` dispara esa misma lógica de activación (mismo camino que `POST /api/admin/users/:id/activate`); una reactivación no la toca. Una transición `true → false` revoca los refresh tokens vigentes, igual que `/deactivate`. Toda esa lógica vive una sola vez en `userActivation.service.ts` — ni `users.service.ts` ni `adminUsers.service.ts` la duplican (evita el ciclo de imports que se daría si uno importara del otro). `generateTemporaryPassword()` pasa de 16 caracteres alfanuméricos+símbolos a **8 dígitos numéricos** (`D-P2-5`) — cambio que alcanza parejo a los tres caminos que la usan (`POST /api/users`, `PATCH /api/users/:id`, `POST /api/admin/users/:id/activate`).
- **Validaciones**: `phone` opcional, exactamente 10 dígitos (`^\d{10}$`); si se manda `password` en un `PATCH` junto con una transición a `isActive:true`, se ignora — gana la contraseña recién generada, para no pisarla en silencio.
- **Tests**: `src/services/users.service.integration.test.ts` (nuevo), `src/app/api/users/users-routes.integration.test.ts` (nuevo — primeros tests HTTP de este módulo).
- **Criterios de aceptación**: sin `Authorization`, cualquiera de los 4 endpoints responde `401 UNAUTHENTICATED`; con una sesión que no es ADMIN, `403 FORBIDDEN`; `POST /api/users` con `phone` de menos de 10 dígitos responde `400 VALIDATION_ERROR`; `POST /api/users` sin `isActive` (o con `isActive:true`) responde `temporaryPassword` de 8 dígitos numéricos y esa contraseña permite loguear; `PATCH /api/users/:id` con `{isActive:true}` sobre un usuario que nunca inició sesión responde igual.

### BE-099 — `PATCH /api/auth/me` (autoservicio de perfil propio)

- **Prioridad/Complejidad/Dependencias**: P1 / S / BE-031 (`GET /api/auth/me`)
- **Objetivo**: que cualquier usuario autenticado pueda editar su propia información de contacto, sin pasar por el Admin.
- **Archivos**: `src/validations/users.validation.ts` (`updateMeSchema`), `src/services/users.service.ts` (`updateOwnProfile`), `src/controllers/auth.controller.ts` (`updateMe`), `src/app/api/auth/me/route.ts` (`PATCH`).
- **Implementación**: acepta únicamente `name`/`phone` — nunca `email`/`password`/`role`/`isActive` desde acá (esos ya tienen sus propios flujos con sus propias reglas de seguridad, y un campo ajeno al schema se descarta en vez de aplicarse). Requiere sesión (`requireSession`), sin restricción de rol adicional — es autoservicio para cualquiera.
- **Tests**: agregado a `src/app/api/auth/auth-routes.integration.test.ts`.
- **Criterios de aceptación**: un usuario puede cambiar su nombre/teléfono con su propio access token; ni el body ni la respuesta permiten tocar `role`/`isActive`/`email`/`password`.

---

[← Índice del plan](README.md)  ·  [Anterior: 12. Docker / despliegue](12-docker-y-despliegue.md)  ·  [Siguiente: 14. Roadmap recomendado](14-roadmap.md)
