import type { Notification } from "@prisma/client";
import { prisma } from "@/db/prisma";
import { AppError } from "@/errors/AppError";
import { buildPaginatedResult, type PaginatedResult } from "@/validations/pagination";
import type { ListNotificationsQuery } from "@/validations/notifications.validation";

// Fase 19 (PB-036). Todas las queries filtran por userId — una notificación
// ajena es 404, no 403, como el resto del backend.
export async function listNotifications(userId: string, query: ListNotificationsQuery): Promise<PaginatedResult<Notification>> {
  const where = { userId, ...(query.isRead !== undefined && { isRead: query.isRead }), ...(query.type && { type: query.type }) };
  const [items, total] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
    prisma.notification.count({ where }),
  ]);
  return buildPaginatedResult(items, total, query);
}

export async function getUnreadCount(userId: string): Promise<{ unread: number }> {
  return { unread: await prisma.notification.count({ where: { userId, isRead: false } }) };
}

// Idempotente: si ya estaba leída no cambia readAt.
export async function markNotificationRead(userId: string, id: string): Promise<Notification> {
  const notification = await prisma.notification.findFirst({ where: { id, userId } });
  if (!notification) {
    throw new AppError("Notification not found", 404, "NOT_FOUND");
  }
  if (notification.isRead) return notification;
  return prisma.notification.update({ where: { id }, data: { isRead: true, readAt: new Date() } });
}

export async function markAllNotificationsRead(userId: string): Promise<{ updated: number }> {
  const { count } = await prisma.notification.updateMany({ where: { userId, isRead: false }, data: { isRead: true, readAt: new Date() } });
  return { updated: count };
}
