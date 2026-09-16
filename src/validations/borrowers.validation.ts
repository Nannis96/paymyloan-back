import { z } from "zod";
import { paginationQuerySchema } from "@/validations/pagination";
import { phone } from "@/validations/users.validation";

const name = z.string().trim().min(1, "Name is required").max(120);
const email = z.email("Invalid email").trim().toLowerCase();
const addressLine1Required = z.string().trim().min(1).max(200);
const cityRequired = z.string().trim().min(1).max(120);
const stateRequired = z
  .string()
  .trim()
  .length(2, "State must be 2 letters")
  .transform((value) => value.toUpperCase());
const postalCodeRequired = z.string().trim().min(1).max(20);
const addressLine1 = addressLine1Required.optional();
const city = cityRequired.optional();
const state = stateRequired.optional();
const postalCode = postalCodeRequired.optional();

// BE-045. `lenderCompanyId` es obligatorio solo si el Lender tiene más de
// una LenderCompany — se valida en el service (D-P4-1), no acá, porque
// depende de cuántas empresas tiene la sesión, no del shape del body.
export const createBorrowerSchema = z.object({
  name,
  email,
  phone,
  lenderCompanyId: z.string().trim().min(1).optional(),
});
export type CreateBorrowerInput = z.infer<typeof createBorrowerSchema>;

// BE-048 (el Lender edita) y BE-050 (el Borrower edita lo propio) — dirección
// únicamente; `phone` ya no vive en `BorrowerProfile` (D-P5-2, redundante
// con `User.phone`) — se edita por `PATCH /api/auth/me` (BE-099).
export const updateBorrowerProfileSchema = z
  .object({ addressLine1, city, state, postalCode })
  .refine((data) => Object.keys(data).length > 0, { message: "Must include at least one field to update" });
export type UpdateBorrowerProfileInput = z.infer<typeof updateBorrowerProfileSchema>;

// D-P7-1. POST /api/lenders/me/become-borrower — a diferencia de la edición
// de perfil de arriba (parcial, todo opcional), acá la dirección completa es
// obligatoria: es la información mínima que le falta a un LENDER para
// adquirir el rol BORROWER.
export const becomeBorrowerSchema = z.object({
  addressLine1: addressLine1Required,
  city: cityRequired,
  state: stateRequired,
  postalCode: postalCodeRequired,
});
export type BecomeBorrowerInput = z.infer<typeof becomeBorrowerSchema>;

// BE-046.
export const listBorrowersQuerySchema = paginationQuerySchema;
export type ListBorrowersQuery = z.infer<typeof listBorrowersQuerySchema>;

// BE-050.
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required").max(72),
  newPassword: z.string().min(8, "Password must be at least 8 characters").max(72),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
