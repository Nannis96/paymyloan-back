import { z } from "zod";
import { paginationQuerySchema } from "@/validations/pagination";

const commissionType = z.enum(["PERCENT", "FIXED"]);
const commissionValue = z.number().min(0).max(1_000_000);
const payoutDelayDays = z.number().int().min(0).max(365);

// PERCENT 0–100; el resto del rango lo valida el servicio con el tipo resuelto.
export const affiliateTermsSchema = z
  .object({
    commissionType,
    commissionValue,
    payoutDelayDays: payoutDelayDays.nullable().optional(),
  })
  .refine((t) => t.commissionType !== "PERCENT" || t.commissionValue <= 100, { message: "Percent commission cannot exceed 100", path: ["commissionValue"] });
export type AffiliateTermsInput = z.infer<typeof affiliateTermsSchema>;

// Approve: tarifa opcional (solo si se envía, tipo y valor van juntos).
export const approveAffiliateSchema = z
  .object({
    commissionType: commissionType.optional(),
    commissionValue: commissionValue.optional(),
    payoutDelayDays: payoutDelayDays.nullable().optional(),
  })
  .refine((t) => (t.commissionType === undefined) === (t.commissionValue === undefined), {
    message: "commissionType and commissionValue must be sent together",
    path: ["commissionValue"],
  })
  .refine((t) => t.commissionType !== "PERCENT" || (t.commissionValue ?? 0) <= 100, { message: "Percent commission cannot exceed 100", path: ["commissionValue"] });
export type ApproveAffiliateInput = z.infer<typeof approveAffiliateSchema>;

export const reasonSchema = z.object({ reason: z.string().trim().min(1, "Reason is required").max(500) });
export type ReasonInput = z.infer<typeof reasonSchema>;

export const manualCommissionSchema = z.object({
  amountCents: z.number().int().min(1).max(100_000_000),
  referredUserId: z.string().uuid().optional(),
  note: z.string().trim().min(1, "Note is required").max(500),
  payableAt: z.coerce.date().optional(),
});
export type ManualCommissionInput = z.infer<typeof manualCommissionSchema>;

export const setPayableAtSchema = z.object({ payableAt: z.coerce.date() });
export const markPaidSchema = z.object({ paymentReference: z.string().trim().min(1).max(200).optional(), force: z.boolean().default(false) });
export const voidCommissionSchema = z.object({ note: z.string().trim().min(1, "Note is required").max(500) });
export type MarkPaidInput = z.infer<typeof markPaidSchema>;

export const myCommissionsQuerySchema = paginationQuerySchema.pick({ page: true, pageSize: true }).extend({
  status: z.enum(["PENDING", "PAID", "VOID"]).optional(),
});
export type MyCommissionsQuery = z.infer<typeof myCommissionsQuerySchema>;

export const adminListAffiliatesQuerySchema = paginationQuerySchema.extend({
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "SUSPENDED", "INACTIVE"]).optional(),
});
export type AdminListAffiliatesQuery = z.infer<typeof adminListAffiliatesQuerySchema>;

export const adminListCommissionsQuerySchema = myCommissionsQuerySchema.extend({
  affiliateId: z.string().uuid().optional(),
  payable: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
});
export type AdminListCommissionsQuery = z.infer<typeof adminListCommissionsQuerySchema>;

export const referralCodeSchema = z
  .string()
  .trim()
  .min(4)
  .max(16)
  .transform((v) => v.toUpperCase());
