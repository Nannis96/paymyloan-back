import path from "node:path";
import { defineConfig } from "vitest/config";

// Contra Postgres real (servicio "db-test" de docker-compose.dev.yml, nunca
// mocks de Prisma — ver plan de backend §11, nota sobre mocks). Requiere
// `docker compose -f docker-compose.dev.yml up -d db-test` antes de correr
// `pnpm run test:integration`.
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    exclude: ["**/node_modules/**"],
    testTimeout: 15_000,
    fileParallelism: false,
  },
});
