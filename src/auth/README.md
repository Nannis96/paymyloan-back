# auth/

Lógica de autenticación reutilizable entre módulos — ver
[Fase 2 (Auth)](../../Docs/plan/fases/fase-02-authentication.md) del plan de
backend (BE-024..034) y el backlog vigente en
[17. Fase 2 — plan actualizado](../../Docs/plan/17-fase-2-actualizada.md).

| Archivo | Qué hace |
|---|---|
| `password.ts` | Hashing bcrypt (`hashPassword`/`verifyPassword`), comparación dummy contra timing attacks (`verifyDummyPassword`) y generación de contraseñas temporales (`generateTemporaryPassword`, usada al activar una cuenta auto-registrada). |
| `jwt.ts` | Access token JWT (`signAccessToken`/`verifyAccessToken`, payload `{ sub, role }` — sin `lenderId`, ver D-P2-2), pending token de 2FA (`signPendingToken`/`verifyPendingToken`), y tokens opacos + su hash SHA-256 (`generateOpaqueToken`/`hashOpaqueToken`) para refresh tokens, reset de contraseña y recovery codes. |
| `totp.ts` | Wrapper de `otplib` para 2FA: `generateSecret`, `verifyCode` (ventana ±1 step), `buildOtpAuthUrl`. |
| `session.ts` | `requireSession`/`requireRole` — helper provisorio que valida el access token para los endpoints de esta fase que ya requieren sesión (`/me`, `/logout`, `/2fa/*`, `/admin/users/:id/activate`). Los middlewares definitivos (`withAuth`/`withRole`, con la regla de 2FA obligatorio de §7.4) son BE-035/BE-036 — Fase 3 los reemplaza. |

Los casos de uso (login, registro, refresh, 2FA, reset de contraseña,
activación de usuario) viven en `src/services/` (`auth.service.ts`,
`twoFactor.service.ts`, `passwordReset.service.ts`, `adminUsers.service.ts`),
no acá — este directorio son solo primitivas sin estado de negocio.
