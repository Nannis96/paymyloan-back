import { z } from "zod";
import { paginationQuerySchema } from "@/validations/pagination";

// Fase 17 (PB-027). Mismo cuerpo de mensaje para ambos lados — lo que
// cambia es a quién identifica cada uno: el Lender manda `borrowerProfileId`
// (y opcionalmente `lenderCompanyId` si tiene más de una empresa, mismo
// patrón que loanQuotes.validation), el Borrower manda `lenderCompanyId`.
const messageBody = z.string().trim().min(1, "Message body is required").max(4000);

export const sendMessageAsLenderSchema = z.object({
  borrowerProfileId: z.string().uuid("Invalid borrower id"),
  lenderCompanyId: z.string().uuid("Invalid lender company id").optional(),
  body: messageBody,
});
export type SendMessageAsLenderInput = z.infer<typeof sendMessageAsLenderSchema>;

export const sendMessageAsBorrowerSchema = z.object({
  lenderCompanyId: z.string().uuid("Invalid lender company id"),
  body: messageBody,
});
export type SendMessageAsBorrowerInput = z.infer<typeof sendMessageAsBorrowerSchema>;

// Historial del Lender con un Borrower puntual — `lenderCompanyId` query
// param solo hace falta si el Lender tiene más de una empresa.
export const lenderThreadQuerySchema = paginationQuerySchema.extend({
  lenderCompanyId: z.string().uuid("Invalid lender company id").optional(),
});
export type LenderThreadQuery = z.infer<typeof lenderThreadQuerySchema>;

export const markThreadReadQuerySchema = z.object({
  lenderCompanyId: z.string().uuid("Invalid lender company id").optional(),
});
export type MarkThreadReadQuery = z.infer<typeof markThreadReadQuerySchema>;
