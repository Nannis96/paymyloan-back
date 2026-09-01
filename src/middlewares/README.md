# middlewares/

Middlewares reutilizables entre endpoints (autenticación, rate limiting,
logging de requests, etc.), invocados desde los route handlers.

Vacío por ahora. Cuando exista lógica que deba correr antes de que la
request llegue a cualquier ruta (ej. verificar un JWT), se agrega también
un `middleware.ts` en la raíz del proyecto, que es la convención de Next.js
para middleware a nivel de plataforma.
