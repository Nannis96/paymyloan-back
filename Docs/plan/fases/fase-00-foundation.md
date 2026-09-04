[← Índice de fases](README.md)  ·  [Backlog](../13-backlog.md)  ·  [Siguiente: Fase 1 — Database](fase-01-database.md)

---

# Fase 0 — Foundation

## BE-001 — Adoptar UUIDv7 como estrategia de IDs
- **Prioridad/Complejidad/Dependencias**: P0 / S / ninguna
- **Objetivo**: reemplazar `@default(cuid())` por `@default(dbgenerated("uuidv7()")) @db.Uuid` en `User` y establecer la convención para toda tabla nueva.
- **Archivos**: `prisma/schema.prisma`, `docker-compose.yml`, `docker-compose.dev.yml`.
- **Implementación**: subir imagen de Postgres a `postgres:18`; migrar `User.id` de `String`/cuid a `Uuid`/uuidv7 (requiere migración de datos si ya hay usuarios reales — en este punto del proyecto no los hay); documentar la convención en un comentario al inicio de `schema.prisma`.
- **Validaciones**: confirmar que Prisma 6.19 soporta `@db.Uuid` con `dbgenerated` sin warnings.
- **Tests**: test de integración que crea un `User` y verifica que `id` matchea el formato UUIDv7 (version nibble `7`).
- **Criterios de aceptación**: `prisma migrate dev` corre limpio contra Postgres 18; un `User` nuevo tiene un `id` UUIDv7 válido.

## BE-002 — Validación fail-fast de variables de entorno
- **Prioridad/Complejidad/Dependencias**: P0 / S / ninguna
- **Objetivo**: que el proceso no arranque en producción si falta una variable obligatoria.
- **Archivos**: `src/config/env.ts`.
- **Implementación**: lista de variables obligatorias por entorno; `throw` al importar el módulo si falta alguna en `NODE_ENV=production`.
- **Validaciones**: cubre `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `DATABASE_URL` como mínimo.
- **Tests**: unit test que simula `process.env` incompleto y espera que el import lance.
- **Criterios de aceptación**: `docker compose up` con un `.env` incompleto en modo producción falla con un mensaje claro, no con un error de Prisma más adelante.

## BE-003 — Configurar CORS
- **Prioridad/Complejidad/Dependencias**: P0 / S / BE-002
- **Objetivo**: restringir el origen permitido al dominio del frontend.
- **Archivos**: middleware nuevo o `next.config.ts` (headers), `src/config/env.ts` (`CORS_ORIGIN`).
- **Validaciones**: preflight `OPTIONS` responde correctamente para el módulo de auth.
- **Tests**: request desde un origen no permitido es rechazada.
- **Criterios de aceptación**: el frontend en `localhost:3000` puede llamar a la API en `localhost:4000` en desarrollo; cualquier otro origen recibe error CORS.

## BE-004 — Logger estructurado + requestId
- **Prioridad/Complejidad/Dependencias**: P1 / S / ninguna
- **Objetivo**: reemplazar `console.log` por un logger JSON con nivel y `requestId` correlacionado.
- **Archivos**: `src/lib/logger.ts` (nuevo), `errorHandler.ts`.
- **Implementación**: middleware que genera un `requestId` (uuid) por request y lo adjunta a todo log de esa request.
- **Tests**: unit test verifica que dos requests concurrentes no mezclan `requestId`.
- **Criterios de aceptación**: un error 500 en producción es rastreable por `requestId` desde el log hasta la respuesta al cliente.

## BE-005 — Rate limiting en endpoints sensibles
- **Prioridad/Complejidad/Dependencias**: P1 / M / BE-002
- **Objetivo**: limitar fuerza bruta en login/2FA/reset de contraseña.
- **Archivos**: `src/middlewares/rateLimit.ts`, aplicado en `login`, `login/2fa`, `password/forgot`.
- **Implementación**: contador en memoria por IP+email para desarrollo; documentar que producción necesita un store compartido (Redis) si hay más de una instancia del backend — no se implementa Redis en este backlog, se deja como nota de escalamiento.
- **Validaciones**: `RATE_LIMIT_LOGIN_MAX`/`RATE_LIMIT_LOGIN_WINDOW_MS` desde `env.ts`.
- **Tests**: 6 intentos fallidos consecutivos → 429 en el 6º.
- **Criterios de aceptación**: el límite es configurable por variable de entorno y se resetea tras la ventana.

## BE-006 — Cliente de correo transaccional
- **Prioridad/Complejidad/Dependencias**: P1 / M / BE-002
- **Objetivo**: reemplazar los webhooks de GoHighLevel de Owner (que no aplican aquí, ver sección [5](../05-que-no-copiar-de-owner.md)) por un proveedor real.
- **Archivos**: `src/lib/email.ts`, plantillas base (bienvenida de deudor, reset de contraseña, notificación de nueva versión de términos).
- **Implementación**: wrapper agnóstico de proveedor (interfaz `sendEmail({to, subject, template, data})`), implementación concreta detrás de `EMAIL_PROVIDER` — ver sección [15](../15-riesgos-y-decisiones-pendientes.md) sobre cuál proveedor confirmar.
- **Tests**: mock del proveedor en tests unitarios; test de integración solo si hay sandbox del proveedor.
- **Criterios de aceptación**: `sendEmail()` funciona en desarrollo contra el sandbox del proveedor elegido.

## BE-007 — Reestructurar carpetas por dominio
- **Prioridad/Complejidad/Dependencias**: P1 / S / ninguna
- **Objetivo**: preparar `src/` para los módulos nuevos sin romper lo existente.
- **Archivos**: crear `src/auth/`, `src/repositories/`, `src/jobs/`, mover nada de lo existente (es aditivo).
- **Criterios de aceptación**: `pnpm build` sigue pasando tras la reestructuración.

---

[← Índice de fases](README.md)  ·  [Backlog](../13-backlog.md)  ·  [Siguiente: Fase 1 — Database](fase-01-database.md)
