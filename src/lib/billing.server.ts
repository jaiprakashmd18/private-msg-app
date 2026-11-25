import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Turning billing webhooks into one "apply this subscription" shape. Pure
 * functions here (no network, no DB) so they can be unit-tested; the routes
 * verify the signature and call server_apply_subscription.
 *
 *  - Stripe (web): /api/webhooks/stripe
 *  - RevenueCat (Apple / Google, from the apps): /api/webhooks/revenuecat
 */

export type Source = "stripe" | "apple" | "google" | "razorpay";
export type Status = "active" | "trialing" | "past_due" | "canceled" | "inactive";

export interface SubscriptionUpdate {
  userId: string;
  source: Source;
  status: Status;
  currentPeriodEnd: string | null;
  externalCustomer: string | null;
  externalSub: string | null;
  cancelAtPeriodEnd: boolean;
}

const isUuid = (v: unknown): v is string =>
  typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

// --- Stripe ---------------------------------------------------------------------

/** Verifies a Stripe-Signature header (t=…,v1=…) against the raw body. */
export function verifyStripeSignature(payload: string, header: string | null, secret: string, nowSec = Date.now() / 1000): boolean {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=", 2) as [string, string]));
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (!Number.isFinite(t) || !v1) return false;
  // Reject timestamps more than 5 minutes out, to blunt replay.
  if (Math.abs(nowSec - t) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(v1);
  return a.length === b.length && timingSafeEqual(a, b);
}

function mapStripeStatus(s: string): Status {
  if (s === "active") return "active";
  if (s === "trialing") return "trialing";
  if (s === "past_due") return "past_due";
  if (s === "canceled" || s === "unpaid" || s === "incomplete_expired") return "canceled";
  return "inactive";
}

interface StripeEvent {
  type?: string;
  data?: { object?: Record<string, unknown> };
}

/** Maps a Stripe event to an update, or null if it isn't one we act on. */
export function parseStripeEvent(event: StripeEvent): SubscriptionUpdate | null {
  const obj = event.data?.object ?? {};
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    if (obj.payment_status !== "paid" || typeof obj.subscription !== "string") return null;
    const userId = obj.client_reference_id ?? (obj.metadata as Record<string, unknown> | undefined)?.user_id;
    if (!isUuid(userId)) return null;
    return {
      userId,
      source: "stripe",
      status: "active",
      currentPeriodEnd: null,
      externalCustomer: typeof obj.customer === "string" ? obj.customer : null,
      externalSub: typeof obj.subscription === "string" ? obj.subscription : null,
      cancelAtPeriodEnd: false,
    };
  }
  if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const userId = (obj.metadata as Record<string, unknown> | undefined)?.user_id;
    if (!isUuid(userId)) return null;
    const item = (obj.items as { data?: Array<{ current_period_end?: number }> } | undefined)?.data?.[0];
    const end = obj.current_period_end ?? item?.current_period_end;
    const periodEnd = typeof end === "number" ? new Date(end * 1000).toISOString() : null;
    return {
      userId,
      source: "stripe",
      status: event.type === "customer.subscription.deleted" ? "canceled" : mapStripeStatus(String(obj.status ?? "")),
      currentPeriodEnd: periodEnd,
      externalCustomer: typeof obj.customer === "string" ? obj.customer : null,
      externalSub: typeof obj.id === "string" ? obj.id : null,
      cancelAtPeriodEnd: obj.cancel_at_period_end === true,
    };
  }
  return null;
}

/** The Checkout Session is paid and its expanded subscription still grants access. */
export function parseStripeCheckoutConfirmation(session: Record<string, unknown>, userId: string, now = Date.now()) {
  if (session.client_reference_id !== userId || session.payment_status !== "paid") return null;
  if (typeof session.subscription !== "object" || !session.subscription) return null;
  const update = parseStripeEvent({
    type: "customer.subscription.updated",
    data: { object: session.subscription as Record<string, unknown> },
  });
  if (!update || update.userId !== userId || !update.externalSub || !update.currentPeriodEnd ||
      Date.parse(update.currentPeriodEnd) <= now || (update.status !== "active" && update.status !== "trialing")) {
    return null;
  }
  return update;
}

// --- RevenueCat (Apple / Google) ------------------------------------------------

const ACTIVE_RC = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "PRODUCT_CHANGE",
  "UNCANCELLATION",
  "NON_RENEWING_PURCHASE",
  "SUBSCRIPTION_EXTENDED",
]);

interface RevenueCatBody {
  event?: {
    type?: string;
    app_user_id?: string;
    store?: string;
    expiration_at_ms?: number;
    cancel_reason?: string;
  };
}

/** Maps a RevenueCat webhook body to an update, or null to ignore it. */
export function parseRevenueCatEvent(body: RevenueCatBody): SubscriptionUpdate | null {
  const e = body.event;
  if (!e || !isUuid(e.app_user_id)) return null;
  const source: Source = e.store === "PLAY_STORE" ? "google" : "apple";
  const periodEnd = typeof e.expiration_at_ms === "number" ? new Date(e.expiration_at_ms).toISOString() : null;
  const type = e.type ?? "";
  let status: Status;
  let cancelAtPeriodEnd = false;
  if (type === "EXPIRATION") status = "canceled";
  else if (type === "BILLING_ISSUE") status = "past_due";
  else if (type === "CANCELLATION") {
    // Still entitled until it expires; just won't renew.
    status = "active";
    cancelAtPeriodEnd = true;
  } else if (ACTIVE_RC.has(type)) status = "active";
  else return null;
  return {
    userId: e.app_user_id!,
    source,
    status,
    currentPeriodEnd: periodEnd,
    externalCustomer: e.app_user_id!,
    externalSub: null,
    cancelAtPeriodEnd,
  };
}

/** Constant-time check of a bearer secret (RevenueCat Authorization header). */
export function bearerMatches(header: string | null, secret: string | undefined): boolean {
  if (!header || !secret) return false;
  const given = header.replace(/^Bearer\s+/i, "");
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

// --- Razorpay (one-time payment: UPI / Google Pay / cards, India) ----------------

const hmacEquals = (expectedHex: string, givenHex: string | null | undefined): boolean => {
  if (!givenHex) return false;
  const a = Buffer.from(expectedHex);
  const b = Buffer.from(givenHex);
  return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * Verifies a Razorpay Checkout success on return: the signature is
 * HMAC-SHA256("<order_id>|<payment_id>", key_secret). Proves the payment is
 * genuine and belongs to that order.
 */
export function verifyRazorpayPaymentSignature(orderId: string, paymentId: string, signature: string, secret: string): boolean {
  if (!orderId || !paymentId || !secret) return false;
  return hmacEquals(createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex"), signature);
}

/** Verifies a Razorpay webhook body against the X-Razorpay-Signature header. */
export function verifyRazorpayWebhookSignature(payload: string, signature: string | null, secret: string): boolean {
  if (!secret) return false;
  return hmacEquals(createHmac("sha256", secret).update(payload).digest("hex"), signature);
}

export function isPaidRazorpayOrder(order: { status?: string; notes?: Record<string, unknown> }) {
  return order.status === "paid" && order.notes?.plan === "plus_lifetime";
}

interface RazorpayWebhookBody {
  event?: string;
  payload?: {
    payment?: { entity?: { id?: string; order_id?: string; notes?: Record<string, unknown> } };
    order?: { entity?: { id?: string; notes?: Record<string, unknown> } };
  };
}

/** Maps a Razorpay webhook (a successful one-time payment) to a lifetime unlock. */
export function parseRazorpayWebhook(body: RazorpayWebhookBody): SubscriptionUpdate | null {
  if (body.event !== "payment.captured" && body.event !== "order.paid") return null;
  const payment = body.payload?.payment?.entity;
  const order = body.payload?.order?.entity;
  const notes = (payment?.notes ?? order?.notes ?? {}) as Record<string, unknown>;
  const userId = notes.user_id;
  if (!isUuid(userId)) return null;
  return {
    userId,
    source: "razorpay",
    status: "active",
    currentPeriodEnd: null, // one-time = lifetime, no end date
    externalCustomer: null,
    externalSub: typeof payment?.order_id === "string" ? payment.order_id : typeof order?.id === "string" ? order.id : null,
    cancelAtPeriodEnd: false,
  };
}
