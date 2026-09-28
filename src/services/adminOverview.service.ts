import { Prisma, type ContractStatus } from "@prisma/client";
import { prisma } from "@/db/prisma";

// AD-001 (Fase 16). Agregación pura para pml_v4/admin/admin-panel.html — sin
// tablas nuevas, todo se deriva en el momento de la consulta. Lo que todavía
// no tiene fuente de datos (suscripciones, interest share, afiliados) viaja
// como `null`: ver Docs/plan/fases/fase-16-admin-overview.md.

const LIVE_STATUSES: ContractStatus[] = ["ACTIVE", "DELINQUENT"];
const SHOWN_STATUSES: ContractStatus[] = ["PENDING_ACCEPTANCE", ...LIVE_STATUSES];
// "Total funded" cuenta lo que llegó a activarse alguna vez, cerrado incluido.
const FUNDED_STATUSES: ContractStatus[] = [...LIVE_STATUSES, "PAID_OFF"];
// "Deals" de un usuario: los que ya pasaron de borrador y no se cancelaron.
const DEAL_STATUSES: ContractStatus[] = [...SHOWN_STATUSES, "PAID_OFF"];

const DEALS_LIMIT = 5;
const ATTENTION_LIMIT = 10;
const SIGNUPS_LIMIT = 5;
const DAY_MS = 86_400_000;

const dealSelect = {
  id: true,
  contractNumber: true,
  status: true,
  nextPaymentDueDate: true,
  property: { select: { addressLine1: true, city: true, state: true } },
  currentTerms: { select: { principalAmount: true } },
} satisfies Prisma.ContractSelect;

function monthRange(now: Date, monthsAgo: number) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo + 1, 1));
  return { start, end, label: start.toISOString().slice(0, 7) };
}

// Closing fees = MARKETPLACE_CONNECTION (D-S2-5) de contratos activados en el
// mes. Solo se mira la versión de términos vigente: cada versión nueva
// inserta su propia fila de fee y sumarlas todas duplicaría el cobro.
async function closingFeesActivatedBetween(start: Date, end: Date) {
  const { _sum } = await prisma.contractFeeItem.aggregate({
    _sum: { computedAmount: true },
    where: {
      category: "PLATFORM",
      code: "MARKETPLACE_CONNECTION",
      contractTerms: {
        currentForContract: { is: { status: { in: FUNDED_STATUSES }, deletedAt: null, activatedAt: { gte: start, lt: end } } },
      },
    },
  });
  return _sum.computedAmount ?? new Prisma.Decimal(0);
}

// ponytail: una consulta por usuario (son SIGNUPS_LIMIT = 5); un groupBy si
// esa lista llega a paginarse.
async function countDeals(user: { lenderProfile: { lenderCompanies: { id: string }[] } | null; borrowerProfile: { id: string } | null }) {
  const companyIds = user.lenderProfile?.lenderCompanies.map((company) => company.id) ?? [];
  const [asLender, asBorrower] = await Promise.all([
    companyIds.length > 0 ? prisma.contract.count({ where: { lenderCompanyId: { in: companyIds }, status: { in: DEAL_STATUSES }, deletedAt: null } }) : 0,
    user.borrowerProfile
      ? prisma.contract.count({
          where: { borrowers: { some: { borrowerProfileId: user.borrowerProfile.id, removedAt: null } }, status: { in: DEAL_STATUSES }, deletedAt: null },
        })
      : 0,
  ]);
  return asLender + asBorrower;
}

// Estado de verificación de un usuario a partir de todas sus solicitudes
// (una por empresa, si es lender): APPROVED gana sobre PENDING, y PENDING
// sobre REJECTED. null = nunca envió ninguna.
const VERIFICATION_PRECEDENCE = ["APPROVED", "PENDING", "REJECTED"] as const;

export async function getAdminOverview(now: Date = new Date()) {
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const liveWhere = { status: { in: LIVE_STATUSES }, deletedAt: null } satisfies Prisma.ContractWhereInput;

  const [activeCount, addedLast7d, funded, lateCount, lateContracts, deals, signups, pendingLender, pendingBorrower, oldestPending, ...monthlyClosingFees] = await Promise.all([
    prisma.contract.count({ where: liveWhere }),
    prisma.contract.count({ where: { ...liveWhere, activatedAt: { gte: weekAgo } } }),
    prisma.contractTerms.aggregate({
      _sum: { principalAmount: true },
      where: { currentForContract: { is: { status: { in: FUNDED_STATUSES }, deletedAt: null } } },
    }),
    prisma.contract.count({ where: { status: "DELINQUENT", deletedAt: null } }),
    prisma.contract.findMany({ where: { status: "DELINQUENT", deletedAt: null }, select: dealSelect, orderBy: { nextPaymentDueDate: "asc" }, take: ATTENTION_LIMIT }),
    // ponytail: "los 5 más recientes", no "los 5 más urgentes" (la mora sale
    // igual en needsAttention); ordenar por urgencia si la vista lo pide.
    prisma.contract.findMany({ where: { status: { in: SHOWN_STATUSES }, deletedAt: null }, select: dealSelect, orderBy: { createdAt: "desc" }, take: DEALS_LIMIT }),
    prisma.user.findMany({
      // Los roles de staff los da de alta un Admin, no se auto-registran.
      where: { role: { in: ["LENDER", "BORROWER"] }, deletedAt: null },
      select: {
        id: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
        lenderProfile: { select: { lenderCompanies: { where: { deletedAt: null }, select: { id: true } } } },
        borrowerProfile: { select: { id: true } },
      },
      orderBy: { createdAt: "desc" },
      take: SIGNUPS_LIMIT,
    }),
    prisma.verificationRequest.count({ where: { status: "PENDING", lenderCompanyId: { not: null } } }),
    prisma.verificationRequest.count({ where: { status: "PENDING", borrowerProfileId: { not: null } } }),
    prisma.verificationRequest.aggregate({ _min: { createdAt: true }, where: { status: "PENDING" } }),
    // Oldest -> newest: el último es el mes en curso.
    ...[5, 4, 3, 2, 1, 0].map((monthsAgo) => {
      const { start, end } = monthRange(now, monthsAgo);
      return closingFeesActivatedBetween(start, end);
    }),
  ]);

  // Días de atraso = desde el vencimiento impago más viejo, no desde que
  // venció la gracia (mismo criterio que el "15 days late" de la vista).
  const overdue = await prisma.scheduledPayment.groupBy({
    by: ["contractId"],
    where: {
      contractId: { in: [...new Set([...lateContracts, ...deals].map((contract) => contract.id))] },
      status: { in: ["PENDING", "PARTIALLY_PAID"] },
      dueDate: { lt: now },
    },
    _min: { dueDate: true },
  });
  const oldestOverdue = new Map(overdue.map((row) => [row.contractId, row._min.dueDate as Date]));
  const daysPastDue = (contractId: string) => {
    const dueDate = oldestOverdue.get(contractId);
    return dueDate ? Math.floor((now.getTime() - dueDate.getTime()) / DAY_MS) : null;
  };

  const address = (contract: (typeof deals)[number]) => contract.property.addressLine1;

  const companyIds = signups.flatMap((user) => user.lenderProfile?.lenderCompanies.map((company) => company.id) ?? []);
  const borrowerIds = signups.flatMap((user) => (user.borrowerProfile ? [user.borrowerProfile.id] : []));
  const verifications = await prisma.verificationRequest.findMany({
    where: { OR: [{ lenderCompanyId: { in: companyIds } }, { borrowerProfileId: { in: borrowerIds } }] },
    select: { status: true, lenderCompanyId: true, borrowerProfileId: true },
  });
  const verificationOf = (user: (typeof signups)[number]) => {
    const statuses = new Set(
      verifications
        .filter(
          (request) =>
            (request.borrowerProfileId !== null && request.borrowerProfileId === user.borrowerProfile?.id) ||
            (request.lenderCompanyId !== null && user.lenderProfile?.lenderCompanies.some((company) => company.id === request.lenderCompanyId)),
        )
        .map((request) => request.status),
    );
    return VERIFICATION_PRECEDENCE.find((status) => statuses.has(status)) ?? null;
  };

  const pendingVerifications = pendingLender + pendingBorrower;

  const closingFees = monthlyClosingFees[5];

  return {
    kpis: {
      activeDeals: { count: activeCount, addedLast7d },
      totalFunded: funded._sum.principalAmount ?? new Prisma.Decimal(0),
      lateContracts: lateCount,
      pendingVerifications,
    },
    revenue: {
      month: monthRange(now, 0).label,
      closingFees,
      subscriptions: null,
      interestShare: null,
      affiliatePayouts: null,
      net: null,
      // Suma de las líneas que ya tienen fuente (hoy solo closing fees).
      last6Months: monthlyClosingFees.map((total, index) => ({ month: monthRange(now, 5 - index).label, total })),
    },
    activeDeals: deals.map((contract) => ({
      contractId: contract.id,
      contractNumber: contract.contractNumber,
      property: contract.property,
      principalAmount: contract.currentTerms?.principalAmount ?? null,
      status: contract.status,
      daysPastDue: daysPastDue(contract.id),
      nextPaymentDueDate: contract.nextPaymentDueDate,
    })),
    needsAttention: [
      // Una sola alerta agregada, no una por solicitud: la vista muestra
      // "N verifications pending" y la cola detallada vive en
      // GET /api/admin/verifications.
      ...(pendingVerifications > 0
        ? [
            {
              type: "VERIFICATIONS_PENDING" as const,
              severity: "red" as const,
              title: `${pendingVerifications} verification${pendingVerifications === 1 ? "" : "s"} pending`,
              detail: `${pendingLender} lender ${pendingLender === 1 ? "entity" : "entities"}, ${pendingBorrower} borrower ${pendingBorrower === 1 ? "entity" : "entities"} awaiting review`,
              entityType: "VerificationRequest" as const,
              entityId: null as string | null,
              occurredAt: oldestPending._min.createdAt,
            },
          ]
        : []),
      ...lateContracts.map((contract) => {
        const days = daysPastDue(contract.id);
        return {
          type: "LATE_PAYMENT" as const,
          severity: "red" as const,
          title: address(contract),
          detail: days === null ? "Payment overdue" : `${days} days past due`,
          entityType: "Contract" as const,
          entityId: contract.id as string | null,
          occurredAt: contract.nextPaymentDueDate,
        };
      }),
    ],
    recentSignups: await Promise.all(
      signups.map(async (user) => ({
        userId: user.id,
        name: user.name,
        role: user.role,
        isActive: user.isActive,
        createdAt: user.createdAt,
        verification: verificationOf(user),
        dealsCount: await countDeals(user),
      })),
    ),
  };
}
