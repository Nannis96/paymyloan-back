import { listBorrowers } from "@/controllers/lenderBorrowers.controller";
import { handleRouteError } from "@/errors/errorHandler";
import { apiSuccess } from "@/lib/apiResponse";

// GET /api/lenders/me/borrowers — lista + búsqueda + paginación (BE-046),
// a través de todas las LenderCompany del Lender (D-P4-1).
export async function GET(request: Request) {
  try {
    const query = Object.fromEntries(new URL(request.url).searchParams);
    const result = await listBorrowers(request, query);
    return apiSuccess(result);
  } catch (error) {
    return handleRouteError(error, request);
  }
}

// POST /api/lenders/me/borrowers (BE-045) — DESHABILITADO 2026-09-11 a
// pedido explícito: un LENDER ya no debe poder crear un Borrower directo.
// Comentado, no borrado — controller/service (createBorrower) siguen
// intactos en lenderBorrowers.controller.ts/.service.ts por si se
// reactiva. Ver Docs/plan/00-contradicciones-y-decisiones.md (pendiente:
// aclarar cómo se crea un LenderBorrower sin este camino).
//
// import { createBorrower } from "@/controllers/lenderBorrowers.controller";
// import { apiError } from "@/lib/apiResponse";
//
// export async function POST(request: Request) {
//   let body: unknown;
//   try {
//     body = await request.json();
//   } catch {
//     return apiError("Invalid JSON in request body", 400, "INVALID_JSON");
//   }
//
//   try {
//     const result = await createBorrower(request, body);
//     return apiSuccess(result, 201);
//   } catch (error) {
//     return handleRouteError(error, request);
//   }
// }
