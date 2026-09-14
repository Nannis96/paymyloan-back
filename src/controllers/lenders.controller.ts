import { withAuth } from "@/middlewares/withAuth";
import { withRole } from "@/middlewares/withRole";
import * as lendersService from "@/services/lenders.service";
import { parseOrThrow } from "@/validations/parse";
import { createLenderCompanySchema, listLendersQuerySchema, updateLenderCompanySchema, updateOwnLenderCompanySchema } from "@/validations/lenders.validation";

// BE-041..044: /api/admin/lenders — ADMIN, escrituras exigen 2FA (D-P3-1).
async function requireAdminSession(request: Request, options?: { requireTwoFactor?: boolean }) {
  const session = await withAuth(request);
  await withRole(session, ["ADMIN"], options);
  return session;
}

export async function listLenders(request: Request, query: unknown) {
  await requireAdminSession(request, { requireTwoFactor: false });
  const input = parseOrThrow(listLendersQuerySchema, query);
  return lendersService.listLenders(input);
}

// D-P4-5: un Admin asocia una LenderCompany nueva a un Lender que ya existe
// (:id = LenderProfile.id) — ya no crea la persona, eso lo cubre el
// auto-registro (D-P2-1).
export async function createLenderCompany(request: Request, lenderProfileId: string, body: unknown) {
  const session = await requireAdminSession(request);
  const input = parseOrThrow(createLenderCompanySchema, body);
  return lendersService.createLenderCompany(lenderProfileId, input, session.userId);
}

export async function getLender(request: Request, id: string) {
  await requireAdminSession(request, { requireTwoFactor: false });
  return lendersService.getLender(id);
}

export async function deleteLender(request: Request, id: string) {
  const session = await requireAdminSession(request);
  return lendersService.deleteLender(id, session.userId);
}

// D-P4-8, nuevo: PATCH/DELETE de una LenderCompany puntual, del lado Admin.
export async function updateLenderCompany(request: Request, lenderId: string, companyId: string, body: unknown) {
  const session = await requireAdminSession(request);
  const input = parseOrThrow(updateLenderCompanySchema, body);
  return lendersService.updateLenderCompany(lenderId, companyId, input, session.userId);
}

export async function deleteLenderCompany(request: Request, lenderId: string, companyId: string) {
  const session = await requireAdminSession(request);
  await lendersService.deleteLenderCompany(lenderId, companyId, session.userId);
  return { deleted: true };
}

// BE-100: GET /api/lenders/me — autoservicio, LENDER. El PATCH que este
// ticket pedía originalmente ya no existe (D-P4-8) — ver nota en
// lenders.service.ts#getOwnLenderProfile.
export async function getOwnLender(request: Request) {
  const session = await withAuth(request);
  await withRole(session, ["LENDER"], { requireTwoFactor: false });
  return lendersService.getOwnLenderProfile(session.userId);
}

// D-P4-5, nuevo (BE-101): el propio Lender se crea una empresa — mismo
// schema/servicio que la ruta de Admin, resolviendo el LenderProfile desde
// la sesión en vez de un :id.
export async function createOwnLenderCompany(request: Request, body: unknown) {
  const session = await withAuth(request);
  await withRole(session, ["LENDER"]);
  const input = parseOrThrow(createLenderCompanySchema, body);
  return lendersService.createOwnLenderCompany(session.userId, input);
}

// D-P4-9, nuevo (autoservicio): el propio Lender edita/borra una empresa
// suya — mismo patrón que createOwnLenderCompany, resolviendo el
// LenderProfile desde la sesión en vez de un :id. Escritura de negocio ->
// exige 2FA (D-P3-1), igual que su contraparte de Admin.
export async function updateOwnLenderCompany(request: Request, companyId: string, body: unknown) {
  const session = await withAuth(request);
  await withRole(session, ["LENDER"]);
  const input = parseOrThrow(updateOwnLenderCompanySchema, body);
  return lendersService.updateOwnLenderCompany(session.userId, companyId, input);
}

export async function deleteOwnLenderCompany(request: Request, companyId: string) {
  const session = await withAuth(request);
  await withRole(session, ["LENDER"]);
  await lendersService.deleteOwnLenderCompany(session.userId, companyId);
  return { deleted: true };
}
