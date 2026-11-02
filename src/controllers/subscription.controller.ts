import { z } from "zod";
import { withAuth } from "@/middlewares/withAuth";
import { withRole } from "@/middlewares/withRole";
import * as subscriptionService from "@/services/subscription.service";
import { parseOrThrow } from "@/validations/parse";
import {
  adminCancelSubscriptionSchema,
  adminListSubscriptionsQuerySchema,
  grantSubscriptionSchema,
  listPaymentsQuerySchema,
} from "@/validations/subscription.validation";

// Fase 20 (Docs/plan/18-suscripciones.md §18.7). Los endpoints del Borrower
// nunca pasan por el gate de suscripción — son justamente los que la
// gestionan. Admin: escrituras de negocio con 2FA (D-P3-1).
async function requireBorrowerSession(request: Request) {
  const session = await withAuth(request);
  await withRole(session, ["BORROWER"], { requireTwoFactor: false });
  return session;
}

async function requireAdminSession(request: Request) {
  const session = await withAuth(request);
  await withRole(session, ["ADMIN"]);
  return session;
}

const idSchema = z.string().uuid("Invalid subscription id");

export async function getMine(request: Request) {
  const session = await requireBorrowerSession(request);
  return subscriptionService.getMySubscription(session.userId);
}

export async function payMine(request: Request) {
  const session = await requireBorrowerSession(request);
  return subscriptionService.payMySubscription(session.userId);
}

export async function cancelMine(request: Request) {
  const session = await requireBorrowerSession(request);
  return subscriptionService.cancelMySubscription(session.userId);
}

export async function listMyPayments(request: Request, query: unknown) {
  const session = await requireBorrowerSession(request);
  return subscriptionService.listMyPayments(session.userId, parseOrThrow(listPaymentsQuerySchema, query));
}

export async function adminList(request: Request, query: unknown) {
  await requireAdminSession(request);
  return subscriptionService.adminListSubscriptions(parseOrThrow(adminListSubscriptionsQuerySchema, query));
}

export async function adminGet(request: Request, id: string) {
  await requireAdminSession(request);
  return subscriptionService.adminGetSubscription(parseOrThrow(idSchema, id));
}

export async function adminGrant(request: Request, id: string, body: unknown) {
  const session = await requireAdminSession(request);
  return subscriptionService.adminGrantSubscription(parseOrThrow(idSchema, id), session.userId, parseOrThrow(grantSubscriptionSchema, body));
}

export async function adminCancel(request: Request, id: string, body: unknown) {
  const session = await requireAdminSession(request);
  return subscriptionService.adminCancelSubscription(parseOrThrow(idSchema, id), session.userId, parseOrThrow(adminCancelSubscriptionSchema, body ?? {}));
}
