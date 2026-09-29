[← Índice de fases](README.md)  ·  [Backlog](../13-backlog.md)  ·  [Anterior: Fase 18 — Ratings Lender ↔ Borrower](fase-18-ratings-lender-borrower.md)

---

# Fase 19 — Borrowing Score calculado (`PB-009`)

> **📝 PROPUESTA 2026-09-29 — pendiente de aprobación. No hay código.** Es el
> "futuro" que la [Fase 18](fase-18-ratings-lender-borrower.md) dejó
> reservado: la métrica **calculada** del Deudor (¿paga a tiempo?), distinta
> de las reseñas con estrellas. La fórmula exacta estaba marcada como
> decisión pendiente en [Fase 14 / PB-009](fase-14-dashboards-ratings.md#pb-009--get-apiborrowersidrating);
> este documento la propone, con los pesos como constantes ajustables. Nada
> se implementa hasta aprobar la sección [Decisiones a confirmar](#decisiones-a-confirmar).

## 1. Qué pide el Product Spec

[pml_product_spec_v2.pdf](../../pml_product_spec_v2.pdf), perfil del Deudor:

- "**Borrowing score (public)**".
- "Past completed loans + active loans".
- "Project type history (rental, fix & flip, slow flip, commercial, new construction)".
- En los listados públicos del marketplace: *"Full address and borrower name
  hidden on public listings; **borrower score/history shown**"*.

No define escala, fórmula ni umbrales. Todo lo de abajo es propuesta.

## 2. Datos disponibles (no hace falta migración)

Todo se deriva de tablas que ya existen — mismo criterio que `averageRating`
y `deployedCapital` (`D-S2-11`): **se calcula al consultar, no se guarda**.

| Señal | Fuente | Detalle |
|---|---|---|
| Cuota pagada a tiempo | `ScheduledPayment.paidInFullAt` vs `dueDate` + `ContractTerms.gracePeriodDays` | `paidInFullAt` lo fija `payments.service.ts` al completarse el pago (manual o vía transacción) |
| Cuota vencida sin pagar | `ScheduledPayment.status ∈ {PENDING, PARTIALLY_PAID}` con `dueDate + gracia < hoy` | Misma definición que el job de mora (`recomputeContractDelinquency.ts`) |
| Cuota anulada | `ScheduledPayment.status = VOIDED` | Se **excluye** del cálculo |
| Pago rechazado / devuelto | `Transaction.status ∈ {FAILED, RETURNED}`, `type = SCHEDULED_PAYMENT` | ACH devuelto = señal de riesgo real |
| Contrato en mora hoy | `Contract.status = DELINQUENT` | Lo mantiene el job diario (`D-A8`) |
| Préstamos completados / activos | `Contract.status = PAID_OFF` / `ACTIVE`,`DELINQUENT` | Vía `ContractBorrower` |
| Historial por tipo de proyecto | `LoanRequest.projectType` de los contratos con `Contract.loanRequestId` | Los contratos `DIRECT` (sin `LoanRequest`) **no tienen** tipo de proyecto — se cuentan aparte |

Solo cuentan contratos que **existieron de verdad**: `ACTIVE`, `DELINQUENT`,
`PAID_OFF` (mismo criterio que `R2` de la Fase 18). `DRAFT`,
`PENDING_ACCEPTANCE` y `CANCELLED` no aportan.

**Atribución con co-deudores:** los pagos son del contrato, no de una
persona. Se atribuyen a **todos los `ContractBorrower` activos**
(`removedAt = null`) — un co-deudor removido deja de acumular, pero no
"hereda" retroactivamente lo que pasó cuando no estaba.

## 3. Fórmula propuesta

Objetivos: **explicable en una línea**, sin sorpresas, y con todos los pesos
en **un solo objeto de constantes** (`SCORE_WEIGHTS`) para calibrarlos con
datos reales sin tocar la lógica (los pesos de negocio nunca salen perfectos
a la primera).

```
duePayments   = cuotas con dueDate + gracia < hoy, no VOIDED
onTime        = duePayments con paidInFullAt <= dueDate + gracia
onTimeRate    = onTime / duePayments

score = clamp(0, 100,
          round(100 * onTimeRate)
          - 5  * pagosFallidosODevueltos
          - 15 * contratosEnMoraHoy )
```

- **Historial insuficiente → `score: null`, `band: "NEW"`.** Con menos de
  `MIN_DUE_PAYMENTS` (propuesta: **3**) cuotas vencidas *y* ningún préstamo
  `PAID_OFF`, un puntaje sería ruido (1 cuota pagada = 100, 1 tardía = 0). Un
  Deudor nuevo no debe verse ni "perfecto" ni "malo".
- **Bandas** (solo presentación): `EXCELLENT` ≥ 90 · `GOOD` 75–89 ·
  `FAIR` 50–74 · `POOR` < 50 · `NEW` sin historial.
- **Sin ponderación por antigüedad** en v1 (una cuota de hace 3 años pesa
  igual que la de ayer). Techo conocido; se agrega decaimiento cuando haya
  datos suficientes para justificarlo (`ponytail:`).
- **El score no se mezcla con las estrellas de la Fase 18.** Se devuelven
  lado a lado, con etiquetas distintas: uno es lo que *hizo* (objetivo), el
  otro lo que *opinan* (subjetivo). Así una reseña amable no maquilla un
  historial de mora ni al revés.

## 4. Respuesta y endpoints

### 4.1 `GET /api/borrowers/:borrowerProfileId/rating` (ya existe, se extiende)

Se **agrega** un campo; nada de lo actual cambia (`average`, `count`,
`distribution`, `reviews`):

```jsonc
{
  "average": 4.5, "count": 2, "distribution": { ... }, "reviews": { ... } | null,
  "borrowingScore": {
    "score": 92,                // null si NEW
    "band": "EXCELLENT",        // EXCELLENT | GOOD | FAIR | POOR | NEW
    "onTimeRate": 0.96,         // null si no hay cuotas vencidas
    "duePayments": 24,
    "latePayments": 1,          // pagadas tarde o aún vencidas
    "failedPayments": 0,        // Transaction FAILED/RETURNED
    "completedLoans": 2,
    "activeLoans": 1,
    "delinquentLoans": 0,
    "projectTypeHistory": { "FIX_AND_FLIP": 2, "RENTAL": 1, "UNSPECIFIED": 0 }
  }
}
```

Visibilidad: **la misma que promedio y conteo** (`R5` de la Fase 18) — cualquier
Lender, Admin y el propio Deudor; otro Deudor recibe `404`. **Nunca** se
exponen montos, direcciones ni nombres de contrapartes, solo agregados.

### 4.2 Listados del marketplace (`PB-009b`)

`maskLoanRequestForMarketplace` oculta `borrowerProfileId` en los `PUBLIC`
(regla 17 de [04 §4.7](../04-base-de-datos.md)), así que el Lender **no puede**
llamar al endpoint anterior desde un listado. El servicio adjunta a cada
`LoanRequest` un `borrowingScore` **compacto** (`score`, `band`,
`completedLoans`, `activeLoans`, `projectTypeHistory`) calculado del
`borrowerProfileId` real *antes* de enmascararlo. Es lo que el Spec pide:
"borrower score/history shown" con nombre y dirección ocultos.

## 5. Diseño (una función pura + una consulta)

- `src/services/borrowingScore.service.ts`:
  - `computeBorrowingScore(facts)` — **función pura**: recibe conteos y
    devuelve `{ score, band, ... }`. Sin acceso a BD → testeable con casos de
    tabla, sin Postgres.
  - `getBorrowingScore(borrowerProfileId, asOf = new Date())` — arma los
    `facts` con **un par de consultas agregadas** (cuotas, transacciones,
    contratos) y llama a la pura. `asOf` inyectable para tests
    deterministas (mismo patrón que `recomputeContractDelinquencyStatus`).
  - `getBorrowingScoresFor(borrowerProfileIds[])` — versión por lote para el
    listado del marketplace (evita N+1 en una página de 20 items).
- Sin tabla nueva ni columna nueva: **cero migraciones**.
- `ponytail:` se recalcula en cada request. Si el listado del marketplace se
  vuelve lento, se cachea en una columna/tabla de snapshot refrescada por el
  job diario que ya corre (`D-A8`); ese mismo snapshot daría el historial del
  score en el tiempo, que hoy no se pide.

## 6. Fuera de alcance

- **Score del Prestamista** ("responde bien", tiempo de respuesta): otro
  ticket. `PB-010` ya excluye "avg response time" a propósito. `Message` y
  `LoanQuote` ya guardan `createdAt`, así que será derivable sin migración.
- Decaimiento por antigüedad, tendencias, historial del score en el tiempo.
- Bloquear o filtrar por score (informativo únicamente, igual que `D-A10`).
- Fully Verified / credit pull (`BorrowerApplication`, `PB-018`, bloqueado por
  proveedor): el score de acá es de **comportamiento en la plataforma**, no
  de crédito externo.
- Notificaciones de cambio de score (`PB-022` sin implementar).

## Decisiones a confirmar

Cada una con recomendación; si se aprueba tal cual, se implementan las
recomendadas.

| # | Pregunta | Recomendación | Alternativa |
|---|---|---|---|
| S1 | Escala | **0–100 + banda** (`EXCELLENT/GOOD/FAIR/POOR/NEW`) | Solo bandas, o 300–850 tipo crédito (sugiere un equivalente a FICO que **no** es) |
| S2 | ¿"A tiempo" incluye los días de gracia? | **Sí**: `paidInFullAt ≤ dueDate + gracePeriodDays` — coherente con cuándo el sistema marca `DELINQUENT` | Estricto (`≤ dueDate`): castiga a quien usa la gracia que el contrato le da |
| S3 | Historial mínimo para mostrar puntaje | **3 cuotas vencidas o 1 préstamo `PAID_OFF`**; antes, `NEW` | Otro umbral, o mostrar siempre |
| S4 | Pesos | **−5 por pago fallido/devuelto, −15 por contrato en mora hoy**, en `SCORE_WEIGHTS` ajustable | Sin penalizaciones (solo `onTimeRate`): más simple, pero ignora ACH devueltos y mora vigente |
| S5 | Pagos parciales | Una cuota `PARTIALLY_PAID` vencida cuenta como **tardía** hasta completarse | Proporcional al monto pagado (más justo, más complejo) |
| S6 | Co-deudores | Los pagos cuentan para **todos** los `ContractBorrower` activos | Solo el `isPrimary` |
| S7 | ¿Contar el score en el marketplace? | **Sí** (`PB-009b`), versión compacta y sin datos sensibles | Solo en el perfil (endpoint), no en listados — incumple el Spec |
| S8 | Contratos `DIRECT` en `projectTypeHistory` | Bucket **`UNSPECIFIED`** (no tienen `LoanRequest`) | Ocultarlos (subestima el historial real) |
| S9 | Pagos manuales del Lender (`payments/manual`) | **Cuentan igual** — `paidInFullAt` es la fecha registrada | Excluirlos (el Lender podría "maquillar" fechas; hoy no hay control) |

## 7. Plan de acción

1. **Aprobación** + respuestas a `S1`–`S9`.
2. `borrowingScore.service.ts`: función pura + `SCORE_WEIGHTS` + `getBorrowingScore`/`getBorrowingScoresFor`.
3. **Test unitario** de la función pura (tabla de casos: sin historial → `NEW`;
   100 % a tiempo; con gracia; con devueltos; con mora vigente; límites de
   banda; `clamp` en 0). Sin Postgres.
4. Extender `getBorrowerRating` con `borrowingScore` (`PB-009`).
5. Adjuntar el score compacto a los listados del marketplace antes de
   enmascarar (`PB-009b`).
6. **Tests de integración** (Postgres real, `asOf` fijo): cuota pagada dentro de gracia
   = a tiempo; tarde; vencida sin pagar; `VOIDED` excluida; `RETURNED` penaliza;
   contrato `DELINQUENT`; co-deudor removido no acumula; contrato `DRAFT` no
   cuenta; visibilidad (Lender/self/Admin/otro Borrower `404`); el listado
   `PUBLIC` trae `borrowingScore` **y** sigue sin `borrowerProfileId`.
7. **Docs**: cerrar esta fase, `API_REFERENCE`, `06-api-endpoints`,
   `IMPLEMENTATION_PROGRESS`, `00-contradicciones` (nueva `D-S2-13c`),
   `04-base-de-datos` (regla 17), `fase-14` (`PB-009` resuelto), índices.
8. Verificación: `type-check`, `lint`, `test`, `test:integration`, más
   prueba con `curl` contra el API de desarrollo.

## Archivos afectados (estimado)

- `src/services/borrowingScore.service.ts` + `borrowingScore.service.test.ts` (unitario)
- `src/services/reviews.service.ts` (`getBorrowerRating` devuelve `borrowingScore`)
- `src/services/loanRequests.service.ts` (listados del marketplace)
- `src/app/api/borrowing-score-routes.integration.test.ts`
- Docs del paso 7. **Sin cambios en `schema.prisma` ni migraciones.**

## Tickets

| ID | Título | Prioridad | Complejidad | Estado |
|---|---|---|---|---|
| PB-009 | `borrowingScore` (servicio + función pura) y extensión de `GET /api/borrowers/:id/rating` | P1 | M | ⏳ propuesta |
| PB-009b | `borrowingScore` compacto en listados del marketplace | P1 | S | ⏳ propuesta |

---

[← Índice de fases](README.md)  ·  [Backlog](../13-backlog.md)  ·  [Anterior: Fase 18 — Ratings Lender ↔ Borrower](fase-18-ratings-lender-borrower.md)
