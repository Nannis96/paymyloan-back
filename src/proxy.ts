import { NextResponse, type NextRequest } from "next/server";
import { buildCorsHeaders } from "@/middlewares/cors";

// Proxy de plataforma de Next.js 16 (antes "middleware", ver
// https://nextjs.org/docs/messages/middleware-to-proxy) — corre antes de
// cualquier route handler bajo /api/*: resuelve CORS (BE-003) y
// genera/propaga el requestId (BE-004) que cada route handler retoma vía
// getRequestId().
export const config = {
  matcher: "/api/:path*",
};

export function proxy(request: NextRequest) {
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  const corsHeaders = buildCorsHeaders(request.headers.get("origin"));

  if (request.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers: corsHeaders });
  }

  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set("x-request-id", requestId);

  const response = NextResponse.next({ request: { headers: forwardedHeaders } });
  for (const [key, value] of Object.entries(corsHeaders)) {
    response.headers.set(key, value);
  }
  response.headers.set("x-request-id", requestId);

  return response;
}
