import { z } from "zod";
import { ein, state } from "@/validations/lenders.validation";
import { paginationQuerySchema } from "@/validations/pagination";

// AD-003. Mismo body para Prestamistas y Deudores: los datos de la entidad
// que se va a verificar (lender/verification.html, borrower/onboarding.html).
// Sin SSN/ID ni archivos — ver D-A9.
export const submitVerificationSchema = z.object({
  entityName: z.string().trim().min(1, "Entity name is required").max(200),
  entityType: z.enum(["LLC", "CORPORATION", "LP", "TRUST", "INDIVIDUAL", "OTHER"]),
  ein,
  stateOfFormation: state,
  signatoryName: z.string().trim().min(1).max(120).optional(),
  signatoryTitle: z.string().trim().min(1).max(120).optional(),
});
export type SubmitVerificationInput = z.infer<typeof submitVerificationSchema>;

export const listVerificationsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
  subject: z.enum(["LENDER", "BORROWER"]).optional(),
});
export type ListVerificationsQuery = z.infer<typeof listVerificationsQuerySchema>;

export const rejectVerificationSchema = z.object({
  reason: z.string().trim().min(1, "A reason is required").max(500),
});
export type RejectVerificationInput = z.infer<typeof rejectVerificationSchema>;
