import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // "standalone" empaqueta el server con solo las dependencias que usa en
  // runtime. Es lo que permite que la imagen final de Docker no lleve
  // node_modules completo (ver Dockerfile, stage "runner").
  output: "standalone",
  poweredByHeader: false,
  // El motor nativo de Prisma se carga con una ruta armada en runtime, no
  // con un import estático, así que el tracing automático de "standalone"
  // no siempre lo detecta. Se fuerza acá para que la imagen de producción
  // no falle con "query engine not found".
  outputFileTracingIncludes: {
    "/api/**/*": ["./node_modules/.prisma/client/**/*"],
  },
};

export default nextConfig;
