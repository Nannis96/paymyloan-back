[← Índice del plan](README.md)  ·  [Anterior: 10. Migraciones y seeders](10-migraciones-y-seeders.md)  ·  [Siguiente: 12. Docker / despliegue](12-docker-y-despliegue.md)

---

# 11. Testing

| Categoría | Alcance | Ejemplos concretos |
|---|---|---|
| **Unit** | Funciones puras: `amortization.service.ts`, `payment-allocation.service.ts` | PMT estándar vs Excel/calculadora de referencia; balloon con vencimiento antes del plazo de amortización; interés devengado per-diem con `THIRTY_360` vs `ACTUAL_365` |
| **Integration** | Service + Prisma contra una DB de test real (no mocks — ver nota abajo) | `applyTransaction` deja `currentPrincipalBalance` exacto tras 3 pagos parciales consecutivos; `generateAmortizationSchedule` cierra el saldo en exactamente $0.00 en la última fila |
| **API** | Cada endpoint de la sección [6](06-api-endpoints.md), casos felices y de validación | Zod rechaza `principalAmount` negativo; `POST /contracts` sin `addressLine1` responde 400 |
| **Authentication** | Login, 2FA, refresh, password reset | Login con 2FA activo sin `code` responde `2FA_REQUIRED` sin emitir tokens; refresh token reusado tras rotación revoca toda la cadena; reset token expirado responde 410 |
| **Authorization** | RBAC puro (sin tenancy) | `BORROWER` intentando `POST /api/contracts` → 403; `LENDER` intentando `GET /api/admin/lenders` → 403 |
| **Multi-tenancy** | El caso explícito del encargo | Suite parametrizada: Lender A autenticado contra cada endpoint de `contracts`/`borrowers`/`payment-methods` con IDs de Lender B → 404 en todos; Borrower de Lender A contra un contrato de Lender B → 404 |
| **Contract** | Ciclo de vida completo | Contrato con 2 co-deudores no activa hasta que ambos acepten; rechazo de uno lo regresa a `DRAFT`; edición de términos tras `ACCEPTED` crea v2, no muta v1 |
| **Payment** | Waterfall y duplicados | Transacción de $2,500 cubre mora+interés+capital de 2 filas vencidas correctamente distribuido; mismo `stripePaymentIntentId` reenviado por el webhook no duplica `TransactionAllocation`; doble-click en el frontend con el mismo `Idempotency-Key` crea una sola `Transaction` |

**Nota sobre mocks**: los tests de integration/API corren contra una instancia real de Postgres de test (mismo patrón `docker-compose` con un servicio `db-test` o una base separada) — no se mockea Prisma. Justificación: el aislamiento multi-tenant y el waterfall de pagos son exactamente el tipo de lógica donde un mock puede "pasar" mientras el comportamiento real contra Postgres (constraints, transacciones, índices únicos) falla.

**Casos negativos y de seguridad explícitos a cubrir** (no opcionales):
- Intentar autenticar con un `refreshToken` de otro usuario.
- Manipular el `role` o `lenderId` dentro de un JWT modificado a mano (firma inválida) → 401.
- Intentar aceptar términos (`ContractTermsAcceptance`) como un `BORROWER` no asociado al contrato → 404.
- Reintentar `POST /api/contracts/:id/terms/:termsId/accept` dos veces con el mismo `borrowerProfileId` → 409 (constraint único).
- Rate limit de login: 6º intento fallido en la ventana configurada → 429.

---

[← Índice del plan](README.md)  ·  [Anterior: 10. Migraciones y seeders](10-migraciones-y-seeders.md)  ·  [Siguiente: 12. Docker / despliegue](12-docker-y-despliegue.md)
