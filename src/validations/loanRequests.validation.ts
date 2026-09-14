import { z } from "zod";
import { propertyFields, propertyUpdateSchema } from "@/validations/contracts.validation";
import { paginationQuerySchema } from "@/validations/pagination";

const uuid = z.string().trim().min(1, "Required");
const money = z.coerce.number().positive("Amount must be positive");
const nonNegativeMoney = z.coerce.number().min(0);

const projectType = z.enum(["RENTAL", "FIX_AND_FLIP", "SLOW_FLIP", "COMMERCIAL", "NEW_CONSTRUCTION"]);
const visibility = z.enum(["PUBLIC", "PRIVATE"]);
const loanRequestStatus = z.enum(["DRAFT", "PUBLISHED", "MATCHED", "WITHDRAWN", "EXPIRED", "CONVERTED"]);

// PB-011. `property` embebida (D-P6-2/D-S2-25, sin endpoint propio de
// Property) — se crea sin lenderCompanyId, se backfillea recién al
// seleccionar una cotización (PB-017). `visibility` se fija acá (no al
// publicar) — simplificación de implementación sobre D-S2-1.
export const createLoanRequestSchema = z.object({
  property: propertyFields,
  projectType,
  purchasePrice: money,
  rehabAmount: nonNegativeMoney,
  totalLoanAmountRequested: money,
  requestedClosingDate: z.coerce.date(),
  requestedTimelineNotes: z.string().trim().max(1000).optional(),
  visibility,
});
export type CreateLoanRequestInput = z.infer<typeof createLoanRequestSchema>;

// BE-054-style: editable solo mientras DRAFT (validado en el service).
export const updateLoanRequestSchema = z
  .object({
    property: propertyUpdateSchema.optional(),
    projectType: projectType.optional(),
    purchasePrice: money.optional(),
    rehabAmount: nonNegativeMoney.optional(),
    totalLoanAmountRequested: money.optional(),
    requestedClosingDate: z.coerce.date().optional(),
    requestedTimelineNotes: z.string().trim().max(1000).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: "Must include at least one field to update" });
export type UpdateLoanRequestInput = z.infer<typeof updateLoanRequestSchema>;

// D-S2-22.
export const addLoanRequestTargetSchema = z.object({ lenderCompanyId: uuid });
export type AddLoanRequestTargetInput = z.infer<typeof addLoanRequestTargetSchema>;

export const listLoanRequestsQuerySchema = paginationQuerySchema.extend({
  status: loanRequestStatus.optional(),
});
export type ListLoanRequestsQuery = z.infer<typeof listLoanRequestsQuerySchema>;
