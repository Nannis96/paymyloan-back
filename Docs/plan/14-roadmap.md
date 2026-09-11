[← Índice del plan](README.md)  ·  [Anterior: 13. Backlog detallado](13-backlog.md)  ·  [Siguiente: 15. Riesgos y decisiones pendientes](15-riesgos-y-decisiones-pendientes.md)

---

# 14. Roadmap recomendado

El orden sugerido por el encargo (Foundation → Database → Authentication → Authorization → Users → Lenders → Borrowers → Contracts → Payments → Testing → Docker/Deployment) se mantiene, con los ajustes ya justificados más uno nuevo de la ronda 2026-09-10:

1. **Testing no va al final** — cada fase funcional (Authentication, Contracts, Payments) incluye sus propios tests como parte de "hecho" (ítems BE-074 a BE-079 se ejecutan intercalados, no después de BE-084). Se numeran agrupados por tema en la sección [13](13-backlog.md) solo para que el backlog sea legible, no para implicar que se implementan al final.
2. **Payments queda parcialmente bloqueado** por A-3 (Stripe Connect sin confirmar) — se recomienda avanzar **BE-067 (registro manual)** y todo el modelo de datos/waterfall (**BE-068**) sin esperar esa decisión, y dejar **BE-065/066/070** (todo lo que toca Stripe directamente) como el único bloque realmente detenido.
3. **Marketplace/Loan Requests (Fase 13) va después de Contracts (Fase 6), y en un sentido concreto: la bloquea, no al revés** — `D-S2-1` diseñó `LoanRequest` como una etapa *anterior y opcional* al `Contract` desde el punto de vista de negocio, pero de datos es al revés: Fase 13 se apoya en el mismo `POST /api/contracts` (`BE-051`) y en `ContractFeeItem` (`PB-020`), ambos de Fase 6 — y además agrega `Contract.originationSource`/`loanRequestId` sobre la tabla que Fase 6 ya dejó lista, vía su propia migración (`D-S2-19`, corregido 2026-09-10 — antes este documento decía lo contrario). Fase 6 sí es completamente autónoma de Fase 13: se implementa y se da por cerrada sin que `LoanRequest` exista, cubriendo el flujo directo Lender→Contract ya usado por deals privados acordados fuera de la plataforma.
>
> **Estado 2026-09-11**: Fase 6 (`BE-051..064`, `PB-020`) — ✅ completa. Fase 13 — 🟡 parcial: el núcleo de cotizaciones (`PB-011` extendido, `PB-026` nuevo, `PB-017` reescrito — ver [00 §Decisiones 2026-09-11](00-contradicciones-y-decisiones.md#decisiones-2026-09-11-ronda-fase-13--cotizaciones-de-marketplace-antes-de-implementar)) está implementado; `PB-012`/`PB-016`/`PB-018`/`PB-019` y `LoanRequestInvite` (`D-S2-14`) siguen sin empezar. Detalle en [IMPLEMENTATION_PROGRESS.md](../IMPLEMENTATION_PROGRESS.md).
4. **Documentos (Fase 11) sube de prioridad** — antes P3/opcional (`BE-085`), ahora incluye la Commitment Letter (`D-S2-9`), que el Commitment Letter Spec trata como el documento central y vinculante del flujo de cierre. Sigue yendo después de Contracts (necesita `ContractTerms`/`ContractFeeItem` ya aceptados para generarse), pero antes de considerarse "opcional".

```
Foundation (BE-001..007)
   │
Database (BE-008..023)
   │
Authentication (BE-024..034) ─┐
   │                          │  (en paralelo: BE-073 setup de test env)
Authorization (BE-035..039) ──┘
   │
Users/Admin/Lenders (BE-040..044)
   │
Borrowers (BE-045..050)
   │
Contracts + fees de cierre (BE-051..064, PB-020) — autónoma, no requiere Fase 13
   │                                   ╲
   │                                    ╲── Marketplace / Loan Requests / Vetting (Fase 13: PB-011, PB-012, PB-016..019, PB-026)
   │                                        SÍ depende de Fase 6 (Contract, ContractFeeItem) — agrega
   │                                        originationSource/loanRequestId a Contract vía su propia
   │                                        migración (D-S2-19). No bloquea Payments (rama de abajo).
   │
Payments — modelo + manual (BE-067, BE-068, BE-069, BE-071, BE-072)
   │                                   ╲
   │                                    ╲── Payments — Stripe (BE-065, BE-066, BE-070)
   │                                        BLOQUEADO por decisión A-3
   │
Documentos, Commitment Letter y Notificaciones (Fase 11: PB-001..004, PB-021, PB-022, PB-025)
   │
Payoff (Fase 12: PB-005..008)
   │
Dashboards y Ratings (Fase 14: PB-009, PB-010, PB-023, PB-024)
   │
Testing transversal (BE-074..079, intercalado en cada fase anterior)
   │
Docker/Deployment (BE-080..084)
   │
Exports contables (Fase 15: PB-015)
```

---

[← Índice del plan](README.md)  ·  [Anterior: 13. Backlog detallado](13-backlog.md)  ·  [Siguiente: 15. Riesgos y decisiones pendientes](15-riesgos-y-decisiones-pendientes.md)
