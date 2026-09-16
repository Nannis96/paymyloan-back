import { withAuth } from "@/middlewares/withAuth";
import { withRole } from "@/middlewares/withRole";
import * as auditLogsService from "@/services/auditLogs.service";
import { parseOrThrow } from "@/validations/parse";
import { listAuditLogsQuerySchema } from "@/validations/payments.validation";

// BE-072. Lectura — nunca exige 2FA (mismo criterio que GET /api/users). El
// filtro por rol (ADMIN ve todo, LENDER solo sus empresas) vive en el
// servicio, no acá.
export async function listAuditLogs(request: Request, query: unknown) {
  const session = await withAuth(request);
  await withRole(session, ["ADMIN", "LENDER"], { requireTwoFactor: false });
  const input = parseOrThrow(listAuditLogsQuerySchema, query);
  return auditLogsService.listAuditLogs(session, input);
}
