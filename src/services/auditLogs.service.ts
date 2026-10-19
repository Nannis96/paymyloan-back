import type { AuditLog, Prisma } from "@prisma/client";
import type { Session } from "@/middlewares/withAuth";
import { prisma } from "@/db/prisma";
import { AppError } from "@/errors/AppError";
import type { ListAuditLogsQuery } from "@/validations/payments.validation";
import { buildPaginatedResult, type PaginatedResult } from "@/validations/pagination";

// BE-072. ADMIN ve todo; LENDER solo `lenderCompanyId IN (mis empresas)`
// (mismo criterio tenant-scoped que cualquier otro listado, ya que
// withTenantScope se descartó — D-P6-1). BORROWER no tiene acceso: ningún
// otro rol de este módulo lista auditoría.
export async function listAuditLogs(session: Session, query: ListAuditLogsQuery): Promise<PaginatedResult<AuditLog>> {
  const where: Prisma.AuditLogWhereInput = {};

  if (session.roles.includes("ADMIN")) {
    // sin restricción de tenant
  } else if (session.roles.includes("LENDER")) {
    const profile = await prisma.lenderProfile.findUnique({
      where: { userId: session.userId },
      include: { lenderCompanies: { where: { deletedAt: null }, select: { id: true } } },
    });
    const companyIds = profile?.lenderCompanies.map((company) => company.id) ?? [];
    if (companyIds.length === 0) return buildPaginatedResult([], 0, query);
    where.lenderCompanyId = { in: companyIds };
  } else {
    throw new AppError("You do not have permission for this operation", 403, "FORBIDDEN");
  }

  if (query.contractId) where.contractId = query.contractId;
  if (query.action) where.action = query.action;
  if (query.entityType) where.entityType = query.entityType;
  if (query.actorId) where.actorUserId = query.actorId;
  if (query.from || query.to) where.createdAt = { ...(query.from && { gte: query.from }), ...(query.to && { lte: query.to }) };

  const [total, logs] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
  ]);

  return buildPaginatedResult(logs, total, query);
}
