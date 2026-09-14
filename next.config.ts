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
  // no falle con "query engine not found". El glob usa "**" antes de
  // ".prisma" porque con pnpm el cliente generado vive dentro del store
  // aislado (node_modules/.pnpm/@prisma+client@.../node_modules/.prisma),
  // no en node_modules/.prisma como con npm.
  outputFileTracingIncludes: {
    "/api/**/*": ["./node_modules/**/.prisma/client/**/*"],
  },
};

export default nextConfig;
