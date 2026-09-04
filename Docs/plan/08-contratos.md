[← Índice del plan](README.md)  ·  [Anterior: 7. Autenticación y autorización](07-autenticacion-y-autorizacion.md)  ·  [Siguiente: 9. Pagos](09-pagos.md)

---

# 8. Contratos

## 8.1 Ciclo de vida y estados

```
Contract.status:
  DRAFT ──submit──► PENDING_ACCEPTANCE ──(todos aceptan)──► ACTIVE ──payoff/última cuota──► PAID_OFF
    │                        │                                 │
    └──cancel (soft)         └──(algún rechazo)──► DRAFT       └──cancel (regla abajo)──► CANCELLED
                                (Lender revisa y reenvía,                │
                                 o cancela)                              ▼
                                                                    (permanece con historial completo)
  ACTIVE ──mora > gracePeriodDays──► DELINQUENT ──se pone al día──► ACTIVE
```

- `DELETE /api/contracts/:id` (hard-ish, en realidad `deletedAt`): permitido **solo** si `status = DRAFT` y no tiene ninguna `Transaction` — regla de "eliminar cuando las reglas de negocio lo permitan" del encargo.
- `POST /api/contracts/:id/cancel`: permitido en `PENDING_ACCEPTANCE` o `ACTIVE`; en `ACTIVE` requiere confirmación reforzada en el frontend y queda auditado con motivo obligatorio; nunca borra `ScheduledPayment`/`Transaction` existentes.
- `ContractTerms.status` sigue su propia máquina de estados (ver [4.3](04-base-de-datos.md#43-tablas)), acoplada a la del contrato solo en el punto de activación.

## 8.2 Creación / edición / consulta / eliminación

- **Crear** (`POST /api/contracts`): transacción atómica que crea `Contract(DRAFT)` + `ContractTerms(v1, DRAFT)` en un solo `$transaction`, genera `contractNumber` (formato `PML-{año}-{secuencial de 6 dígitos}`), asocia deudor(es) iniciales vía `ContractBorrower` si se envían en el mismo payload.
- **Editar** (`PATCH /api/contracts/:id`): mientras `ContractTerms` vigente está `DRAFT`, edición directa de los campos financieros y de dirección. Una vez `PENDING_ACCEPTANCE`/`ACCEPTED`, cualquier cambio financiero pasa por `POST /api/contracts/:id/terms` (nueva versión) — la dirección y metadatos no financieros sí se pueden editar directo en cualquier estado (no requieren reaceptación).
- **Consultar**: `GET /api/contracts/:id` devuelve contrato + términos vigentes + deudores asociados + resumen de saldo; el detalle de calendario/transacciones vive en sub-rutas para no sobrecargar la respuesta principal (paginación en frontend).
- **Eliminar**: ver [8.1](08-contratos.md#81-ciclo-de-vida-y-estados).

## 8.3 Propiedad del contrato

> **Actualizado 2026-09-04** (`D-P1-5`): esta sección describía la dirección embebida directamente en `Contract` (decisión `A-4`). Esa decisión quedó **revertida** — ver [00 §Decisiones 2026-09-04](00-contradicciones-y-decisiones.md#decisiones-2026-09-04-ronda-fase-1) y [04 §Property](04-base-de-datos.md#property-nueva). Se conserva el razonamiento original abajo, tachado conceptualmente, para que quede registro de por qué se decidió cada cosa en su momento.

`Contract.propertyId` es una FK obligatoria a la tabla `Property` (dirección + campos de valuation/ARV/taxes). Una `Property` puede estar asociada a varios `Contract` a lo largo del tiempo (refinanciamiento, segunda posición, un préstamo nuevo tras el payoff del anterior); un `Contract` tiene exactamente una `Property`. *Blanket loans* (una hipoteca sobre varias propiedades) sigue sin soportarse en esta fase — pregunta abierta, ver riesgo #7 en la sección [15](15-riesgos-y-decisiones-pendientes.md) — pero ahora es más barato de agregar después (reemplazar la FK simple por una tabla puente `ContractProperty`, sin tener que extraer `Property` de `Contract` primero).

*(Razonamiento original, ya no vigente: "Campos embebidos directamente en `Contract` — decisión A-4. No hay reutilización posible entre contratos... cada contrato captura su propia dirección aunque dos contratos del mismo prestamista coincidan en la misma casa.")*

## 8.4 Datos financieros y amortización

Reutiliza literalmente la lógica ya diseñada en [PAYMYLOAN_DATABASE_DESIGN.md](../PAYMYLOAN_DATABASE_DESIGN.md) sección 11 (Amortization) — **REUSE** de la fórmula PMT de Owner (`lib/actions.ts`), **ADAPT** para agregar interest-only y balloon (que Owner no soporta), **NEW** para interés devengado por día (`calculateAccruedInterest`, necesario para calcular saldo vivo entre fechas de corte). Funciones puras, sin I/O, en `src/services/amortization.service.ts`:

- `calculateAmortizedPayment(principal, annualRate, termMonths)` — REUSE
- `calculateInterestOnlyPayment(principal, annualRate)` — ADAPT
- `calculateBalloonPayment(principal, annualRate, amortizationTermMonths, maturityDate, firstPaymentDate)` — NEW
- `calculateAccruedInterest(principal, annualRate, dayCountConvention, fromDate, toDate)` — NEW
- `generateAmortizationSchedule(contractTermsId)` — ADAPT (sin auto-marcado de pagos pasados)
- `regenerateScheduleAfterTermsChange(contractId, newContractTermsId)` — NEW, anula (`VOIDED`) filas futuras `PENDING`/`PARTIALLY_PAID` de la versión anterior

## 8.5 Comparación con Owner (`Contract`)

| Aspecto | Owner (`Contract`) | PayMyLoan (`Contract` + `ContractTerms`) |
|---|---|---|
| Propiedad | FK a `Property` (tabla de inventario de 60+ campos) | Dirección embebida directamente |
| Términos financieros | Campos directos en `Contract`, editables in place | Versionados en `ContractTerms`, inmutables una vez `ACCEPTED` |
| Compradores | `buyers BuyerProfile[]` (M:N sin rol explícito de "quién decide") | `ContractBorrower` (M:N) + `ContractTermsAcceptance` (quién aceptó qué versión) |
| Aceptación de términos | No existe | Obligatoria, bloqueante, auditada (D0-3) |
| Estructura de préstamo | Solo amortización estándar | `INTEREST_ONLY`/`AMORTIZED`/`BALLOON` |
| Multi-tenant | No aplica (una sola inmobiliaria) | `lenderId` en cada fila |

---

[← Índice del plan](README.md)  ·  [Anterior: 7. Autenticación y autorización](07-autenticacion-y-autorizacion.md)  ·  [Siguiente: 9. Pagos](09-pagos.md)
