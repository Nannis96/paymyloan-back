import { z } from "zod";

const uuid = z.string().trim().min(1, "Required");
const money = z.coerce.number().positive("Amount must be positive");

// PB-026 (D-S2-21). Mismo shape mínimo que ContractTerms — el resto
// (firstPaymentDate/maturityDate/lateFee/...) se deriva al seleccionar
// (loanQuotes.service.ts#deriveContractTermsFromQuote), editable por el
// Prestamista después vía PATCH /api/contracts/:id mientras siga DRAFT.
export const submitLoanQuoteSchema = z.object({
  lenderCompanyId: uuid.optional(),
  structure: z.enum(["INTEREST_ONLY", "AMORTIZED", "BALLOON"]),
  principalAmount: money,
  interestRate: z.coerce.number().min(0).max(100),
  amortizationTermMonths: z.coerce.number().int().positive(),
  estimatedClosingCostsAmount: z.coerce.number().min(0).optional(),
  message: z.string().trim().max(2000).optional(),
  expiresAt: z.coerce.date().optional(),
});
export type SubmitLoanQuoteInput = z.infer<typeof submitLoanQuoteSchema>;
