[← Índice del plan](README.md)  ·  [Anterior: 0. Contradicciones y decisiones de partida](00-contradicciones-y-decisiones.md)  ·  [Siguiente: 2. Diferencias PayMyLoan vs Owner](02-diferencias-owner.md)

---

# 1. Resumen de arquitectura propuesta

PayMyLoan Backend es una **API headless** (Next.js 16 App Router, solo `route.ts`, sin páginas) que sirve como fuente de verdad para tres tipos de cliente autenticado — Admin, Prestamista, Deudor — y para el propio frontend `paymyloan` como único consumidor HTTP.

```
                 ┌────────────────────────┐
   paymyloan     │   paymyloan-back (API)  │        PostgreSQL 18
   (Next.js UI)  │  Next.js 16 route.ts    │◄──────►(Prisma 6.19,
   :3000    ────►│  :4000                  │         UUIDv7 nativo)
                 │  route → controller     │
                 │       → service         │              │
                 │       → Prisma          │              ▼
                 └────────────────────────┘        Stripe (ACH/Connect,
                          │                          pendiente de Fase 7)
                          ▼
                    S3 (documentos,
                    fase 2/opcional)
```

**Principio rector**: el rol de un usuario (`ADMIN`/`LENDER`/`BORROWER`) es fijo y vive en `User.role` — a diferencia de [PAYMYLOAN_DATABASE_DESIGN.md](../PAYMYLOAN_DATABASE_DESIGN.md), donde el rol nunca podía vivir en `User` porque ahí era relativo a cada préstamo. Aquí **no** hay esa simetría: un Prestamista siempre es Prestamista, un Deudor siempre pertenece a un único Prestamista. El aislamiento entre prestamistas (multi-tenancy) no se resuelve con una tabla de membresía como `LoanParty`, sino con una **clave de tenant (`lenderId`) presente en cada tabla de negocio** (`BorrowerProfile`, `Contract`) y aplicada en cada query — ver sección [4.1](04-base-de-datos.md#41-convenciones) y sección [7.5](07-autenticacion-y-autorizacion.md#75-rbac--aislamiento-multi-tenant--cómo-se-evita-que-un-prestamista-acceda-a-datos-de-otro).

## 1.1 Multi-tenancy en una frase

Todo recurso de negocio (Deudor, Contrato, Pago, Documento) cuelga — directa o transitivamente — de un `lenderId`. Ninguna consulta de un usuario con rol `LENDER` se ejecuta sin `WHERE lenderId = session.lenderId`, sin excepción, sin importar qué IDs vengan en la URL o el body. El detalle mecánico está en la sección [7.5](07-autenticacion-y-autorizacion.md#75-rbac--aislamiento-multi-tenant--cómo-se-evita-que-un-prestamista-acceda-a-datos-de-otro).

---

[← Índice del plan](README.md)  ·  [Anterior: 0. Contradicciones y decisiones de partida](00-contradicciones-y-decisiones.md)  ·  [Siguiente: 2. Diferencias PayMyLoan vs Owner](02-diferencias-owner.md)
