[← Índice del plan](README.md)  ·  [Anterior: 11. Testing](11-testing.md)  ·  [Siguiente: 13. Backlog detallado](13-backlog.md)

---

# 12. Docker / despliegue

## 12.1 Cambios sobre la configuración actual

- `docker-compose.yml` y `docker-compose.dev.yml`: imagen de Postgres `postgres:16` → **`postgres:18`** (requerido por D0-2, `uuidv7()` nativo).
- Verificar compatibilidad de la versión de `pg` que usa Prisma 6.19 con Postgres 18 antes de subir (Prisma suele soportar versiones nuevas de Postgres sin cambios, pero se valida explícitamente como tarea de backlog, no se asume).

## 12.2 Dockerfile

Se mantiene el patrón multietapa ya usado (`deps → dev / builder → runner`, `node:22-slim`, `output: standalone`, usuario no root, `HEALTHCHECK` sobre `/api/health`) — sin cambios de fondo, solo se agrega el paso de generación de Prisma Client si cambia algo del build.

## 12.3 Docker Compose para desarrollo

Se mantiene `docker-compose.dev.yml` con hot reload + `prisma migrate deploy` antes de levantar el server. Se agrega:
- Servicio `db-test` (o base de datos separada) para correr la suite de integration/API tests sin tocar los datos de desarrollo.
- Variables nuevas de la sección [3.5](03-arquitectura-backend.md#35-configuración-y-variables-de-entorno) propagadas al contenedor.

## 12.4 Variables de entorno en Docker

Todas las variables de la sección [3.5](03-arquitectura-backend.md#35-configuración-y-variables-de-entorno) se agregan a `docker-compose.yml`/`docker-compose.dev.yml` como `environment:`/`env_file`, nunca hardcodeadas en el `Dockerfile`. `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET`/`STRIPE_SECRET_KEY`/`EMAIL_API_KEY` se tratan como secretos — en desarrollo pueden vivir en `.env`, en producción deben venir de un secret manager del hosting elegido (fuera del alcance de este documento definir cuál).

## 12.5 Networking

Sin reverse proxy propio todavía (igual que hoy) — el puerto 4000 se publica directo al host en desarrollo; en producción se recomienda el mismo patrón nginx+certbot que ya usa `paymyloan` (frontend), ya sea compartiendo el mismo nginx con un `location /api/` o con un subdominio propio (`api.paymyloan.ai`) — **decisión de infraestructura pendiente**, ver sección [15](15-riesgos-y-decisiones-pendientes.md).

## 12.6 Health checks

Se mantiene `GET /api/health`, se le agrega una verificación de conectividad a Postgres (`SELECT 1`) para que el `HEALTHCHECK` de Docker realmente refleje si la API puede servir tráfico, no solo si el proceso Node está vivo.

## 12.7 Build de producción

Sin cambios de fondo respecto al patrón ya documentado en el README actual (`output: standalone`, migración corre en un servicio `migrate` aparte con el target `builder`).

---

[← Índice del plan](README.md)  ·  [Anterior: 11. Testing](11-testing.md)  ·  [Siguiente: 13. Backlog detallado](13-backlog.md)
