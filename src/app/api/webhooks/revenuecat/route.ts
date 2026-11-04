import { bearerMatches, parseRevenueCatEvent } from "@/lib/billing.server";
import { logServerError } from "@/lib/errors";
import { getSupabaseServiceClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** RevenueCat events (Apple / Google, from the apps) → the subscriptions table. */
export async function POST(request: Request) {
  const secret = process.env.REVENUECAT_WEBHOOK_SECRET;
  if (!secret) return new Response("Not configured", { status: 503 });
  if (!bearerMatches(request.headers.get("authorization"), secret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  let update;
  try {
    update = parseRevenueCatEvent(await request.json());
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
    logServerError("webhooks/revenuecat", error);
    return new Response("Apply failed", { status: 500 });
  }
  return Response.json({ ok: true });
}
