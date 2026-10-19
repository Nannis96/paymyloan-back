import type { Prisma } from "@prisma/client";
import { prisma } from "@/db/prisma";
import { type SafeUser, toSafeUser } from "@/services/users.service";
import type { ListAdminBorrowersQuery } from "@/validations/borrowers.validation";
import { buildPaginatedResult, type PaginatedResult } from "@/validations/pagination";

// AB-02. Espejo de listLenders (BE-041) para el Admin.
export interface AdminBorrowerListItem {
  id: string;
  user: SafeUser;
  entityName: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  /** APPROVED gana sobre PENDING, y PENDING sobre REJECTED; null = nunca envió. */
  verification: "APPROVED" | "PENDING" | "REJECTED" | null;
  /** Contratos que pasaron de borrador y no se cancelaron (mismo criterio que "deals" del overview). */
  contractsCount: number;
}

const PRECEDENCE = ["APPROVED", "PENDING", "REJECTED"] as const;
const DEAL_STATUSES = ["PENDING_ACCEPTANCE", "ACTIVE", "DELINQUENT", "PAID_OFF"] as const;

export async function listAdminBorrowers(query: ListAdminBorrowersQuery): Promise<PaginatedResult<AdminBorrowerListItem>> {
  const where: Prisma.BorrowerProfileWhereInput = { deletedAt: null };
  if (query.search) {
    where.OR = [
      { user: { name: { contains: query.search, mode: "insensitive" } } },
      { user: { email: { contains: query.search, mode: "insensitive" } } },
      { entityName: { contains: query.search, mode: "insensitive" } },
    ];
  }
  if (query.verification) where.verificationRequests = { some: { status: query.verification } };

  const [total, profiles] = await Promise.all([
    prisma.borrowerProfile.count({ where }),
    prisma.borrowerProfile.findMany({
      where,
      include: { user: true, verificationRequests: { select: { status: true } } },
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  const counts = await prisma.contractBorrower.groupBy({
    by: ["borrowerProfileId"],
    where: {
      borrowerProfileId: { in: profiles.map((profile) => profile.id) },
      removedAt: null,
      contract: { status: { in: [...DEAL_STATUSES] }, deletedAt: null },
    },
    _count: { _all: true },
  });
  const countOf = new Map(counts.map((row) => [row.borrowerProfileId, row._count._all]));

  const items = profiles.map((profile) => {
    const statuses = new Set(profile.verificationRequests.map((request) => request.status));
    return {
      id: profile.id,
      user: toSafeUser(profile.user),
      entityName: profile.entityName,
      addressLine1: profile.addressLine1,
      city: profile.city,
      state: profile.state,
      postalCode: profile.postalCode,
      verification: PRECEDENCE.find((status) => statuses.has(status)) ?? null,
      contractsCount: countOf.get(profile.id) ?? 0,
    };
  });

  return buildPaginatedResult(items, total, query);
}
