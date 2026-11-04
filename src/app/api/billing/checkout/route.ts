import { AppError, handleRouteError, logServerError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Starts a Stripe Checkout for Loveline Plus and returns { url } to redirect to.
 * Off (ok:false, reason:"not_configured") until STRIPE_SECRET_KEY and
 * STRIPE_PRICE_ID are set in Vercel. Web only — the apps use the store.
 */
export async function POST(request: Request) {
  try {
    const secret = process.env.STRIPE_SECRET_KEY;
    const price = process.env.STRIPE_PRICE_ID;
    if (!secret || !price) {
      return Response.json({ ok: false, reason: "not_configured" }, { status: 200 });
    }

    const supabase = await getSupabaseServerClient();
    const { data } = await supabase.auth.getClaims();
    const userId = data?.claims?.sub;
    const email = typeof data?.claims?.email === "string" ? data.claims.email : undefined;
    if (!userId) throw new AppError("Not signed in", 401, "unauthenticated");

    const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin;
    const form = new URLSearchParams({
      mode: "subscription",
      "line_items[0][price]": price,
      "line_items[0][quantity]": "1",
      success_url: `${origin}/settings?plus=success`,
      cancel_url: `${origin}/settings?plus=cancel`,
      client_reference_id: userId,
      "subscription_data[metadata][user_id]": userId,
      "metadata[user_id]": userId,
      allow_promotion_codes: "true",
    });
    if (email) form.set("customer_email", email);

    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "content-type": "application/x-www-form-urlencoded" },
      body: form,
    });
    const json = (await res.json()) as { url?: string; error?: { message?: string } };
    if (!res.ok || !json.url) {
      logServerError("billing/checkout", json.error ?? { status: res.status });
      throw new AppError("Could not start checkout", 502, "stripe_error");
    }
    return Response.json({ ok: true, url: json.url }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return handleRouteError("billing/checkout", error);
  }
}
