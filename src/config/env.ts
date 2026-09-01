// Punto único de lectura de variables de entorno. El resto del código
// importa `env`, nunca `process.env` directamente, para que agregar una
// variable nueva (DATABASE_URL, JWT_SECRET, ...) sea un cambio en un solo
// lugar y con tipos.

const nodeEnv = process.env.NODE_ENV ?? "development";

export const env = {
  nodeEnv,
  isProduction: nodeEnv === "production",
  isDevelopment: nodeEnv === "development",
  port: Number(process.env.PORT ?? 4000),
} as const;
