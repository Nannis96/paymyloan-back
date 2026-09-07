// IP y user agent del cliente, para RefreshToken.ipAddress/userAgent y
// AuditLog.ipAddress/userAgent (BE-027..032). `x-forwarded-for` es el único
// header disponible en este stack (Next detrás de nginx/docker, sin acceso
// directo al socket) — se toma la primera IP de la lista.
export interface RequestMeta {
  ipAddress?: string;
  userAgent?: string;
}

export function getRequestMeta(request: Request): RequestMeta {
  const forwardedFor = request.headers.get("x-forwarded-for");
  const ipAddress = forwardedFor?.split(",")[0]?.trim() || undefined;
  const userAgent = request.headers.get("user-agent") ?? undefined;
  return { ipAddress, userAgent };
}
