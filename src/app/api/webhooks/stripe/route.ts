import { logServerError } from "@/lib/errors";
import { parseStripeEvent, verifyStripeSignature } from "@/lib/billing.server";
import { getSupabaseServiceClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** Stripe billing events → the subscriptions table. Off until STRIPE_WEBHOOK_SECRET is set. */
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return new Response("Not configured", { status: 503 });

  const payload = await request.text();
  if (!verifyStripeSignature(payload, request.headers.get("stripe-signature"), secret)) {
    return new Response("Bad signature", { status: 400 });
  }

  let update;
  try {
    update = parseStripeEvent(JSON.parse(payload));
  } catch {
    return new Response("Bad payload", { status: 400 });
  }
  if (!update) return Response.json({ ok: true, ignored: true });

  try {
    const { error } = await getSupabaseServiceClient().rpc("server_apply_subscription", {
      p_user_id: update.userId,
      p_source: update.source,
      p_status: update.status,
      p_current_period_end: update.currentPeriodEnd,
      p_external_customer: update.externalCustomer,
      p_external_sub: update.externalSub,
      p_cancel_at_period_end: update.cancelAtPeriodEnd,
    });
    if (error) throw error;
  } catch (error) {
    logServerError("webhooks/stripe", error);
    return new Response("Apply failed", { status: 500 });
  }
  return Response.json({ ok: true });
}
