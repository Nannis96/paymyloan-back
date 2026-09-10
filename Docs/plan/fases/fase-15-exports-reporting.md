[← Índice de fases](README.md)  ·  [Backlog](../13-backlog.md)  ·  [Anterior: Fase 14 — Dashboards y Ratings](fase-14-dashboards-ratings.md)

---

# Fase 15 — Exports contables

> **Formalizada y ampliada 2026-09-10**: `IMPLEMENTATION_PROGRESS.md` solo tenía `PB-015` ("Export CSV de transacciones por contrato + reporte año fiscal por prestamista"), sin correo automático. [pml_product_spec_v2.pdf](../../pml_product_spec_v2.pdf) agrega un requisito concreto: "Year-end reporting — auto emails with interest paid/received for CPA and bookkeepers". Ver [00](../00-contradicciones-y-decisiones.md#decisiones-2026-09-10-ronda-product-spec-v2--commitment-letter-spec).
>
> **Depende de** `BookkeeperProfile`/`LenderCompanyBookkeeper` (ya implementadas, Fase 1) y de Fase 7 (`Transaction`, base de cualquier reporte de interés).

## PB-015 — Export CSV + reporte fiscal + envío automático a CPA/Bookkeepers
- **Objetivo**: exports bajo demanda (ya planeados) más el envío automático anual que agrega el Product Spec v2.
- **Prioridad/Complejidad/Dependencias**: P2 / M / BE-017 (`TransactionAllocation`, desglose interés/capital), PB-004 (envío de documentos, Fase 11)
- **Archivos afectados**: `src/services/reports.service.ts` (nuevo), `src/app/api/contracts/[id]/transactions/export/route.ts` (CSV bajo demanda), `src/jobs/sendYearEndReports.ts` (nuevo).
- **Implementación**:
  - **Export CSV bajo demanda** (ya planeado): `GET .../transactions/export` — CSV de `TransactionAllocation` por contrato, con `allocationType` desglosado (mismo criterio ya usado por el propio `04 §5.8` de [PAYMYLOAN_DATABASE_DESIGN.md](../../PAYMYLOAN_DATABASE_DESIGN.md): el interés cobrado solo es correcto si está desglosado por fila).
  - **Reporte año fiscal** (ya planeado): agregado anual de interés pagado (Deudor)/recibido (Prestamista) por `LenderCompany`.
  - **Envío automático** (nuevo, del Product Spec v2): job anual (`sendYearEndReports.ts`) que, para cada `LenderCompany`, resuelve sus `BookkeeperProfile` vinculados (`LenderCompanyBookkeeper`, ya implementada) y les envía el reporte fiscal por correo (`PB-004`) — no requiere una tabla de suscripción nueva (a diferencia de `ReportRecipient` del diseño superado en [PAYMYLOAN_DATABASE_DESIGN.md](../../PAYMYLOAN_DATABASE_DESIGN.md)): la relación N:M ya existente entre Prestamista y Bookkeeper es suficiente para saber a quién enviarle qué, sin modelar una suscripción aparte.
- **Validaciones**: el CSV nunca incluye información bancaria completa — solo montos y fechas, mismo criterio transversal ya establecido.
- **Tests**: la suma de `interestDue` en el reporte anual coincide con `SUM(TransactionAllocation.amount) WHERE allocationType=INTEREST` del período.
- **Decisión pendiente**: formato exacto del reporte fiscal (¿1099-INT-like, o un resumen libre?) — no especificado por ningún documento fuente, fuera de alcance de este plan definirlo sin confirmación legal/contable.

---

[← Índice de fases](README.md)  ·  [Backlog](../13-backlog.md)  ·  [Anterior: Fase 14 — Dashboards y Ratings](fase-14-dashboards-ratings.md)
