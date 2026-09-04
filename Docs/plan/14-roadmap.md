[← Índice del plan](README.md)  ·  [Anterior: 13. Backlog detallado](13-backlog.md)  ·  [Siguiente: 15. Riesgos y decisiones pendientes](15-riesgos-y-decisiones-pendientes.md)

---

# 14. Roadmap recomendado

El orden sugerido por el encargo (Foundation → Database → Authentication → Authorization → Users → Lenders → Borrowers → Contracts → Payments → Testing → Docker/Deployment) se mantiene, con dos ajustes justificados:

1. **Testing no va al final** — cada fase funcional (Authentication, Contracts, Payments) incluye sus propios tests como parte de "hecho" (ítems BE-074 a BE-079 se ejecutan intercalados, no después de BE-084). Se numeran agrupados por tema en la sección [13](13-backlog.md) solo para que el backlog sea legible, no para implicar que se implementan al final.
2. **Payments queda parcialmente bloqueado** por A-3 (Stripe Connect sin confirmar) — se recomienda avanzar **BE-067 (registro manual)** y todo el modelo de datos/waterfall (**BE-068**) sin esperar esa decisión, y dejar **BE-065/066/070** (todo lo que toca Stripe directamente) como el único bloque realmente detenido.

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
Contracts (BE-051..064)
   │
Payments — modelo + manual (BE-067, BE-068, BE-069, BE-071, BE-072)
   │                                   ╲
   │                                    ╲── Payments — Stripe (BE-065, BE-066, BE-070)
   │                                        BLOQUEADO por decisión A-3
Testing transversal (BE-074..079, intercalado en cada fase anterior)
   │
Docker/Deployment (BE-080..084)
   │
(Opcional) Documentos (BE-085)
```

---

[← Índice del plan](README.md)  ·  [Anterior: 13. Backlog detallado](13-backlog.md)  ·  [Siguiente: 15. Riesgos y decisiones pendientes](15-riesgos-y-decisiones-pendientes.md)
