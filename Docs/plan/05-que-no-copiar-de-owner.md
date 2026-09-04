[← Índice del plan](README.md)  ·  [Anterior: 4. Base de datos](04-base-de-datos.md)  ·  [Siguiente: 6. API — Endpoints por módulo](06-api-endpoints.md)

---

# 5. Qué NO debemos copiar de Owner

Explícito, para que quede fuera de cualquier duda al implementar:

- **El `Property` de Owner tal cual** (60+ campos de marketing bilingüe, SEO, galería, showings, comisión de agente, precio de venta/renta). PayMyLoan **sí** tiene una tabla `Property` desde la revisión del 2026-09-04 (decisión `D-P1-5`, ver [00](00-contradicciones-y-decisiones.md#decisiones-2026-09-04-ronda-fase-1) y [04](04-base-de-datos.md#property-nueva)) — reemplaza la decisión `A-4` original — pero es un modelo mínimo orientado a garantía/valuation (dirección + campos de ARV/taxes tomados puntualmente de la lógica de `app/api/analyze/route.ts` de Owner), no el inventario de marketing completo.
- **Perfiles `AgentProfile`, `RenterProfile`, `WebuserProfile`**, `AgentReferral`, `LeaseAgreement`, `RentalPayment`, `MarketingMaterial` — sin relación con préstamos privados garantizados.
- **`MediaFolder`/`MediaFile`** como gestor de archivos genérico — si se construye el módulo de Documentos, los archivos cuelgan de `Contract`, no de un árbol de carpetas desconectado del dominio.
- **Auto-marcado de pagos pasados como `PAID`** en la generación del calendario.
- **URL pública persistida tras subir a S3** — todo acceso de lectura de documentos, si se implementa, es vía URL firmada de corta vida bajo demanda.
- **`SERVICE_FEE` fijo hardcodeado** — el modelo de cobro de la plataforma sigue sin decidirse, no se inventa un valor.
- **Middleware de NextAuth con lógica de redirect por jerarquía de perfiles** (`auth.config.ts` de Owner) — se reemplaza por middlewares explícitos de rol + tenant (sección [7.6](07-autenticacion-y-autorizacion.md#76-middlewaresguards)); el frontend decide sus propios redirects post-login (ver plan de frontend).
- **Webhook de Stripe que marca `PAID` en `checkout.session.completed`** — se reemplaza por el manejo completo del ciclo ACH.
- **Comunidad, cursos, blog, integraciones de Buildium** — cero relación con el dominio.

---

[← Índice del plan](README.md)  ·  [Anterior: 4. Base de datos](04-base-de-datos.md)  ·  [Siguiente: 6. API — Endpoints por módulo](06-api-endpoints.md)
