[← Índice del plan](README.md)  ·  [Anterior: 9. Pagos](09-pagos.md)  ·  [Siguiente: 11. Testing](11-testing.md)

---

# 10. Migraciones y seeders

> **Actualizado 2026-09-04** — el orden y el seed reflejan el modelo revisado en [04. Base de datos](04-base-de-datos.md) (`LenderCompany`, `BorrowerProfile` a nivel de plataforma, `Property`, `BookkeeperProfile`, `InsuranceCompanyProfile`). Detalle ticket por ticket en [16. Fase 1 — plan actualizado](16-fase-1-actualizada.md).

## 10.1 Orden de creación de tablas (una migración por bloque lógico, no una gigante)

1. `User` + campo `role` (5 valores) + campo `isActive` (migración de datos: todo `User` existente debe recibir un `role` explícito antes de que el campo sea `NOT NULL` — hoy solo hay usuarios de prueba, sin impacto real; `isActive` nace `true` por default, sin migración de datos necesaria).
2. Enum `UserRole`.
3. `LenderProfile`.
4. Enum `LenderCompanyStatus`, tabla `LenderCompany`.
5. `BorrowerProfile` (sin `lenderId`).
6. Enum `TenantLinkStatus`, tabla `LenderBorrower`.
7. `BookkeeperProfile`, tabla `LenderCompanyBookkeeper` (reutiliza `TenantLinkStatus`).
8. `InsuranceCompanyProfile`.
9. Enum `PropertyType`, tabla `Property` (depende de `LenderCompany`).
10. Enums de contrato (`ContractStatus`, `ContractTermsStatus`, `AcceptanceDecision`, `LoanStructure`, `DayCountConvention`, `LateFeeType`).
11. `Contract` (con `lenderCompanyId`, `propertyId`, `insuranceCompanyId`), `ContractTerms` (sin la FK circular `Contract.currentTermsId` todavía resuelta — se agrega en un segundo `ALTER` dentro de la misma migración, patrón estándar de Prisma para referencias circulares).
12. `ContractTermsAcceptance`, `ContractBorrower`.
13. Enums de pagos (`ScheduledPaymentStatus`, `TransactionType` con `PAYOFF_PAYMENT`, `TransactionStatus`, `PaymentMethodChannel`, `AllocationType`, `PaymentMethodStatus`, `PaymentMethodVerificationStatus`).
14. `ScheduledPayment`, `Transaction`, `TransactionAllocation`, `PaymentMethod`.
15. Enums `AutopayStatus`/`AutopayAmountType`, tabla `Autopay` (modelada, sin activar).
16. `WebhookEvent`, enums `WebhookProvider`/`WebhookEventStatus`.
17. `AuditLog` (con `lenderCompanyId`).
18. `RefreshToken`, `PasswordResetToken`, `TwoFactorRecoveryCode`.
19. (Opcional/fase 2) `Document` + enums asociados.

## 10.2 Seeders

`prisma/seed.ts` (patrón ya usado por Owner, adaptado):

- 1 usuario `ADMIN` con 2FA **desactivado por defecto** en el seed (se activa en el primer login real — el seed no puede generar un secreto TOTP útil sin interacción), credenciales solo para desarrollo, nunca en producción (`seed.ts` verifica `env.isProduction` y aborta si es true).
- 1–2 `LenderProfile` de desarrollo, cada uno con 1–2 `LenderCompany` (para poder probar el selector de empresa activa) — al menos una con `isOpenToDeals=false` para probar el filtro.
- 2–3 `BorrowerProfile`, con al menos uno vinculado (`LenderBorrower`) a **dos** `LenderCompany` distintas, para probar de entrada el caso multi-lender.
- 1 `BookkeeperProfile` vinculado a una `LenderCompany` vía `LenderCompanyBookkeeper`.
- 1 `InsuranceCompanyProfile`.
- 2–3 `Property` de ejemplo, con los campos de valuation/ARV/taxes cargados a mano (valores de prueba, no de una API real).
- 1–2 `Contract` de ejemplo en distintos estados (`DRAFT`, `ACTIVE` con calendario generado), cada uno referenciando una `Property` del seed; al menos uno con `insuranceCompanyId` asignado.
- Reutiliza `BCRYPT_COST` de `env.ts`, nunca hashea con un costo distinto al de producción.

---

[← Índice del plan](README.md)  ·  [Anterior: 9. Pagos](09-pagos.md)  ·  [Siguiente: 11. Testing](11-testing.md)
