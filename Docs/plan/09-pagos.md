[← Índice del plan](README.md)  ·  [Anterior: 8. Contratos](08-contratos.md)  ·  [Siguiente: 10. Migraciones y seeders](10-migraciones-y-seeders.md)

---

# 9. Pagos

## 9.1 Modelo — `ScheduledPayment` vs `Transaction`

Se reutiliza íntegro el razonamiento de [PAYMYLOAN_DATABASE_DESIGN.md](../PAYMYLOAN_DATABASE_DESIGN.md) sección 5.6–5.8: separar "lo que se debe" de "lo que ocurrió" es la corrección central sobre el `Payment` monolítico de Owner, y sigue siendo válida sin cambios bajo el modelo jerárquico de este plan — solo cambia que ambas tablas cuelgan de `Contract` en vez de `Loan`.

## 9.2 Estados y ciclo ACH

Idéntico al ya documentado ([PAYMYLOAN_DATABASE_DESIGN.md](../PAYMYLOAN_DATABASE_DESIGN.md) sección 14), reproducido aquí por completitud:

```
PENDING → PROCESSING → SUCCEEDED
                      → FAILED
SUCCEEDED → RETURNED   (días después: fondos insuficientes, cuenta cerrada)
SUCCEEDED → REFUNDED   (reembolso manual)
```

`applyTransaction()` se ejecuta **solo** cuando `status → SUCCEEDED`, nunca antes — corrige el defecto puntual de Owner (marca `PAID` en `checkout.session.completed` sin esperar liquidación real).

## 9.3 Aplicación de pagos (prelación / waterfall)

`calculatePaymentAllocation(transaction, scheduledPayments)`: mora → interés → capital, sobre las `ScheduledPayment` `PENDING`/`PARTIALLY_PAID` más antiguas primero. Persiste como filas de `TransactionAllocation` dentro de la misma `$transaction` de Prisma que actualiza `ScheduledPayment.amountPaid`/`status` y `Contract.currentPrincipalBalance`.

## 9.4 Prevención de pagos duplicados

Dos capas, igual que [PAYMYLOAN_DATABASE_DESIGN.md](../PAYMYLOAN_DATABASE_DESIGN.md) sección 15:

1. **Webhook de Stripe**: `WebhookEvent.externalEventId` único — evento repetido se descarta antes de tocar `Transaction`.
2. **Creación de `Transaction`**: `stripePaymentIntentId` único + `Idempotency-Key` enviado a Stripe con el `id` de la `Transaction` recién creada en `PENDING` — evita que un doble-click cree dos cargos.

## 9.5 Qué puede hacer cada rol

| Acción | ADMIN | LENDER | BORROWER |
|---|---|---|---|
| Registrar pago ACH propio | — | — | Sí (`POST /contracts/:id/payments`) |
| Registrar pago manual (wire/cheque) | — | Sí, en sus contratos | — |
| Ver historial de transacciones | Sí (todo) | Sí, sus contratos | Sí, sus contratos |
| Reversar transacción (ACH return) | Sí | No | No |
| Agregar/quitar método de pago | — | — | Sí, propio |
| Marcar una transacción como exitosa a mano | No (solo vía webhook o reverse explícito auditado) | No | No |

## 9.6 Comparación con Owner (`Payment`)

| Aspecto | Owner (`Payment`) | PayMyLoan (`ScheduledPayment` + `Transaction`) |
|---|---|---|
| Calendario vs transacción real | Una sola fila para ambos | Dos tablas distintas, unidas por `TransactionAllocation` |
| Ciclo ACH | `PENDING`→`PAID` inmediato en el webhook | `PENDING`→`PROCESSING`→`SUCCEEDED`/`FAILED`, con `RETURNED`/`REFUNDED` posteriores |
| Pagos parciales / abonos a capital | No representable limpiamente | `TransactionAllocation` por tipo (`LATE_FEE`/`INTEREST`/`PRINCIPAL`) |
| Idempotencia de webhook | No existe | `WebhookEvent.externalEventId` único |
| Registro manual (wire/cheque) | No distinguido de ACH | `PaymentMethodChannel` explícito |

---

[← Índice del plan](README.md)  ·  [Anterior: 8. Contratos](08-contratos.md)  ·  [Siguiente: 10. Migraciones y seeders](10-migraciones-y-seeders.md)
