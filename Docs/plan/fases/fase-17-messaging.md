[← Índice de fases](README.md)  ·  [Backlog](../13-backlog.md)  ·  [Anterior: Fase 16 — Admin Overview](fase-16-admin-overview.md)

---

# Fase 17 — Mensajería Lender ↔ Borrower

> **✅ Implementada 2026-09-28** (`PB-027` → `PB-030`). Chat directo entre
> Prestamista y Deudor, habilitado solo si hay una relación de negocio real
> entre ambos. Este documento es la fuente de verdad del módulo — decisiones,
> modelo, endpoints y tests, todo en un solo lugar.

## Objetivo

Permitir que un Lender (usuario detrás de una `LenderCompany`) y un Borrower
(`BorrowerProfile`) se manden mensajes directos **solo si existe una relación
de negocio real entre ambos**: una cotización en negociación (`LoanQuote`) o
un préstamo (`Contract`) entre esa empresa y ese deudor. Nadie puede escribirle
en frío a nadie — el chat no es un directorio.

La regla de habilitación está aislada en **una sola función de servicio**
(`canMessage`, en `src/services/messaging.service.ts`) para que, si cambia
más adelante (el pedido original ya avisaba que podía cambiar), el ajuste sea
de una función y no una cirugía en cada endpoint.

## Decisiones tomadas

Analizadas y aprobadas el 2026-09-28 (todas las recomendaciones del análisis
original, sin cambios) antes de implementar:

| # | Pregunta | Decisión |
|---|---|---|
| D1 | Granularidad del hilo | **Un hilo por par** `(lenderCompanyId, borrowerProfileId)` — mismo criterio que `LenderBorrower`/`LoanQuote` (ya son N:M a ese nivel, no por préstamo). Sin `Conversation` propia. |
| D2 | Qué habilita "préstamo entre ellos" | **`Contract.status != DRAFT`** habilita; una vez habilitado, **nunca se vuelve a apagar** por cambio de estado (`PAID_OFF`/`CANCELLED` incluidos) — la relación ya existió, no hay motivo para cortar el canal después. |
| D3 | Qué cuenta como "oferta en negociación" | **`LoanQuote.status === 'SUBMITTED'`** — una cotización viva. Un `LoanRequest` `PUBLISHED` sin ninguna cotización enviada no habilita. |
| D4 | Historial tras perder elegibilidad | **Se puede leer siempre.** `canMessage` solo gatea **enviar** mensajes nuevos, nunca leer los viejos (`GET` nunca da 403 por esto, solo 404 si jamás hubo mensajes). |
| D5 | Co-deudores | **Un hilo por `BorrowerProfile`**, ninguno grupal. |
| D6 | Lender con varias `LenderCompany` | **Un hilo por empresa** — el tenant real siempre fue `LenderCompany`, no `LenderProfile` (mismo criterio que `LoanQuote`/`LenderBorrower`/`Contract`). |
| D7 | ¿`AuditLog` por mensaje? | **No.** Alto volumen, bajo valor de auditoría frente a contratos/pagos — `Message`, de solo-inserción, ya es su propio rastro inmutable. |
| D8 | ¿Tiempo real? | **No en v1.** Solo REST; el cliente hace polling del hilo abierto. Sin dependencias nuevas (no había `ws`/`socket.io`/similar en el proyecto). |
| D9 | ¿Adjuntos? | **No en v1** — no existe `Document`/S3 todavía (Fase 11, `PB-002`, pendiente). Solo texto, tope 4000 caracteres. |
| D10 | ¿Estado de lectura (`readAt`)? | **Sí, incluido** — una columna nullable, endpoint explícito `POST .../read` (no efecto secundario de un `GET`). |
| D11 | `GET` de hilos: ¿lista pares elegibles sin mensajes? | **No** — solo pares con al menos un mensaje enviado. El botón para *empezar* una conversación vive en la pantalla donde ya se ve la contraparte (la cotización, el contrato). |

## Modelo

Una sola tabla nueva, sin `Conversation` separada — el "hilo" es una vista
calculada (`groupBy` por `lenderCompanyId`/`borrowerProfileId`), no una
entidad propia. Migración `20260928220125_pb027_messages`.

```prisma
enum MessageSenderRole {
  LENDER
  BORROWER
}

// De solo inserción — nunca se edita ni se borra, mismo criterio que
// AuditLog/ContractTermsAcceptance. Sin adjuntos y sin evento propio en
// AuditLog (D7/D9).
model Message {
  id String @id @default(dbgenerated("uuidv7()")) @db.Uuid

  lenderCompanyId String        @db.Uuid
  lenderCompany   LenderCompany @relation(fields: [lenderCompanyId], references: [id], onDelete: Restrict)

  borrowerProfileId String          @db.Uuid
  borrowerProfile   BorrowerProfile @relation(fields: [borrowerProfileId], references: [id], onDelete: Restrict)

  senderUserId String            @db.Uuid
  senderUser   User              @relation("MessageSender", fields: [senderUserId], references: [id])
  senderRole   MessageSenderRole

  body String @db.VarChar(4000)

  readAt    DateTime?
  createdAt DateTime  @default(now())

  @@index([lenderCompanyId, borrowerProfileId, createdAt])
  @@index([borrowerProfileId, readAt])
  @@map("messages")
}
```

## Regla de elegibilidad (`canMessage`)

`src/services/messaging.service.ts` — único lugar que hay que tocar si la
regla cambia; lo llama `sendFromLender`/`sendFromBorrower` antes de crear el
`Message`, nunca las lecturas (D4):

```ts
async function canMessage(lenderCompanyId: string, borrowerProfileId: string): Promise<boolean> {
  const [activeQuote, realLoan] = await Promise.all([
    prisma.loanQuote.findFirst({
      where: { lenderCompanyId, status: "SUBMITTED", loanRequest: { borrowerProfileId } },
      select: { id: true },
    }),
    prisma.contract.findFirst({
      where: { lenderCompanyId, status: { not: "DRAFT" }, deletedAt: null, borrowers: { some: { borrowerProfileId } } },
      select: { id: true },
    }),
  ]);
  return activeQuote !== null || realLoan !== null;
}
```

## Endpoints

Mismo patrón "`/me`" que el resto de la API — rutas separadas por rol en vez
de un único endpoint genérico (así están `verification`, `borrowers`,
`companies`, etc. en todo el repo). `withRole(..., { requireTwoFactor: false })`
en las ocho: mandar un mensaje no es una escritura de negocio en el sentido
de `D-P3-1` (no mueve plata ni cambia el estado de un contrato).

| Método | Ruta | Rol | Notas |
|---|---|---|---|
| POST | `/api/lenders/me/messages` | LENDER | Body `{ borrowerProfileId, lenderCompanyId?, body }` — `lenderCompanyId` obligatorio solo si tiene más de una empresa (mismo patrón que `loanQuotes.service.ts#resolveTargetLenderCompanyId`, duplicado acá a propósito). `403 MESSAGING_NOT_ALLOWED` si `canMessage` da falso |
| POST | `/api/borrowers/me/messages` | BORROWER | Body `{ lenderCompanyId, body }` |
| GET | `/api/lenders/me/messages/threads` | LENDER | Borrowers con al menos un mensaje, con `lastMessage` + `unreadCount` (D11) |
| GET | `/api/borrowers/me/messages/threads` | BORROWER | Ídem, del lado del Deudor |
| GET | `/api/lenders/me/messages/threads/:borrowerProfileId` | LENDER | Historial paginado (`page`/`pageSize`, orden `createdAt asc`). `?lenderCompanyId=` si tiene más de una empresa. `404 THREAD_NOT_FOUND` si nunca hubo mensajes |
| GET | `/api/borrowers/me/messages/threads/:lenderCompanyId` | BORROWER | Ídem |
| POST | `/api/lenders/me/messages/threads/:borrowerProfileId/read` | LENDER | Marca `readAt = now()` en los mensajes recibidos de ese Borrower (`senderRole=BORROWER`) |
| POST | `/api/borrowers/me/messages/threads/:lenderCompanyId/read` | BORROWER | Ídem, `senderRole=LENDER` |

## Reglas de servicio

- `body`: `trim()`, no vacío, máx. 4000 caracteres (Zod).
- `POST` re-chequea `canMessage` en cada envío — es la única guarda real, no
  confía en que el frontend ya lo validó.
- Sin rate limiting propio; si se abusa, entra en el genérico de endpoints
  sensibles (`BE-005`) más adelante.
- Sin ediciones ni borrados — un mensaje enviado es inmutable.
- `GET` de un hilo nunca depende de `canMessage`: `404 THREAD_NOT_FOUND` solo
  si no hay ningún `Message` para ese par, sin importar si la relación sigue
  vigente.

## Fuera de alcance en v1

- Adjuntos/archivos (D9 — bloqueado por `Document`/S3, Fase 11, `PB-002`).
- Tiempo real (D8 — REST + polling alcanza al volumen actual).
- Notificaciones por email de "tenés un mensaje nuevo" — depende de
  `Notification` (`PB-022`, Fase 11, no implementado); se puede sumar después
  sin tocar el modelo de `Message`.
- Bookkeepers, Admin o Insurance Company como participantes.
- Hilos grupales (D5), auditoría por mensaje (D7).

## Archivos afectados

- `prisma/schema.prisma` (modelo `Message`, enum `MessageSenderRole`, relaciones en `User`/`LenderCompany`/`BorrowerProfile`) + `prisma/migrations/20260928220125_pb027_messages/`.
- `src/validations/messages.validation.ts`
- `src/services/messaging.service.ts`
- `src/controllers/messages.controller.ts`
- `src/app/api/lenders/me/messages/route.ts`
- `src/app/api/borrowers/me/messages/route.ts`
- `src/app/api/lenders/me/messages/threads/route.ts`
- `src/app/api/borrowers/me/messages/threads/route.ts`
- `src/app/api/lenders/me/messages/threads/[borrowerProfileId]/route.ts`
- `src/app/api/borrowers/me/messages/threads/[lenderCompanyId]/route.ts`
- `src/app/api/lenders/me/messages/threads/[borrowerProfileId]/read/route.ts`
- `src/app/api/borrowers/me/messages/threads/[lenderCompanyId]/read/route.ts`
- `src/app/api/messages-routes.integration.test.ts`
- `Docs/API_REFERENCE.md` (§ Mensajería), `Docs/plan/06-api-endpoints.md` (§6.17), `Docs/plan/13-backlog.md`, `Docs/plan/fases/README.md`, `Docs/IMPLEMENTATION_PROGRESS.md`

## Tickets

| ID | Título | Prioridad | Complejidad | Estado |
|---|---|---|---|---|
| PB-027 | Modelo `Message` + `canMessage` en `messaging.service.ts` | P1 | M | ✅ |
| PB-028 | `POST /api/lenders/me/messages` y `/api/borrowers/me/messages` | P1 | S | ✅ |
| PB-029 | `GET .../messages/threads` y `.../messages/threads/:counterpartId` (Lender + Borrower) | P1 | M | ✅ |
| PB-030 | `POST .../messages/threads/:counterpartId/read` (Lender + Borrower) | P2 | S | ✅ |

## Tests

`src/app/api/messages-routes.integration.test.ts` (Postgres real, sin mocks,
las 8 rutas vía sus route handlers reales) — 6 tests, todos en verde:

- Camino dorado: sin relación → `403 MESSAGING_NOT_ALLOWED`; una `LoanQuote`
  `SUBMITTED` habilita el envío en ambos sentidos; aparecen en `GET
  /threads` de los dos lados con `lastMessage`/`unreadCount` correctos;
  historial paginado en orden cronológico; `POST .../read` baja el contador
  de no leídos a 0 en cada lado (y no toca los mensajes propios).
- D4: la cotización se retira sin llegar a contrato → se bloquea el envío,
  pero el historial anterior se sigue leyendo (`200`, no `404`).
- D2: un `Contract` fuera de `DRAFT` habilita el chat sin ninguna cotización,
  y sigue habilitado tras pasar a `PAID_OFF`/`CANCELLED`.
- D2: un `Contract` todavía `DRAFT` no habilita el chat.
- Multi-empresa: sin `lenderCompanyId` y 2 empresas → `400
  LENDER_COMPANY_REQUIRED`; empresa propia sin relación → `403
  MESSAGING_NOT_ALLOWED`; empresa ajena → `404`; historial sin
  `lenderCompanyId` → `400`.
- Acceso: rol equivocado → `403`; sin token → `401`; contraparte sin
  mensajes → `404 THREAD_NOT_FOUND`; `body` vacío o >4000 caracteres → `400`.

Suite completa verificada sin regresiones: `pnpm run type-check`, `pnpm run
lint` y `pnpm run test:integration` (40 archivos, 249 tests) en verde.

---

[← Índice de fases](README.md)  ·  [Backlog](../13-backlog.md)  ·  [Anterior: Fase 16 — Admin Overview](fase-16-admin-overview.md)
