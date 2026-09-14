import { env } from "@/config/env";

// Único origen permitido (CORS_ORIGIN), nunca "*" (ver plan de backend §3.6).
// Función pura para poder testear la decisión sin levantar Next.
export function isOriginAllowed(origin: string | null): boolean {
  return origin !== null && origin === env.corsOrigin;
}

export function buildCorsHeaders(origin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };

  if (isOriginAllowed(origin)) {
    headers["Access-Control-Allow-Origin"] = origin as string;
    headers["Vary"] = "Origin";
  }

  return headers;
}
