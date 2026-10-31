import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { describeDateReminder } from "@/lib/dates";
import { logServerError } from "@/lib/errors";
import { describeMood, describePlanReminder, formatPlanTime, tapFor } from "@/lib/love";

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
  conversation_kind?: "direct" | "group";
  conversation_title?: string | null;
  sender_name: string;
  body: string;
  has_attachments: boolean;
  attachment_kind?: "image" | "audio" | "video" | "file" | "view_once" | null;
  /** System event for taps ("nudge") and date reminders. */
  event?: {
    type: string;
    title?: string;
    kind?: string;
    years?: number;
    both?: boolean;
    mood?: string;
    note?: string | null;
    starts_at?: string;
    place?: string | null;
  } | null;
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
  /** Vibration pattern (Android), for "thinking of you". */
  vibrate?: number[];
}

export function buildPayload(t: Omit<PushTarget, "endpoint" | "p256dh" | "auth">): PushPayload {
  const url = `/chat/${t.conversation_id}`;
  const sender = t.sender_name || "Someone";
  if (t.event?.type === "nudge") {
    const tap = tapFor(t.event.kind);
    return { title: sender, body: tap.notification, url, tag: `nudge-${t.conversation_id}`, vibrate: [120, 60, 120, 60, 240] };
  }
  if (t.event?.type === "daily_answered") {
    return {
      title: sender,
      body: t.event.both ? "answered too ✨ See each other's answers" : "answered today's question 💬 Answer to see theirs",
      url,
      tag: `daily-${t.conversation_id}`,
    };
  }
  if (t.event?.type === "plan_added" && t.event.starts_at) {
    return {
      title: sender,
      body: t.show_preview ? `planned “${t.event.title ?? "a date"}” · ${formatPlanTime(t.event.starts_at)}` : "planned a date 📅",
      url,
      tag: `plan-${t.conversation_id}`,
    };
  }
  if (t.event?.type === "plan_reminder" && t.event.starts_at) {
    return {
      title: "Date reminder ⏰",
      body: t.show_preview ? describePlanReminder(t.event.title ?? "Your date", t.event.starts_at) : "You have a date coming up",
      url,
      tag: `plan-${t.conversation_id}`,
    };
  }
  if (t.event?.type === "journal") {
    return { title: sender, body: "wrote in your journal 📔", url: `${url}/journal`, tag: `journal-${t.conversation_id}` };
  }
  if (t.event?.type === "mood") {
    return {
      title: sender,
      body: t.show_preview && t.event.mood ? describeMood(t.event.mood, t.event.note, "").replace(/^ is /, "is ") : "updated their mood",
      url,
      tag: `mood-${t.conversation_id}`,
    };
  }
  if (t.event?.type === "date_reminder") {
    return {
      title: "A special day 🎉",
      body: t.show_preview
        ? describeDateReminder({ kind: t.event.kind ?? "other", title: t.event.title ?? "A special day", years: t.event.years ?? 0 })
        : "You have a special day today",
      url,
      tag: `reminder-${t.conversation_id}`,
    };
  }
  const media =
    t.attachment_kind === "view_once"
      ? "📷 View-once photo"
      : t.attachment_kind === "image"
        ? "📷 Photo"
        : t.attachment_kind === "audio"
          ? "🎤 Voice message"
          : t.attachment_kind === "video"
            ? "🎬 Video"
            : "📎 Attachment";
  const preview = t.body.trim() ? t.body.trim().slice(0, 140) : t.has_attachments ? media : "New message";
  const group = t.conversation_kind === "group";
  return {
    title: group ? (t.conversation_title ?? "Group") : sender,
    body: group ? (t.show_preview ? `${sender}: ${preview}` : `New message from ${sender}`) : t.show_preview ? preview : "New message",
    url,
    tag: t.conversation_id,
  };
}

/** VAPID "subject": must be an https: URL or mailto: address. */
function vapidSubject(origin: string): string {
  return origin.startsWith("https://") ? origin : "mailto:notifications@example.com";
}

let registeredOrigin: string | undefined;

/**
 * Tells the database where this app lives, so its every-minute job can ask
 * /api/push/hook to notify people about love notes and date reminders.
 * Only real deployments (https) are registered.
 */
export async function registerAppOrigin(service: SupabaseClient, origin: string): Promise<void> {
  if (registeredOrigin === origin || !origin.startsWith("https://")) return;
  const { error } = await service.rpc("server_register_app", { p_url: origin });
  if (error) logServerError("push.register", error);
  else registeredOrigin = origin;
}

/**
 * Sends a notification about `messageId` to the other members' devices.
 * The database decides who (if anyone) is notified; see server_push_targets.
 * `callerId` is the signed-in user asking, or null for the database's hook.
 */
export async function notifyNewMessage(
  service: SupabaseClient,
  messageId: string,
  callerId: string | null,
  origin: string,
): Promise<number> {
  const { data, error } = await service.rpc("server_push_targets", {
    p_message_id: messageId,
    p_caller: callerId,
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
