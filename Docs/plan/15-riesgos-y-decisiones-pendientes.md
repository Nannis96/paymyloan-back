[← Índice del plan](README.md)  ·  [Anterior: 14. Roadmap recomendado](14-roadmap.md)

---

# 15. Riesgos y decisiones pendientes

Recapitulación de todo lo que puede cambiar el diseño y que este plan **no** resolvió unilateralmente:

| # | Pendiente | Impacto si no se resuelve | Bloquea |
|---|---|---|---|
| 1 | **Stripe Connect vs cuenta única** (alcance Q1, A-3) | Sin esto, `PaymentMethod.stripeConnectedAccountId`/`LenderProfile.stripeConnectedAccountId` no tienen un flujo real de onboarding que implementar | BE-065, BE-066, BE-070 |
| 2 | **Quién absorbe la comisión de Stripe** (alcance Q2) | No afecta el schema (`Transaction.amount` es el mismo), pero sí si hace falta desglosar `platformFeeAmount`/`stripeFeeAmount` en `Transaction` | Ajuste menor a BE-016 si se confirma que sí |
| 3 | **Modelo de cobro de la propia plataforma** (alcance Q5) | No se modela ninguna tabla de facturación — se agregaría en una revisión posterior | Ninguna tarea de este backlog, pero sí trabajo futuro |
| 4 | **Autopay** (alcance Q8, A-2) | Sin `Autopay`, el deudor debe pagar manualmente cada mes — aceptable si el MVP no lo requiere, pero confirmar explícitamente | Agregaría un módulo nuevo al backlog si se confirma |
| 5 | **Proveedor de correo transaccional** (Resend/SES/Postmark) | BE-006 necesita un proveedor concreto elegido antes de implementarse; se usó Resend como placeholder en `.env.example` | BE-006 y todo lo que dependa de correo (invitaciones, reset de contraseña) |
| 6 | **Networking de producción** (nginx compartido vs subdominio propio para la API) | No bloquea desarrollo, sí bloquea el despliegue real | BE-084 |
| 7 | **Préstamos "blanket" (una propiedad → varios contratos, o viceversa)** | La dirección embebida en `Contract` (A-4) no soporta esto sin migración real si se confirma que hace falta | Ninguna tarea actual, riesgo aceptado explícitamente |
| 8 | **Módulo de Documentos** | No forma parte del roadmap mínimo — confirmar si es necesario para el lanzamiento o puede esperar a una fase posterior | BE-022, BE-085 |
| 9 | **Compatibilidad de Prisma 6.19 con Postgres 18** | No verificado en este plan (es investigación, no diseño) — debe confirmarse como primer paso de BE-001 antes de asumir que la migración es trivial | BE-001, y transitivamente todo lo demás |
| 10 | **Escrow de impuestos/seguro** (alcance, mencionado por Owner) | No mencionado por el encargo de este plan ni modelado — se asume fuera de alcance | — |

---

[← Índice del plan](README.md)  ·  [Anterior: 14. Roadmap recomendado](14-roadmap.md)
