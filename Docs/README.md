# Documentación — PayMyLoan Backend

Todo el material de planificación y diseño del backend. Nada de esto es
código: el README del proyecto ([`../README.md`](../README.md)) documenta lo
que ya existe y corre; esto documenta lo que se decidió construir y por qué.

## Documentos

| Documento | Qué es | Cuándo consultarlo |
|---|---|---|
| [plan/](plan/) | **Plan de implementación del backend**, dividido en 16 secciones + 11 fases de backlog | Es el documento de referencia: arquitectura, schema, endpoints, auth, backlog y roadmap |
| [IMPLEMENTATION_PROGRESS.md](IMPLEMENTATION_PROGRESS.md) | Checklist de avance real contra el plan | Para saber qué está hecho, qué falta y qué decisiones siguen abiertas |
| [PAYMYLOAN_DATABASE_DESIGN.md](PAYMYLOAN_DATABASE_DESIGN.md) | Diseño de datos previo, con el análisis profundo de `Owner` | Fuente de la lógica financiera (amortización, waterfall, ACH, idempotencia). Su capa de identidad quedó **superada** por el plan — ver [decisión D0-1](plan/00-contradicciones-y-decisiones.md) |
| [PML — PayMyLoan.ai Product Board.pdf](PML%20—%20PayMyLoan.ai%20Product%20Board.pdf) | Product Board del 3 sep 2026 | Origen de los deltas `M-*` y de los tickets `PB-*` que aparecen en el progreso pero no en el plan original |

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
