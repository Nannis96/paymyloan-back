import type { LoanQuote } from "@prisma/client";
import { prisma } from "@/db/prisma";
import { AppError } from "@/errors/AppError";
import { logAuditEvent } from "@/lib/audit";
import { sendEmail } from "@/lib/email";
import { addMonths } from "@/services/amortization.service";
import { createContractFromLoanQuote } from "@/services/contracts.service";
import type { ContractTermsInput } from "@/validations/contracts.validation";
import type { SubmitLoanQuoteInput } from "@/validations/loanQuotes.validation";

// D-P6-1/D-P4-1: mismo patrón de resolución multi-empresa ya usado en
// contracts.service.ts, duplicado acá a propósito (convención del repo,
// ver requireOwnedLenderCompanies en cada servicio que lo necesita).
async function requireOwnedLenderCompanies(userId: string): Promise<{ id: string }[]> {
  const profile = await prisma.lenderProfile.findUnique({
    where: { userId },
    include: { lenderCompanies: { where: { deletedAt: null }, select: { id: true } } },
  });
  if (!profile || profile.deletedAt) {
    throw new AppError("Lender profile not found", 404, "LENDER_NOT_FOUND");
  }
  return profile.lenderCompanies;
}

async function resolveTargetLenderCompanyId(userId: string, requestedId: string | undefined): Promise<string> {
  const companies = await requireOwnedLenderCompanies(userId);
  if (companies.length === 0) {
    throw new AppError("You don't have any company registered yet", 409, "NO_LENDER_COMPANY");
  }
  if (requestedId) {
    const match = companies.find((company) => company.id === requestedId);
    if (!match) {
      throw new AppError("Company not found", 404, "NOT_FOUND");
    }
    return match.id;
  }
  if (companies.length === 1) {
    return companies[0].id;
  }
  throw new AppError("You have more than one company — specify lenderCompanyId", 400, "LENDER_COMPANY_REQUIRED");
}

// D-S2-22 (regla 22 de 04 §4.7): visible/cotizable si PUBLIC, o si esta
// LenderCompany está en LoanRequestLenderTarget — LoanRequestInvite
// (contraparte sin cuenta) queda fuera de este alcance.
async function requireQuotableLoanRequest(lenderCompanyId: string, loanRequestId: string) {
  const loanRequest = await prisma.loanRequest.findUnique({ where: { id: loanRequestId } });
  if (!loanRequest || loanRequest.status !== "PUBLISHED") {
    throw new AppError("Loan request not found", 404, "NOT_FOUND");
  }
  if (loanRequest.visibility === "PRIVATE") {
    const target = await prisma.loanRequestLenderTarget.findUnique({
      where: { loanRequestId_lenderCompanyId: { loanRequestId, lenderCompanyId } },
    });
    if (!target || target.removedAt) {
      throw new AppError("Loan request not found", 404, "NOT_FOUND");
    }
  }
  return loanRequest;
}

// PB-026. Crea o reemplaza (mientras siga SUBMITTED) la cotización propia —
// nunca una segunda fila, @@unique([loanRequestId, lenderCompanyId]).
export async function submitQuote(userId: string, loanRequestId: string, input: SubmitLoanQuoteInput): Promise<LoanQuote> {
  const lenderCompanyId = await resolveTargetLenderCompanyId(userId, input.lenderCompanyId);
  await requireQuotableLoanRequest(lenderCompanyId, loanRequestId);

  const existing = await prisma.loanQuote.findUnique({
    where: { loanRequestId_lenderCompanyId: { loanRequestId, lenderCompanyId } },
  });
  if (existing && (existing.status === "SELECTED" || existing.status === "DECLINED")) {
    throw new AppError("This loan request is no longer accepting quotes", 409, "LOAN_REQUEST_ALREADY_MATCHED");
  }

  const data = {
    structure: input.structure,
    principalAmount: input.principalAmount,
    interestRate: input.interestRate,
    amortizationTermMonths: input.amortizationTermMonths,
    estimatedClosingCostsAmount: input.estimatedClosingCostsAmount,
    message: input.message,
    expiresAt: input.expiresAt,
    status: "SUBMITTED" as const,
  };

  const quote = existing
    ? await prisma.loanQuote.update({
        where: { loanRequestId_lenderCompanyId: { loanRequestId, lenderCompanyId } },
        data: { ...data, submittedByUserId: userId },
      })
    : await prisma.loanQuote.create({ data: { ...data, loanRequestId, lenderCompanyId, submittedByUserId: userId } });

  await logAuditEvent({ action: "LOAN_QUOTE_SUBMITTED", entityType: "LoanQuote", entityId: quote.id, actorUserId: userId, lenderCompanyId });
  return quote;
}

export async function withdrawQuote(userId: string, loanRequestId: string): Promise<void> {
  const companies = await requireOwnedLenderCompanies(userId);
  const companyIds = companies.map((company) => company.id);

  const quote = await prisma.loanQuote.findFirst({
    where: { loanRequestId, lenderCompanyId: { in: companyIds }, status: "SUBMITTED" },
  });
  if (!quote) {
    throw new AppError("Quote not found", 404, "NOT_FOUND");
  }

  await prisma.loanQuote.update({ where: { id: quote.id }, data: { status: "WITHDRAWN" } });
  await logAuditEvent({ action: "LOAN_QUOTE_WITHDRAWN", entityType: "LoanQuote", entityId: quote.id, actorUserId: userId, lenderCompanyId: quote.lenderCompanyId });
}

async function requireOwnLoanRequestForBorrower(userId: string, loanRequestId: string) {
  const borrowerProfile = await prisma.borrowerProfile.findUnique({ where: { userId } });
  if (!borrowerProfile) {
    throw new AppError("Loan request not found", 404, "NOT_FOUND");
  }
  const loanRequest = await prisma.loanRequest.findUnique({ where: { id: loanRequestId } });
  if (!loanRequest || loanRequest.borrowerProfileId !== borrowerProfile.id) {
    throw new AppError("Loan request not found", 404, "NOT_FOUND");
  }
  return loanRequest;
}

export async function listReceivedQuotes(userId: string, loanRequestId: string): Promise<LoanQuote[]> {
  await requireOwnLoanRequestForBorrower(userId, loanRequestId);
  return prisma.loanQuote.findMany({
    where: { loanRequestId },
    include: { lenderCompany: { select: { id: true, companyName: true } } },
    orderBy: { createdAt: "asc" },
  });
}

// D-S2-21: pre-llena ContractTerms desde la cotización — structure/
// principal/rate/plazo vienen de la LoanQuote; firstPaymentDate/maturityDate/
// lateFee no tienen equivalente en LoanQuote (el Prestamista los define recién
// al cotizar en detalle vía PATCH, D-S2-1 sigue tratando esto como punto de
// partida editable, no una oferta final). Defaults razonables: primer pago un
// mes después del cierre solicitado, mora FLAT $50/10 días de gracia.
function deriveContractTermsFromQuote(quote: LoanQuote, requestedClosingDate: Date): ContractTermsInput {
  const firstPaymentDate = addMonths(requestedClosingDate, 1);
  const maturityDate = addMonths(firstPaymentDate, quote.amortizationTermMonths - 1);
  return {
    structure: quote.structure,
    principalAmount: quote.principalAmount.toNumber(),
    interestRate: quote.interestRate.toNumber(),
    dayCountConvention: "THIRTY_360",
    amortizationTermMonths: quote.amortizationTermMonths,
    firstPaymentDate,
    paymentDueDay: firstPaymentDate.getUTCDate(),
    maturityDate,
    lateFeeType: "FLAT",
    lateFeeAmount: 50,
    gracePeriodDays: 10,
  };
}

// PB-017 (reescrito, D-S2-21). El Deudor elige una cotización: la marca
// SELECTED, declina el resto (regla 21 de 04 §4.7), backfillea
// Property.lenderCompanyId (D-S2-25), marca LoanRequest MATCHED, y crea el
// Contract vía BE-051 (contracts.service.ts#createContractFromLoanQuote).
// La verificación de status dentro del mismo updateMany decide la carrera
// si dos selecciones llegaran casi simultáneas (no debería poder pasar —
// solo el propio Deudor puede seleccionar — pero cubre un doble-click).
export async function selectQuote(userId: string, loanRequestId: string, quoteId: string): Promise<{ contractId: string }> {
  const loanRequest = await requireOwnLoanRequestForBorrower(userId, loanRequestId);
  if (loanRequest.status !== "PUBLISHED") {
    throw new AppError("This loan request is not open for selection", 409, "LOAN_REQUEST_NOT_PUBLISHED");
  }

  const quote = await prisma.loanQuote.findUnique({ where: { id: quoteId } });
  if (!quote || quote.loanRequestId !== loanRequestId) {
    throw new AppError("Quote not found", 404, "NOT_FOUND");
  }
  if (quote.status !== "SUBMITTED") {
    throw new AppError("This quote is no longer available", 409, "QUOTE_NOT_SUBMITTED");
  }

  const terms = deriveContractTermsFromQuote(quote, loanRequest.requestedClosingDate);

  const { contractId, lenderBorrowerId, lenderBorrowerCreated } = await prisma.$transaction(async (tx) => {
    const claimed = await tx.loanQuote.updateMany({ where: { id: quoteId, status: "SUBMITTED" }, data: { status: "SELECTED" } });
    if (claimed.count === 0) {
      throw new AppError("This quote is no longer available", 409, "QUOTE_NOT_SUBMITTED");
    }

    await tx.loanQuote.updateMany({
      where: { loanRequestId, status: "SUBMITTED", id: { not: quoteId } },
      data: { status: "DECLINED" },
    });

    await tx.property.update({ where: { id: loanRequest.propertyId }, data: { lenderCompanyId: quote.lenderCompanyId } });
    await tx.loanRequest.update({
      where: { id: loanRequestId },
      data: { status: "MATCHED", matchedLenderCompanyId: quote.lenderCompanyId, matchedAt: new Date() },
    });

    // D-P5-3: única forma de crear un LenderBorrower nuevo desde que BE-045
    // quedó deshabilitado (D-P5-1) — ver el comentario en
    // contracts.service.ts#createContractFromLoanQuote.
    return createContractFromLoanQuote(tx, {
      loanRequestId,
      propertyId: loanRequest.propertyId,
      lenderCompanyId: quote.lenderCompanyId,
      borrowerProfileId: loanRequest.borrowerProfileId,
      createdByUserId: userId,
      invitedByUserId: quote.submittedByUserId,
      terms,
    });
  });

  await logAuditEvent({
    action: "LOAN_QUOTE_SELECTED",
    entityType: "LoanQuote",
    entityId: quoteId,
    actorUserId: userId,
    lenderCompanyId: quote.lenderCompanyId,
    contractId,
  });
  await logAuditEvent({
    action: "CONTRACT_CREATED",
    entityType: "Contract",
    entityId: contractId,
    actorUserId: userId,
    lenderCompanyId: quote.lenderCompanyId,
    contractId,
  });
  if (lenderBorrowerCreated) {
    await logAuditEvent({
      action: "BORROWER_LINKED_TO_LENDER",
      entityType: "LenderBorrower",
      entityId: lenderBorrowerId,
      actorUserId: userId,
      lenderCompanyId: quote.lenderCompanyId,
      contractId,
    });
  }

  const [contract, lenderUser] = await Promise.all([
    prisma.contract.findUniqueOrThrow({ where: { id: contractId }, select: { contractNumber: true } }),
    prisma.user.findUnique({ where: { id: quote.submittedByUserId }, select: { email: true } }),
  ]);
  if (lenderUser) {
    await sendEmail({
      to: lenderUser.email,
      subject: "Your quote was selected",
      template: "loan-quote-selected",
      data: { contractNumber: contract.contractNumber },
    });
  }

  return { contractId };
}
