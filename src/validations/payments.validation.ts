import { z } from "zod";
import { paginationQuerySchema } from "@/validations/pagination";

const money = z.coerce.number().positive("Amount must be positive");

// BE-067. Sin Stripe (A-3 sigue bloqueado) — solo canales que el Lender
// concilia a mano; ACH/CARD quedan para BE-065/066 cuando Stripe se
// desbloquee (09-pagos.md §9.5: "Registrar pago manual (wire/cheque)": solo
// LENDER, en sus propios contratos).
export const createManualPaymentSchema = z.object({
  amount: money,
  method: z.enum(["WIRE", "CHECK", "MANUAL"]).default("MANUAL"),
  occurredAt: z.coerce.date().optional(),
  notes: z.string().trim().max(1000).optional(),
});
export type CreateManualPaymentInput = z.infer<typeof createManualPaymentSchema>;

// BE-071. `reason` obligatorio y auditado — mismo patrón que
// cancelContractSchema (BE-056).
export const reverseTransactionSchema = z.object({
  reason: z.string().trim().min(1, "reason is required").max(1000),
});
export type ReverseTransactionInput = z.infer<typeof reverseTransactionSchema>;

// BE-069.
export const listTransactionsQuerySchema = paginationQuerySchema;
export type ListTransactionsQuery = z.infer<typeof listTransactionsQuerySchema>;

// BE-072. `contractId`/`action`/`entityType` opcionales — sin filtro
// aplican todos los que el rol pueda ver.
export const listAuditLogsQuerySchema = paginationQuerySchema.extend({
  contractId: z.string().trim().min(1).optional(),
  action: z.string().trim().min(1).optional(),
  entityType: z.string().trim().min(1).optional(),
});
export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;
