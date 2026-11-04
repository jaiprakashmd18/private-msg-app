import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  bearerMatches,
  parseRazorpayWebhook,
  parseRevenueCatEvent,
  parseStripeEvent,
  verifyRazorpayPaymentSignature,
  verifyRazorpayWebhookSignature,
  verifyStripeSignature,
} from "@/lib/billing.server";

const USER = "11111111-2222-3333-4444-555555555555";

describe("Stripe webhook", () => {
  const secret = "whsec_test_secret";
  function sign(payload: string, t = Math.floor(Date.now() / 1000)) {
    const v1 = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
    return `t=${t},v1=${v1}`;
  }

  it("verifies a genuine signature and rejects tampering, replays and the wrong secret", () => {
    const body = '{"hello":"world"}';
    expect(verifyStripeSignature(body, sign(body), secret)).toBe(true);
    expect(verifyStripeSignature(body + "x", sign(body), secret)).toBe(false);
    expect(verifyStripeSignature(body, sign(body), "whsec_wrong")).toBe(false);
    expect(verifyStripeSignature(body, sign(body, 1), secret)).toBe(false); // old timestamp
    expect(verifyStripeSignature(body, null, secret)).toBe(false);
  });

  it("maps checkout and subscription events to the user; ignores noise", () => {
    expect(
      parseStripeEvent({ type: "checkout.session.completed", data: { object: { client_reference_id: USER, customer: "cus_1", subscription: "sub_1" } } }),
    ).toMatchObject({ userId: USER, source: "stripe", status: "active", externalSub: "sub_1" });

    const upd = parseStripeEvent({
      type: "customer.subscription.updated",
      data: { object: { metadata: { user_id: USER }, status: "active", current_period_end: 1893456000, id: "sub_1", customer: "cus_1", cancel_at_period_end: true } },
    });
    expect(upd).toMatchObject({ userId: USER, status: "active", cancelAtPeriodEnd: true });
    expect(upd?.currentPeriodEnd).toBe("2030-01-01T00:00:00.000Z");

    expect(parseStripeEvent({ type: "customer.subscription.deleted", data: { object: { metadata: { user_id: USER } } } })).toMatchObject({ status: "canceled" });
    expect(parseStripeEvent({ type: "customer.subscription.updated", data: { object: { metadata: { user_id: USER }, status: "past_due" } } })).toMatchObject({ status: "past_due" });
    // No user id, or an unrelated event → ignored.
    expect(parseStripeEvent({ type: "checkout.session.completed", data: { object: {} } })).toBeNull();
    expect(parseStripeEvent({ type: "invoice.paid", data: { object: {} } })).toBeNull();
  });
});

describe("RevenueCat webhook", () => {
  it("checks the bearer secret", () => {
    expect(bearerMatches("Bearer abc123", "abc123")).toBe(true);
    expect(bearerMatches("abc123", "abc123")).toBe(true);
    expect(bearerMatches("Bearer nope", "abc123")).toBe(false);
    expect(bearerMatches(null, "abc123")).toBe(false);
    expect(bearerMatches("Bearer abc123", undefined)).toBe(false);
  });

  it("maps Apple/Google events to active, cancel-at-period-end, and expiry", () => {
    const base = { app_user_id: USER, expiration_at_ms: 1893456000000 };
    expect(parseRevenueCatEvent({ event: { ...base, type: "INITIAL_PURCHASE", store: "APP_STORE" } })).toMatchObject({ source: "apple", status: "active" });
    expect(parseRevenueCatEvent({ event: { ...base, type: "RENEWAL", store: "PLAY_STORE" } })).toMatchObject({ source: "google", status: "active" });
    expect(parseRevenueCatEvent({ event: { ...base, type: "CANCELLATION", store: "APP_STORE" } })).toMatchObject({ status: "active", cancelAtPeriodEnd: true });
    expect(parseRevenueCatEvent({ event: { ...base, type: "EXPIRATION", store: "APP_STORE" } })).toMatchObject({ status: "canceled" });
    expect(parseRevenueCatEvent({ event: { ...base, type: "BILLING_ISSUE", store: "APP_STORE" } })).toMatchObject({ status: "past_due" });
    expect(parseRevenueCatEvent({ event: { type: "TEST", app_user_id: "not-a-uuid" } })).toBeNull();
    expect(parseRevenueCatEvent({ event: { ...base, type: "TRANSFER", store: "APP_STORE" } })).toBeNull();
  });
});

describe("Razorpay", () => {
  const secret = "rzp_secret_test";

  it("verifies a checkout-return signature (order_id|payment_id) and rejects fakes", () => {
    const orderId = "order_ABC123";
    const paymentId = "pay_XYZ789";
    const sig = createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
    expect(verifyRazorpayPaymentSignature(orderId, paymentId, sig, secret)).toBe(true);
    // Tampered payment id, wrong secret, and empties are all rejected.
    expect(verifyRazorpayPaymentSignature(orderId, "pay_OTHER", sig, secret)).toBe(false);
    expect(verifyRazorpayPaymentSignature(orderId, paymentId, sig, "wrong")).toBe(false);
    expect(verifyRazorpayPaymentSignature(orderId, paymentId, "", secret)).toBe(false);
    expect(verifyRazorpayPaymentSignature("", paymentId, sig, secret)).toBe(false);
  });

  it("verifies a webhook body signature against the header", () => {
    const body = '{"event":"payment.captured"}';
    const sig = createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyRazorpayWebhookSignature(body, sig, secret)).toBe(true);
    expect(verifyRazorpayWebhookSignature(body + "x", sig, secret)).toBe(false);
    expect(verifyRazorpayWebhookSignature(body, sig, "wrong")).toBe(false);
    expect(verifyRazorpayWebhookSignature(body, null, secret)).toBe(false);
  });

  it("maps a captured payment to a lifetime unlock for the order's user; ignores the rest", () => {
    const captured = parseRazorpayWebhook({
      event: "payment.captured",
      payload: { payment: { entity: { id: "pay_1", order_id: "order_1", notes: { user_id: USER } } } },
    });
    expect(captured).toMatchObject({ userId: USER, source: "razorpay", status: "active", externalSub: "order_1" });
    expect(captured?.currentPeriodEnd).toBeNull(); // lifetime
    // order.paid also works (notes on the order).
    expect(
      parseRazorpayWebhook({ event: "order.paid", payload: { order: { entity: { id: "order_2", notes: { user_id: USER } } } } }),
    ).toMatchObject({ userId: USER, externalSub: "order_2" });
    // No user id, or an event we don't act on → ignored.
    expect(parseRazorpayWebhook({ event: "payment.captured", payload: { payment: { entity: { id: "pay_1" } } } })).toBeNull();
    expect(parseRazorpayWebhook({ event: "payment.failed", payload: { payment: { entity: { notes: { user_id: USER } } } } })).toBeNull();
  });
});
