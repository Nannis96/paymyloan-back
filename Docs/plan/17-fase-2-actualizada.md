[← Índice del plan](README.md)  ·  [Anterior: 16. Fase 1 — plan actualizado](16-fase-1-actualizada.md)

---

# 17. Fase 2 — Authentication (plan actualizado e implementado, 2026-09-07)

> **Reemplaza** a [fases/fase-02-authentication.md](fases/fase-02-authentication.md) (histórico, no editado, con aviso al inicio) en lo que respecta a `PB-013` y agrega un ticket nuevo (`BE-097`) que no existía en ningún backlog. Los 11 tickets originales (`BE-024`..`BE-034`) **no cambiaron** de alcance — se implementaron tal cual estaban especificados.
>
> **Estado**: implementado y verificado. Ver [IMPLEMENTATION_PROGRESS.md](../IMPLEMENTATION_PROGRESS.md) para el detalle de verificación end-to-end.
>
> **Por qué existe este documento en vez de editar el original**: mismo criterio que [16. Fase 1 — plan actualizado](16-fase-1-actualizada.md) — declarar explícitamente qué cambió y por qué, sin perder el registro de la decisión original.

## 17.1 Qué cambió respecto al backlog original

Spencer confirmó tres decisiones en esta ronda que no estaban resueltas (o estaban contradichas entre documentos) en el plan original:

1. **Roles que pueden auto-registrarse vía `POST /api/auth/register`**: `LENDER` y `BORROWER`, ambos — no solo `BORROWER`. Esto resuelve una contradicción real: [IMPLEMENTATION_PROGRESS.md](../IMPLEMENTATION_PROGRESS.md) (antes de esta ronda) tenía `PB-013` como "alta propia del deudor, rol BORROWER", mientras que [00-contradicciones-y-decisiones.md § D-P1-10](00-contradicciones-y-decisiones.md#decisiones-2026-09-04-ronda-fase-1) ya decía ambos roles. Este documento y el resto de la actualización de abajo dejan una única fuente de verdad: **ambos roles**.
2. **Un auto-registro nace inactivo** (`isActive=false`) y requiere activación por un Admin — resuelve el riesgo #20 (antes abierto en [15](15-riesgos-y-decisiones-pendientes.md)). Esto exige un endpoint de activación que no existía en ningún backlog: **`BE-097`**.
3. **El registro no pide contraseña.** El formulario de auto-registro es solo `{ name, email, role }` — sin contraseña. La cuenta nace sin credencial utilizable; al activarla, `BE-097` genera una contraseña temporal y la envía por correo (plantilla `account-activated`, `src/lib/email.ts`). Esto también resuelve el riesgo #21 (¿el registro pide la empresa en el mismo paso? — no, ni siquiera pide contraseña; la empresa (`LenderCompany`) se da de alta después, en Fase 4, como ya prevía el schema al permitir un `LenderProfile` sin ninguna `LenderCompany` todavía).

Ningún ticket original se elimina. `BE-097` es nuevo, adelantado desde donde naturalmente viviría (Fase 4, gestión de usuarios) porque sin él el auto-registro es un callejón sin salida — un usuario que se auto-registra nunca podría iniciar sesión.

## 17.2 Decisiones de diseño no triviales (ver también `D-P2-*` en [00](00-contradicciones-y-decisiones.md))

- **El JWT no lleva `lenderId`.** El §7.1 original especificaba el payload `{ sub, role, lenderId? }`, resuelto en el login. Ese `lenderId` dejó de tener sentido desde `D-P1-3` (el tenant es `LenderCompany`, y un `LenderProfile` puede tener N) — resolver "una" empresa en el login ya no es correcto cuando puede haber varias. El payload implementado es **`{ sub, role }`** únicamente; `GET /api/auth/me` devuelve la lista completa de `LenderCompany` (para LENDER) o de empresas vinculadas vía `LenderBorrower` (para BORROWER) para que el cliente pueda elegir. Cómo esa elección viaja en requests posteriores queda para Fase 3 (`withTenantScope`, `BE-037`, riesgo #18) — no se resuelve acá.
- **Dos esquemas de hash, por motivos distintos.** `User.password` sigue con bcrypt (`env.bcryptCost=12`), lento y salteado a propósito — una contraseña tiene poca entropía y necesita ese costo. Los tokens opacos (`RefreshToken.tokenHash`, `PasswordResetToken.tokenHash`, `TwoFactorRecoveryCode.codeHash`) usan **SHA-256**: el schema los declara `@unique`, y para buscarlos por índice hace falta un hash determinista — bcrypt saltea distinto en cada llamada, así que un hash bcrypt ahí obligaría a comparar contra todas las filas de la tabla. Son valores aleatorios de 256 bits (`crypto.randomBytes(32)`), así que un hash rápido no los debilita.
- **`jose` para JWT, no `jsonwebtoken`.** Trae tipos propios y funciona en edge runtime — deja abierta la puerta a que el `withAuth` de Fase 3 viva en `src/proxy.ts` (el proxy de plataforma de Next 16, que hoy ya corre en cada request bajo `/api/*`). **`otplib`** para TOTP, como pedía `BE-026` textualmente ("wrapper de `@otplib`").
- **`otplib` v13 mide `epochTolerance` en segundos, no en "steps".** No está documentado así explícitamente; se verificó empíricamente contra la librería real (ver comentario en `src/auth/totp.ts`). La ventana ±1 step de 30s que pide `BE-026` se implementa como `epochTolerance: 30`.
- **Helper de sesión provisorio (`src/auth/session.ts`).** `/me`, `/logout`, `/2fa/*` y `/admin/users/:id/activate` son "Autenticado" según §6.1, pero los middlewares reales (`withAuth`/`withRole`) son `BE-035`/`BE-036`, de Fase 3. Esta fase agrega `requireSession`/`requireRole`, lo mínimo que hace falta hoy — Fase 3 los envuelve/reemplaza. **A propósito no** aplica la regla de 2FA obligatorio de §7.4 (eso es explícitamente `BE-036`, y meterla acá hubiera dejado media implementación de un ticket de otra fase).
- **Reuso de un refresh token revocado por *logout* no tumba las demás sesiones.** El criterio de aceptación de `BE-029` dice "reuso de un refresh token ya rotado revoca toda la cadena". La implementación distingue explícitamente **por qué** un token está revocado: si `replacedByTokenId` está seteado (fue rotado por un `refresh` posterior y alguien reintenta el viejo — señal de robo), se revoca toda la cadena del usuario. Si solo tiene `revokedAt` seteado por un `logout()` normal (sin rotación), se rechaza ese token puntual sin tocar las demás sesiones del usuario en otros dispositivos. La primera versión implementada no hacía esa distinción y fallaba un test de integración precisamente por eso (un `logout()` de un dispositivo revocaba, en cascada, la sesión activa de otro) — quedó corregido antes de cerrar la fase.
- **Recovery codes y códigos TOTP comparten el mismo campo `code` en `/login/2fa`.** `verifyCode()` (TOTP) se prueba primero; si el input no tiene forma de código TOTP (otplib exige 6 dígitos y lanza en vez de devolver `false` para cualquier otra longitud, p.ej. un recovery code de 10 caracteres), se captura esa excepción y se interpreta como "no es un TOTP válido" antes de caer al camino de recovery codes — nunca se propaga como error 500.
- **`sendEmail()` gana un modo "dev": si `EMAIL_API_KEY` está vacío, loguea el correo completo en vez de llamar a Resend.** Sin esto, el flujo de activación (que depende de que el correo con la contraseña temporal efectivamente "llegue") sería imposible de ejercitar en desarrollo/test sin credenciales reales de Resend. Nunca ocurre en producción — `BE-002` exige `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET`/`DATABASE_URL` ahí, y el resto de la operación (incluyendo un proveedor de correo real) es una precondición operativa, no algo que este código deba forzar.

## 17.3 Qué se implementó

Sin cambios de `schema.prisma` — el modelo de Fase 1 ya traía todo lo necesario.

| Área | Archivos |
|---|---|
| Primitivas | `src/auth/password.ts`, `src/auth/jwt.ts`, `src/auth/totp.ts`, `src/auth/session.ts` |
| Servicios | `src/services/auth.service.ts` (login/loginTwoFactor/refresh/logout/logoutAll/getMe/register), `src/services/twoFactor.service.ts` (setup/verify/disable/regenerateRecoveryCodes), `src/services/passwordReset.service.ts` (forgot/reset), `src/services/adminUsers.service.ts` (activate/deactivate, `BE-097`) |
| Validaciones | `src/validations/auth.validation.ts`, `src/validations/parse.ts` (extraído de `users.controller.ts` para reusar entre los 4 controllers nuevos) |
| Controllers | `src/controllers/auth.controller.ts`, `src/controllers/twoFactor.controller.ts`, `src/controllers/adminUsers.controller.ts` |
| Rutas | `src/app/api/auth/{register,login,login/2fa,refresh,logout,logout-all,me,password/forgot,password/reset,2fa/setup,2fa/verify,2fa/disable,2fa/recovery-codes}/route.ts`, `src/app/api/admin/users/[id]/{activate,deactivate}/route.ts` |
| Cambios en archivos existentes | `src/lib/email.ts` (plantilla `account-activated` + modo dev sin `EMAIL_API_KEY`), `src/db/testFixtures.ts` (`createTestUserWithPassword`, `createTestUserWithTwoFactor` — contraseña bcrypt real, a diferencia de `createTestUser`), `src/services/users.service.ts` (`toSafeUser` exportado, reusado por los servicios nuevos), `src/controllers/users.controller.ts` (usa el `parseOrThrow` compartido) |

### Tests

- **Unit** (`src/auth/*.test.ts`): round-trip de hash/compare, token expirado y firma manipulada fallan, pending token nunca sirve como access token y viceversa, código TOTP con drift de 1 step pasa y de 2 steps falla, `durationToMs`.
- **Integración** (`src/services/*.integration.test.ts`, contra Postgres real — nunca mocks): login con/sin 2FA, 401 idéntico para correo inexistente vs. contraseña incorrecta, cuenta inactiva rechazada, recovery code de un solo uso, rotación de refresh + detección de reuso (con el matiz de `replacedByTokenId` de arriba), logout vs. logout-all, `getMe` con `LenderCompany` asociadas, registro idempotente sin filtrar si el correo ya existía, 2FA setup/verify/disable/recovery-codes con exigencia de contraseña+código vigente, reset de contraseña que revoca sesiones, y el ciclo completo de activación (`BE-097`) incluyendo el caso de reactivación que no reenvía correo.
- **Rutas HTTP** (`src/app/api/auth/auth-routes.integration.test.ts`) — **primeros tests de este repo que invocan los route handlers reales** en vez de Prisma/servicios directo: 202 de registro, 401 idéntico a nivel HTTP, 429 de rate limit al 6º intento desde la misma IP, 403/401 de `/admin/users/:id/activate` sin sesión de Admin, y el camino dorado completo (registro → login rechazado → activación → login con la contraseña emitida → `/me`).

92 tests en total para el repo (31 unit + 61 integración), todos verdes.

---

[← Índice del plan](README.md)  ·  [Anterior: 16. Fase 1 — plan actualizado](16-fase-1-actualizada.md)
