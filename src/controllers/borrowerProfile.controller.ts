import { withAuth } from "@/middlewares/withAuth";
import { withRole } from "@/middlewares/withRole";
import { reissueAccessToken } from "@/services/auth.service";
import * as borrowerProfileService from "@/services/borrowerProfile.service";
import * as lendersService from "@/services/lenders.service";
import { createLenderCompanySchema } from "@/validations/lenders.validation";
import { parseOrThrow } from "@/validations/parse";
import { changePasswordSchema, updateBorrowerProfileSchema } from "@/validations/borrowers.validation";

// BE-050: /api/borrowers/me — BORROWER nunca exige 2FA (D-P3-1). La edición
// sí exige haber cambiado la contraseña temporal (D-P4-2) — la lectura y el
// propio cambio de contraseña quedan exentos, si no nadie podría cambiarla.
export async function getOwnProfile(request: Request) {
  const session = await withAuth(request);
  await withRole(session, ["BORROWER"], { requireTwoFactor: false });
  return borrowerProfileService.getOwnProfile(session.userId);
}

export async function updateOwnProfile(request: Request, body: unknown) {
  const session = await withAuth(request);
  await withRole(session, ["BORROWER"], { requireTwoFactor: false, requirePasswordChanged: true });
  const input = parseOrThrow(updateBorrowerProfileSchema, body);
  return borrowerProfileService.updateOwnProfile(session.userId, input);
}

export async function changeOwnPassword(request: Request, body: unknown) {
  const session = await withAuth(request);
  await withRole(session, ["BORROWER"], { requireTwoFactor: false });
  const input = parseOrThrow(changePasswordSchema, body);
  await borrowerProfileService.changeOwnPassword(session.userId, input);
  return { changed: true };
}

// D-P7-1. POST /api/borrowers/me/become-lender — un BORROWER adquiere el
// rol LENDER completando la información de su primera LenderCompany.
// `withRole(["BORROWER"])` ya rechaza ADMIN/BOOKKEEPER/INSURANCE_COMPANY con
// 403; si ya es LENDER también, el service responde 409.
export async function becomeLender(request: Request, body: unknown) {
  const session = await withAuth(request);
  await withRole(session, ["BORROWER"], { requireTwoFactor: false });
  const input = parseOrThrow(createLenderCompanySchema, body);
  const result = await lendersService.becomeLender(session.userId, input);
  const { accessToken } = await reissueAccessToken(session.userId);
  return { ...result, accessToken };
}
