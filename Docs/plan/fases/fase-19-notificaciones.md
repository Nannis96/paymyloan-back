[← Índice de fases](README.md)  ·  [Backlog](../13-backlog.md)  ·  [Anterior: Fase 18 — Ratings](fase-18-ratings-lender-borrower.md)

---

# Fase 19 — Notificaciones (in-app) Lender ↔ Borrower

> **✅ Implementada 2026-09-29** (`PB-035` → `PB-039`). Propuesta aprobada
> tal cual, con todas las recomendaciones `N1`–`N10`. Implementa el diseño
> ya existente de `Notification` (`D-S2-12`, `PB-022` en
> [Fase 11](fase-11-documentos-pdf.md#pb-022--notification-in-app--disparadores))
> acotado al flujo Lender ↔ Borrower. `PB-022` queda **absorbido** por
> `PB-035`/`PB-036` (mismo precedente que `PB-023` en Fase 18); los
> disparadores de pagos/payoff/`BorrowerApplication` se enchufan después con
> la misma `notify()`, sin migración. Request/response en
> [API_REFERENCE](../../API_REFERENCE.md#notificaciones-srcappapinotifications).

## 1. Qué se pide

Que cada usuario tenga su lista de notificaciones dentro de la app:

**Lender**
1. Le llegó una **solicitud de cotización** de un Borrower (préstamo para una propiedad).
2. El Borrower **contestó los términos** que le ofrecieron (aceptó o rechazó).
3. El Borrower **aceptó los términos** → el contrato quedó activo.
4. Le escribió un mensaje.

**Borrower**
1. El Lender le mandó una **oferta (cotización)** para el crédito que pidió.
2. El Lender le mandó los **términos** del contrato para revisar.
3. Ya está el **contrato** (activo).
4. Le escribió un mensaje.

## 2. Análisis — lo que ya existe

| Ya existe | Estado | Relación |
|---|---|---|
| Diseño de `Notification` (`D-S2-12`, [04 §Notification](../04-base-de-datos.md), [06 §6.13](../06-api-endpoints.md)): `userId`, `type` String libre + union TS, `title`, `body`, `isRead`, `readAt`, `relatedEntityType/Id`, `createdAt`. Rutas `GET /api/notifications`, `POST /:id/read`, `POST /read-all` | Solo diseño, **sin tabla ni código** | Se implementa tal cual, con los ajustes de §3 |
| `sendEmail()` en 4 puntos: `loan-quote-selected`, `terms-updated`, `terms-rejected`, activación | ✅ | **No se toca.** Los emails actuales siguen saliendo; `notify()` corre al lado, no los reemplaza (`N6`) |
| `Message` + `readAt` (Fase 17) | ✅ | Los mensajes ya tienen su propio "no leído"; se decide en `N4` cómo se reflejan |
| `logAuditEvent` (`AuditLog.action` = String + union TS) | ✅ | **Patrón a copiar** para `Notification.type`: sin enum de Postgres, sin migración por evento nuevo |
| `canMessage`, `canReview` — "una sola función con la regla" | ✅ | Mismo criterio: **una sola función `notify()`** en `src/lib/notify.ts`; los servicios la llaman, no hay bus de eventos |
| Puntos de servicio donde ocurre cada evento | ✅ (ver §4) | Cada disparador es **una línea** en un servicio que ya existe |

### 2.1 Destinatario — quién es "el Lender" y "el Borrower"

- **Borrower** → `BorrowerProfile.userId`.
- **Lender** → una `LenderCompany` no tiene usuario propio: se resuelve por
  `LenderCompany.lenderProfile.userId` (el dueño; mismo criterio que
  `canReview` y `requireOwnedLenderCompanies`). Bookkeepers **no** reciben en v1.
- Un usuario dual (`D-P7-1`) recibe las de sus dos lados en **una sola
  lista**; el `type` y `relatedEntity` dicen de qué lado es. Sin filtro por rol.

### 2.2 Riesgos y cómo se cubren

| Riesgo | Mitigación |
|---|---|
| Notificar de más (spam: marketplace `PUBLIC` = todos los lenders) | La solicitud de cotización **solo** se notifica a los `LoanRequestLenderTarget` activos, nunca a todo el marketplace (`N2`) |
| Un fallo al crear la notificación tumba la operación de negocio (aceptar términos) | `notify()` **nunca lanza**: try/catch + `logger.error`; la operación de negocio ya se confirmó. Trade-off: se puede perder una notificación, no una transacción (`N5`) |
| Notificación de un evento que se revirtió (ej. transacción falló) | Se dispara **después** de que commitea la transacción, no dentro |
| Un usuario lee notificaciones ajenas | Todas las queries filtran por `userId = session.userId`; `404` (no `403`) si el `id` no es suyo, como el resto del backend |
| Ráfaga de mensajes = 50 notificaciones | Coalescencia por hilo (`N4`) |
| Crecimiento de la tabla | Índice `(userId, isRead, createdAt)`; retención/purga **fuera de v1** (`ponytail:` job de purga a 90 días si se mide) |
| Notificaciones duplicadas por reintentos del cliente | Cada disparador vive en un endpoint de escritura que ya es idempotente por estado (`409` si repite); no hace falta clave de idempotencia |

## 3. Modelo propuesto

Una tabla. Sin tabla de entregas por canal (mismo criterio que `D-S2-12`).

```prisma
// De solo inserción salvo isRead/readAt. type es String (no enum de BD),
// mismo criterio que AuditLog.action: el control vive en el union de
// src/lib/notify.ts. D-S2-12.
model Notification {
  id String @id @default(dbgenerated("uuidv7()")) @db.Uuid

  userId String @db.Uuid
  user   User   @relation("UserNotifications", fields: [userId], references: [id], onDelete: Cascade)

  type  String
  title String @db.VarChar(200)
  body  String @db.VarChar(1000)

  // Deep-link para el front: qué abrir al tocarla.
  relatedEntityType String? // "LoanRequest" | "LoanQuote" | "Contract" | "MessageThread"
  relatedEntityId   String? @db.Uuid

  isRead    Boolean   @default(false)
  readAt    DateTime?
  createdAt DateTime  @default(now())

  @@index([userId, isRead, createdAt])
  @@map("notifications")
}
```

Cambios respecto al diseño de `D-S2-12`: `title`/`body` con tope
(`VarChar` en vez de `Text`) y `relatedEntityId` como `Uuid` (todos los ids
del sistema lo son). Se agrega `onDelete: Cascade` en `User` (una notificación
no tiene sentido sin su dueño; los `User` casi nunca se borran físicamente).

### 3.1 Catálogo de tipos (v1)

| `type` | Para | Se dispara en | `relatedEntity` |
|---|---|---|---|
| `LOAN_QUOTE_REQUESTED` | Lender (dueño de la empresa) | `publishLoanRequest` (por cada target activo) y `addLoanRequestTarget` cuando la solicitud ya está `PUBLISHED` | `LoanRequest` |
| `LOAN_QUOTE_RECEIVED` | Borrower | `submitQuote` (crear o reemplazar oferta) | `LoanQuote` |
| `LOAN_QUOTE_SELECTED` | Lender | `selectQuote` | `Contract` |
| `CONTRACT_TERMS_SUBMITTED` | Borrower (cada co-deudor activo) | `submitContractTerms` | `Contract` |
| `CONTRACT_TERMS_ACCEPTED` | Lender | `acceptContractTerms` cuando la aceptación **no** activa el contrato (título distingue "faltan N") | `Contract` |
| `CONTRACT_ACTIVATED` | Lender **y** Borrower(es) | `acceptContractTerms` cuando se completa el quórum y `!contract.activatedAt` | `Contract` |
| `CONTRACT_TERMS_REJECTED` | Lender | `rejectContractTerms` | `Contract` |
| `MESSAGE_RECEIVED` | la contraparte | `sendFromLender` / `sendFromBorrower` (coalescida, `N4`) | `MessageThread` (id = id del `LenderCompany` o `BorrowerProfile` de la contraparte, ver `N4`) |

Opcionales que salen casi gratis (una línea cada uno, **fuera del pedido**, ver `N3`):
`LOAN_QUOTE_WITHDRAWN` (Borrower ve que retiraron una oferta), `LOAN_QUOTE_DECLINED`
(Lender: se seleccionó otra o se retiró la solicitud), `REVIEW_RECEIVED`,
`VERIFICATION_APPROVED/REJECTED`.

## 4. Puntos de disparo (ya verificados en el código)

| Evento | Archivo / función | Hoy | Agregar |
|---|---|---|---|
| Borrower publica solicitud | `loanRequests.service.ts#publishLoanRequest` | solo audit | `notify` a cada target activo |
| Borrower agrega lender a solicitud publicada | `loanRequests.service.ts#addLoanRequestTarget` | solo audit | `notify` si `status === PUBLISHED` (si es `DRAFT`, se notifica al publicar) |
| Lender envía oferta | `loanQuotes.service.ts#submitQuote` | solo audit | `notify` al Borrower dueño de la solicitud |
| Borrower elige oferta | `loanQuotes.service.ts#selectQuote` | email `loan-quote-selected` | `notify` al Lender |
| Lender envía términos | `contracts.service.ts#submitContractTerms` | email `terms-updated` | `notify` a cada co-deudor activo |
| Borrower acepta | `contracts.service.ts#acceptContractTerms` | solo audit | `notify` al Lender; si activó, `CONTRACT_ACTIVATED` a ambos lados |
| Borrower rechaza | `contracts.service.ts#rejectContractTerms` | email `terms-rejected` | `notify` al Lender |
| Mensaje | `messaging.service.ts#sendFromLender/sendFromBorrower` | solo insert | `notify` a la contraparte |

> Nota de implementación: `acceptContractTerms` decide la activación
> **dentro** de la transacción (`return` temprano si falta quórum). Para no
> notificar dentro de la transacción, la transacción debe devolver un flag
> `{ activated: boolean }` y `notify` corre después del commit.

## 5. Endpoints propuestos

Todos autenticados, sin restricción de rol (cualquier usuario ve las suyas),
`requireTwoFactor: false` (leer/marcar no mueve dinero ni contratos —
mismo criterio que mensajería y reseñas). Ya estaban en [06 §6.13](../06-api-endpoints.md).

| Método | Ruta | Notas |
|---|---|---|
| GET | `/api/notifications` | Propias, más nuevas primero, paginado (`paginationQuerySchema`). Filtros: `?isRead=true\|false`, `?type=`. Respuesta: `PaginatedResult` |
| GET | `/api/notifications/unread-count` | `{ unread: number }` — para el badge de la campana; barato (índice) y evita traer la lista solo para contar. Si se aprueba `N4`-B, suma también mensajes no leídos como `{ unread, unreadMessages }` |
| POST | `/api/notifications/:id/read` | Marca una propia. `404` si no es suya. Idempotente (si ya estaba leída, `200` sin cambios) |
| POST | `/api/notifications/read-all` | Marca todas las propias sin leer. Devuelve `{ updated: number }` |

Sin `DELETE` en v1 (`N7`). Sin tiempo real: **polling** del cliente sobre
`unread-count` (mismo criterio que mensajería, Fase 17; SSE/WebSocket
fuera de alcance).

## 6. Fuera de alcance en v1

- Tiempo real (SSE/WebSocket/push); el cliente hace polling.
- Canal SMS/push móvil (bloqueado por riesgo #25, sin proveedor confirmado).
- Emails nuevos: los 4 actuales quedan; no se agregan plantillas nuevas (`N6`).
- Preferencias de notificación por usuario (silenciar tipos).
- Notificar a Bookkeepers / Insurance Company / Admin.
- Borrar notificaciones y purga automática.
- Disparadores de pagos, payoff y `BorrowerApplication` (las fases respectivas los enchufan con `notify()`).

## Decisiones a confirmar

Cada una con recomendación; si se aprueba el documento tal cual, se implementan las recomendadas.

| # | Pregunta | Recomendación | Alternativa |
|---|---|---|---|
| N1 | ¿Tabla `Notification` (fila por notificación) o solo derivar de datos existentes? | **Tabla** (`D-S2-12`): sin ella no hay "leída/no leída" por evento ni historial de rechazos/aceptaciones | Derivar todo con queries (sin tabla): imposible para eventos que no dejan fila propia (ej. "términos aceptados") |
| N2 | ¿A qué lenders se les notifica una solicitud de cotización? | **Solo a los `LoanRequestLenderTarget` activos** (los que el Borrower eligió). El marketplace `PUBLIC` se descubre navegando, no por notificación | Notificar a todos los lenders con `isOpenToDeals` en solicitudes `PUBLIC` (spam; requiere preferencias de usuario antes) |
| N3 | Alcance de tipos | **Los 8 de §3.1** (lo pedido + mensajes). Los opcionales, después si se piden | Incluir ya `QUOTE_WITHDRAWN/DECLINED`, `REVIEW_RECEIVED`, `VERIFICATION_*` (5 líneas más, sin costo de diseño) |
| N4 | Mensajes: ¿una notificación por mensaje? | **A) Coalescida por hilo**: si ya hay una `MESSAGE_RECEIVED` **sin leer** de ese hilo para ese usuario, se **actualiza** (`body` = último mensaje, `createdAt` = ahora) en vez de crear otra. `POST .../threads/:id/read` (Fase 17) también marca esa notificación como leída. Un solo lugar (`notify`) | **B)** No crear filas para mensajes; el badge suma `unreadMessages` desde `Message.readAt` (cero duplicación de estado, pero la campana no muestra los mensajes en el feed). **C)** Una fila por mensaje (ruidoso) |
| N5 | ¿Qué pasa si falla `notify()`? | **No falla la operación de negocio** (try/catch + `logger.error`) | Dentro de la misma transacción (más consistente, pero un bug de notificaciones rompe aceptar términos) |
| N6 | ¿Emails? | **Sin cambios**: los 4 existentes siguen; `notify()` solo crea la fila in-app. Las que no tienen email hoy (oferta recibida, términos aceptados/rechazados a Borrower…) quedan solo in-app | Agregar plantillas email para los eventos nuevos (`SendEmailInput.template` es una union cerrada: cada uno es una plantilla más) |
| N7 | ¿Borrar / archivar notificaciones? | **No en v1** (solo leer). Purga por job si la tabla crece | `DELETE /api/notifications/:id` (aditivo, sin migración) |
| N8 | ¿Textos en español o inglés? | **Inglés**, igual que los `subject` de los emails actuales y los mensajes de `AppError` (el front traduce por `type` si hace falta) | Español fijo en el back |
| N9 | Co-deudores: ¿`CONTRACT_TERMS_SUBMITTED` a todos? | **Sí, a cada `ContractBorrower` activo**, igual que hace el email hoy | Solo al deudor principal |
| N10 | ¿`GET /api/notifications/unread-count` aparte? | **Sí** (barato, es lo que el front consulta en polling) | Que el front use `GET /api/notifications?isRead=false&pageSize=1` y lea `total` (un endpoint menos) |

## 7. Plan de acción (pasos, en orden)

1. **Aprobación** de este documento + respuestas a `N1`–`N10`.
2. **Migración + modelo** — `Notification` + relación en `User` (`PB-035`).
3. **`src/lib/notify.ts`** — `notify({ userId, type, title, body, relatedEntity? })`
   (nunca lanza), `notifyLenderCompany(lenderCompanyId, …)` (resuelve el
   dueño vía `lenderProfile.userId`), y la coalescencia de `MESSAGE_RECEIVED`
   (según `N4`). Union `NotificationType` exportada.
4. **Servicio + validación + controller + rutas** de la tabla §5
   (`PB-036`): `notifications.service.ts`, `notifications.validation.ts`
   (`isRead` coercionado a boolean, `type` opcional), `notifications.controller.ts`,
   `src/app/api/notifications/{route,unread-count/route,read-all/route,[id]/read/route}.ts`.
5. **Disparadores** (`PB-037` cotizaciones, `PB-038` contratos, `PB-039` mensajes)
   — una llamada `notify(...)` por punto de §4, después del commit.
6. **Tests de integración** (Postgres real, patrón de
   `messages-routes.integration.test.ts` / `reviews-routes.integration.test.ts`):
   - Cada uno de los 8 eventos crea **exactamente una** notificación para el
     destinatario correcto y ninguna para el otro lado (salvo `CONTRACT_ACTIVATED`: una por lado).
   - Solicitud a 2 targets → 2 notificaciones (una por dueño); lender no target → 0.
   - Targets agregados en `DRAFT` → 0 al agregar, 1 por target al publicar.
   - Co-deudores: `TERMS_SUBMITTED` a cada activo, no a removidos; `CONTRACT_ACTIVATED` solo con el último aceptante.
   - Mensajes: 3 mensajes seguidos sin leer → 1 fila con `body` del último; tras `read` del hilo y otro mensaje → fila nueva.
   - `GET` pagina y filtra por `isRead`/`type`; solo devuelve las propias.
   - `POST /:id/read` de una ajena → `404`; idempotente; `read-all` no toca las de otros usuarios.
   - `unread-count` refleja `read`/`read-all`.
   - Fallo forzado de `notify` no revierte `acceptContractTerms` (`N5`).
   - Sin token → `401`.
7. **Docs**: cerrar esta fase; marcar `PB-022` como absorbido parcialmente
   en `13-backlog.md`/`fase-11`; `04-base-de-datos` (Notification →
   implementado), `06-api-endpoints` (§6.13), `API_REFERENCE.md`,
   `fases/README.md`, `IMPLEMENTATION_PROGRESS.md`, `00-contradicciones`
   (`D-S2-12` → implementado con los ajustes de §3).
8. **Verificación**: `pnpm run type-check`, `pnpm run lint`,
   `pnpm run test:integration` sin regresiones.

## Archivos afectados (estimado)

**Nuevos**
- `prisma/schema.prisma` (+ migración `..._pb035_notifications`)
- `src/lib/notify.ts`
- `src/services/notifications.service.ts`
- `src/validations/notifications.validation.ts`
- `src/controllers/notifications.controller.ts`
- `src/app/api/notifications/route.ts`
- `src/app/api/notifications/unread-count/route.ts`
- `src/app/api/notifications/read-all/route.ts`
- `src/app/api/notifications/[id]/read/route.ts`
- `src/app/api/notifications-routes.integration.test.ts`

**Modificados (una a pocas líneas cada uno)**
- `src/services/loanRequests.service.ts` (`publishLoanRequest`, `addLoanRequestTarget`)
- `src/services/loanQuotes.service.ts` (`submitQuote`, `selectQuote`)
- `src/services/contracts.service.ts` (`submitContractTerms`, `acceptContractTerms`, `rejectContractTerms`)
- `src/services/messaging.service.ts` (`sendFrom*`, y `markThreadRead*` si se aprueba `N4`-A)
- Docs listados en el paso 7

## Tickets

| ID | Título | Prioridad | Complejidad | Estado |
|---|---|---|---|---|
| PB-035 | Modelo `Notification` + migración + `notify()` en `src/lib/notify.ts` (absorbe la parte de tabla de `PB-022`) | P1 | M | ✅ |
| PB-036 | `GET /api/notifications`, `GET .../unread-count`, `POST .../:id/read`, `POST .../read-all` | P1 | M | ✅ |
| PB-037 | Disparadores de cotizaciones (solicitud recibida, oferta recibida, oferta seleccionada) | P1 | S | ✅ |
| PB-038 | Disparadores de contrato (términos enviados / aceptados / rechazados, contrato activo) | P1 | M | ✅ |
| PB-039 | Disparador de mensajes (coalescido por hilo) | P2 | S | ✅ |

---

[← Índice de fases](README.md)  ·  [Backlog](../13-backlog.md)  ·  [Anterior: Fase 18 — Ratings](fase-18-ratings-lender-borrower.md)
