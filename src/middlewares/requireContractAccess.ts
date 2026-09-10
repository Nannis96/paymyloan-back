import type { Contract } from "@prisma/client";
import type { Session } from "@/middlewares/withAuth";
import { prisma } from "@/db/prisma";
import { AppError } from "@/errors/AppError";
import { logAuditEvent } from "@/lib/audit";

// BE-038. Resuelve si `session` puede acceder a `contractId`, para LENDER
// (dueño de la LenderCompany del contrato) y BORROWER (asociado vía
// ContractBorrower activo) — usado por todo el módulo de contratos y pagos
// (Fase 6, todavía no construido). El modelo de acceso de ADMIN a contratos
// puntuales no está definido todavía — se decide en Fase 6.
//
// Siempre 404 (nunca 403) cuando el contrato existe pero no pertenece a la
// sesión — mismo criterio anti-enumeración que el resto de §7.5: no le
// confirma a un atacante que el ID que probó existe. Cada rechazo por
// tenant mismatch queda en AuditLog (BE-039, action=ACCESS_DENIED).
export async function requireContractAccess(session: Session, contractId: string): Promise<Contract> {
  const contract = await prisma.contract.findUnique({ where: { id: contractId } });
  if (!contract || contract.deletedAt) {
    throw new AppError("Contract not found", 404, "NOT_FOUND");
  }

  if (session.role === "LENDER") {
    const lenderProfile = await prisma.lenderProfile.findUnique({ where: { userId: session.userId } });
    const ownsCompany = lenderProfile
      ? await prisma.lenderCompany.findFirst({
          where: { id: contract.lenderCompanyId, lenderProfileId: lenderProfile.id },
        })
      : null;

    if (!ownsCompany) {
      await logAuditEvent({
        action: "ACCESS_DENIED",
        entityType: "Contract",
        entityId: contractId,
        actorUserId: session.userId,
        lenderCompanyId: contract.lenderCompanyId,
        contractId,
        metadata: { role: session.role, reason: "tenant_mismatch" },
      });
      throw new AppError("Contract not found", 404, "NOT_FOUND");
    }

    return contract;
  }

  if (session.role === "BORROWER") {
    const borrowerProfile = await prisma.borrowerProfile.findUnique({ where: { userId: session.userId } });
    const link = borrowerProfile
      ? await prisma.contractBorrower.findUnique({
          where: { contractId_borrowerProfileId: { contractId, borrowerProfileId: borrowerProfile.id } },
        })
      : null;

    if (!link || link.removedAt) {
      await logAuditEvent({
        action: "ACCESS_DENIED",
        entityType: "Contract",
        entityId: contractId,
        actorUserId: session.userId,
        contractId,
        metadata: { role: session.role, reason: "not_associated" },
      });
      throw new AppError("Contract not found", 404, "NOT_FOUND");
    }

    return contract;
  }

  throw new AppError("You do not have permission for this operation", 403, "FORBIDDEN");
}
