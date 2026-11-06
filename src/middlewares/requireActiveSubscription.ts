import type { Session } from "@/middlewares/withAuth";
import { assertSubscriptionAccess } from "@/services/subscription.service";

// Fase 20 (§18.5). Solo para acciones que inician un préstamo nuevo del
// Borrower — nunca pagos, lecturas ni mensajería. 403 SUBSCRIPTION_REQUIRED
// si ni el trial ni el periodo pagado están vigentes.
export async function requireActiveSubscription(session: Session): Promise<void> {
  await assertSubscriptionAccess(session.userId);
}
