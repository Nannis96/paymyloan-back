# middlewares/

Helpers de autorización y control de tráfico reutilizados entre route
handlers — no son middleware de Next.js a nivel de plataforma (eso es
[`src/proxy.ts`](../proxy.ts), que corre antes de cualquier ruta bajo
`/api/*`), sino funciones que cada controller llama explícitamente al
principio de su lógica.

| Archivo | Qué hace |
|---|---|
| `withAuth.ts` | BE-035. Verifica el access token (firma+expiración) y devuelve `Session = { userId, role }`. |
| `withRole.ts` | BE-036. Verifica que `session.role` esté permitido; para ADMIN/LENDER, además exige 2FA activo por default (§7.4, D-P3-1) — se apaga con `{ requireTwoFactor: false }` en los endpoints de autoservicio de 2FA (`/api/auth/2fa/*`) y en lecturas (`GET /api/users`). |
| `requireContractAccess.ts` | BE-038. Resuelve si la sesión puede acceder a un `Contract` — LENDER (dueño de la `LenderCompany`) o BORROWER (`ContractBorrower` activo). Sin consumidor todavía (Fase 6), probado directo contra fixtures. |
| `rateLimit.ts` | BE-005. Contador en memoria por IP+bucket, usado en `login`/`login/2fa`/`password/forgot`. |
| `cors.ts` | BE-003. Headers de CORS, usados desde `src/proxy.ts`. |

`withTenantScope` (BE-037) queda diferido a Fase 4 (D-P3-2) — no tiene
ningún endpoint consumidor todavía (`/api/lenders/me/*`, `/api/contracts/*`);
se decide su mecanismo (header, path, etc.) cuando exista el primero.
