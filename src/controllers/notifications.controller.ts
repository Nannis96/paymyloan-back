import { withAuth } from "@/middlewares/withAuth";
import * as notificationsService from "@/services/notifications.service";
import { listNotificationsQuerySchema } from "@/validations/notifications.validation";
import { parseOrThrow } from "@/validations/parse";
import { z } from "zod";

// Fase 19 (PB-036). Cualquier usuario autenticado ve las suyas; leer/marcar
// no mueve dinero ni cambia el estado de un contrato — sin 2FA (mismo
// criterio que mensajería, Fase 17).

export async function list(request: Request, query: unknown) {
  const session = await withAuth(request);
  return notificationsService.listNotifications(session.userId, parseOrThrow(listNotificationsQuerySchema, query));
}

export async function unreadCount(request: Request) {
  const session = await withAuth(request);
  return notificationsService.getUnreadCount(session.userId);
}

export async function markRead(request: Request, id: string) {
  const session = await withAuth(request);
  return notificationsService.markNotificationRead(session.userId, parseOrThrow(z.string().uuid("Invalid notification id"), id));
}

export async function markAllRead(request: Request) {
  const session = await withAuth(request);
  return notificationsService.markAllNotificationsRead(session.userId);
}
