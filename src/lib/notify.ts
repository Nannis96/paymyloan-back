import { prisma } from "@/db/prisma";
import { logger } from "@/lib/logger";

// Fase 19 (PB-035). Notificaciones in-app — ver
// Docs/plan/fases/fase-19-notificaciones.md. `Notification.type` es String a
// nivel de Postgres (mismo criterio que AuditLog.action); el control de qué
// valores existen vive en este union.
export type NotificationType =
  | "LOAN_QUOTE_REQUESTED"
  | "LOAN_QUOTE_RECEIVED"
  | "LOAN_QUOTE_SELECTED"
  | "CONTRACT_TERMS_SUBMITTED"
  | "CONTRACT_TERMS_ACCEPTED"
  | "CONTRACT_TERMS_REJECTED"
  | "CONTRACT_ACTIVATED"
  | "MESSAGE_RECEIVED"
  | "PAYMENT_REQUESTED"
  | "PAYMENT_REQUEST_CONFIRMED"
  | "PAYMENT_REQUEST_REJECTED";

export type NotificationEntityType = "LoanRequest" | "LoanQuote" | "Contract" | "MessageThread";

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  relatedEntity?: { type: NotificationEntityType; id: string };
  // N4-A: si ya hay una del mismo type + relatedEntity sin leer, se actualiza
  // (body/createdAt) en vez de crear otra. Solo MESSAGE_RECEIVED lo usa.
  coalesce?: boolean;
}

// N5: nunca lanza. Se llama después del commit de la operación de negocio;
// perder una notificación es aceptable, romper "aceptar términos" no.
export async function notify(input: NotifyInput): Promise<void> {
  try {
    const { userId, type, title, body, relatedEntity } = input;
    const relatedEntityType = relatedEntity?.type;
    const relatedEntityId = relatedEntity?.id;
    if (input.coalesce) {
      const updated = await prisma.notification.updateMany({
        where: { userId, type, relatedEntityType, relatedEntityId, isRead: false },
        data: { title, body: body.slice(0, 1000), createdAt: new Date() },
      });
      if (updated.count > 0) return;
    }
    await prisma.notification.create({ data: { userId, type, title, body: body.slice(0, 1000), relatedEntityType, relatedEntityId } });
  } catch (error) {
    logger.error("notify failed", { type: input.type, userId: input.userId, error: error instanceof Error ? error.message : String(error) });
  }
}

// Una LenderCompany no tiene usuario propio: el destinatario es el dueño
// (LenderProfile.userId), mismo criterio que reviews.service.ts#canReview.
export async function notifyLenderCompany(lenderCompanyId: string, input: Omit<NotifyInput, "userId">): Promise<void> {
  try {
    const company = await prisma.lenderCompany.findUnique({ where: { id: lenderCompanyId }, select: { lenderProfile: { select: { userId: true } } } });
    if (company) await notify({ ...input, userId: company.lenderProfile.userId });
  } catch (error) {
    logger.error("notifyLenderCompany failed", { type: input.type, lenderCompanyId, error: error instanceof Error ? error.message : String(error) });
  }
}

export async function notifyBorrowerProfile(borrowerProfileId: string, input: Omit<NotifyInput, "userId">): Promise<void> {
  try {
    const profile = await prisma.borrowerProfile.findUnique({ where: { id: borrowerProfileId }, select: { userId: true } });
    if (profile) await notify({ ...input, userId: profile.userId });
  } catch (error) {
    logger.error("notifyBorrowerProfile failed", { type: input.type, borrowerProfileId, error: error instanceof Error ? error.message : String(error) });
  }
}
