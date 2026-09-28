[← Índice de fases](README.md)  ·  [Backlog](../13-backlog.md)  ·  [Anterior: Fase 17 — Mensajería](fase-17-messaging.md)

---

# Fase 18 — Puntuación entre Lender y Borrower (Ratings)

> **✅ Implementada 2026-09-29** (`PB-031` → `PB-034`). Propuesta del
> 2026-09-28, **aprobada con todas las recomendaciones `R1`–`R10`** de la
> sección [Decisiones a confirmar](#decisiones-a-confirmar). Detalles que el
> plan dejaba abiertos y se resolvieron al implementar: las reseñas
> públicas **no exponen quién reseñó**; `GET /api/borrowers/:id/rating`
> devuelve `reviews: null` (no un error) cuando el que consulta puede ver el
> promedio pero no los comentarios; `/api/me/reviews/pending` tiene tope de
> 100 por lado. Request/response en [API_REFERENCE](../../API_REFERENCE.md).

## 1. Qué se pide

- **Hoy (v1):** los dos lados se califican entre sí con **1 a 5 estrellas** y
  pueden dejar un **mensaje** (comentario).
  - Lender → Borrower.
  - Borrower → Lender.
- **Futuro (ya contemplado, no es v1):** la puntuación pasaría a ser (o
  sumar) una métrica **calculada** — paga a tiempo o no, el Lender responde
  bien o no.

## 2. Análisis

### 2.1 Lo que ya existe en el plan (y choca o se solapa)

| Ya planeado | Estado | Relación con esta fase |
|---|---|---|
| `D-S2-13` / `PB-023` — `LenderReview` (Deudor califica al Prestamista, 1–5 + comentario, único por contrato+deudor) | Solo diseño, sin código | **Esta fase lo generaliza a los dos sentidos.** `PB-023` queda absorbido por `PB-031`/`PB-032`. Mismo criterio: reseña = entidad enviada por un usuario, distinta de un cálculo. |
| `PB-009` — `GET /api/borrowers/:id/rating` ("Borrowing Score" calculado) | Solo diseño, fórmula sin decidir | Es **exactamente el "futuro"** que se menciona (paga a tiempo). Se reserva el mismo path y un shape de respuesta extensible para no rehacer nada (ver §5). |
| `PB-010` — `GET /api/lenders/:id/stats` (con `averageRating` derivado de `LenderReview`) | Solo diseño | `averageRating` sale de esta tabla. |
| `canMessage` (Fase 17, `messaging.service.ts`) | ✅ Implementado | Patrón a copiar: **una sola función de servicio** con la regla de elegibilidad (`canReview`), para que cuando cambie la regla sea una función, no cirugía en cada endpoint. |
| `assertNotSelfLending` (`selfDealing.service.ts`) | ✅ Implementado | Reutilizable: con el rol dual (`D-P7-1`) un usuario puede ser Lender y Borrower a la vez; hay que impedir que se califique a sí mismo. |
| `D-S2-11` / `D-S2-13` — promedios **derivados**, no columnas | Decisión vigente | Se mantiene: `AVG(rating)`, sin `averageRating` guardado. |

### 2.2 Principio de diseño

Hay **dos cosas distintas** que hoy se confunden bajo la palabra "puntuación":

1. **Reseña** — la escribe una persona: estrellas + texto. *Esto es la v1.*
2. **Score calculado** — lo deriva el sistema de pagos/respuestas. *Futuro.*

Van en **tablas/cálculos separados** y se muestran juntos. Así el cambio
futuro es *sumar* un cálculo, no migrar ni tirar la tabla de reseñas.
Además, una reseña de 5 estrellas de un deudor que jamás pagó a tiempo no
"contamina" el score objetivo cuando llegue.

### 2.3 Riesgos reales (y cómo se cubren)

| Riesgo | Mitigación en el plan |
|---|---|
| Reseñas falsas / de gente sin trato real | Solo se puede calificar sobre un **`Contract`** real (no cotización ni chat) — ver `R2`. |
| Autocalificación (usuario con rol dual) | `assertNotSelfLending`-style: comparar `User.id` de ambos lados. |
| Represalia / presión ("cambiá tu reseña o…") | Reseña **inmutable** en v1 (sin editar ni borrar), una sola por contrato y dirección. |
| Comentarios abusivos o datos personales | Tope 1000 caracteres, sin adjuntos. Moderación admin **fuera de v1** pero el modelo la admite sin migración destructiva (ver `R7`). |
| Reseñar antes de haber vivido nada | El contrato debe haber salido de `DRAFT`/`PENDING_ACCEPTANCE` — ver `R2`. |
| Co-deudores en un mismo contrato | Cada `BorrowerProfile` es una unidad calificable por separado (`R4`), igual que hilos en Fase 17 (`D5`). |
| Promedio calculado en cada request se vuelve lento | Es una agregación indexada; techo documentado, se cachea en columna solo si se mide lento (`ponytail:`). |

## 3. Modelo propuesto

Una sola tabla, bidireccional. Sin tabla de "resumen" — todo derivado.

```prisma
enum ReviewDirection {
  LENDER_TO_BORROWER
  BORROWER_TO_LENDER
}

// De solo inserción (mismo criterio que Message/AuditLog): no se edita ni se
// borra en v1. El promedio se deriva con AVG(rating), nunca se guarda
// (D-S2-11/D-S2-13).
model Review {
  id String @id @default(dbgenerated("uuidv7()")) @db.Uuid

  // Contexto: de qué préstamo real habla la reseña.
  contractId String   @db.Uuid
  contract   Contract @relation(fields: [contractId], references: [id], onDelete: Restrict)

  // Las dos puntas de la relación, siempre presentes sin importar el sentido.
  // El "calificado" es lenderCompany o borrowerProfile según `direction`.
  lenderCompanyId String        @db.Uuid
  lenderCompany   LenderCompany @relation(fields: [lenderCompanyId], references: [id], onDelete: Restrict)

  borrowerProfileId String          @db.Uuid
  borrowerProfile   BorrowerProfile @relation(fields: [borrowerProfileId], references: [id], onDelete: Restrict)

  direction      ReviewDirection
  reviewerUserId String          @db.Uuid
  reviewerUser   User            @relation("ReviewAuthor", fields: [reviewerUserId], references: [id])

  rating  Int     // 1–5, CHECK en la migración
  comment String? @db.VarChar(1000)

  createdAt DateTime @default(now())

  // Una reseña por contrato, por deudor, por sentido.
  @@unique([contractId, borrowerProfileId, direction])
  @@index([lenderCompanyId, direction])
  @@index([borrowerProfileId, direction])
  @@map("reviews")
}
```

Notas:
- `CHECK (rating BETWEEN 1 AND 5)` en la migración SQL, además de Zod —
  restricción en la BD, no solo en la app.
- `direction` + las dos FKs evita dos tablas casi idénticas
  (`LenderReview`/`BorrowerReview`) y hace trivial `GET` de "reseñas recibidas"
  por cualquiera de los dos lados.
- Sin `hiddenAt` en v1 (YAGNI); si se moderan comentarios, es una columna
  nullable aditiva.

## 4. Regla de elegibilidad — `canReview`

Único lugar a tocar si la regla cambia (`src/services/reviews.service.ts`):

1. El usuario que reseña es **parte real del contrato**:
   - Lender: dueño (vía `LenderProfile.userId`) de `contract.lenderCompanyId`.
   - Borrower: `ContractBorrower` **activo** (`removedAt = null`) del contrato.
2. El sentido (`direction`) **se infiere** del lado en que está el usuario en
   ese contrato — **no** de `User.role` (un usuario dual es Lender en un
   contrato y Borrower en otro).
3. `Contract.status ∈ { ACTIVE, DELINQUENT, PAID_OFF }` (ver `R2`).
4. No existe ya una reseña para `(contractId, borrowerProfileId, direction)`
   → si no, `409 REVIEW_ALREADY_EXISTS`.
5. Anti-autocalificación: si `lenderCompany.lenderProfile.userId ===
   borrowerProfile.userId` → `409 SELF_REVIEW_NOT_ALLOWED`.

Cuando es Lender quien reseña, **debe indicar `borrowerProfileId`** (un
contrato puede tener co-deudores); cuando es Borrower, el calificado es la
`lenderCompany` del contrato (no hay ambigüedad).

## 5. Endpoints propuestos

Contrato como recurso (mismo enfoque que `/api/contracts/:id/...` ya
existentes, que resuelven el rol por participación en el contrato):

| Método | Ruta | Quién | Notas |
|---|---|---|---|
| POST | `/api/contracts/:id/reviews` | Lender o Borrower del contrato | Body `{ rating, comment?, borrowerProfileId? }` — `borrowerProfileId` obligatorio solo si reseña el Lender. `direction` se infiere. `403 REVIEW_NOT_ALLOWED` si falla `canReview` |
| GET | `/api/contracts/:id/reviews` | Cualquier parte del contrato | Reseñas de ese contrato (las dos direcciones) + `canReview` del usuario actual (para que el front sepa si mostrar el botón) |
| GET | `/api/lenders/:lenderCompanyId/rating` | Autenticado | `{ average, count, distribution: {1..5}, reviews: [...] }` paginado — visibilidad según `R5` |
| GET | `/api/borrowers/:borrowerProfileId/rating` | Autenticado | Mismo shape. **Mismo path que `PB-009`**: hoy devuelve solo reseñas; cuando exista el score calculado se le **agrega** un campo (`score`) sin romper el contrato |
| GET | `/api/me/reviews/pending` | Cualquier usuario | Contratos elegibles donde aún no reseñó (P2 — solo para que el front pueda mostrar "te falta calificar") |

Todas con `withRole(...)` + `requireTwoFactor: false` (calificar no mueve
dinero ni cambia el estado de un contrato, mismo criterio que mensajería).

## 6. Camino al "futuro" (score calculado)

Sin construir nada ahora, pero dejando la puerta abierta:

- El shape de `/rating` es un **objeto**, no un número → agregar `score`,
  `onTimePaymentRate`, `avgResponseTime`, etc. es aditivo.
- **Borrower "paga a tiempo"** se calcula desde `ScheduledPayment`
  (`dueDate` vs `Transaction.completedAt`) — datos que **ya existen**, así que
  no hace falta guardar nada hoy para poder calcularlo mañana.
- **Lender "responde bien"** sí necesita un dato nuevo: tiempo entre un
  `Message`/`LoanQuote` recibido y la respuesta. `Message` (Fase 17) ya trae
  `createdAt` + `senderRole`, así que también es derivable **sin migración**.
- Qué cuenta como "bien" y con qué pesos es decisión de negocio → se define
  cuando se escriba la fase del score (es `PB-009`).

## 7. Fuera de alcance en v1

- Editar/borrar reseñas; réplica del calificado a una reseña.
- Moderación de comentarios por Admin (modelo lo admite; ver `R7`).
- Notificaciones ("recibiste una calificación") — depende de `Notification`
  (`PB-022`, no implementado).
- Score calculado (pagos a tiempo / respuesta) — es `PB-009`.
- Calificar a Bookkeepers, Insurance Companies o Admins.
- Bloquear operaciones por mala calificación (informativo únicamente).

## Decisiones a confirmar

Cada una viene con recomendación; si se aprueba el plan tal cual, se
implementan las recomendadas.

| # | Pregunta | Recomendación | Alternativa |
|---|---|---|---|
| R1 | ¿Una tabla bidireccional o dos (`LenderReview`/`BorrowerReview`)? | **Una (`Review`)** — menos código, una sola regla, un solo test | Dos tablas si los campos van a divergir mucho (ej. categorías distintas por lado) |
| R2 | ¿Desde qué estado del contrato se puede calificar? | **`ACTIVE`, `DELINQUENT`, `PAID_OFF`** — hubo trato real; sin `DRAFT`/`PENDING_ACCEPTANCE`/`CANCELLED` (no llegó a existir la relación) | Solo `PAID_OFF` (más estricto, pero el deudor no puede calificar a un lender malo hasta el final y las reseñas tardan años en llegar) |
| R3 | ¿Se puede calificar sin contrato, solo por cotización/chat? | **No.** Es la barrera contra reseñas falsas/hostiles | Sí, si el negocio prioriza volumen de reseñas sobre calidad |
| R4 | Co-deudores | **Cada `BorrowerProfile` se califica por separado**; un Borrower califica a la `LenderCompany` (no a la persona Lender) | Reseña única grupal (complica quién la escribe) |
| R5 | ¿Quién ve los **comentarios**? El promedio+conteo se asume visible | **Lender (empresa): comentarios visibles a cualquier usuario autenticado** (es un marketplace, el Deudor elige con quién trabajar). **Borrower: comentarios visibles solo al propio Borrower, a Lenders con quienes tuvo/tiene contrato, y a Admin**; el promedio+conteo sí visible a cualquier Lender (es una persona física, privacidad) | Todo público en ambos sentidos |
| R6 | ¿Editar o borrar la propia reseña? | **No en v1** (inmutable, evita represalias/presión); una por contrato+sentido | Ventana de edición corta (ej. 24 h) — agrega estado y reglas |
| R7 | ¿Moderación de comentarios? | **Fuera de v1**; si hace falta, `hiddenAt` nullable + `POST /api/admin/reviews/:id/hide` es aditivo, sin tocar lo hecho | Incluirla ya (más superficie: rol Admin, auditoría, filtros en cada lectura) |
| R8 | Comentario: ¿obligatorio/opcional y tope? | **Opcional, máx. 1000 caracteres**, sin adjuntos | Obligatorio si la nota es ≤ 2 (fuerza justificar críticas, más fricción) |
| R9 | ¿`AuditLog` por reseña? | **No** — `Review` es de solo inserción y ya es su propio rastro (mismo criterio que `Message`, `D7` de Fase 17) | Sí, si Compliance lo pide |
| R10 | ¿Endpoint `pending` (P2)? | **Sí, P2** — barato y es lo que hace que la gente efectivamente califique | Omitirlo hasta que el front lo pida |

## 8. Plan de acción (pasos, en orden)

1. **Aprobación** de este documento + respuestas a `R1`–`R10`.
2. **Migración + modelo** — `Review`, `ReviewDirection`, `CHECK` de rating,
   relaciones en `User`/`LenderCompany`/`BorrowerProfile`/`Contract`
   (`PB-031`).
3. **Servicio** `reviews.service.ts`: `canReview` (regla única),
   `createReview`, `listContractReviews`, `getRatingSummary`.
4. **Validaciones Zod** (`reviews.validation.ts`): `rating` entero 1–5,
   `comment` `trim()` máx. 1000.
5. **Controller + rutas** de la tabla §5 (`PB-032`, `PB-033`, `PB-034`).
6. **Tests de integración** (Postgres real, sin mocks — patrón de
   `messages-routes.integration.test.ts`):
   - Lender→Borrower y Borrower→Lender en camino dorado; promedio y
     distribución correctos.
   - Duplicado (mismo contrato+deudor+sentido) → `409`.
   - Contrato `DRAFT`/`PENDING_ACCEPTANCE`/`CANCELLED` → `403`.
   - Usuario ajeno al contrato → `403`/`404`; co-deudor removido → `403`.
   - Rol dual: no puede calificarse a sí mismo; el sentido sale del lado del
     contrato, no de `User.role`.
   - `rating` 0/6/1.5, `comment` >1000 → `400`.
   - Visibilidad de comentarios por `R5`.
7. **Docs**: cerrar esta fase, marcar `PB-023` como absorbido en
   `13-backlog.md`/`fase-14`, actualizar `00-contradicciones` (nueva
   `D-S2-13b`), `04-base-de-datos`, `06-api-endpoints`, `API_REFERENCE.md`,
   `fases/README.md`, `IMPLEMENTATION_PROGRESS.md`.
8. **Verificación**: `pnpm run type-check`, `pnpm run lint`,
   `pnpm run test:integration` sin regresiones.

## Archivos afectados (estimado)

- `prisma/schema.prisma` + migración `..._pb031_reviews`
- `src/validations/reviews.validation.ts`
- `src/services/reviews.service.ts`
- `src/controllers/reviews.controller.ts`
- `src/app/api/contracts/[id]/reviews/route.ts`
- `src/app/api/lenders/[lenderCompanyId]/rating/route.ts`
- `src/app/api/borrowers/[borrowerProfileId]/rating/route.ts`
- `src/app/api/me/reviews/pending/route.ts`
- `src/app/api/reviews-routes.integration.test.ts`
- Docs listados en el paso 7

## Tickets

| ID | Título | Prioridad | Complejidad | Estado |
|---|---|---|---|---|
| PB-031 | Modelo `Review` + migración + `canReview` en `reviews.service.ts` (absorbe `PB-023`) | P1 | M | ✅ |
| PB-032 | `POST` / `GET /api/contracts/:id/reviews` | P1 | M | ✅ |
| PB-033 | `GET /api/lenders/:id/rating` y `GET /api/borrowers/:id/rating` (promedio, distribución, reseñas; reserva el path de `PB-009`) | P1 | M | ✅ |
| PB-034 | `GET /api/me/reviews/pending` | P2 | S | ✅ |

---

[← Índice de fases](README.md)  ·  [Backlog](../13-backlog.md)  ·  [Anterior: Fase 17 — Mensajería](fase-17-messaging.md)
