import { z } from "zod";
import { paginationQuerySchema } from "@/validations/pagination";

export const listPaymentsQuerySchema = paginationQuerySchema.pick({ page: true, pageSize: true });

export const adminListSubscriptionsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(["TRIALING", "ACTIVE", "CANCELLED", "EXPIRED"]).optional(),
});
export type AdminListSubscriptionsQuery = z.infer<typeof adminListSubscriptionsQuerySchema>;

export const grantSubscriptionSchema = z.object({
  days: z.number().int().min(1).max(365),
  reason: z.string().trim().min(1, "Reason is required").max(500),
});
export type GrantSubscriptionInput = z.infer<typeof grantSubscriptionSchema>;

export const adminCancelSubscriptionSchema = z.object({
  immediate: z.boolean().default(false),
});
export type AdminCancelSubscriptionInput = z.infer<typeof adminCancelSubscriptionSchema>;
