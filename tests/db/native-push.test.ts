import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { asOwner, asUser, createUser, directConversation, send } from "./helpers";

const fcmToken = () => `fcm-${randomUUID()}:APA91b${randomUUID().replace(/-/g, "")}`;
const apnsToken = () => randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");

describe("phone app notifications (FCM / APNs tokens)", () => {
  it("saves Android and iPhone tokens and targets them like browsers", async () => {
    const a = await createUser();
    const b = await createUser();
    const conv = await directConversation(a.id, b.id);
    const android = fcmToken();
    const iphone = apnsToken().toUpperCase();
    await asUser(b.id, "select public.save_native_push_token('fcm', $1, true, 'GhostlineApp android')", [android]);
    await asUser(b.id, "select public.save_native_push_token('apns', $1, false, 'GhostlineApp ios')", [iphone]);

    const rows = await asUser<{ endpoint: string; show_preview: boolean }>(
      b.id,
      "select endpoint, show_preview from public.push_subscriptions order by endpoint",
    );
    expect(rows).toEqual([
      { endpoint: `apns:${iphone.toLowerCase()}`, show_preview: false },
      { endpoint: `fcm:${android}`, show_preview: true },
    ]);

    const { id: messageId } = await send(a.id, conv, "Hi from the app");
    const targets = await asUser<{ endpoint: string }>(
      null,
      "select endpoint from public.server_push_targets($1, $2)",
      [messageId, a.id],
      "service_role",
    );
    expect(targets.map((t) => t.endpoint).sort()).toEqual([`apns:${iphone.toLowerCase()}`, `fcm:${android}`]);

    // Turning off on the phone removes just that phone.
    await asUser(b.id, "select public.delete_push_subscription($1)", [`fcm:${android}`]);
    expect(await asUser(b.id, "select 1 from public.push_subscriptions")).toHaveLength(1);
  });

  it("moves a phone's token to whoever signs in on it, and rejects junk", async () => {
    const a = await createUser();
    const b = await createUser();
    const token = fcmToken();
    await asUser(a.id, "select public.save_native_push_token('fcm', $1)", [token]);
    await asUser(b.id, "select public.save_native_push_token('fcm', $1)", [token]);
    const [owner] = await asOwner<{ user_id: string }>("select user_id from public.push_subscriptions where endpoint = $1", [
      `fcm:${token}`,
    ]);
    expect(owner.user_id).toBe(b.id);

    await expect(asUser(a.id, "select public.save_native_push_token('gcm', $1)", [token])).rejects.toThrow(/Invalid push provider/);
    await expect(asUser(a.id, "select public.save_native_push_token('apns', 'not-hex')")).rejects.toThrow(/Invalid push token/);
    await expect(asUser(a.id, "select public.save_native_push_token('fcm', 'short')")).rejects.toThrow(/Invalid push token/);
    await expect(asUser(a.id, "select public.save_native_push_token('fcm', 'bad token with spaces and more')")).rejects.toThrow(
      /Invalid push token/,
    );
    await expect(
      asUser(null, "select public.save_native_push_token('fcm', $1)", [fcmToken()], "anon"),
    ).rejects.toThrow(/permission denied/);
    // The table still refuses anything that is not https / fcm / apns.
    await expect(
      asOwner("insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'ftp://x', 'k', 'a')", [a.id]),
    ).rejects.toThrow(/push_subscriptions_endpoint_check/);
  });
});
