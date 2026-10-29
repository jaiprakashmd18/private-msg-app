"use client";

import type { SupabaseClient } from "@supabase/supabase-js";

/** The browser's install prompt (Chrome/Edge/Android), captured at startup. */
export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

declare global {
  interface Window {
    __installPrompt?: BeforeInstallPromptEvent | null;
  }
  interface Navigator {
    standalone?: boolean;
  }
}

export function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
}

export function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function pushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

async function saveSubscription(supabase: SupabaseClient, sub: PushSubscription, showPreview: boolean) {
  const json = sub.toJSON();
  const { error } = await supabase.rpc("save_push_subscription", {
    p_endpoint: json.endpoint,
    p_p256dh: json.keys?.p256dh,
    p_auth: json.keys?.auth,
    p_show_preview: showPreview,
    p_user_agent: navigator.userAgent.slice(0, 300),
  });
  if (error) throw error;
}

/** Asks for permission (must be called from a tap/click) and registers this device. */
export async function enablePush(supabase: SupabaseClient, showPreview: boolean): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(
      permission === "denied"
        ? "Notifications are blocked for this app. Allow them in your browser or phone settings, then try again."
        : "Notification permission was not granted.",
    );
  }
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const res = await fetch("/api/push/key");
    const json = (await res.json()) as { ok: boolean; publicKey?: string };
    if (!json.ok || !json.publicKey) throw new Error("Notifications are not available right now.");
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(json.publicKey),
    });
  }
  await saveSubscription(supabase, sub, showPreview);
}

export async function updatePushPreview(supabase: SupabaseClient, showPreview: boolean): Promise<void> {
  const sub = await currentPushSubscription();
  if (sub) await saveSubscription(supabase, sub, showPreview);
}

/** Removes this device's subscription (server first, then the browser). */
export async function disablePush(supabase: SupabaseClient): Promise<void> {
  const sub = await currentPushSubscription();
  if (!sub) return;
  await supabase.rpc("delete_push_subscription", { p_endpoint: sub.endpoint });
  await sub.unsubscribe();
}

/** Tells the server to notify the other members about a message we just sent. */
export function requestPushForMessage(messageId: string): void {
  void fetch("/api/push/notify", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ messageId }),
    keepalive: true,
  }).catch(() => undefined);
}

/** Unread total on the installed app's icon, where supported. */
export function setAppBadge(count: number): void {
  const nav = navigator as Navigator & {
    setAppBadge?: (n: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  if (count > 0) nav.setAppBadge?.(count).catch(() => undefined);
  else nav.clearAppBadge?.().catch(() => undefined);
}
