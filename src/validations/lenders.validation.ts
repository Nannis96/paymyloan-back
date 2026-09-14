import { z } from "zod";
import { paginationQuerySchema } from "@/validations/pagination";
import { phone } from "@/validations/users.validation";

const companyName = z.string().trim().min(1, "Company name is required").max(200);
// Formato XX-XXXXXXX — ver comentario en LenderCompany.ein (riesgo #13/#14).
const ein = z.string().trim().regex(/^\d{2}-\d{7}$/, "EIN must be in the format XX-XXXXXXX");
const state = z
  .string()
  .trim()
  .length(2, "State must be 2 letters")
  .transform((value) => value.toUpperCase());
const addressLine1 = z.string().trim().min(1, "Address is required").max(200);
const addressLine2 = z.string().trim().max(200).optional();
const city = z.string().trim().min(1, "City is required").max(120);
const postalCode = z.string().trim().min(1, "Postal code is required").max(20);

// D-P4-5 (rescopeo de BE-040): crea solo una LenderCompany nueva, asociada a
// un LenderProfile que ya existe — nunca un User. La persona (nombre/correo)
// ya se dio de alta por su cuenta (auto-registro, D-P2-1) o la creó un Admin
// por otra vía; este schema es puramente de la empresa. Lo usan tanto
// POST /api/admin/lenders/:id/companies (Admin asocia una empresa a un
// Lender existente) como POST /api/lenders/me/companies (el propio Lender
// se crea una empresa) — ver lenders.service.ts#createLenderCompany.
export const createLenderCompanySchema = z.object({
  companyName,
  ein,
  contactPhone: phone,
  addressLine1,
  addressLine2,
  city,
  state,
  postalCode,
});
export type CreateLenderCompanyInput = z.infer<typeof createLenderCompanySchema>;

// D-P4-8, nuevo: edición de una LenderCompany puntual (todos los campos
// opcionales — reemplaza a BE-043, que solo editaba LenderProfile.contactPhone,
// eliminado por D-P4-8 al quedar redundante con User.phone). `:companyId` se
// valida contra el `:id` del Lender en el service (lenders.service.ts#requireLenderCompany).
const updateLenderCompanyFields = z.object({
  companyName: companyName.optional(),
  ein: ein.optional(),
  contactPhone: phone,
  addressLine1: addressLine1.optional(),
  addressLine2,
  city: city.optional(),
  state: state.optional(),
  postalCode: postalCode.optional(),
  isOpenToDeals: z.boolean().optional(),
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
});
export const updateLenderCompanySchema = updateLenderCompanyFields.refine((data) => Object.keys(data).length > 0, {
  message: "Must include at least one field to update",
});
export type UpdateLenderCompanyInput = z.infer<typeof updateLenderCompanySchema>;

// D-P4-9, nuevo (autoservicio): mismo shape que arriba, sin `status` —
// suspender/reactivar una LenderCompany es moderación exclusiva del Admin
// (D-P1-8); el propio Lender no puede auto-reactivarse tras una suspensión.
export const updateOwnLenderCompanySchema = updateLenderCompanyFields
  .omit({ status: true })
  .refine((data) => Object.keys(data).length > 0, { message: "Must include at least one field to update" });
export type UpdateOwnLenderCompanyInput = z.infer<typeof updateOwnLenderCompanySchema>;

// BE-041.
export const listLendersQuerySchema = paginationQuerySchema.extend({
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
});
export type ListLendersQuery = z.infer<typeof listLendersQuerySchema>;
