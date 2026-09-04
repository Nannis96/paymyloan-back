# Documentación — PayMyLoan Backend

Todo el material de planificación y diseño del backend. Nada de esto es
código: el README del proyecto ([`../README.md`](../README.md)) documenta lo
que ya existe y corre; esto documenta lo que se decidió construir y por qué.

## Documentos

| Documento | Qué es | Cuándo consultarlo |
|---|---|---|
| [plan/](plan/) | **Plan de implementación del backend**, dividido en 17 secciones (16 originales + [16. Fase 1 actualizada](plan/16-fase-1-actualizada.md)) + 11 fases de backlog | Es el documento de referencia: arquitectura, schema, endpoints, auth, backlog y roadmap. [plan/04-base-de-datos.md](plan/04-base-de-datos.md) es la **única fuente de verdad del modelo de datos** |
| [IMPLEMENTATION_PROGRESS.md](IMPLEMENTATION_PROGRESS.md) | Checklist de avance real contra el plan | Para saber qué está hecho, qué falta y qué decisiones siguen abiertas |
| [PAYMYLOAN_DATABASE_DESIGN.md](PAYMYLOAN_DATABASE_DESIGN.md) | Diseño de datos previo, con el análisis profundo de `Owner` | Fuente de la lógica financiera (amortización, waterfall, ACH, idempotencia). Su capa de identidad quedó **superada** por el plan — ver [decisión D0-1](plan/00-contradicciones-y-decisiones.md) |
| [PML — PayMyLoan.ai Product Board.pdf](PML%20—%20PayMyLoan.ai%20Product%20Board.pdf) | Product Board del 3 sep 2026 | Origen de los deltas `M-*`/`C-*`, de los tickets `PB-*`, y — desde el 2026-09-04 — de los roles `BOOKKEEPER`/`INSURANCE_COMPANY` y la entidad `Property` formalizados en [plan/00 §Decisiones 2026-09-04](plan/00-contradicciones-y-decisiones.md#decisiones-2026-09-04-ronda-fase-1) |

## Orden de lectura sugerido

1. [plan/README.md](plan/README.md) — índice y mapa del plan.
2. [plan/00-contradicciones-y-decisiones.md](plan/00-contradicciones-y-decisiones.md) — las decisiones que condicionan todo lo demás.
3. [IMPLEMENTATION_PROGRESS.md](IMPLEMENTATION_PROGRESS.md) — dónde está parado el proyecto hoy.
4. La sección del plan que corresponda al trabajo que toca.

## Cómo se relacionan entre sí

```
PAYMYLOAN_DATABASE_DESIGN.md      Product Board (PDF)
        │                                 │
        │ lógica financiera                │ deltas M-* y tickets PB-*
        ▼                                 ▼
              plan/  (plan aprobado)
                       │
                       ▼
           IMPLEMENTATION_PROGRESS.md  (estado de avance)
```
