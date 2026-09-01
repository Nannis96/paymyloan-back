import { env } from "@/config/env";

export interface HealthStatus {
  status: "ok";
  environment: string;
  uptime: number;
  timestamp: string;
}

// Controller de ejemplo: hoy no necesita ningún service porque no hay
// lógica de negocio, pero fija el patrón que seguirán los controllers
// reales (recibir el request ya parseado, orquestar services, devolver
// datos planos — nunca un Response directo, eso lo arma el route handler).
export function getHealthStatus(): HealthStatus {
  return {
    status: "ok",
    environment: env.nodeEnv,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  };
}
