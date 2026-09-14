import { z } from "zod";
import { paginationQuerySchema } from "@/validations/pagination";

const uuid = z.string().trim().min(1, "Required");
const money = z.coerce.number().positive("Amount must be positive");
const nonNegativeMoney = z.coerce.number().min(0);
const percentRate = z.coerce.number().min(0).max(100);
const positiveInt = z.coerce.number().int().positive();
const state = z
  .string()
  .trim()
  .length(2, "State must be 2 letters")
  .transform((value) => value.toUpperCase());

// D-P6-2 (BE-051): sin endpoint propio de Property en esta fase — la
// dirección viaja embebida en el mismo body de POST /api/contracts (y en
// PATCH /api/contracts/:id, editable en cualquier estado). Campos de
// valuation/ARV, todos opcionales (carga manual, D-P1-5).
export const propertyFields = z.object({
  addressLine1: z.string().trim().min(1, "Address is required").max(200),
  addressLine2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1, "City is required").max(120),
  state,
  postalCode: z.string().trim().min(1, "Postal code is required").max(20),
  county: z.string().trim().max(120).optional(),
  parcelNumber: z.string().trim().max(60).optional(),
  propertyType: z.enum(["SINGLE_FAMILY", "MULTI_FAMILY", "CONDO", "TOWNHOUSE", "LAND", "COMMERCIAL", "OTHER"]),
  bedrooms: z.coerce.number().int().min(0).optional(),
  bathrooms: z.coerce.number().min(0).optional(),
  squareFootage: z.coerce.number().int().min(0).optional(),
  lotSize: z.coerce.number().int().min(0).optional(),
  yearBuilt: z.coerce.number().int().min(1800).optional(),
  conditionScale: z.coerce.number().int().min(0).max(5).optional(),
  estimatedRepairCost: nonNegativeMoney.optional(),
  estimatedMarketValue: nonNegativeMoney.optional(),
  afterRepairValue: nonNegativeMoney.optional(),
  lastSalePrice: nonNegativeMoney.optional(),
  lastSaleDate: z.coerce.date().optional(),
  annualPropertyTax: nonNegativeMoney.optional(),
  annualInsuranceEstimate: nonNegativeMoney.optional(),
});
export type PropertyInput = z.infer<typeof propertyFields>;
export const propertyUpdateSchema = propertyFields.partial();

// BE-051/BE-060. Mismo shape para la v1 (creación) y cualquier versión
// posterior (proponer nueva versión) — PB-020: prePayPenaltyType/Amount
// (D-S2-2), viajan juntos o ninguno.
const contractTermsFields = z.object({
  structure: z.enum(["INTEREST_ONLY", "AMORTIZED", "BALLOON"]),
  principalAmount: money,
  interestRate: percentRate,
  dayCountConvention: z.enum(["THIRTY_360", "ACTUAL_365"]).default("THIRTY_360"),
  amortizationTermMonths: positiveInt,
  firstPaymentDate: z.coerce.date(),
  paymentDueDay: z.coerce.number().int().min(1).max(31),
  maturityDate: z.coerce.date(),
  lateFeeType: z.enum(["FLAT", "PERCENTAGE"]),
  lateFeeAmount: money,
  gracePeriodDays: z.coerce.number().int().min(0).default(10),
  prePayPenaltyType: z.enum(["FLAT", "PERCENTAGE"]).optional(),
  prePayPenaltyAmount: nonNegativeMoney.optional(),
  changeSummary: z.string().trim().max(500).optional(),
});
export type ContractTermsInput = z.infer<typeof contractTermsFields>;

const contractTermsSchema = contractTermsFields.superRefine((data, ctx) => {
  if (data.maturityDate <= data.firstPaymentDate) {
    ctx.addIssue({ code: "custom", message: "maturityDate must be after firstPaymentDate", path: ["maturityDate"] });
  }
  if ((data.prePayPenaltyType == null) !== (data.prePayPenaltyAmount == null)) {
    ctx.addIssue({
      code: "custom",
      message: "prePayPenaltyType and prePayPenaltyAmount must be provided together",
      path: ["prePayPenaltyAmount"],
    });
  }
});

// BE-051. `lenderCompanyId` obligatorio solo si el Lender tiene más de una
// LenderCompany — validado en el service (D-P6-1), no acá. `property` crea
// la Property embebida (D-P6-2); `borrowerProfileIds` asocia deudores
// iniciales en el mismo payload (08-contratos.md §8.2).
export const createContractSchema = z.object({
  lenderCompanyId: uuid.optional(),
  property: propertyFields,
  terms: contractTermsSchema,
  insuranceCompanyId: uuid.optional(),
  borrowerProfileIds: z.array(uuid).max(10).optional(),
});
export type CreateContractInput = z.infer<typeof createContractSchema>;

// BE-054. `terms` solo se aplica si la ContractTerms vigente está DRAFT
// (validado en el service, no acá) — property/insuranceCompanyId son
// editables en cualquier estado (08-contratos.md §8.2).
export const updateContractSchema = z
  .object({
    property: propertyUpdateSchema.optional(),
    terms: contractTermsFields.partial().optional(),
    insuranceCompanyId: uuid.nullable().optional(),
  })
  .refine((data) => data.property !== undefined || data.terms !== undefined || data.insuranceCompanyId !== undefined, {
    message: "Must include at least one field to update",
  });
export type UpdateContractInput = z.infer<typeof updateContractSchema>;

// BE-060. Nueva versión de ContractTerms — mismo shape completo que la
// creación (no hay copia parcial de la versión anterior, D-S2-2 nota BE-060).
export const proposeContractTermsSchema = contractTermsSchema;
export type ProposeContractTermsInput = z.infer<typeof proposeContractTermsSchema>;

// BE-056. `reason` obligatorio y auditado (08-contratos.md §8.1).
export const cancelContractSchema = z.object({
  reason: z.string().trim().min(1, "reason is required").max(1000),
});
export type CancelContractInput = z.infer<typeof cancelContractSchema>;

// BE-057.
export const addContractBorrowerSchema = z.object({
  borrowerProfileId: uuid,
  isPrimary: z.boolean().optional(),
});
export type AddContractBorrowerInput = z.infer<typeof addContractBorrowerSchema>;

// BE-061.
export const rejectContractTermsSchema = z.object({
  comment: z.string().trim().max(1000).optional(),
});
export type RejectContractTermsInput = z.infer<typeof rejectContractTermsSchema>;

// PB-020. `label` obligatorio en la práctica cuando code=CUSTOM (no forzado
// a nivel de BD, sí acá). MARKETPLACE_CONNECTION se rechaza en el service —
// solo el propio servicio la inserta (D-S2-5, Fase 13).
export const createFeeItemSchema = z
  .object({
    category: z.enum(["LENDER", "PLATFORM"]),
    code: z.enum(["ORIGINATION_POINTS", "PROCESSING", "UNDERWRITING", "DOC_PREP", "CUSTOM", "MARKETPLACE_CONNECTION"]),
    label: z.string().trim().min(1).max(200).optional(),
    amountType: z.enum(["FLAT", "PERCENTAGE"]),
    amountValue: money,
  })
  .refine((data) => data.code !== "CUSTOM" || !!data.label, { message: "label is required when code=CUSTOM", path: ["label"] });
export type CreateFeeItemInput = z.infer<typeof createFeeItemSchema>;

// BE-052.
export const listContractsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(["DRAFT", "PENDING_ACCEPTANCE", "ACTIVE", "DELINQUENT", "PAID_OFF", "CANCELLED"]).optional(),
});
export type ListContractsQuery = z.infer<typeof listContractsQuerySchema>;
