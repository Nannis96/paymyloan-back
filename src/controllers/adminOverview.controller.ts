import { withAuth } from "@/middlewares/withAuth";
import { withRole } from "@/middlewares/withRole";
import * as adminOverviewService from "@/services/adminOverview.service";

// AD-001. Lectura ADMIN-only — nunca exige 2FA (mismo criterio que GET
// /api/users y GET /api/audit-logs).
export async function getOverview(request: Request) {
  const session = await withAuth(request);
  await withRole(session, ["ADMIN"], { requireTwoFactor: false });
  return adminOverviewService.getAdminOverview();
}
