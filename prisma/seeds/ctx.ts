import type {
  BorrowerProfile,
  BookkeeperProfile,
  Contract,
  ContractStatus,
  ContractTerms,
  InsuranceCompanyProfile,
  LenderCompany,
  LenderProfile,
  LoanQuote,
  LoanRequest,
  LoanStructure,
  PaymentMethod,
  Prisma,
  ScheduledPayment,
  User,
} from "@prisma/client";
import { prisma } from "@/db/prisma";
import { logAuditEvent, type LogAuditEventInput } from "@/lib/audit";

export const DEV_PASSWORD = "DevPass!2026";
// Secreto TOTP fijo de los usuarios *2fa* — apto solo para desarrollo.
export const DEV_TOTP_SECRET = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";

const now = new Date();
export const NOW = now;
/** Primer día del mes `offset` meses respecto al actual (negativo = pasado). */
export const monthStart = (offset: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
export const daysFromNow = (days: number) => new Date(now.getTime() + days * 86_400_000);
export const addDays = (date: Date, days: number) => new Date(date.getTime() + days * 86_400_000);

export interface LenderEntry {
  user: User;
  profile: LenderProfile;
}

export interface ContractSpec {
  key: string;
  company: string; // clave en ctx.companies
  borrowers: string[]; // claves en ctx.borrowers; el primero es el principal
  status: ContractStatus;
  structure: LoanStructure;
  principal: string;
  rate: string;
  /** Cantidad de cuotas del calendario (maturity = first + rows - 1 meses). */
  rows: number;
  /** Mes (relativo al actual) de la primera cuota. */
  firstOffset: number;
  lateFee?: { type: "FLAT" | "PERCENTAGE"; amount: string };
  insurance?: string;
  fees?: boolean;
  /** Qué hacer con los términos/pagos — lo interpretan contracts.ts y payments.ts. */
  plan?: "current" | "delinquent" | "payoff";
  /** Cuántas cuotas se pagaron antes de la mora / del payoff. */
  paidRows?: number;
  /** PENDING_ACCEPTANCE: v1 rechazada (queda SUPERSEDED) y v2 enviada. */
  resubmitted?: boolean;
  /** PENDING_ACCEPTANCE: cuántos co-deudores ya aceptaron. */
  acceptedBy?: number;
  /** DRAFT sin co-deudores todavía. */
  noBorrowers?: boolean;
  loanRequestId?: string;
  originationSource?: "DIRECT" | "MARKETPLACE" | "PRIVATE_INVITE";
  propertyId?: string;
  createdAt?: Date;
}

export interface ContractEntry {
  spec: ContractSpec;
  contract: Contract;
  terms: ContractTerms; // versión vigente
  rows: ScheduledPayment[];
}

export interface Ctx {
  password: string;
  admin: User;
  admin2fa: User;
  users: Record<string, User>;
  lenders: Record<string, LenderEntry>;
  companies: Record<string, LenderCompany>;
  borrowers: Record<string, { user: User; profile: BorrowerProfile }>;
  bookkeepers: Record<string, { user: User; profile: BookkeeperProfile }>;
  insurance: Record<string, InsuranceCompanyProfile>;
  paymentMethods: Record<string, PaymentMethod[]>; // por clave de borrower
  loanRequests: LoanRequest[];
  quotes: LoanQuote[];
  contracts: ContractEntry[];
  propertyCount: number;
  contractCount: number;
}

export const ownerOf = (ctx: Ctx, companyKey: string): User => {
  const company = ctx.companies[companyKey];
  const entry = Object.values(ctx.lenders).find((l) => l.profile.id === company.lenderProfileId);
  if (!entry) throw new Error(`Sin dueño para la empresa ${companyKey}`);
  return entry.user;
};

/** Crea el vínculo Lender↔Borrower solo si no existe todavía. */
export async function ensureLink(ctx: Ctx, companyKey: string, borrowerKey: string, notes?: string) {
  const lenderCompanyId = ctx.companies[companyKey].id;
  const borrowerProfileId = ctx.borrowers[borrowerKey].profile.id;
  const existing = await prisma.lenderBorrower.findUnique({ where: { lenderCompanyId_borrowerProfileId: { lenderCompanyId, borrowerProfileId } } });
  if (existing) return existing;
  return prisma.lenderBorrower.create({ data: { lenderCompanyId, borrowerProfileId, invitedByUserId: ownerOf(ctx, companyKey).id, notes } });
}

const STREETS = ["Evergreen Terrace", "Riverside Dr", "Barton Skyway", "Oak Hollow Ln", "Pecan St", "Mesa Verde Ct", "Lamar Blvd", "Bluebonnet Way", "Cedar Park Rd", "Zilker Loop", "Burnet Rd", "Manor Rd"];
const CITIES: [string, string, string][] = [["Austin", "TX", "787"], ["Round Rock", "TX", "786"], ["San Antonio", "TX", "782"], ["Dallas", "TX", "752"], ["Houston", "TX", "770"], ["Fort Worth", "TX", "761"]];
const TYPES = ["SINGLE_FAMILY", "MULTI_FAMILY", "CONDO", "TOWNHOUSE", "LAND", "COMMERCIAL", "OTHER"] as const;

/** Property de ejemplo; cicla los 7 PropertyType y llena valuación en las impares. */
export async function createProperty(ctx: Ctx, createdByUserId: string, lenderCompanyId: string | null) {
  const i = ctx.propertyCount++;
  const [city, state, zip] = CITIES[i % CITIES.length];
  const rich = i % 2 === 1;
  return prisma.property.create({
    data: {
      addressLine1: `${100 + i * 17} ${STREETS[i % STREETS.length]}`,
      city,
      state,
      postalCode: `${zip}${String(i % 10)}${String((i * 3) % 10)}`.slice(0, 5),
      county: rich ? "Travis" : null,
      propertyType: TYPES[i % TYPES.length],
      bedrooms: rich ? 2 + (i % 3) : null,
      bathrooms: rich ? "2.0" : null,
      squareFootage: rich ? 900 + i * 40 : null,
      yearBuilt: rich ? 1980 + i : null,
      conditionScale: rich ? i % 6 : null,
      estimatedRepairCost: rich ? "15000.00" : null,
      estimatedMarketValue: rich ? (300_000 + i * 5_000).toFixed(2) : null,
      afterRepairValue: rich ? (340_000 + i * 5_000).toFixed(2) : null,
      annualPropertyTax: rich ? "6200.00" : null,
      annualInsuranceEstimate: rich ? "1450.00" : null,
      createdByUserId,
      lenderCompanyId,
    },
  });
}

export const audit = (input: LogAuditEventInput) =>
  logAuditEvent({ ...input, metadata: { ...((input.metadata as object) ?? {}), seed: true } as Prisma.InputJsonValue });
