import type { Prisma } from "@prisma/client";
import { prisma } from "@/db/prisma";

// BE-020. `AuditLog.action` es `String` a nivel de Postgres (nunca un enum
// de BD — ver Docs/plan/04-base-de-datos.md §4.3, motivo: un enum obligaría
// a una migración de schema por cada evento nuevo). El control de qué
// valores son válidos vive acá, en un union type de TypeScript — mismo
// balance de trade-offs que ya documentó PAYMYLOAN_DATABASE_DESIGN.md §5.12.
export type AuditAction =
  // Identidad
  | "USER_LOGIN_SUCCESS"
  | "USER_LOGIN_FAILED"
  | "USER_2FA_ENABLED"
  | "USER_2FA_DISABLED"
  | "USER_PASSWORD_CHANGED"
  | "USER_ACTIVATED"
  | "USER_DEACTIVATED"
  // Prestamistas / empresas
  | "LENDER_CREATED"
  | "LENDER_UPDATED"
  | "LENDER_DELETED"
  | "LENDER_COMPANY_CREATED"
  | "LENDER_COMPANY_UPDATED"
  | "LENDER_COMPANY_SUSPENDED"
  | "LENDER_COMPANY_DELETED"
  // Deudores
  | "BORROWER_CREATED"
  | "BORROWER_UPDATED"
  | "BORROWER_DELETED"
  | "BORROWER_LINKED_TO_LENDER"
  | "BORROWER_UNLINKED_FROM_LENDER"
  // Bookkeeper
  | "BOOKKEEPER_CREATED"
  | "BOOKKEEPER_LINKED_TO_LENDER"
  | "BOOKKEEPER_UNLINKED_FROM_LENDER"
  // Insurance Company
  | "INSURANCE_COMPANY_CREATED"
  | "INSURANCE_COMPANY_LINKED_TO_CONTRACT"
  // Propiedad
  | "PROPERTY_CREATED"
  | "PROPERTY_UPDATED"
  // Contratos
  | "CONTRACT_CREATED"
  | "CONTRACT_TERMS_PROPOSED"
  | "CONTRACT_TERMS_ACCEPTED"
  | "CONTRACT_TERMS_REJECTED"
  | "CONTRACT_ACTIVATED"
  | "CONTRACT_CANCELLED"
  // Pagos
  | "TRANSACTION_CREATED"
  | "TRANSACTION_SUCCEEDED"
  | "TRANSACTION_RETURNED"
  | "PAYMENT_METHOD_ADDED"
  | "PAYMENT_METHOD_REMOVED"
  // Acceso
  | "ACCESS_DENIED";

export interface LogAuditEventInput {
  action: AuditAction;
  entityType: string;
  entityId?: string;
  /** Nulo si el actor es del sistema (job, webhook) — en ese caso pasar `systemActorLabel`. */
  actorUserId?: string;
  systemActorLabel?: string;
  lenderCompanyId?: string;
  contractId?: string;
  metadata?: Prisma.InputJsonValue;
  ipAddress?: string;
  userAgent?: string;
}

// Único punto de escritura de AuditLog (BE-020): la tabla es de solo
// inserción, así que este helper nunca actualiza ni borra, solo crea.
export async function logAuditEvent(input: LogAuditEventInput): Promise<void> {
  await prisma.auditLog.create({
    data: {
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      actorUserId: input.actorUserId,
      isSystemActor: input.actorUserId === undefined,
      systemActorLabel: input.systemActorLabel,
      lenderCompanyId: input.lenderCompanyId,
      contractId: input.contractId,
      metadata: input.metadata,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
    },
  });
}
