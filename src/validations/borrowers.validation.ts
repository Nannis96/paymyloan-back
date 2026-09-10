import { z } from "zod";
import { paginationQuerySchema } from "@/validations/pagination";
import { phone } from "@/validations/users.validation";

const name = z.string().trim().min(1, "Name is required").max(120);
const email = z.email("Invalid email").trim().toLowerCase();
const addressLine1 = z.string().trim().min(1).max(200).optional();
const city = z.string().trim().min(1).max(120).optional();
const state = z
  .string()
  .trim()
  .length(2, "State must be 2 letters")
  .transform((value) => value.toUpperCase())
  .optional();
const postalCode = z.string().trim().min(1).max(20).optional();

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

// BE-048 (el Lender edita) y BE-050 (el Borrower edita lo propio) — mismos
// campos de contacto, nunca lenderCompanyId/lenderId.
export const updateBorrowerProfileSchema = z
  .object({ phone, addressLine1, city, state, postalCode })
  .refine((data) => Object.keys(data).length > 0, { message: "Must include at least one field to update" });
export type UpdateBorrowerProfileInput = z.infer<typeof updateBorrowerProfileSchema>;

// BE-046.
export const listBorrowersQuerySchema = paginationQuerySchema;
export type ListBorrowersQuery = z.infer<typeof listBorrowersQuerySchema>;

// BE-050.
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required").max(72),
  newPassword: z.string().min(8, "Password must be at least 8 characters").max(72),
});
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
