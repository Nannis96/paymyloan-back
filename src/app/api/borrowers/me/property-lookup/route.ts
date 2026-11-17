import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";
import { withAuth } from "@/middlewares/withAuth";
import { withRole } from "@/middlewares/withRole";
import { lookupProperty } from "@/services/rentcast.service";
import { parseOrThrow } from "@/validations/parse";
import { z } from "zod";

const querySchema = z.object({ address: z.string().trim().min(5, "address is required").max(300) });

// GET /api/borrowers/me/property-lookup?address=... — autollenado de Submit Deal vía RentCast.
// Solo lectura: no persiste nada.
export async function GET(request: Request) {
  try {
    const session = await withAuth(request);
    await withRole(session, ["BORROWER"], { requireTwoFactor: false });
    const { address } = parseOrThrow(querySchema, Object.fromEntries(new URL(request.url).searchParams));
    return apiSuccess(await lookupProperty(address));
  } catch (error) {
    return handleRouteError(error, request);
  }
}
