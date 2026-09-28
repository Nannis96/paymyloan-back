import { z } from "zod";

// Fase 18 (PB-031). Mismo cuerpo para ambos lados: el Lender además indica a
// qué co-deudor califica (`borrowerProfileId`); el Borrower no lo manda — el
// calificado es la LenderCompany del contrato. `direction` nunca viene del
// cliente, se infiere del lado del contrato (§4 de la fase).
export const createReviewSchema = z.object({
  rating: z.number().int("Rating must be a whole number").min(1).max(5),
  comment: z
    .string()
    .trim()
    .max(1000)
    .transform((value) => value || undefined)
    .optional(),
  borrowerProfileId: z.string().uuid("Invalid borrower id").optional(),
});
export type CreateReviewInput = z.infer<typeof createReviewSchema>;
