import { listAuditLogs } from "@/controllers/auditLogs.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

// GET /api/audit-logs — ADMIN ve todo, LENDER solo sus empresas (BE-072).
export async function GET(request: Request) {
  try {
    const query = Object.fromEntries(new URL(request.url).searchParams);
    const result = await listAuditLogs(request, query);
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}
