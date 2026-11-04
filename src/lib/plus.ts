"use client";

/**
 * Ghostline Plus: the paid tier that unlocks the "couple pack". The real
 * subscription state is decided by the server (see my_subscription); this file
 * is only the shared copy and the "start subscribing" flow.
 *
 * Web: Stripe Checkout (/api/billing/checkout). Apps: Apple / Google via
 * RevenueCat, wired once the native purchase SDK is configured. Until billing
 * is set up, the administrator can grant Plus for free in Admin.
 */
import { isNativeApp } from "@/lib/native";

export const PLUS_NAME = "Ghostline Plus";

/** Shown on the paywall. Just the price label, set in Vercel; billing is configured separately. */
export const PLUS_PRICE = process.env.NEXT_PUBLIC_PLUS_PRICE || "$4.99 / month";

/** The couple pack — everything Plus unlocks. */
export const PLUS_FEATURES: Array<{ emoji: string; title: string; detail: string }> = [
  { emoji: "📔", title: "Our journal", detail: "One entry each per day, with a photo." },
  { emoji: "⛰️", title: "Bucket list", detail: "Dreams to do together, ticked off with a photo." },
  { emoji: "📅", title: "Date planner", detail: "Plan dates and get a reminder before each one." },
  { emoji: "💞", title: "Special dates", detail: "“Day 412 together”, anniversaries and meet countdowns." },
  { emoji: "⏰", title: "Love notes for later", detail: "Write now, delivered at the time you choose." },
];

export type SubscribeResult = { ok: true } | { ok: false; message: string };

/** Starts the subscription flow for wherever the user is. */
export async function startSubscribe(): Promise<SubscribeResult> {
  if (isNativeApp()) {
    // The native store purchase (RevenueCat) is wired up once its keys are set.
    return {
      ok: false,
      message: "In-app subscriptions aren’t turned on yet. For now you can subscribe on the website, or ask the admin.",
    };
  }
  let json: { url?: string; reason?: string } = {};
  try {
    const res = await fetch("/api/billing/checkout", { method: "POST", headers: { "content-type": "application/json" } });
    json = (await res.json()) as typeof json;
  } catch {
    return { ok: false, message: "Network error — check your connection and try again." };
  }
  if (json.url) {
    window.location.assign(json.url);
    return { ok: true };
  }
  return {
    ok: false,
    message:
      json.reason === "not_configured"
        ? "Subscriptions aren’t set up yet. Ask the administrator to turn on Ghostline Plus."
        : "Couldn’t start checkout. Please try again.",
  };
}
