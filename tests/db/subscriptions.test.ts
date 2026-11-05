import { describe, expect, it } from "vitest";
import { asOwner, asUser, createUser, directConversation } from "./helpers";

const myAccess = (id: string) => asUser<{ is_plus: boolean }>(id, "select is_plus from public.my_access()").then((r) => r[0]!.is_plus);
const mySub = (id: string) =>
  asUser<{ is_plus: boolean; status: string; source: string | null }>(id, "select is_plus, status, source from public.my_subscription()").then((r) => r[0]!);

describe("Loveline Plus entitlement", () => {
  it("nobody is Plus by default; the admin can grant and revoke it", async () => {
    const admin = await createUser({ role: "admin" });
    const a = await createUser();
    expect(await myAccess(a.id)).toBe(false);
    expect(await mySub(a.id)).toMatchObject({ is_plus: false, status: "inactive" });

    await asUser(admin.id, "select public.admin_set_plus($1, true)", [a.id]);
    expect(await myAccess(a.id)).toBe(true);
    expect(await mySub(a.id)).toMatchObject({ is_plus: true, status: "active", source: "admin" });

    await asUser(admin.id, "select public.admin_set_plus($1, false)", [a.id]);
    expect(await myAccess(a.id)).toBe(false);
    expect(await mySub(a.id)).toMatchObject({ is_plus: false, status: "canceled" });
  });

  it("a timed grant expires", async () => {
    const admin = await createUser({ role: "admin" });
    const a = await createUser();
    await asUser(admin.id, "select public.admin_set_plus($1, true, 30)", [a.id]);
    expect(await myAccess(a.id)).toBe(true);
    // Move the end date into the past.
    await asOwner("update public.subscriptions set current_period_end = now() - interval '1 day' where user_id = $1", [a.id]);
    expect(await myAccess(a.id)).toBe(false);
  });

  it("only an admin grants; members can't grant themselves or read others", async () => {
    const a = await createUser();
    const b = await createUser();
    await expect(asUser(a.id, "select public.admin_set_plus($1, true)", [a.id])).rejects.toThrow(/Administrator privileges/i);
    await asOwner("insert into public.subscriptions (user_id, status, source) values ($1, 'active', 'stripe')", [b.id]);
    // A member reads only their own row (RLS).
    expect(await asUser(a.id, "select 1 from public.subscriptions where user_id = $1", [b.id])).toHaveLength(0);
    expect(await asUser(b.id, "select 1 from public.subscriptions where user_id = $1", [b.id])).toHaveLength(1);
  });

  it("in a chat, either partner's Plus unlocks the couple pack for both", async () => {
    const admin = await createUser({ role: "admin" });
    const a = await createUser();
    const b = await createUser();
    const conv = await directConversation(a.id, b.id);
    expect(await asUser(a.id, "select public.conversation_is_plus($1)", [conv]).then((r) => r[0])).toMatchObject({ conversation_is_plus: false });

    await asUser(admin.id, "select public.admin_set_plus($1, true)", [b.id]);
    // Neither A nor B is blocked now — one partner paying covers the chat.
    expect((await asUser<{ conversation_is_plus: boolean }>(a.id, "select public.conversation_is_plus($1)", [conv]))[0].conversation_is_plus).toBe(true);
    expect((await asUser<{ conversation_is_plus: boolean }>(b.id, "select public.conversation_is_plus($1)", [conv]))[0].conversation_is_plus).toBe(true);

    const outsider = await createUser();
    await expect(asUser(outsider.id, "select public.conversation_is_plus($1)", [conv])).rejects.toThrow(/not a member/i);
  });

  it("a billing webhook (service role) sets and ends a subscription; clients can't call it", async () => {
    const a = await createUser();
    await asUser(null, "select public.server_apply_subscription($1, 'stripe', 'active', now() + interval '30 days', 'cus_1', 'sub_1')", [a.id], "service_role");
    expect(await myAccess(a.id)).toBe(true);
    expect(await mySub(a.id)).toMatchObject({ is_plus: true, status: "active", source: "stripe" });
    await asUser(null, "select public.server_apply_subscription($1, 'stripe', 'canceled')", [a.id], "service_role");
    expect(await myAccess(a.id)).toBe(false);
    await expect(
      asUser(a.id, "select public.server_apply_subscription($1, 'stripe', 'active')", [a.id]),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asUser(null, "select public.server_apply_subscription($1, 'paypal', 'active')", [a.id], "service_role"),
    ).rejects.toThrow(/Invalid subscription source/i);
  });

  it("a Razorpay (one-time) payment unlocks Plus for life — no end date", async () => {
    const a = await createUser();
    await asUser(null, "select public.server_apply_subscription($1, 'razorpay', 'active', null, null, 'order_1')", [a.id], "service_role");
    expect(await myAccess(a.id)).toBe(true);
    expect(await mySub(a.id)).toMatchObject({ is_plus: true, status: "active", source: "razorpay" });
    // Lifetime: no current_period_end, so it never expires.
    const row = await asOwner<{ current_period_end: string | null }>(
      "select current_period_end from public.subscriptions where user_id = $1",
      [a.id],
    );
    expect(row[0]!.current_period_end).toBeNull();
  });
});
