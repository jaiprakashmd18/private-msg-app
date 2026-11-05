"use client";

/**
 * Razorpay one-time payment for Loveline Plus (lifetime), web only. Razorpay
 * Checkout shows UPI (Google Pay / PhonePe / Paytm), cards, netbanking and
 * wallets. The server creates the order and verifies the signature; this file
 * just opens the checkout and hands the result back to be confirmed.
 */
import { APP_NAME } from "@/lib/env";

/** The browser knows Razorpay is on when its (public) key id is set. */
export const RAZORPAY_ENABLED = Boolean(process.env.NEXT_PUBLIC_RAZORPAY_KEY_ID);

interface RazorpaySuccess {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}
interface RazorpayOptions {
  key: string;
  order_id: string;
  amount: number;
  currency: string;
  name: string;
  description?: string;
  prefill?: { email?: string };
  theme?: { color?: string };
  handler: (response: RazorpaySuccess) => void;
  modal?: { ondismiss?: () => void };
}
interface RazorpayInstance {
  open(): void;
  on(event: "payment.failed", handler: () => void): void;
}
type RazorpayCtor = new (options: RazorpayOptions) => RazorpayInstance;

declare global {
  interface Window {
    Razorpay?: RazorpayCtor;
  }
}

const SCRIPT = "https://checkout.razorpay.com/v1/checkout.js";
let scriptPromise: Promise<boolean> | null = null;

function loadCheckout(): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  if (window.Razorpay) return Promise.resolve(true);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<boolean>((resolve) => {
    const s = document.createElement("script");
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => resolve(Boolean(window.Razorpay));
    s.onerror = () => {
      scriptPromise = null;
      resolve(false);
    };
    document.body.appendChild(s);
  });
  return scriptPromise;
}

export type PayResult = { ok: true } | { ok: false; message: string };

/** Opens Razorpay Checkout and resolves once the payment is verified (or not). */
export async function payWithRazorpay(): Promise<PayResult> {
  let order: {
    ok?: boolean;
    reason?: string;
    orderId?: string;
    amount?: number;
    currency?: string;
    keyId?: string;
    prefillEmail?: string;
  };
  try {
    const res = await fetch("/api/billing/razorpay/order", { method: "POST" });
    order = (await res.json()) as typeof order;
  } catch {
    return { ok: false, message: "Network error — check your connection and try again." };
  }
  if (!order.ok || !order.orderId || !order.keyId) {
    return {
      ok: false,
      message:
        order.reason === "not_configured"
          ? "Payments aren’t set up yet. Ask the administrator to turn on Loveline Plus."
          : "Couldn’t start the payment. Please try again.",
    };
  }

  if (!(await loadCheckout()) || !window.Razorpay) {
    return { ok: false, message: "Couldn’t open the payment window. Check your connection and try again." };
  }

  return new Promise<PayResult>((resolve) => {
    const rzp = new window.Razorpay!({
      key: order.keyId!,
      order_id: order.orderId!,
      amount: order.amount!,
      currency: order.currency!,
      name: APP_NAME,
      description: "Loveline Plus — lifetime",
      prefill: order.prefillEmail ? { email: order.prefillEmail } : undefined,
      theme: { color: "#0a84ff" },
      handler: (response) => {
        void (async () => {
          try {
            const res = await fetch("/api/billing/razorpay/verify", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(response),
            });
            const json = (await res.json()) as { is_plus?: boolean };
            resolve(
              json.is_plus
                ? { ok: true }
                : { ok: false, message: "Payment received, but it couldn’t be confirmed yet. Reload the page in a moment." },
            );
          } catch {
            resolve({ ok: false, message: "Payment received, but confirmation failed. Reload the page in a moment." });
          }
        })();
      },
      // Empty message = the person closed the window; no error toast needed.
      modal: { ondismiss: () => resolve({ ok: false, message: "" }) },
    });
    rzp.on("payment.failed", () => resolve({ ok: false, message: "Payment failed or was cancelled. No charge was made." }));
    rzp.open();
  });
}
