import path from "node:path";
import { defineConfig } from "vitest/config";

// Suite rápida, sin base de datos: funciones puras y utilidades. Los tests
// que sí necesitan Postgres real viven en *.integration.test.ts y corren con
// vitest.integration.config.ts (ver BE-073/081 y package.json).
export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "./src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "src/**/*.integration.test.ts"],
  },
});
