[← Índice de fases](README.md)  ·  [Backlog](../13-backlog.md)  ·  [Anterior: Fase 10 — Opcional](fase-10-opcional.md)  ·  [Siguiente: Fase 12 — Payoff](fase-12-payoff.md)

---

# Fase 11 — Documentos, Commitment Letter y Notificaciones

> **Formalizada 2026-09-10**: antes solo existía como una fila suelta en [IMPLEMENTATION_PROGRESS.md](../../IMPLEMENTATION_PROGRESS.md) (`PB-001`..`PB-004`, sin detalle de ticket). Esta ronda la trae a `Docs/plan/` y la amplía con los requisitos de [pml_commitment_letter_spec 1.1.pdf](../../pml_commitment_letter_spec%201.1.pdf) — ver [00 §D-S2-8/9/12](../00-contradicciones-y-decisiones.md#decisiones-2026-09-10-ronda-product-spec-v2--commitment-letter-spec) y el modelo de datos en [04 §4.7](../04-base-de-datos.md#47-modelo-extendido--marketplace-fees-vetting-notificaciones-ratings-revisión-2026-09-10). **Sube de prioridad** respecto al backlog original (era P3/`BE-085`, "opcional") porque la Commitment Letter es, según el propio documento fuente, el documento vinculante central del cierre — no una función accesoria.
>
> **Depende de** Fase 6 (Contracts + `ContractFeeItem`, `PB-020`) y, para `PB-021`, de la decisión `A-3` (Stripe Connect) igual que el resto de lo que toca cobro recurrente.

## PB-001 — Motor de PDF
- **Objetivo**: generar PDFs server-side (Commitment Letter, Payoff Letter, Pitch Deck — `PB-012`) a partir de datos estructurados, no HTML capturado a mano.
- **Prioridad/Complejidad/Dependencias**: P1 / M / ninguna
- **Archivos afectados**: `src/lib/pdf.ts` (nuevo).
- **Implementación**: `Owner` genera PDF 100% client-side con `@react-pdf/renderer`, sin persistencia — no reutilizable tal cual para un backend headless. Dos opciones evaluadas, sin decidir todavía: (a) `@react-pdf/renderer` en modo server (renderiza a buffer, sin navegador) — más liviano, limitado en layout complejo; (b) Chromium headless en la imagen Docker (`puppeteer`/`playwright`) renderizando un template HTML — más pesado de imagen, más flexible para layouts tipo tabla (la Closing Fee Summary Table). **Decisión pendiente** — ver riesgo correspondiente en [15](../15-riesgos-y-decisiones-pendientes.md).
- **Tests**: un PDF generado a partir de datos de prueba contiene el texto esperado (extracción de texto, no comparación visual).
- **Criterios de aceptación**: `generatePdf(template, data)` devuelve un `Buffer` sin depender de ningún proceso externo no empaquetado en la imagen.

## PB-002 — Tabla `Document` + storage S3 privado + URLs firmadas
- **Objetivo**: persistir cualquier documento (Commitment Letter, Payoff Letter, fotos de `LoanRequest`, documentos de `BorrowerApplication`, disclosures) con acceso de lectura siempre vía URL firmada de corta vida — nunca una URL pública persistida (corrige el defecto ya documentado de `Owner`, sección [5.10 de PAYMYLOAN_DATABASE_DESIGN.md](../../PAYMYLOAN_DATABASE_DESIGN.md)).
- **Prioridad/Complejidad/Dependencias**: P0 / L / BE-011 (`Contract`), `D-S2-8` (`Document.contractId` opcional + `loanRequestId`/`applicationId`)
- **Archivos afectados**: `prisma/schema.prisma` (tabla `Document` — ya diseñada en el plan original, `BE-022`/`BE-085`, ahora ampliada por `D-S2-8`), `src/lib/s3.ts` (nuevo — `getUploadUrl`/`getDownloadUrl` con `PutObjectCommand`/`GetObjectCommand` presignados, 60–300s), `src/services/documents.service.ts`.
- **Implementación**: `getDocumentDownloadUrl()` verifica acceso (vía `Contract`/`LoanRequest`/`BorrowerApplication` según cuál de los tres FKs tenga la fila, `D-S2-8`) antes de firmar. Borrar un `Document` en BD también borra el objeto en S3 (a diferencia de `Owner`, que deja huérfanos).
- **Validaciones**: `mimeType` restringido a PDF/imagen; `fileSizeBytes` con tope configurable.
- **Tests**: una URL firmada expira; un usuario sin acceso al `Contract`/`LoanRequest`/`BorrowerApplication` correspondiente no puede pedir una URL de descarga (404, mismo criterio anti-enumeración de [7.5](../07-autenticacion-y-autorizacion.md#75-rbac--aislamiento-multi-tenant--cómo-se-evita-que-un-prestamista-acceda-a-datos-de-otro)).
- **Criterios de aceptación**: subir → listar → descargar vía URL firmada → borrar, ciclo completo por `curl`.

## PB-003 — Commitment Letter — generación + distribución automática
- **Objetivo**: implementar `D-S2-9` — la Commitment Letter es el PDF de una `ContractTerms` ya `ACCEPTED` (D0-3) más su `ContractFeeItem[]` (`PB-020`), auto-distribuido a la parte de cierre y a la aseguradora.
- **Prioridad/Complejidad/Dependencias**: P0 / L / PB-001, PB-002, PB-020, BE-059 (`generateAmortizationSchedule`, el punto donde el contrato pasa a `ACTIVE`)
- **Archivos afectados**: `src/services/commitmentLetter.service.ts` (nuevo), `src/services/contracts.service.ts` (hook en el mismo punto que `BE-059`), `src/app/api/contracts/[id]/commitment-letter/route.ts` (§6.15).
- **Implementación**: en la misma operación que `generateAmortizationSchedule` (último `ContractTermsAcceptance` que completa el quórum): (1) genera el PDF con `PB-001` a partir de `Contract`+`ContractTerms`+`ContractFeeItem[]` (contenido exacto — sección "Commitment Letter — Contents" del documento fuente: nombres/contacto de ambas partes, dirección, monto/tasa/plazo/tipo, calendario IO o amortizado, fecha de inicio de ACH, fecha de cierre, Closing Fee Summary Table, disclosure de fees mensuales, términos de mora/pre-pay, `LenderCompany.wireBankAccountLast4`/`wireVerificationPhone` (`D-S2-18`), bloques de firma); (2) persiste como `Document(type=COMMITMENT_LETTER, contractId)`; (3) envía por correo (`PB-004`) a `Contract.closingAttorneyEmail` y, si `Contract.insuranceCompanyId` está asignado, a `InsuranceCompanyProfile` correspondiente; (4) marca `sentToTitleCompanyAt`/`sentToInsuranceCompanyAt` en la fila de `Document`.
- **Validaciones**: no se genera si `Contract.closingAttorneyEmail` es nulo (se permite crear el contrato sin ese dato, pero no cerrar sin él) — responde error de negocio claro, no falla en silencio.
- **Tests**: activar un contrato con `closingAttorneyEmail`+`insuranceCompanyId` asignados genera un único `Document(type=COMMITMENT_LETTER)` con ambos timestamps de envío seteados; sin `insuranceCompanyId`, solo se envía a la parte de cierre.
- **Criterios de aceptación**: camino dorado completo (crear contrato → términos → fees → aceptación de todos los deudores) termina con una Commitment Letter descargable vía `GET /api/contracts/:id/commitment-letter`.
- **Decisión pendiente**: si el negocio exige firma electrónica certificada (DocuSign/similar) además de la aceptación in-app (D0-3) — ver riesgo #24/#28 en [15](../15-riesgos-y-decisiones-pendientes.md). Este ticket asume que **no** hace falta, consistente con cómo D0-3 ya trata la aceptación en plataforma como el acto de firma.

## PB-004 — Envío de documentos por correo a las partes
- **Objetivo**: mecanismo genérico de envío de un `Document` por correo, reusado por `PB-003` (Commitment Letter), Fase 12 (Payoff Letter) y `PB-025` (extra disclosures).
- **Prioridad/Complejidad/Dependencias**: P1 / S / PB-002, BE-006 (cliente de correo, ya existente)
- **Archivos afectados**: `src/lib/email.ts` (plantillas nuevas: `commitment-letter`, `payoff-letter`, `extra-disclosure`), `src/services/documents.service.ts` (`sendDocumentByEmail(documentId, recipientEmail)`).
- **Implementación**: adjunta el PDF (o incluye un link firmado de corta vida, a decidir según tamaño típico de archivo — no bloqueante) usando el mismo modo dev de `sendEmail()` ya implementado (loguea si `EMAIL_API_KEY` está vacío, `D-P2-1`/Fase 2).
- **Tests**: en modo dev, el correo logueado contiene el nombre del documento y el destinatario correcto.

## PB-021 — ACH draft mode tras la Commitment Letter
- **Objetivo**: implementar "Monthly payment ACH is placed in draft mode with the official start date per the promissory note. Goes live automatically on start date" del Commitment Letter Spec.
- **Prioridad/Complejidad/Dependencias**: P2 / M / PB-003, `Autopay` (`BE-096`, ya modelada sin activar — `A-2`), bloqueado por `A-3` (Stripe Connect) igual que el resto de cobro recurrente
- **Implementación**: al generarse la Commitment Letter (`PB-003`), si el Deudor ya tiene un `PaymentMethod` verificado, se crea una fila `Autopay(status=PAUSED, nextAttemptScheduledFor=ContractTerms.firstPaymentDate)` — "draft mode" se modela como `PAUSED` hasta la fecha de inicio, un job (`src/jobs/activateScheduledAutopay.ts`, nuevo) la pasa a `ACTIVE` en la fecha exacta. **No se implementa el cobro real** hasta que `A-3` se resuelva — este ticket solo prepara el estado, consistente con cómo `Autopay` ya se modeló sin activar en Fase 1.
- **Decisión pendiente**: este ticket es la primera vez que el negocio pide explícitamente cobro recurrente automático (antes `A-2` decía que el alcance no lo confirmaba) — revisar si `A-2` debe darse por resuelta a favor de "sí, autopay es necesario" ahora que el Commitment Letter Spec lo describe como comportamiento esperado por defecto, no opcional. Ver [15](../15-riesgos-y-decisiones-pendientes.md), riesgo #4.

## PB-022 — `Notification` (in-app) + disparadores
- **Objetivo**: implementar `D-S2-12` — lista de notificaciones que ambos dashboards (`PB-024`) necesitan mostrar.
- **Prioridad/Complejidad/Dependencias**: P1 / M / ninguna (tabla independiente)
- **Archivos afectados**: `prisma/schema.prisma` (tabla `Notification`), `src/lib/notify.ts` (nuevo — `notify(userId, type, title, body, relatedEntity?)`, crea la fila y opcionalmente dispara `sendEmail`), `src/app/api/notifications/route.ts`, `src/app/api/notifications/[id]/read/route.ts`, `src/app/api/notifications/read-all/route.ts` (§6.13).
- **Implementación**: disparadores mínimos para esta fase — `applyTransaction` (`BE-068`, pago recibido/hecho), `ContractTermsAcceptance` creada (términos aceptados/rechazados), `PayoffRequest` creada (Fase 12), `BorrowerApplication` revisada (`PB-018`). Cada disparador es una llamada a `notify()` en el mismo service, no un listener separado — evita infraestructura de eventos que el resto del backend no usa.
- **Tests**: un pago exitoso crea exactamente una `Notification` para el Deudor y una para el Prestamista, ambas con `relatedEntityType=Transaction`.
- **Criterios de aceptación**: `GET /api/notifications` filtra por `isRead` y pagina.

## PB-025 — Extra disclosures (documentos del Lender para firma del Borrower)
- **Objetivo**: "Extra disclosures — lenders can upload documents for borrower to sign" (Product Spec v2, Other Features).
- **Prioridad/Complejidad/Dependencias**: P2 / M / PB-002
- **Implementación**: `Document(type=EXTRA_DISCLOSURE, contractId)`, subido por el Prestamista. La "firma" del Deudor se modela igual que D0-3 (una fila de aceptación) — reutiliza el mismo patrón de `ContractTermsAcceptance` en una tabla ligera nueva `DocumentAcknowledgement(documentId, borrowerProfileId, acknowledgedAt, ipAddress?)` en vez de sobrecargar `ContractTermsAcceptance` (que es específica de `ContractTerms`, no de cualquier documento).
- **Tests**: un disclosure sin reconocer bloquea... **no bloquea nada por defecto** — el documento fuente no dice que sea bloqueante como la aceptación de términos; se deja como simple registro de que el Deudor lo vio/firmó, salvo que el negocio confirme lo contrario.

---

[← Índice de fases](README.md)  ·  [Backlog](../13-backlog.md)  ·  [Anterior: Fase 10 — Opcional](fase-10-opcional.md)  ·  [Siguiente: Fase 12 — Payoff](fase-12-payoff.md)
