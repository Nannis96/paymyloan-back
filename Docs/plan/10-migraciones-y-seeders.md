[← Índice del plan](README.md)  ·  [Anterior: 9. Pagos](09-pagos.md)  ·  [Siguiente: 11. Testing](11-testing.md)

---

# 10. Migraciones y seeders

## 10.1 Orden de creación de tablas (una migración por bloque lógico, no una gigante)

1. `User` (ya existe) + campo `role` (migración de datos: todo `User` existente debe recibir un `role` explícito antes de que el campo sea `NOT NULL` — hoy solo hay usuarios de prueba, sin impacto real).
2. Enums base (`UserRole`, `LenderStatus`).
3. `LenderProfile`.
4. `BorrowerProfile`.
5. Enums de contrato (`ContractStatus`, `ContractTermsStatus`, `AcceptanceDecision`, `LoanStructure`, `DayCountConvention`, `LateFeeType`, `PropertyType`).
6. `Contract`, `ContractTerms` (sin la FK circular `Contract.currentTermsId` todavía resuelta — se agrega en un segundo `ALTER` dentro de la misma migración, patrón estándar de Prisma para referencias circulares).
7. `ContractTermsAcceptance`, `ContractBorrower`.
8. Enums de pagos (`ScheduledPaymentStatus`, `TransactionType`, `TransactionStatus`, `PaymentMethodChannel`, `AllocationType`, `PaymentMethodStatus`, `PaymentMethodVerificationStatus`).
9. `ScheduledPayment`, `Transaction`, `TransactionAllocation`, `PaymentMethod`.
10. `WebhookEvent`, enums `WebhookProvider`/`WebhookEventStatus`.
11. `AuditLog`.
12. `RefreshToken`, `PasswordResetToken`, `TwoFactorRecoveryCode`.
13. (Opcional/fase 2) `Document` + enums asociados.

## 10.2 Seeders

`prisma/seed.ts` (patrón ya usado por Owner, adaptado):

- 1 usuario `ADMIN` con 2FA **desactivado por defecto** en el seed (se activa en el primer login real — el seed no puede generar un secreto TOTP útil sin interacción), credenciales solo para desarrollo, nunca en producción (`seed.ts` verifica `env.isProduction` y aborta si es true).
- 1 `LenderProfile` de desarrollo con 2–3 `BorrowerProfile` asociados.
- 1–2 `Contract` de ejemplo en distintos estados (`DRAFT`, `ACTIVE` con calendario generado) para poder probar el frontend sin tener que recorrer todo el flujo manualmente cada vez.
- Reutiliza `BCRYPT_COST` de `env.ts`, nunca hashea con un costo distinto al de producción.

---

[← Índice del plan](README.md)  ·  [Anterior: 9. Pagos](09-pagos.md)  ·  [Siguiente: 11. Testing](11-testing.md)
