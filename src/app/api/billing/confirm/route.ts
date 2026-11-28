import { parseStripeCheckoutConfirmation } from "@/lib/billing.server";
import { AppError, handleRouteError, logServerError } from "@/lib/errors";
import { getSupabaseServiceClient } from "@/lib/supabase/admin";
import { requireBillingMember } from "@/lib/billing-access.server";

export const runtime = "nodejs";

/**
 * Confirms a just-completed Stripe Checkout and unlocks Plus immediately, so
 * the person doesn't have to wait for the asynchronous webhook. Safe to call
 * repeatedly: it only applies a session that is PAID and whose
 * client_reference_id is the signed-in user, so nobody can unlock someone
 * else (or themselves) without having actually paid for that session.
 *
 * The webhook (/api/webhooks/stripe) stays the source of truth for renewals
 * and cancellations; this is just the fast path on return.
 */
export async function POST(request: Request) {
  try {
    const secret = process.env.STRIPE_SECRET_KEY;
    if (!secret) return Response.json({ ok: false, reason: "not_configured" }, { status: 200 });

    const { user_id: userId } = await requireBillingMember(request);

    const body = (await request.json().catch(() => ({}))) as { sessionId?: unknown };
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    // Stripe Checkout Session ids look like cs_test_... / cs_live_... .
    if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) throw new AppError("Bad session", 400, "bad_request");

    const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=subscription`, {
      headers: { authorization: `Bearer ${secret}` },
    });
    const session = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      logServerError("billing/confirm", session.error ?? { status: res.status });
      throw new AppError("Could not verify payment", 502, "stripe_error");
    }

    const update = parseStripeCheckoutConfirmation(session, userId);
    if (!update) {
      return Response.json({ ok: true, is_plus: false, pending: true }, { headers: { "cache-control": "no-store" } });
    }

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

    return Response.json({ ok: true, is_plus: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return handleRouteError("billing/confirm", error);
  }
}
