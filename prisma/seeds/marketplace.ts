import type { LoanQuoteStatus, LoanRequestStatus, LoanRequestVisibility, LoanStructure, ProjectType } from "@prisma/client";
import { prisma } from "@/db/prisma";
import { audit, createProperty, daysFromNow, ownerOf, type Ctx } from "./ctx";

// LoanRequest (6 estados × 3), LoanQuote (5 estados × 3), LoanRequestLenderTarget.
// Las CONVERTED quedan enlazadas a un Contract en contracts.ts (seedContracts).

type Q = [company: string, status: LoanQuoteStatus, structure?: LoanStructure];
interface Req {
  status: LoanRequestStatus;
  visibility: LoanRequestVisibility;
  borrower: string;
  type: ProjectType;
  quotes?: Q[];
  targets?: string[];
  removedTarget?: boolean;
}

const REQUESTS: Req[] = [
  // DRAFT ×3 — sin publicar, sin cotizaciones
  { status: "DRAFT", visibility: "PUBLIC", borrower: "borrower1", type: "RENTAL" },
  { status: "DRAFT", visibility: "PRIVATE", borrower: "borrower2", type: "FIX_AND_FLIP", targets: ["C"] },
  { status: "DRAFT", visibility: "PUBLIC", borrower: "borrower3", type: "SLOW_FLIP" },
  // PUBLISHED ×3 — cotizaciones SUBMITTED esperando decisión
  { status: "PUBLISHED", visibility: "PUBLIC", borrower: "borrower1", type: "FIX_AND_FLIP", quotes: [["A", "SUBMITTED", "AMORTIZED"], ["C", "SUBMITTED", "INTEREST_ONLY"]] },
  { status: "PUBLISHED", visibility: "PRIVATE", borrower: "borrower4", type: "RENTAL", targets: ["A", "D"], quotes: [["A", "SUBMITTED", "BALLOON"], ["D", "SUBMITTED", "AMORTIZED"]] },
  { status: "PUBLISHED", visibility: "PUBLIC", borrower: "borrower5", type: "COMMERCIAL", quotes: [["D", "SUBMITTED", "INTEREST_ONLY"], ["A", "SUBMITTED", "AMORTIZED"]] },
  // MATCHED ×3 — una SELECTED, la otra DECLINED
  { status: "MATCHED", visibility: "PUBLIC", borrower: "borrower2", type: "RENTAL", quotes: [["C", "SELECTED", "AMORTIZED"], ["A", "DECLINED", "AMORTIZED"]] },
  { status: "MATCHED", visibility: "PRIVATE", borrower: "borrower3", type: "NEW_CONSTRUCTION", targets: ["C"], quotes: [["C", "SELECTED", "BALLOON"], ["D", "DECLINED", "INTEREST_ONLY"]] },
  { status: "MATCHED", visibility: "PUBLIC", borrower: "borrower6", type: "SLOW_FLIP", quotes: [["D", "SELECTED", "INTEREST_ONLY"], ["C", "DECLINED", "AMORTIZED"]] },
  // WITHDRAWN ×3 — el Deudor retiró; las cotizaciones quedan WITHDRAWN
  { status: "WITHDRAWN", visibility: "PUBLIC", borrower: "borrower4", type: "RENTAL", quotes: [["A", "WITHDRAWN", "AMORTIZED"]] },
  { status: "WITHDRAWN", visibility: "PRIVATE", borrower: "borrower5", type: "COMMERCIAL", targets: ["A"], removedTarget: true, quotes: [["C", "WITHDRAWN", "INTEREST_ONLY"]] },
  { status: "WITHDRAWN", visibility: "PUBLIC", borrower: "borrower1", type: "FIX_AND_FLIP", quotes: [["D", "WITHDRAWN", "BALLOON"]] },
  // EXPIRED ×3 — venció sin elegir; cotizaciones EXPIRED
  { status: "EXPIRED", visibility: "PUBLIC", borrower: "borrower2", type: "RENTAL", quotes: [["A", "EXPIRED", "AMORTIZED"]] },
  { status: "EXPIRED", visibility: "PUBLIC", borrower: "borrower3", type: "SLOW_FLIP", quotes: [["C", "EXPIRED", "INTEREST_ONLY"]] },
  { status: "EXPIRED", visibility: "PUBLIC", borrower: "borrower6", type: "NEW_CONSTRUCTION", quotes: [["D", "EXPIRED", "BALLOON"]] },
  // CONVERTED ×3 — cotización SELECTED y Contract ACTIVE (ver contracts.ts)
  { status: "CONVERTED", visibility: "PUBLIC", borrower: "borrower1", type: "RENTAL", quotes: [["A", "SELECTED", "AMORTIZED"]] },
  { status: "CONVERTED", visibility: "PRIVATE", borrower: "borrower2", type: "FIX_AND_FLIP", targets: ["C"], quotes: [["C", "SELECTED", "INTEREST_ONLY"]] },
  { status: "CONVERTED", visibility: "PUBLIC", borrower: "borrower5", type: "SLOW_FLIP", quotes: [["D", "SELECTED", "AMORTIZED"]] },
];

export async function seedMarketplace(ctx: Ctx) {
  for (const [i, r] of REQUESTS.entries()) {
    const b = ctx.borrowers[r.borrower];
    const winner = r.quotes?.find(([, s]) => s === "SELECTED")?.[0];
    const purchasePrice = 200_000 + i * 15_000;
    const rehab = 20_000 + i * 2_000;
    const property = await createProperty(ctx, b.user.id, winner ? ctx.companies[winner].id : null);
    const matched = r.status === "MATCHED" || r.status === "CONVERTED";

    const lr = await prisma.loanRequest.create({
      data: {
        borrowerProfileId: b.profile.id,
        propertyId: property.id,
        projectType: r.type,
        purchasePrice: purchasePrice.toFixed(2),
        rehabAmount: rehab.toFixed(2),
        totalLoanAmountRequested: ((purchasePrice + rehab) * 0.8).toFixed(2),
        requestedClosingDate: daysFromNow(30 + i),
        requestedTimelineNotes: i % 2 ? "Cierre rápido deseado." : null,
        visibility: r.visibility,
        status: r.status,
        matchedLenderCompanyId: matched && winner ? ctx.companies[winner].id : null,
        matchedAt: matched ? daysFromNow(-12) : null,
        convertedAt: r.status === "CONVERTED" ? daysFromNow(-10) : null,
        withdrawnAt: r.status === "WITHDRAWN" ? daysFromNow(-6) : null,
        expiresAt: r.status === "EXPIRED" ? daysFromNow(-3) : r.status === "PUBLISHED" ? daysFromNow(14) : null,
      },
    });
    ctx.loanRequests.push(lr);
    const common = { entityType: "LoanRequest", entityId: lr.id, actorUserId: b.user.id };
    await audit({ ...common, action: "LOAN_REQUEST_CREATED" });
    if (r.status !== "DRAFT") await audit({ ...common, action: "LOAN_REQUEST_PUBLISHED" });
    if (r.status === "WITHDRAWN") await audit({ ...common, action: "LOAN_REQUEST_WITHDRAWN" });

    for (const co of r.targets ?? []) {
      await prisma.loanRequestLenderTarget.create({
        data: { loanRequestId: lr.id, lenderCompanyId: ctx.companies[co].id, invitedByUserId: b.user.id, removedAt: r.removedTarget ? daysFromNow(-8) : null },
      });
      await audit({ ...common, action: "LOAN_REQUEST_TARGET_ADDED", metadata: { lenderCompanyId: ctx.companies[co].id } });
    }

    for (const [co, status, structure = "AMORTIZED"] of r.quotes ?? []) {
      const principal = (purchasePrice + rehab) * 0.8;
      const quote = await prisma.loanQuote.create({
        data: {
          loanRequestId: lr.id,
          lenderCompanyId: ctx.companies[co].id,
          structure,
          principalAmount: principal.toFixed(2),
          interestRate: (9 + (i % 4) * 0.75).toFixed(3),
          amortizationTermMonths: structure === "AMORTIZED" ? 24 : 360,
          estimatedClosingCostsAmount: "4500.00",
          message: "Podemos cerrar en 3 semanas con documentación completa.",
          status,
          expiresAt: status === "EXPIRED" ? daysFromNow(-4) : daysFromNow(10),
          submittedByUserId: ownerOf(ctx, co).id,
        },
      });
      ctx.quotes.push(quote);
      const qc = { entityType: "LoanQuote", entityId: quote.id, lenderCompanyId: ctx.companies[co].id };
      await audit({ ...qc, action: "LOAN_QUOTE_SUBMITTED", actorUserId: ownerOf(ctx, co).id });
      if (status === "WITHDRAWN") await audit({ ...qc, action: "LOAN_QUOTE_WITHDRAWN", actorUserId: ownerOf(ctx, co).id });
      if (status === "SELECTED") await audit({ ...qc, action: "LOAN_QUOTE_SELECTED", actorUserId: b.user.id });
    }
  }
}
