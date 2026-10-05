import { Prisma } from "@prisma/client";
import { prisma } from "@/db/prisma";
import { addMonths, generateAmortizationSchedule } from "@/services/amortization.service";
import { addDays, audit, createProperty, ensureLink, monthStart, ownerOf, type ContractEntry, type ContractSpec, type Ctx } from "./ctx";

// Contract (6 estados × 3), ContractTerms (5 estados × 3), ContractTermsAcceptance
// (ACCEPTED/REJECTED), ContractBorrower, ContractFeeItem y calendario
// (ScheduledPayment) generado con el mismo servicio que usa la API.

const D = Prisma.Decimal;
const SCHEDULED = ["ACTIVE", "DELINQUENT", "PAID_OFF"];

export async function buildContract(ctx: Ctx, spec: ContractSpec): Promise<ContractEntry> {
  const company = ctx.companies[spec.company];
  const owner = ownerOf(ctx, spec.company);
  if (!spec.noBorrowers) for (const b of spec.borrowers) await ensureLink(ctx, spec.company, b);
  const profileIds = spec.noBorrowers ? [] : spec.borrowers.map((b) => ctx.borrowers[b].profile.id);

  const propertyId = spec.propertyId ?? (await createProperty(ctx, owner.id, company.id)).id;
  const first = monthStart(spec.firstOffset);
  const scheduled = SCHEDULED.includes(spec.status);
  const contractNumber = `PML-${new Date().getUTCFullYear()}-${String(++ctx.contractCount).padStart(6, "0")}`;

  const contract = await prisma.contract.create({
    data: {
      lenderCompanyId: company.id,
      propertyId,
      insuranceCompanyId: spec.insurance ? ctx.insurance[spec.insurance].id : null,
      contractNumber,
      status: spec.status,
      originationSource: spec.originationSource ?? "DIRECT",
      loanRequestId: spec.loanRequestId,
      createdByUserId: owner.id,
      activatedAt: scheduled ? addMonths(first, -1) : null,
      cancelledAt: spec.status === "CANCELLED" ? addDays(new Date(), -7) : null,
    },
  });

  const termsBase = (versionNumber: number, rate: string, status: Prisma.ContractTermsUncheckedCreateInput["status"], supersedesId?: string) => ({
    contractId: contract.id,
    versionNumber,
    structure: spec.structure,
    principalAmount: spec.principal,
    interestRate: rate,
    dayCountConvention: spec.structure === "BALLOON" ? ("ACTUAL_365" as const) : ("THIRTY_360" as const),
    amortizationTermMonths: spec.structure === "AMORTIZED" ? spec.rows : 360,
    firstPaymentDate: first,
    paymentDueDay: 1,
    maturityDate: addMonths(first, spec.rows - 1),
    lateFeeType: spec.lateFee?.type ?? "FLAT",
    lateFeeAmount: spec.lateFee?.amount ?? "75.00",
    prePayPenaltyType: spec.structure === "BALLOON" ? ("PERCENTAGE" as const) : null,
    prePayPenaltyAmount: spec.structure === "BALLOON" ? "2.00" : null,
    status,
    supersedesId,
    changeSummary: supersedesId ? "Tasa reducida tras el rechazo de la versión anterior." : null,
    createdByUserId: owner.id,
  });

  const decide = (termsId: string, borrowerProfileId: string, decision: "ACCEPTED" | "REJECTED", comment?: string) =>
    prisma.contractTermsAcceptance.create({
      data: { contractTermsId: termsId, borrowerProfileId, decision, decidedAt: addDays(new Date(), -10), ipAddress: "127.0.0.1", userAgent: "Mozilla/5.0 (seed)", comment },
    });

  let terms;
  if (spec.resubmitted) {
    const v1 = await prisma.contractTerms.create({ data: termsBase(1, "12.500", "REJECTED") });
    await decide(v1.id, profileIds[0], "REJECTED", "La tasa es demasiado alta.");
    terms = await prisma.contractTerms.create({ data: termsBase(2, spec.rate, "PENDING_ACCEPTANCE", v1.id) });
    await prisma.contractTerms.update({ where: { id: v1.id }, data: { status: "SUPERSEDED" } });
    for (const id of profileIds.slice(0, spec.acceptedBy ?? 0)) await decide(terms.id, id, "ACCEPTED");
  } else {
    const status = spec.status === "DRAFT" ? "DRAFT" : spec.status === "PENDING_ACCEPTANCE" ? "PENDING_ACCEPTANCE" : spec.status === "CANCELLED" ? "REJECTED" : "ACCEPTED";
    terms = await prisma.contractTerms.create({ data: termsBase(1, spec.rate, status) });
    if (status === "ACCEPTED") for (const id of profileIds) await decide(terms.id, id, "ACCEPTED");
    if (status === "REJECTED") await decide(terms.id, profileIds[0], "REJECTED", "No puedo cumplir con estas condiciones.");
    if (status === "PENDING_ACCEPTANCE") for (const id of profileIds.slice(0, spec.acceptedBy ?? 0)) await decide(terms.id, id, "ACCEPTED");
  }

  await prisma.contract.update({ where: { id: contract.id }, data: { currentTermsId: terms.id } });
  for (const [i, borrowerProfileId] of profileIds.entries()) {
    await prisma.contractBorrower.create({ data: { contractId: contract.id, borrowerProfileId, isPrimary: i === 0, addedByUserId: owner.id } });
  }

  const feeItems: Prisma.ContractFeeItemUncheckedCreateInput[] = [];
  const principal = new D(spec.principal);
  const fee = (category: "LENDER" | "PLATFORM", code: Prisma.ContractFeeItemUncheckedCreateInput["code"], label: string, amountType: "FLAT" | "PERCENTAGE", value: string) =>
    feeItems.push({
      contractTermsId: terms.id, category, code, label, amountType, amountValue: value,
      computedAmount: amountType === "FLAT" ? value : principal.times(value).div(100).toDecimalPlaces(2).toString(),
    });
  if (spec.fees) {
    fee("LENDER", "ORIGINATION_POINTS", "Origination points", "PERCENTAGE", "2.00");
    fee("LENDER", "PROCESSING", "Processing fee", "FLAT", "495.00");
    fee("LENDER", "UNDERWRITING", "Underwriting fee", "FLAT", "750.00");
    fee("LENDER", "DOC_PREP", "Document preparation", "FLAT", "250.00");
    fee("LENDER", "CUSTOM", "Property inspection", "FLAT", "300.00");
  }
  if (spec.loanRequestId) fee("PLATFORM", "MARKETPLACE_CONNECTION", "Marketplace connection fee", "PERCENTAGE", "0.50");
  if (feeItems.length) await prisma.contractFeeItem.createMany({ data: feeItems });

  if (scheduled) await prisma.$transaction((tx) => generateAmortizationSchedule(tx, terms.id));

  const common = { entityType: "Contract", entityId: contract.id, lenderCompanyId: company.id, contractId: contract.id };
  await audit({ ...common, action: "CONTRACT_CREATED", actorUserId: owner.id });
  if (spec.status !== "DRAFT") await audit({ ...common, action: "CONTRACT_TERMS_SUBMITTED", actorUserId: owner.id });
  if (scheduled) await audit({ ...common, action: "CONTRACT_ACTIVATED", actorUserId: owner.id });
  if (spec.status === "DELINQUENT") await audit({ ...common, action: "CONTRACT_MARKED_DELINQUENT", systemActorLabel: "delinquency-job" });
  if (spec.status === "CANCELLED") {
    await audit({ ...common, action: "CONTRACT_TERMS_REJECTED", actorUserId: ctx.borrowers[spec.borrowers[0]].user.id });
    await audit({ ...common, action: "CONTRACT_CANCELLED", actorUserId: owner.id });
  }

  const entry: ContractEntry = {
    spec,
    contract: await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } }),
    terms: await prisma.contractTerms.findUniqueOrThrow({ where: { id: terms.id } }),
    rows: await prisma.scheduledPayment.findMany({ where: { contractId: contract.id }, orderBy: { sequenceNumber: "asc" } }),
  };
  ctx.contracts.push(entry);
  return entry;
}

const keyOf = <T>(map: Record<string, T>, id: string, pick: (v: T) => string = (v) => (v as { id: string }).id) =>
  Object.keys(map).find((k) => pick(map[k]) === id)!;

export async function seedContracts(ctx: Ctx) {
  const direct: ContractSpec[] = [
    // DRAFT ×3 — terms DRAFT, sin calendario
    { key: "draft1", company: "A", borrowers: ["borrower1"], status: "DRAFT", structure: "AMORTIZED", principal: "250000.00", rate: "9.500", rows: 36, firstOffset: 1 },
    { key: "draft2", company: "C", borrowers: ["borrower4"], status: "DRAFT", structure: "INTEREST_ONLY", principal: "150000.00", rate: "10.500", rows: 12, firstOffset: 1, fees: true, insurance: "insurance1" },
    { key: "draft3", company: "B", borrowers: [], noBorrowers: true, status: "DRAFT", structure: "BALLOON", principal: "320000.00", rate: "11.000", rows: 24, firstOffset: 2 },
    // PENDING_ACCEPTANCE ×3 — sin aceptar / quórum parcial con co-deudores / renegociado (v1 SUPERSEDED)
    { key: "pend1", company: "A", borrowers: ["borrower3"], status: "PENDING_ACCEPTANCE", structure: "AMORTIZED", principal: "220000.00", rate: "9.250", rows: 36, firstOffset: 1, resubmitted: true },
    { key: "pend2", company: "C", borrowers: ["borrower2", "borrower3"], status: "PENDING_ACCEPTANCE", structure: "BALLOON", principal: "410000.00", rate: "10.750", rows: 24, firstOffset: 1, acceptedBy: 1, resubmitted: true, fees: true, insurance: "insurance2" },
    { key: "pend3", company: "D", borrowers: ["borrower4"], status: "PENDING_ACCEPTANCE", structure: "INTEREST_ONLY", principal: "175000.00", rate: "10.000", rows: 12, firstOffset: 1, resubmitted: true },
    // ACTIVE ×3 (+3 de marketplace) — todas las cuotas vencidas, pagadas
    { key: "active1", company: "A", borrowers: ["borrower1"], status: "ACTIVE", structure: "AMORTIZED", principal: "250000.00", rate: "9.500", rows: 36, firstOffset: -4, plan: "current", fees: true, insurance: "insurance1" },
    { key: "active2", company: "C", borrowers: ["borrower2"], status: "ACTIVE", structure: "INTEREST_ONLY", principal: "180000.00", rate: "10.000", rows: 12, firstOffset: -2, plan: "current", lateFee: { type: "PERCENTAGE", amount: "5.00" }, fees: true, insurance: "insurance1" },
    { key: "active3", company: "D", borrowers: ["borrower4", "borrower5"], status: "ACTIVE", structure: "BALLOON", principal: "400000.00", rate: "11.000", rows: 24, firstOffset: -6, plan: "current", insurance: "insurance2" },
    // DELINQUENT ×3 — cuotas vencidas sin pagar, mora aplicada
    { key: "delinq1", company: "A", borrowers: ["borrower3"], status: "DELINQUENT", structure: "AMORTIZED", principal: "180000.00", rate: "8.750", rows: 24, firstOffset: -5, plan: "delinquent", paidRows: 2 },
    { key: "delinq2", company: "C", borrowers: ["borrower4"], status: "DELINQUENT", structure: "INTEREST_ONLY", principal: "300000.00", rate: "12.000", rows: 12, firstOffset: -3, plan: "delinquent", paidRows: 1, lateFee: { type: "PERCENTAGE", amount: "5.00" } },
    { key: "delinq3", company: "D", borrowers: ["borrower6"], status: "DELINQUENT", structure: "AMORTIZED", principal: "95000.00", rate: "10.000", rows: 12, firstOffset: -4, plan: "delinquent", paidRows: 1 },
    // PAID_OFF ×3 — payoff anticipado, cuotas restantes VOIDED
    { key: "paid1", company: "A", borrowers: ["borrower1"], status: "PAID_OFF", structure: "AMORTIZED", principal: "60000.00", rate: "9.000", rows: 12, firstOffset: -8, plan: "payoff", paidRows: 5 },
    { key: "paid2", company: "C", borrowers: ["borrower2"], status: "PAID_OFF", structure: "INTEREST_ONLY", principal: "120000.00", rate: "9.500", rows: 12, firstOffset: -10, plan: "payoff", paidRows: 5 },
    { key: "paid3", company: "D", borrowers: ["borrower5"], status: "PAID_OFF", structure: "BALLOON", principal: "200000.00", rate: "10.000", rows: 24, firstOffset: -14, plan: "payoff", paidRows: 6 },
    // CANCELLED ×3 — el Deudor rechazó los términos (terms REJECTED)
    { key: "canc1", company: "A", borrowers: ["borrower5"], status: "CANCELLED", structure: "AMORTIZED", principal: "140000.00", rate: "9.900", rows: 24, firstOffset: 1 },
    { key: "canc2", company: "C", borrowers: ["borrower3"], status: "CANCELLED", structure: "INTEREST_ONLY", principal: "260000.00", rate: "11.250", rows: 12, firstOffset: 1 },
    { key: "canc3", company: "D", borrowers: ["borrower4"], status: "CANCELLED", structure: "BALLOON", principal: "380000.00", rate: "11.500", rows: 24, firstOffset: 2 },
  ];
  for (const spec of direct) await buildContract(ctx, spec);

  // Contratos originados en el marketplace: una LoanRequest CONVERTED por cada uno.
  for (const lr of ctx.loanRequests.filter((r) => r.status === "CONVERTED")) {
    const quote = ctx.quotes.find((q) => q.loanRequestId === lr.id && q.status === "SELECTED")!;
    const structure = quote.structure;
    await buildContract(ctx, {
      key: `mkt-${lr.id.slice(0, 8)}`,
      company: keyOf(ctx.companies, quote.lenderCompanyId),
      borrowers: [keyOf(ctx.borrowers, lr.borrowerProfileId, (v) => v.profile.id)],
      status: "ACTIVE",
      structure,
      principal: quote.principalAmount.toString(),
      rate: quote.interestRate.toString(),
      rows: structure === "AMORTIZED" ? quote.amortizationTermMonths : 12,
      firstOffset: -2,
      plan: "current",
      propertyId: lr.propertyId,
      loanRequestId: lr.id,
      originationSource: lr.visibility === "PRIVATE" ? "PRIVATE_INVITE" : "MARKETPLACE",
    });
  }
}
