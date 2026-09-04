[← Índice de fases](README.md)  ·  [Backlog](../13-backlog.md)  ·  [Anterior: Fase 1 — Database](fase-01-database.md)  ·  [Siguiente: Fase 3 — Authorization](fase-03-authorization.md)

---

# Fase 2 — Authentication

## BE-024 — Módulo `src/auth/password.ts`
- **Prioridad/Complejidad/Dependencias**: P0 / S / ninguna
- **Objetivo**: formalizar el wrapper de bcrypt ya usado inline en `users.service.ts`, reutilizable en el módulo de auth.
- **Tests**: hash+compare round-trip.

## BE-025 — Módulo `src/auth/jwt.ts`
- **Prioridad/Complejidad/Dependencias**: P0 / M / BE-002
- **Implementación**: `signAccessToken(payload)`, `verifyAccessToken(token)`, generación/hash de refresh tokens opacos.
- **Tests**: token expirado falla verificación; payload manipulado (firma inválida) falla.

## BE-026 — Módulo `src/auth/totp.ts`
- **Prioridad/Complejidad/Dependencias**: P0 / S / ninguna
- **Implementación**: wrapper de `@otplib` (mismo patrón que Owner), `generateSecret()`, `verifyCode(secret, code)`, `buildOtpAuthUrl()`.
- **Tests**: código válido pasa, código con drift de 1 step pasa (ventana estándar de TOTP), código inválido falla.

## BE-027 — `POST /api/auth/login`
- **Prioridad/Complejidad/Dependencias**: P0 / M / BE-024, BE-025
- **Implementación**: sección [7.2](../07-autenticacion-y-autorizacion.md#72-login--logout--refresh), paso 1.
- **Validaciones**: Zod (`email`, `password` no vacíos); no revela si el email existe (mismo mensaje genérico para email inexistente y password incorrecta).
- **Tests**: credenciales válidas sin 2FA → tokens; credenciales válidas con 2FA → `pendingToken`; credenciales inválidas → 401 en ambos casos con el mismo mensaje.
- **Criterios de aceptación**: timing del endpoint no varía perceptiblemente entre "email no existe" y "password incorrecta" (mitigación básica de timing attack — bcrypt.compare contra un hash dummy si el usuario no existe).

## BE-028 — `POST /api/auth/login/2fa`
- **Prioridad/Complejidad/Dependencias**: P0 / M / BE-026, BE-027
- **Tests**: código correcto emite tokens; código incorrecto no incrementa el rate limit de `login` sino el suyo propio; recovery code válido funciona una sola vez.

## BE-029 — `POST /api/auth/refresh`
- **Prioridad/Complejidad/Dependencias**: P0 / M / BE-025
- **Implementación**: rotación + detección de reuso (sección [7.2](../07-autenticacion-y-autorizacion.md#72-login--logout--refresh)).
- **Tests**: reuso de un refresh token ya rotado revoca toda la cadena del usuario.

## BE-030 — `POST /api/auth/logout` y `/logout-all`
- **Prioridad/Complejidad/Dependencias**: P1 / S / BE-029

## BE-031 — `GET /api/auth/me`
- **Prioridad/Complejidad/Dependencias**: P0 / S / BE-025
- **Implementación**: devuelve `User` (SafeUser) + `LenderProfile`/`BorrowerProfile` según `role`.

## BE-032 — `POST /api/auth/password/forgot` y `/reset`
- **Prioridad/Complejidad/Dependencias**: P1 / M / BE-021, BE-006
- **Tests**: token usado dos veces falla la segunda; token expirado falla; reset revoca todos los refresh tokens existentes.

## BE-033 — `POST /api/auth/2fa/setup` y `/verify`
- **Prioridad/Complejidad/Dependencias**: P0 / M / BE-026
- **Tests**: `verify` con código incorrecto no activa 2FA; `verify` exitoso genera exactamente 8 recovery codes y no los vuelve a exponer después.

## BE-034 — `POST /api/auth/2fa/disable` y `/recovery-codes`
- **Prioridad/Complejidad/Dependencias**: P1 / M / BE-033
- **Validaciones**: `disable` requiere contraseña actual + código TOTP vigente (no solo la sesión activa) — evita que una sesión robada pueda desactivar 2FA sola.

---

[← Índice de fases](README.md)  ·  [Backlog](../13-backlog.md)  ·  [Anterior: Fase 1 — Database](fase-01-database.md)  ·  [Siguiente: Fase 3 — Authorization](fase-03-authorization.md)
