import { withAuth } from "@/middlewares/withAuth";
import { withRole } from "@/middlewares/withRole";
import { listAdminBorrowers as listService } from "@/services/adminBorrowers.service";
import { parseOrThrow } from "@/validations/parse";
import { listAdminBorrowersQuerySchema } from "@/validations/borrowers.validation";

// AB-02: GET /api/admin/borrowers — ADMIN, lectura exenta de 2FA.
export async function listAdminBorrowers(request: Request, query: unknown) {
  const session = await withAuth(request);
  await withRole(session, ["ADMIN"], { requireTwoFactor: false });
  return listService(parseOrThrow(listAdminBorrowersQuerySchema, query));
}
