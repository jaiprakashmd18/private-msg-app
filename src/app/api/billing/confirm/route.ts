import { AppError, handleRouteError, logServerError } from "@/lib/errors";
import { getSupabaseServiceClient } from "@/lib/supabase/admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";

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

    const supabase = await getSupabaseServerClient();
    const { data: claims } = await supabase.auth.getClaims();
    const userId = claims?.claims?.sub;
    if (!userId) throw new AppError("Not signed in", 401, "unauthenticated");

    const body = (await request.json().catch(() => ({}))) as { sessionId?: unknown };
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    // Stripe Checkout Session ids look like cs_test_... / cs_live_... .
    if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) throw new AppError("Bad session", 400, "bad_request");

    const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
      headers: { authorization: `Bearer ${secret}` },
    });
    const session = (await res.json()) as {
      payment_status?: string;
      status?: string;
      client_reference_id?: string;
      customer?: string;
      subscription?: string;
      error?: { message?: string };
    };
    if (!res.ok) {
      logServerError("billing/confirm", session.error ?? { status: res.status });
      throw new AppError("Could not verify payment", 502, "stripe_error");
    }

    // Only the person who started this exact checkout, and only once it is paid.
    const paid = session.payment_status === "paid" || session.status === "complete";
    if (session.client_reference_id !== userId || !paid) {
      return Response.json({ ok: true, is_plus: false, pending: true });
    }

    const { error } = await getSupabaseServiceClient().rpc("server_apply_subscription", {
      p_user_id: userId,
      p_source: "stripe",
      p_status: "active",
      p_current_period_end: null,
      p_external_customer: typeof session.customer === "string" ? session.customer : null,
      p_external_sub: typeof session.subscription === "string" ? session.subscription : null,
      p_cancel_at_period_end: false,
    });
    if (error) throw error;

    return Response.json({ ok: true, is_plus: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return handleRouteError("billing/confirm", error);
  }
}
