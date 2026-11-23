import { env } from "@/config/env";
import { apiSuccess } from "@/lib/apiResponse";

// GET /api/subscription/price — público. Fuente única del precio mensual
// (SUBSCRIPTION_PRICE_CENTS) y de la tarifa de verificación (VERIFICATION_FEE_CENTS) para los textos de marketing/legal del front.
export async function GET() {
  return apiSuccess({ priceCents: env.subscriptionPriceCents, currency: env.subscriptionCurrency, verificationFeeCents: env.verificationFeeCents });
}
