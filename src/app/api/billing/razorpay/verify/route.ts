import { verifyRazorpayPaymentSignature } from "@/lib/billing.server";
import { AppError, handleRouteError, logServerError } from "@/lib/errors";
import { getSupabaseServiceClient } from "@/lib/supabase/admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * Confirms a Razorpay Checkout success and unlocks Plus (lifetime). Verifies
 * the signature Razorpay returns, then fetches the order to confirm it was the
 * one WE created for THIS signed-in user (notes.user_id) — so a leaked
 * payment id/signature can't unlock a different account. The webhook
 * (/api/webhooks/razorpay) is the backup if the browser closes before this runs.
 */
export async function POST(request: Request) {
  try {
    const keyId = process.env.RAZORPAY_KEY_ID || process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID;
    const keySecret = process.env.RAZORPAY_KEY_SECRET;
    if (!keyId || !keySecret) return Response.json({ ok: false, reason: "not_configured" }, { status: 200 });

    const supabase = await getSupabaseServerClient();
    const { data } = await supabase.auth.getClaims();
    const userId = data?.claims?.sub;
    if (!userId) throw new AppError("Not signed in", 401, "unauthenticated");

    const body = (await request.json().catch(() => ({}))) as {
      razorpay_order_id?: unknown;
      razorpay_payment_id?: unknown;
      razorpay_signature?: unknown;
    };
    const orderId = typeof body.razorpay_order_id === "string" ? body.razorpay_order_id : "";
    const paymentId = typeof body.razorpay_payment_id === "string" ? body.razorpay_payment_id : "";
    const signature = typeof body.razorpay_signature === "string" ? body.razorpay_signature : "";
    if (!/^order_[A-Za-z0-9]+$/.test(orderId) || !/^pay_[A-Za-z0-9]+$/.test(paymentId)) {
      throw new AppError("Bad payment details", 400, "bad_request");
    }

    if (!verifyRazorpayPaymentSignature(orderId, paymentId, signature, keySecret)) {
      throw new AppError("Payment could not be verified", 400, "bad_signature");
    }

    // Confirm this order was created for this user (notes.user_id).
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
    const res = await fetch(`https://api.razorpay.com/v1/orders/${encodeURIComponent(orderId)}`, {
      headers: { authorization: `Basic ${auth}` },
    });
    const order = (await res.json()) as { notes?: Record<string, unknown>; error?: { description?: string } };
    if (!res.ok) {
      logServerError("billing/razorpay/verify", order.error ?? { status: res.status });
      throw new AppError("Could not verify payment", 502, "razorpay_error");
    }
    if (order.notes?.user_id !== userId) {
      throw new AppError("This payment isn't for your account", 403, "forbidden");
    }

    const { error } = await getSupabaseServiceClient().rpc("server_apply_subscription", {
      p_user_id: userId,
      p_source: "razorpay",
      p_status: "active",
      p_current_period_end: null, // lifetime
      p_external_customer: null,
      p_external_sub: orderId,
      p_cancel_at_period_end: false,
    });
    if (error) throw error;

    return Response.json({ ok: true, is_plus: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return handleRouteError("billing/razorpay/verify", error);
  }
}
