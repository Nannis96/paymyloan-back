[← Índice del plan](README.md)  ·  [Anterior: 1. Resumen de arquitectura propuesta](01-resumen-arquitectura.md)  ·  [Siguiente: 3. Arquitectura del backend](03-arquitectura-backend.md)

---

# 2. Diferencias PayMyLoan vs Owner (condensado)

Ver el inventario completo y la tabla REUSE/ADAPT/NEW/REMOVE en [PAYMYLOAN_DATABASE_DESIGN.md](../PAYMYLOAN_DATABASE_DESIGN.md) sección 16 — sigue siendo válida para todo lo que no depende del modelo de identidad. Resumen aplicado a este plan:

| Pieza de Owner | Se necesita en PayMyLoan | Acción |
|---|---|---|
| Stack Next.js/Prisma/Postgres/Docker | Sí | REUSE |
| bcrypt + TOTP (`@otplib`) para 2FA | Sí | REUSE (patrón), NextAuth en sí **no** se reutiliza — ver A-1 |
| `User.role` como enum simple | Sí, en un sentido distinto | ADAPT — en Owner es `ADMIN/STAFF/USER` y coexiste con perfiles opcionales ambiguos; aquí es `ADMIN/LENDER/BORROWER`, exhaustivo y exclusivo, sin perfiles adicionales sueltos |
| `SellerProfile`/`BuyerProfile`/etc. (perfiles 1:1) | Sí, como patrón | ADAPT — se reutiliza el patrón "perfil 1:1 con datos de negocio separados de `User`" para `LenderProfile` y `BorrowerProfile`, pero exclusivo por rol (no puede tener dos perfiles a la vez, a diferencia de Owner) |
| `Property` (60+ campos de marketing) | No | REMOVE — ver A-4, no existe tabla `Property` en absoluto |
| `Contract` (monolítico: identidad + términos mutables) | Sí, el concepto | ADAPT — se separa en `Contract` (identidad/ciclo de vida) + `ContractTerms` (términos versionados, inmutables una vez aceptados) |
| `Payment` (calendario + transacción en una tabla) | Sí, el concepto | ADAPT — se separa en `ScheduledPayment` (lo que se debe) + `Transaction` (lo que ocurrió) + `TransactionAllocation`, exactamente como ya corrigió [PAYMYLOAN_DATABASE_DESIGN.md](../PAYMYLOAN_DATABASE_DESIGN.md) |
| Auto-marcado de `Payment` pasado como `PAID` | No | REMOVE |
| `VerificationToken` + flujo de invitación por correo | Parcial | ADAPT — se reutiliza el patrón (token único + expiración) para `PasswordResetToken`, pero **no** hay invitación de Deudor por correo con auto-creación de cuenta: el Deudor lo crea el Prestamista directamente (con contraseña temporal) — ver sección [6.4](06-api-endpoints.md#64-borrowers-autoservicio) |
| Stripe Checkout Session simple | Parcial | ADAPT — ver A-3, pendiente de decisión Connect vs cuenta única |
| Webhook de Stripe (solo `checkout.session.completed`) | Sí, ampliado | ADAPT — mismo defecto que ya documentó [PAYMYLOAN_DATABASE_DESIGN.md](../PAYMYLOAN_DATABASE_DESIGN.md): falta manejar el ciclo asíncrono completo de ACH |
| S3 con URL pública persistida | No | REMOVE si se implementa el módulo de Documentos (fase 2/opcional) |
| `AuditLog` (actor + entidad + detalle texto libre) | Sí, el concepto | ADAPT — se mantiene actor opcional/sistema + `entityType`/`entityId`, se reemplaza `details` de texto libre por `metadata` JSON, se agrega `lenderId` denormalizado para filtrar por tenant, cobertura ampliada a **todo** evento financiero y de identidad (Owner no audita ni un pago) |
| `MediaFolder`/`MediaFile` | No | REMOVE — el módulo de Documentos (si se construye) ata archivos a `Contract`, no a un gestor de archivos genérico |
| `SERVICE_FEE` fijo ($39) | No | REMOVE — el modelo de cobro de la plataforma sigue sin decidirse (alcance Q5), no se inventa un valor |
| Perfiles `Agent`/`Renter`/Comunidad/Cursos/Blog | No | REMOVE — sin relación con préstamos privados |

---

[← Índice del plan](README.md)  ·  [Anterior: 1. Resumen de arquitectura propuesta](01-resumen-arquitectura.md)  ·  [Siguiente: 3. Arquitectura del backend](03-arquitectura-backend.md)
