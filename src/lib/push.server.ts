import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { logServerError } from "@/lib/errors";

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

let cachedKeys: VapidKeys | undefined;

/**
 * The VAPID key pair is created on first use and stored in the database
 * (private schema), so deployments need no extra configuration. Concurrent
 * first calls are safe: the database keeps whichever pair was stored first.
 */
export async function getVapidKeys(service: SupabaseClient): Promise<VapidKeys> {
  if (cachedKeys) return cachedKeys;
  const candidate = webpush.generateVAPIDKeys();
  const { data, error } = await service
    .rpc("server_get_or_create_vapid", { p_public: candidate.publicKey, p_private: candidate.privateKey })
    .single<{ vapid_public: string; vapid_private: string }>();
  if (error || !data) throw error ?? new Error("VAPID keys unavailable");
  cachedKeys = { publicKey: data.vapid_public, privateKey: data.vapid_private };
  return cachedKeys;
}

interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
  show_preview: boolean;
  conversation_id: string;
  sender_name: string;
  body: string;
  has_attachments: boolean;
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

export function buildPayload(t: Omit<PushTarget, "endpoint" | "p256dh" | "auth">): PushPayload {
  const preview = t.body.trim() ? t.body.trim().slice(0, 140) : t.has_attachments ? "📎 Attachment" : "New message";
  return {
    title: t.sender_name || "New message",
    body: t.show_preview ? preview : "New message",
    url: `/chat/${t.conversation_id}`,
    tag: t.conversation_id,
  };
}

/** VAPID "subject": must be an https: URL or mailto: address. */
function vapidSubject(origin: string): string {
  return origin.startsWith("https://") ? origin : "mailto:notifications@example.com";
}

/**
 * Sends a notification about `messageId` to the other members' devices.
 * The database decides who (if anyone) is notified; see server_push_targets.
 */
export async function notifyNewMessage(
  service: SupabaseClient,
  messageId: string,
  senderId: string,
  origin: string,
): Promise<number> {
  const { data, error } = await service.rpc("server_push_targets", {
    p_message_id: messageId,
    p_sender: senderId,
  });
  if (error) throw error;
  const targets = (data ?? []) as PushTarget[];
  if (targets.length === 0) return 0;

  const keys = await getVapidKeys(service);
  const options = {
    vapidDetails: { subject: vapidSubject(origin), publicKey: keys.publicKey, privateKey: keys.privateKey },
    TTL: 60 * 60 * 24,
    urgency: "high" as const,
  };

  const results = await Promise.allSettled(
    targets.map((t) =>
      webpush.sendNotification(
        { endpoint: t.endpoint, keys: { p256dh: t.p256dh, auth: t.auth } },
        JSON.stringify(buildPayload(t)),
        options,
      ),
    ),
  );

  let sent = 0;
  const expired: string[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      sent += 1;
      return;
    }
    const status = (r.reason as { statusCode?: number }).statusCode;
    // 404/410: the browser unsubscribed or the subscription expired.
    if (status === 404 || status === 410) expired.push(targets[i]!.endpoint);
    else logServerError("push.send", r.reason);
  });
  if (expired.length > 0) {
    await service.from("push_subscriptions").delete().in("endpoint", expired);
  }
  return sent;
}
