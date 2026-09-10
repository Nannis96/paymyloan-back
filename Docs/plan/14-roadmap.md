[← Índice del plan](README.md)  ·  [Anterior: 13. Backlog detallado](13-backlog.md)  ·  [Siguiente: 15. Riesgos y decisiones pendientes](15-riesgos-y-decisiones-pendientes.md)

---

# 14. Roadmap recomendado

El orden sugerido por el encargo (Foundation → Database → Authentication → Authorization → Users → Lenders → Borrowers → Contracts → Payments → Testing → Docker/Deployment) se mantiene, con los ajustes ya justificados más uno nuevo de la ronda 2026-09-10:

1. **Testing no va al final** — cada fase funcional (Authentication, Contracts, Payments) incluye sus propios tests como parte de "hecho" (ítems BE-074 a BE-079 se ejecutan intercalados, no después de BE-084). Se numeran agrupados por tema en la sección [13](13-backlog.md) solo para que el backlog sea legible, no para implicar que se implementan al final.
2. **Payments queda parcialmente bloqueado** por A-3 (Stripe Connect sin confirmar) — se recomienda avanzar **BE-067 (registro manual)** y todo el modelo de datos/waterfall (**BE-068**) sin esperar esa decisión, y dejar **BE-065/066/070** (todo lo que toca Stripe directamente) como el único bloque realmente detenido.
3. **Marketplace/Loan Requests (Fase 13) no bloquea Contracts (Fase 6)** — `D-S2-1` diseñó `LoanRequest` explícitamente como una etapa *anterior y opcional* a `Contract`, no como un reemplazo. Fase 6 puede implementarse primero (cubre el flujo directo Lender→Contract, ya usado por deals privados acordados fuera de la plataforma); Fase 13 se apoya en el mismo `POST /api/contracts` (`BE-051`) una vez que hay un match, así que **debe** ir después de Fase 6, no antes. Los fees de contrato (`ContractFeeItem`, `PB-020`) sí entran en Fase 6, porque cualquier contrato (marketplace o directo) necesita su Closing Fee Summary Table.
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
Contracts + fees de cierre (BE-051..064, PB-020)
   │                                   ╲
   │                                    ╲── Marketplace / Loan Requests / Vetting (Fase 13: PB-011, PB-012, PB-016..019)
   │                                        no bloquea nada de abajo — capa de origination opcional
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
