import { AppError, handleRouteError, logServerError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Creates a Razorpay order for a one-time Loveline Plus (lifetime) payment and
 * returns what the browser needs to open Razorpay Checkout (UPI / Google Pay /
 * cards). Off (ok:false, reason:"not_configured") until RAZORPAY_KEY_ID and
 * RAZORPAY_KEY_SECRET are set in Vercel. Web only — the store apps use the store.
 *
 *   RAZORPAY_AMOUNT    price in the smallest unit (paise); default 39900 = ₹399
 *   RAZORPAY_CURRENCY  default INR
 */
export async function POST() {
  try {
    // Key id is public; accept it under either name so the browser and server share one value.
    const keyId = process.env.RAZORPAY_KEY_ID || process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) {
      return Response.json({ ok: false, reason: "not_configured" }, { status: 200 });
    }

    const supabase = await getSupabaseServerClient();
    const { data } = await supabase.auth.getClaims();
    const userId = data?.claims?.sub;
    const email = typeof data?.claims?.email === "string" ? data.claims.email : undefined;
    if (!userId) throw new AppError("Not signed in", 401, "unauthenticated");

    const amount = Math.max(100, Number(process.env.RAZORPAY_AMOUNT) || 39900);
    const currency = (process.env.RAZORPAY_CURRENCY || "INR").toUpperCase();

    const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
    const res = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: { authorization: `Basic ${auth}`, "content-type": "application/json" },
      body: JSON.stringify({
        amount,
        currency,
        // <= 40 chars, must be unique-ish per attempt.
        receipt: `plus_${userId.slice(0, 8)}_${Date.now().toString(36)}`,
        // Notes travel with the order; the verify route and webhook read user_id
        // from here, so a payment can only unlock the account that started it.
        notes: { user_id: userId, plan: "plus_lifetime" },
      }),
    });
    const order = (await res.json()) as { id?: string; amount?: number; currency?: string; error?: { description?: string } };
    if (!res.ok || !order.id) {
      logServerError("billing/razorpay/order", order.error ?? { status: res.status });
      throw new AppError("Could not start payment", 502, "razorpay_error");
    }

    return Response.json(
      {
        ok: true,
        orderId: order.id,
        amount: order.amount ?? amount,
        currency: order.currency ?? currency,
        keyId,
        prefillEmail: email ?? "",
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return handleRouteError("billing/razorpay/order", error);
  }
}
