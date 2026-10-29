/**
 * Database security test-suite. Every test talks to PostgreSQL exactly the way
 * the Supabase Data API does (role `authenticated` + JWT claims), so these
 * tests exercise the real RLS policies, grants and RPCs from the migrations.
 *
 * Run with: npm run test:db
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asOwner,
  asUser,
  createUser,
  directConversation,
  freshEmail,
  insertAuthUser,
  pool,
  send,
  setSettings,
} from "./helpers";

afterAll(async () => {
  await pool.end();
});

beforeAll(async () => {
  await setSettings({
    admin_can_read_messages: false,
    attachments_enabled: true,
    edit_window_minutes: 15,
    message_retention_days: null,
  });
});

describe("allowlist enforcement at sign-up", () => {
  const hook = (user: object) =>
    asOwner<{ r: { error?: { http_code: number; message: string } } }>(
      "select public.before_user_created_hook($1::jsonb) as r",
      [JSON.stringify({ user })],
    );

  it("rejects a Google account whose email is not approved", async () => {
    await expect(insertAuthUser(randomUUID(), freshEmail())).rejects.toThrow(/not authorized/i);
  });

  it("rejects non-Google sign-ups (email/password, magic link, anonymous) even for approved emails", async () => {
    const email = freshEmail();
    await asOwner("insert into public.authorized_emails (email) values ($1)", [email]);
    await expect(insertAuthUser(randomUUID(), email, "email")).rejects.toThrow(/Only Google sign-in/i);
    await expect(insertAuthUser(randomUUID(), email, "phone")).rejects.toThrow(/Only Google sign-in/i);
    await expect(
      asOwner("insert into auth.users (id, is_anonymous) values ($1, true)", [randomUUID()]),
    ).rejects.toThrow(/Only Google sign-in/i);
  });

  it("rejects a disabled email", async () => {
    const email = freshEmail();
    await asOwner("insert into public.authorized_emails (email, status) values ($1, 'disabled')", [email]);
    await expect(insertAuthUser(randomUUID(), email)).rejects.toThrow(/not authorized/i);
  });

  it("matches emails case-insensitively", async () => {
    const email = freshEmail();
    await asOwner("insert into public.authorized_emails (email) values ($1)", [email]);
    const id = randomUUID();
    await insertAuthUser(id, email.toUpperCase());
    const [p] = await asOwner<{ email: string }>("select email from public.profiles where id = $1", [id]);
    expect(p.email).toBe(email);
  });

  it("auth hook rejects unapproved or non-Google accounts and accepts approved Google accounts", async () => {
    const google = { provider: "google", providers: ["google"] };
    const [denied] = await hook({ email: freshEmail(), app_metadata: google });
    expect(denied.r.error?.http_code).toBe(403);

    const email = freshEmail();
    await asOwner("insert into public.authorized_emails (email) values ($1)", [email]);
    const [allowed] = await hook({ email, app_metadata: google });
    expect(allowed.r).toEqual({});

    const [wrongProvider] = await hook({ email, app_metadata: { provider: "email", providers: ["email"] } });
    expect(wrongProvider.r.error?.http_code).toBe(403);
  });

  it("access-token hook refuses tokens for disabled or unknown users", async () => {
    const u = await createUser();
    const token = (userId: string) =>
      asOwner<{ r: { error?: unknown; claims?: unknown } }>(
        "select public.custom_access_token_hook($1::jsonb) as r",
        [JSON.stringify({ user_id: userId, claims: { sub: userId, role: "authenticated" } })],
      );
    expect((await token(u.id))[0].r.claims).toBeDefined();
    await asOwner("update public.authorized_emails set status = 'disabled' where id = $1", [u.entryId]);
    expect((await token(u.id))[0].r.error).toBeDefined();
    expect((await token(randomUUID()))[0].r.error).toBeDefined();
  });

  it("creates a linked profile named from the admin label or the Google profile", async () => {
    const u = await createUser({ label: "Tester" });
    const [access] = await asUser<{ is_active: boolean; role: string; display_name: string }>(
      u.id,
      "select * from public.my_access()",
    );
    expect(access.is_active).toBe(true);
    expect(access.role).toBe("member");
    expect(access.display_name).toBe("Tester");

    const v = await createUser();
    const [noLabel] = await asUser<{ display_name: string }>(v.id, "select * from public.my_access()");
    expect(noLabel.display_name).toBe("Test User");
  });

  it("does not let a user change the email on their account", async () => {
    const u = await createUser();
    await expect(
      asOwner("update auth.users set email = $2 where id = $1", [u.id, freshEmail()]),
    ).rejects.toThrow(/not permitted/i);
  });
});

describe("privilege escalation", () => {
  it("members cannot read or modify the allowlist", async () => {
    const u = await createUser();
    expect(await asUser(u.id, "select * from public.authorized_emails")).toHaveLength(0);
    await expect(
      asUser(u.id, "insert into public.authorized_emails (email) values ($1)", [freshEmail()]),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asUser(u.id, "update public.authorized_emails set role = 'admin' where id = $1", [u.entryId]),
    ).rejects.toThrow(/permission denied/i);
  });

  it("members cannot grant themselves admin through their profile or an RPC", async () => {
    const u = await createUser();
    // Only display_name/bio are updatable; re-linking to another entry is denied.
    await expect(
      asUser(u.id, "update public.profiles set authorized_email_id = null where id = $1", [u.id]),
    ).rejects.toThrow(/permission denied/i);
    await expect(asUser(u.id, "select public.admin_add_email($1)", [freshEmail()])).rejects.toThrow(
      /Administrator privileges required/i,
    );
    await expect(asUser(u.id, "select public.admin_stats()")).rejects.toThrow(
      /Administrator privileges required/i,
    );
  });

  it("members can update only their own display name and bio", async () => {
    const a = await createUser();
    const b = await createUser();
    await asUser(a.id, "update public.profiles set display_name = 'Me' where id = $1", [a.id]);
    await asUser(a.id, "update public.profiles set display_name = 'Hacked' where id = $1", [b.id]);
    const rows = await asOwner<{ id: string; display_name: string }>(
      "select id, display_name from public.profiles where id = any($1)",
      [[a.id, b.id]],
    );
    expect(rows.find((r) => r.id === a.id)?.display_name).toBe("Me");
    expect(rows.find((r) => r.id === b.id)?.display_name).not.toBe("Hacked");
  });

  it("server-only functions are not callable by signed-in users", async () => {
    const u = await createUser();
    await expect(asUser(u.id, "select public.server_run_retention_purge()")).rejects.toThrow(
      /permission denied/i,
    );
  });

  it("the anon role can read nothing", async () => {
    const a = await createUser();
    const b = await createUser();
    const conv = await directConversation(a.id, b.id);
    await send(a.id, conv, "secret");
    for (const table of ["profiles", "messages", "conversations", "authorized_emails", "audit_logs"]) {
      await expect(asUser(null, `select * from public.${table}`, [], "anon")).rejects.toThrow(
        /permission denied/i,
      );
    }
    await expect(asUser(null, "select * from public.list_conversations()", [], "anon")).rejects.toThrow(
      /permission denied/i,
    );
  });
});

describe("conversation and message isolation", () => {
  it("outsiders cannot read another pair's messages", async () => {
    const a = await createUser();
    const b = await createUser();
    const c = await createUser();
    const conv = await directConversation(a.id, b.id);
    await send(a.id, conv, "hello b");

    expect(await asUser(b.id, "select * from public.messages where conversation_id = $1", [conv])).toHaveLength(1);
    expect(await asUser(c.id, "select * from public.messages where conversation_id = $1", [conv])).toHaveLength(0);
    expect(await asUser(c.id, "select * from public.conversations where id = $1", [conv])).toHaveLength(0);
    expect(
      await asUser(c.id, "select * from public.conversation_members where conversation_id = $1", [conv]),
    ).toHaveLength(0);
    expect(await asUser(c.id, "select * from public.search_messages('hello')")).toHaveLength(0);
  });

  it("outsiders cannot send to a conversation they are not in", async () => {
    const a = await createUser();
    const b = await createUser();
    const c = await createUser();
    const conv = await directConversation(a.id, b.id);
    await expect(send(c.id, conv, "intrusion")).rejects.toThrow(/not a member/i);
  });

  it("users cannot add themselves to a conversation or insert messages directly", async () => {
    const a = await createUser();
    const b = await createUser();
    const c = await createUser();
    const conv = await directConversation(a.id, b.id);
    await expect(
      asUser(c.id, "insert into public.conversation_members (conversation_id, user_id) values ($1, $2)", [
        conv,
        c.id,
      ]),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asUser(
        c.id,
        "insert into public.messages (conversation_id, sender_id, client_id, body) values ($1, $2, $3, 'x')",
        [conv, c.id, randomUUID()],
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asUser(a.id, "update public.messages set body = 'forged' where conversation_id = $1", [conv]),
    ).rejects.toThrow(/permission denied/i);
  });

  it("cannot start a conversation with a disabled user", async () => {
    const a = await createUser();
    const b = await createUser();
    await asOwner("update public.authorized_emails set status = 'disabled' where id = $1", [b.entryId]);
    await expect(directConversation(a.id, b.id)).rejects.toThrow(/does not have access/i);
  });

  it("creates exactly one conversation per pair", async () => {
    const a = await createUser();
    const b = await createUser();
    const first = await directConversation(a.id, b.id);
    const second = await directConversation(b.id, a.id);
    expect(second).toBe(first);
  });
});

describe("messages", () => {
  it("deduplicates retried sends with the same client_id", async () => {
    const a = await createUser();
    const b = await createUser();
    const conv = await directConversation(a.id, b.id);
    const clientId = randomUUID();
    const m1 = await send(a.id, conv, "once", clientId);
    const m2 = await send(a.id, conv, "once", clientId);
    expect(m2.id).toBe(m1.id);
    const rows = await asOwner("select 1 from public.messages where conversation_id = $1", [conv]);
    expect(rows).toHaveLength(1);
  });

  it("validates message input", async () => {
    const a = await createUser();
    const b = await createUser();
    const conv = await directConversation(a.id, b.id);
    await expect(send(a.id, conv, "   \n ")).rejects.toThrow(/empty/i);
    await expect(send(a.id, conv, "x".repeat(4001))).rejects.toThrow(/too long/i);
    const ok = await send(a.id, conv, "  line 1\nline 2  ");
    expect(ok.body).toBe("line 1\nline 2");
  });

  it("rate-limits message floods", async () => {
    const a = await createUser();
    const b = await createUser();
    const conv = await directConversation(a.id, b.id);
    for (let i = 0; i < 15; i += 1) await send(a.id, conv, `m${i}`);
    await expect(send(a.id, conv, "one too many")).rejects.toThrow(/too quickly/i);
  });

  it("only the sender can edit, and only within the edit window", async () => {
    const a = await createUser();
    const b = await createUser();
    const conv = await directConversation(a.id, b.id);
    const m = await send(a.id, conv, "original");
    await expect(asUser(b.id, "select public.edit_message($1, 'hijack')", [m.id])).rejects.toThrow(
      /not found/i,
    );
    const [edited] = await asUser<{ body: string; edited_at: string }>(
      a.id,
      "select * from public.edit_message($1, 'fixed')",
      [m.id],
    );
    expect(edited.body).toBe("fixed");
    expect(edited.edited_at).not.toBeNull();

    await asOwner("update public.messages set created_at = now() - interval '1 hour' where id = $1", [m.id]);
    await expect(asUser(a.id, "select public.edit_message($1, 'late')", [m.id])).rejects.toThrow(
      /no longer be edited/i,
    );
  });

  it("only the sender can delete; deletion wipes the body for everyone", async () => {
    const a = await createUser();
    const b = await createUser();
    const conv = await directConversation(a.id, b.id);
    const m = await send(a.id, conv, "regret");
    await expect(asUser(b.id, "select public.delete_message($1)", [m.id])).rejects.toThrow(/not found/i);
    await asUser(a.id, "select public.delete_message($1)", [m.id]);
    const [row] = await asUser<{ body: string; deleted_at: string | null }>(
      b.id,
      "select body, deleted_at from public.messages where id = $1",
      [m.id],
    );
    expect(row.body).toBe("");
    expect(row.deleted_at).not.toBeNull();
  });

  it("tracks unread counts and read receipts", async () => {
    const a = await createUser();
    const b = await createUser();
    const conv = await directConversation(a.id, b.id);
    await send(a.id, conv, "one");
    await send(a.id, conv, "two");

    const [beforeRead] = await asUser<{ unread_count: number; last_message_body: string }>(
      b.id,
      "select * from public.list_conversations() where id = $1",
      [conv],
    );
    expect(beforeRead.unread_count).toBe(2);
    expect(beforeRead.last_message_body).toBe("two");

    await asUser(b.id, "select public.mark_conversation_read($1)", [conv]);
    const [afterRead] = await asUser<{ unread_count: number }>(
      b.id,
      "select * from public.list_conversations() where id = $1",
      [conv],
    );
    expect(afterRead.unread_count).toBe(0);

    const [senderView] = await asUser<{ other_last_read_at: string | null }>(
      a.id,
      "select * from public.list_conversations() where id = $1",
      [conv],
    );
    expect(senderView.other_last_read_at).not.toBeNull();
  });

  it("a quick reply right after sending is still marked read", async () => {
    const a = await createUser();
    const b = await createUser();
    const conv = await directConversation(a.id, b.id);
    await send(a.id, conv, "ping"); // sets a's own read watermark
    await send(b.id, conv, "pong"); // immediate reply
    await asUser(a.id, "select public.mark_conversation_read($1)", [conv]);
    const [row] = await asUser<{ unread_count: number }>(
      a.id,
      "select * from public.list_conversations() where id = $1",
      [conv],
    );
    expect(row.unread_count).toBe(0);
  });

  it("history persists across sign-out / new sessions", async () => {
    const a = await createUser();
    const b = await createUser();
    const conv = await directConversation(a.id, b.id);
    await send(a.id, conv, "keep me");
    await asOwner("delete from auth.sessions where user_id = $1", [b.id]); // sign out everywhere
    await asOwner("insert into auth.sessions (id, user_id) values (gen_random_uuid(), $1)", [b.id]); // sign in again
    const rows = await asUser<{ body: string }>(
      b.id,
      "select body from public.messages where conversation_id = $1",
      [conv],
    );
    expect(rows.map((r) => r.body)).toEqual(["keep me"]);
  });

  it("search only covers the caller's conversations", async () => {
    const a = await createUser();
    const b = await createUser();
    const c = await createUser();
    const ab = await directConversation(a.id, b.id);
    const ac = await directConversation(a.id, c.id);
    await send(a.id, ab, "pineapple pizza plan");
    await send(a.id, ac, "pineapple smoothie");
    const forB = await asUser<{ conversation_id: string }>(b.id, "select * from public.search_messages('pinea')");
    expect(forB.map((r) => r.conversation_id)).toEqual([ab]);
    const forA = await asUser(a.id, "select * from public.search_messages('pineapple')");
    expect(forA).toHaveLength(2);
  });
});

describe("revocation", () => {
  it("disabling an email cuts off an existing session immediately and ends sessions", async () => {
    const admin = await createUser({ role: "admin" });
    const a = await createUser();
    const b = await createUser();
    const conv = await directConversation(a.id, b.id);
    await send(a.id, conv, "before revoke");

    await asUser(admin.id, "select public.admin_set_access_status($1, 'disabled')", [b.entryId]);

    // Same JWT as before — RLS re-checks the allowlist on every query.
    expect(await asUser(b.id, "select * from public.messages where conversation_id = $1", [conv])).toHaveLength(0);
    expect(await asUser(b.id, "select * from public.profiles")).toHaveLength(1); // own row only
    await expect(send(b.id, conv, "still here?")).rejects.toThrow(/revoked/i);
    await expect(asUser(b.id, "select * from public.list_conversations()")).rejects.toThrow(/revoked/i);
    const sessions = await asOwner("select 1 from auth.sessions where user_id = $1", [b.id]);
    expect(sessions).toHaveLength(0);
    const [access] = await asUser<{ is_active: boolean }>(b.id, "select * from public.my_access()");
    expect(access.is_active).toBe(false);

    // A cannot keep sending to a revoked participant.
    await expect(send(a.id, conv, "hello?")).rejects.toThrow(/no longer has access/i);

    // Re-enabling restores access to the full history.
    await asUser(admin.id, "select public.admin_set_access_status($1, 'active')", [b.entryId]);
    expect(await asUser(b.id, "select * from public.messages where conversation_id = $1", [conv])).toHaveLength(1);
  });

  it("removing an email revokes access; re-adding re-links the account", async () => {
    const admin = await createUser({ role: "admin" });
    const b = await createUser();
    await asUser(admin.id, "select public.admin_remove_email($1)", [b.entryId]);
    const [access] = await asUser<{ is_active: boolean }>(b.id, "select * from public.my_access()");
    expect(access.is_active).toBe(false);

    await asUser(admin.id, "select public.admin_add_email($1, 'back')", [b.email]);
    const [again] = await asUser<{ is_active: boolean }>(b.id, "select * from public.my_access()");
    expect(again.is_active).toBe(true);
  });
});

describe("admin operations", () => {
  it("admins can add emails (normalized); duplicates and bad formats are rejected; actions are audited", async () => {
    const admin = await createUser({ role: "admin" });
    const email = freshEmail();
    const [row] = await asUser<{ role: string; status: string; email: string }>(
      admin.id,
      "select * from public.admin_add_email($1, 'New person')",
      [`  ${email.toUpperCase()} `],
    );
    expect(row.email).toBe(email);
    expect(row.role).toBe("member");
    expect(row.status).toBe("active");
    await expect(asUser(admin.id, "select public.admin_add_email($1)", [email])).rejects.toThrow(
      /already on the allowlist/i,
    );
    await expect(asUser(admin.id, "select public.admin_add_email('not-an-email')")).rejects.toThrow(
      /valid email/i,
    );
    const logs = await asUser<{ action: string }>(
      admin.id,
      "select action from public.audit_logs where actor_id = $1",
      [admin.id],
    );
    expect(logs.map((l) => l.action)).toContain("admin.email_added");
  });

  it("admins cannot change administrator entries from the dashboard", async () => {
    const admin = await createUser({ role: "admin" });
    const other = await createUser({ role: "admin" });
    await expect(
      asUser(admin.id, "select public.admin_set_access_status($1, 'disabled')", [other.entryId]),
    ).rejects.toThrow(/database owner/i);
    await expect(asUser(admin.id, "select public.admin_remove_email($1)", [admin.entryId])).rejects.toThrow(
      /database owner/i,
    );
  });

  it("a disabled admin loses admin rights", async () => {
    const admin = await createUser({ role: "admin" });
    await asOwner("update public.authorized_emails set status = 'disabled' where id = $1", [admin.entryId]);
    await expect(asUser(admin.id, "select public.admin_stats()")).rejects.toThrow(/revoked/i);
  });

  it("audit logs cannot be written or altered directly, even by admins", async () => {
    const admin = await createUser({ role: "admin" });
    await expect(
      asUser(admin.id, "insert into public.audit_logs (action) values ('fake')"),
    ).rejects.toThrow(/permission denied/i);
    await expect(asUser(admin.id, "delete from public.audit_logs")).rejects.toThrow(/permission denied/i);
    await expect(asUser(admin.id, "update public.audit_logs set action = 'x'")).rejects.toThrow(
      /permission denied/i,
    );
    const member = await createUser();
    expect(await asUser(member.id, "select * from public.audit_logs")).toHaveLength(0);
  });

  it("admins cannot read message content unless the policy is enabled, and reads are audited", async () => {
    const admin = await createUser({ role: "admin" });
    const a = await createUser();
    const b = await createUser();
    const conv = await directConversation(a.id, b.id);
    await send(a.id, conv, "private words");

    // Not via RLS…
    expect(await asUser(admin.id, "select * from public.messages where conversation_id = $1", [conv])).toHaveLength(0);
    // …and not via the RPC while the policy is off.
    await expect(
      asUser(admin.id, "select * from public.admin_read_conversation_messages($1)", [conv]),
    ).rejects.toThrow(/disabled by policy/i);

    await setSettings({ admin_can_read_messages: true });
    try {
      const rows = await asUser<{ body: string }>(
        admin.id,
        "select * from public.admin_read_conversation_messages($1)",
        [conv],
      );
      expect(rows.map((r) => r.body)).toEqual(["private words"]);
      const logs = await asOwner(
        "select 1 from public.audit_logs where actor_id = $1 and action = 'admin.messages_viewed' and target_id = $2",
        [admin.id, conv],
      );
      expect(logs).toHaveLength(1);
    } finally {
      await setSettings({ admin_can_read_messages: false });
    }
  });

  it("stats and conversation listing expose metadata only", async () => {
    const admin = await createUser({ role: "admin" });
    const [stats] = await asUser<{ s: Record<string, number> }>(admin.id, "select public.admin_stats() as s");
    expect(stats.s.allowlist_total).toBeGreaterThan(0);
    const convs = await asUser<Record<string, unknown>>(admin.id, "select * from public.admin_list_conversations()");
    for (const c of convs) expect(Object.keys(c)).not.toContain("body");
  });

  it("retention purge deletes only messages older than the configured period", async () => {
    const admin = await createUser({ role: "admin" });
    const a = await createUser();
    const b = await createUser();
    const conv = await directConversation(a.id, b.id);
    const old = await send(a.id, conv, "old");
    await send(a.id, conv, "new");
    await asOwner("update public.messages set created_at = now() - interval '40 days' where id = $1", [old.id]);

    // No retention configured: nothing is purged.
    await asUser(admin.id, "select public.admin_run_retention_purge()");
    expect(await asOwner("select 1 from public.messages where conversation_id = $1", [conv])).toHaveLength(2);

    await setSettings({ message_retention_days: 30 });
    try {
      await asUser(admin.id, "select public.admin_run_retention_purge()");
      const left = await asOwner<{ body: string }>(
        "select body from public.messages where conversation_id = $1",
        [conv],
      );
      expect(left.map((r) => r.body)).toEqual(["new"]);
    } finally {
      await setSettings({ message_retention_days: null });
    }
  });

  it("user deletion removes the user's messages and is blocked for admins/self", async () => {
    const admin = await createUser({ role: "admin" });
    const a = await createUser();
    const b = await createUser();
    const conv = await directConversation(a.id, b.id);
    await send(b.id, conv, "from b");
    await send(a.id, conv, "from a");
    await asUser(admin.id, "select * from public.admin_prepare_user_deletion($1)", [b.id]);
    const left = await asOwner<{ body: string }>("select body from public.messages where conversation_id = $1", [conv]);
    expect(left.map((r) => r.body)).toEqual(["from a"]);
    await expect(
      asUser(admin.id, "select * from public.admin_prepare_user_deletion($1)", [admin.id]),
    ).rejects.toThrow(/own account/i);
  });
});

describe("attachments", () => {
  async function upload(userId: string, path: string, size = 1234, mimetype = "image/png") {
    await asUser(
      userId,
      "insert into storage.objects (bucket_id, name, owner_id, metadata) values ('attachments', $1, $2, $3)",
      [path, userId, JSON.stringify({ size, mimetype })],
    );
  }

  it("members can upload only into their own folder of their own conversations", async () => {
    const a = await createUser();
    const b = await createUser();
    const c = await createUser();
    const conv = await directConversation(a.id, b.id);
    await upload(a.id, `${conv}/${a.id}/${randomUUID()}-ok.png`);
    await expect(upload(a.id, `${conv}/${b.id}/${randomUUID()}-spoof.png`)).rejects.toThrow(
      /row-level security/i,
    );
    await expect(upload(c.id, `${conv}/${c.id}/${randomUUID()}-intrude.png`)).rejects.toThrow(
      /row-level security/i,
    );
  });

  it("attached files are readable by members only", async () => {
    const a = await createUser();
    const b = await createUser();
    const c = await createUser();
    const conv = await directConversation(a.id, b.id);
    const path = `${conv}/${a.id}/${randomUUID()}-photo.png`;
    await upload(a.id, path);

    // Before it is attached, only the uploader can see it.
    expect(await asUser(b.id, "select 1 from storage.objects where name = $1", [path])).toHaveLength(0);

    await asUser(a.id, "select public.send_message($1, $2, '', $3::jsonb)", [
      conv,
      randomUUID(),
      JSON.stringify([{ path, name: "photo.png" }]),
    ]);
    expect(await asUser(b.id, "select 1 from storage.objects where name = $1", [path])).toHaveLength(1);
    expect(await asUser(c.id, "select 1 from storage.objects where name = $1", [path])).toHaveLength(0);
    const [att] = await asUser<{ size_bytes: string; mime_type: string }>(
      b.id,
      "select size_bytes, mime_type from public.attachments where storage_path = $1",
      [path],
    );
    expect(Number(att.size_bytes)).toBe(1234);
    expect(att.mime_type).toBe("image/png");
  });

  it("cannot attach someone else's upload or an oversized file", async () => {
    const a = await createUser();
    const b = await createUser();
    const conv = await directConversation(a.id, b.id);
    const bPath = `${conv}/${b.id}/${randomUUID()}-b.png`;
    await upload(b.id, bPath);
    await expect(
      asUser(a.id, "select public.send_message($1, $2, '', $3::jsonb)", [
        conv,
        randomUUID(),
        JSON.stringify([{ path: bPath, name: "b.png" }]),
      ]),
    ).rejects.toThrow(/Invalid attachment path/i);

    const big = `${conv}/${a.id}/${randomUUID()}-big.bin`;
    await asOwner(
      "insert into storage.objects (bucket_id, name, owner_id, metadata) values ('attachments', $1, $2, $3)",
      [big, a.id, JSON.stringify({ size: 20 * 1024 * 1024, mimetype: "application/zip" })],
    );
    await expect(
      asUser(a.id, "select public.send_message($1, $2, '', $3::jsonb)", [
        conv,
        randomUUID(),
        JSON.stringify([{ path: big, name: "big.bin" }]),
      ]),
    ).rejects.toThrow(/10 MB/i);
  });

  it("uploads are blocked when the administrator disables attachments", async () => {
    const a = await createUser();
    const b = await createUser();
    const conv = await directConversation(a.id, b.id);
    await setSettings({ attachments_enabled: false });
    try {
      await expect(upload(a.id, `${conv}/${a.id}/${randomUUID()}-x.png`)).rejects.toThrow(
        /row-level security/i,
      );
    } finally {
      await setSettings({ attachments_enabled: true });
    }
  });
});

describe("push notifications", () => {
  const sub = () => ({ endpoint: `https://push.example.com/${randomUUID()}`, p256dh: "BPk3x", auth: "a1b2" });
  const save = (userId: string, s: ReturnType<typeof sub>, preview = true) =>
    asUser(userId, "select public.save_push_subscription($1, $2, $3, $4, 'test-agent')", [
      s.endpoint,
      s.p256dh,
      s.auth,
      preview,
    ]);

  it("members manage only their own device subscriptions", async () => {
    const a = await createUser();
    const b = await createUser();
    const s = sub();
    await save(a.id, s);
    expect(await asUser(a.id, "select endpoint from public.push_subscriptions")).toHaveLength(1);
    expect(await asUser(b.id, "select endpoint from public.push_subscriptions")).toHaveLength(0);
    await expect(
      asUser(b.id, "insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, $2, 'x', 'y')", [
        b.id,
        sub().endpoint,
      ]),
    ).rejects.toThrow(/permission denied/i);
    // B cannot delete A's subscription.
    await asUser(b.id, "select public.delete_push_subscription($1)", [s.endpoint]);
    expect(await asOwner("select 1 from public.push_subscriptions where endpoint = $1", [s.endpoint])).toHaveLength(1);
    await asUser(a.id, "select public.delete_push_subscription($1)", [s.endpoint]);
    expect(await asOwner("select 1 from public.push_subscriptions where endpoint = $1", [s.endpoint])).toHaveLength(0);
  });

  it("rejects invalid subscriptions and users without access", async () => {
    const a = await createUser();
    await expect(
      asUser(a.id, "select public.save_push_subscription('http://insecure.example', 'k', 'a')"),
    ).rejects.toThrow(/Invalid push subscription/i);
    await asOwner("update public.authorized_emails set status = 'disabled' where id = $1", [a.entryId]);
    await expect(save(a.id, sub())).rejects.toThrow(/revoked/i);
  });

  it("server functions are not callable by signed-in users", async () => {
    const a = await createUser();
    await expect(asUser(a.id, "select * from public.server_push_targets($1, $2)", [randomUUID(), a.id])).rejects.toThrow(
      /permission denied/i,
    );
    await expect(asUser(a.id, "select * from public.server_get_or_create_vapid('x', 'y')")).rejects.toThrow(
      /permission denied/i,
    );
  });

  it("notifies only the other active members, only once, only for the real sender's recent message", async () => {
    const a = await createUser();
    const b = await createUser();
    const conv = await directConversation(a.id, b.id);
    const aSub = sub();
    const bSub = sub();
    await save(a.id, aSub);
    await save(b.id, bSub, false);

    const m = await send(a.id, conv, "hello there");
    // Someone else claiming to be the sender gets nothing (and doesn't use up the notification).
    expect(await asOwner("select * from public.server_push_targets($1, $2)", [m.id, b.id])).toHaveLength(0);

    const targets = await asOwner<{ endpoint: string; show_preview: boolean; body: string; sender_name: string }>(
      "select * from public.server_push_targets($1, $2)",
      [m.id, a.id],
    );
    expect(targets.map((t) => t.endpoint)).toEqual([bSub.endpoint]); // not the sender's own device
    expect(targets[0].show_preview).toBe(false);
    expect(targets[0].body).toBe("hello there");
    expect(targets[0].sender_name).toBe("Test User");

    // Second call for the same message: nothing (no duplicate notifications).
    expect(await asOwner("select * from public.server_push_targets($1, $2)", [m.id, a.id])).toHaveLength(0);

    // Old messages can't be used to spam notifications.
    const old = await send(a.id, conv, "old news");
    await asOwner("update public.messages set created_at = now() - interval '1 hour' where id = $1", [old.id]);
    expect(await asOwner("select * from public.server_push_targets($1, $2)", [old.id, a.id])).toHaveLength(0);

    // Disabled recipients are not notified.
    await asOwner("update public.authorized_emails set status = 'disabled' where id = $1", [b.entryId]);
    const m2 = await send(b.id, conv, "x").catch(() => null); // B can't send any more
    expect(m2).toBeNull();
    await asOwner("update public.authorized_emails set status = 'active' where id = $1", [b.entryId]);
    const m3 = await send(a.id, conv, "while b disabled");
    await asOwner("update public.authorized_emails set status = 'disabled' where id = $1", [b.entryId]);
    expect(await asOwner("select * from public.server_push_targets($1, $2)", [m3.id, a.id])).toHaveLength(0);
  });

  it("keeps the first VAPID key pair", async () => {
    const [first] = await asOwner<{ vapid_public: string }>(
      "select * from public.server_get_or_create_vapid('pub-1', 'priv-1')",
    );
    const [second] = await asOwner<{ vapid_public: string }>(
      "select * from public.server_get_or_create_vapid('pub-2', 'priv-2')",
    );
    expect(second.vapid_public).toBe(first.vapid_public);
  });
});

describe("group chats", () => {
  async function group(admin: string, members: string[], title = "Weekend plans") {
    const [row] = await asUser<{ id: string }>(admin, "select public.create_group($1, $2) as id", [title, members]);
    return row.id;
  }
  const sendTo = (userId: string, conv: string, body: string) => send(userId, conv, body);

  it("creates a group; members chat, outsiders see nothing", async () => {
    const a = await createUser();
    const b = await createUser();
    const c = await createUser();
    const out = await createUser();
    const g = await group(a.id, [b.id, c.id]);
    await sendTo(b.id, g, "hi all");
    for (const u of [a, b, c]) {
      const rows = await asUser<{ body: string }>(u.id, "select body from public.messages where conversation_id = $1 and system_event is null", [g]);
      expect(rows.map((r) => r.body)).toEqual(["hi all"]);
    }
    expect(await asUser(out.id, "select 1 from public.messages where conversation_id = $1", [g])).toHaveLength(0);
    await expect(sendTo(out.id, g, "let me in")).rejects.toThrow(/not a member/i);
    const [inbox] = await asUser<{ kind: string; title: string; member_count: number; is_group_admin: boolean }>(
      a.id,
      "select * from public.list_conversations() where id = $1",
      [g],
    );
    expect(inbox).toMatchObject({ kind: "group", title: "Weekend plans", member_count: 3, is_group_admin: true });
  });

  it("validates group creation", async () => {
    const a = await createUser();
    const b = await createUser();
    await expect(group(a.id, [b.id], "  ")).rejects.toThrow(/Group name/i);
    await expect(group(a.id, [a.id])).rejects.toThrow(/at least one other/i);
    await asOwner("update public.authorized_emails set status = 'disabled' where id = $1", [b.entryId]);
    await expect(group(a.id, [b.id])).rejects.toThrow(/don't have access/i);
  });

  it("only group admins add, remove or rename; anyone can leave", async () => {
    const a = await createUser();
    const b = await createUser();
    const c = await createUser();
    const g = await group(a.id, [b.id]);
    await expect(asUser(b.id, "select public.add_group_members($1, $2)", [g, [c.id]])).rejects.toThrow(/Only group admins/i);
    await expect(asUser(b.id, "select public.remove_group_member($1, $2)", [g, a.id])).rejects.toThrow(/Only group admins/i);
    await expect(asUser(b.id, "select public.rename_group($1, 'Hacked')", [g])).rejects.toThrow(/Only group admins/i);
    await expect(asUser(b.id, "select public.set_group_admin($1, $2, true)", [g, b.id])).rejects.toThrow(/Only group admins/i);

    await asUser(a.id, "select public.add_group_members($1, $2)", [g, [c.id]]);
    await asUser(a.id, "select public.rename_group($1, 'Renamed')", [g]);
    const events = await asUser<{ e: { type: string } }>(
      c.id,
      "select system_event as e from public.messages where conversation_id = $1 and system_event is not null order by created_at",
      [g],
    );
    expect(events.map((r) => r.e.type)).toEqual(["group_created", "member_added", "renamed"]);

    await asUser(b.id, "select public.remove_group_member($1, $2)", [g, b.id]); // leave
    expect(await asUser(b.id, "select 1 from public.messages where conversation_id = $1", [g])).toHaveLength(0);
  });

  it("removed members lose access immediately; re-added members get it back", async () => {
    const a = await createUser();
    const b = await createUser();
    const c = await createUser();
    const g = await group(a.id, [b.id, c.id]);
    await sendTo(a.id, g, "before");
    await asUser(a.id, "select public.remove_group_member($1, $2)", [g, b.id]);
    expect(await asUser(b.id, "select 1 from public.messages where conversation_id = $1", [g])).toHaveLength(0);
    expect(await asUser(b.id, "select * from public.list_conversations() where id = $1", [g])).toHaveLength(0);
    await expect(sendTo(b.id, g, "still here?")).rejects.toThrow(/not a member/i);
    await expect(asUser(b.id, "select * from public.list_conversation_members($1)", [g])).rejects.toThrow(/not a member/i);
    await asUser(a.id, "select public.add_group_members($1, $2)", [g, [b.id]]);
    expect((await asUser(b.id, "select 1 from public.messages where conversation_id = $1 and system_event is null", [g])).length).toBe(1);
  });

  it("keeps an admin when the last admin leaves", async () => {
    const a = await createUser();
    const b = await createUser();
    const g = await group(a.id, [b.id]);
    await asUser(a.id, "select public.remove_group_member($1, $2)", [g, a.id]);
    const members = await asUser<{ user_id: string; is_admin: boolean; left_at: string | null }>(
      b.id,
      "select * from public.list_conversation_members($1)",
      [g],
    );
    expect(members.filter((m) => !m.left_at)).toEqual([expect.objectContaining({ user_id: b.id, is_admin: true })]);
    // The person who left is still listed (for names in the history), marked as left.
    expect(members.find((m) => m.user_id === a.id)?.left_at).not.toBeNull();
  });

  it("group keeps working when one member is disabled; read receipts wait for everyone", async () => {
    const a = await createUser();
    const b = await createUser();
    const c = await createUser();
    const g = await group(a.id, [b.id, c.id]);
    await sendTo(a.id, g, "ping");
    await asUser(b.id, "select public.mark_conversation_read($1)", [g]);
    let [row] = await asUser<{ other_last_read_at: string | null }>(a.id, "select * from public.list_conversations() where id = $1", [g]);
    expect(row.other_last_read_at).toBeNull(); // C hasn't read yet
    await asUser(c.id, "select public.mark_conversation_read($1)", [g]);
    [row] = await asUser<{ other_last_read_at: string | null }>(a.id, "select * from public.list_conversations() where id = $1", [g]);
    expect(row.other_last_read_at).not.toBeNull();

    await asOwner("update public.authorized_emails set status = 'disabled' where id = $1", [c.entryId]);
    await expect(sendTo(a.id, g, "still works")).resolves.toBeDefined();
  });

  it("system messages don't count as unread and can't be edited or deleted", async () => {
    const a = await createUser();
    const b = await createUser();
    const g = await group(a.id, [b.id]);
    const [row] = await asUser<{ unread_count: number }>(b.id, "select * from public.list_conversations() where id = $1", [g]);
    expect(row.unread_count).toBe(0);
    const [sys] = await asOwner<{ id: string }>("select id from public.messages where conversation_id = $1 and system_event is not null", [g]);
    await expect(asUser(a.id, "select public.edit_message($1, 'x')", [sys.id])).rejects.toThrow(/not found/i);
    await expect(asUser(a.id, "select public.delete_message($1)", [sys.id])).rejects.toThrow(/not found/i);
  });
});

describe("replies and reactions", () => {
  it("replies must point into the same conversation", async () => {
    const a = await createUser();
    const b = await createUser();
    const c = await createUser();
    const ab = await directConversation(a.id, b.id);
    const ac = await directConversation(a.id, c.id);
    const original = await send(a.id, ab, "original");
    const elsewhere = await send(a.id, ac, "elsewhere");
    const [reply] = await asUser<{ reply_to_id: string }>(
      b.id,
      "select * from public.send_message($1, $2, 'reply', '[]', $3)",
      [ab, randomUUID(), original.id],
    );
    expect(reply.reply_to_id).toBe(original.id);
    await expect(
      asUser(b.id, "select * from public.send_message($1, $2, 'sneaky', '[]', $3)", [ab, randomUUID(), elsewhere.id]),
    ).rejects.toThrow(/not in this conversation/i);
  });

  it("members react (one per person, tap again to remove); outsiders can't", async () => {
    const a = await createUser();
    const b = await createUser();
    const c = await createUser();
    const conv = await directConversation(a.id, b.id);
    const m = await send(a.id, conv, "react to me");
    await asUser(b.id, "select public.toggle_reaction($1, '👍')", [m.id]);
    await asUser(b.id, "select public.toggle_reaction($1, '❤️')", [m.id]); // changes, not adds
    let rows = await asUser<{ emoji: string | null }>(a.id, "select emoji from public.message_reactions where message_id = $1", [m.id]);
    expect(rows.map((r) => r.emoji)).toEqual(["❤️"]);
    await asUser(b.id, "select public.toggle_reaction($1, '❤️')", [m.id]); // same again = remove
    rows = await asUser<{ emoji: string | null }>(a.id, "select emoji from public.message_reactions where message_id = $1", [m.id]);
    expect(rows.map((r) => r.emoji)).toEqual([null]);

    await expect(asUser(c.id, "select public.toggle_reaction($1, '😂')", [m.id])).rejects.toThrow(/not found/i);
    expect(await asUser(c.id, "select 1 from public.message_reactions where message_id = $1", [m.id])).toHaveLength(0);
    await expect(
      asUser(c.id, "insert into public.message_reactions (message_id, conversation_id, user_id, emoji) values ($1, $2, $3, '😂')", [
        m.id,
        conv,
        c.id,
      ]),
    ).rejects.toThrow(/permission denied/i);
    await asUser(a.id, "select public.delete_message($1)", [m.id]);
    await expect(asUser(b.id, "select public.toggle_reaction($1, '👍')", [m.id])).rejects.toThrow(/can't react/i);
  });
});

describe("photos, thumbnails and voice notes", () => {
  async function upload(userId: string, path: string, mimetype = "image/jpeg", size = 2000) {
    await asUser(
      userId,
      "insert into storage.objects (bucket_id, name, owner_id, metadata) values ('attachments', $1, $2, $3)",
      [path, userId, JSON.stringify({ size, mimetype })],
    );
  }

  it("stores size and duration info; thumbnails are readable by members only", async () => {
    const a = await createUser();
    const b = await createUser();
    const c = await createUser();
    const conv = await directConversation(a.id, b.id);
    const photo = `${conv}/${a.id}/${randomUUID()}-photo.jpg`;
    const thumb = `${conv}/${a.id}/${randomUUID()}-thumb.jpg`;
    const voice = `${conv}/${a.id}/${randomUUID()}-voice.webm`;
    await upload(a.id, photo);
    await upload(a.id, thumb, "image/jpeg", 300);
    await upload(a.id, voice, "audio/webm", 5000);
    await asUser(a.id, "select public.send_message($1, $2, '', $3::jsonb)", [
      conv,
      randomUUID(),
      JSON.stringify([
        { path: photo, thumb_path: thumb, name: "photo.jpg", width: 1600, height: 1200 },
        { path: voice, name: "Voice message", duration_ms: 4200 },
      ]),
    ]);
    const atts = await asUser<{ mime_type: string; width: number; duration_ms: number; thumb_path: string }>(
      b.id,
      "select * from public.attachments where conversation_id = $1 order by mime_type",
      [conv],
    );
    expect(atts.map((x) => [x.mime_type, x.width, x.duration_ms])).toEqual([
      ["audio/webm", null, 4200],
      ["image/jpeg", 1600, null],
    ]);
    expect(await asUser(b.id, "select 1 from storage.objects where name = $1", [thumb])).toHaveLength(1);
    expect(await asUser(c.id, "select 1 from storage.objects where name = $1", [thumb])).toHaveLength(0);
  });

  it("rejects thumbnails that aren't the sender's own upload", async () => {
    const a = await createUser();
    const b = await createUser();
    const conv = await directConversation(a.id, b.id);
    const photo = `${conv}/${a.id}/${randomUUID()}-p.jpg`;
    const bThumb = `${conv}/${b.id}/${randomUUID()}-t.jpg`;
    await upload(a.id, photo);
    await upload(b.id, bThumb);
    await expect(
      asUser(a.id, "select public.send_message($1, $2, '', $3::jsonb)", [
        conv,
        randomUUID(),
        JSON.stringify([{ path: photo, thumb_path: bThumb, name: "p.jpg" }]),
      ]),
    ).rejects.toThrow(/Invalid thumbnail/i);
  });

  it("deleting a photo message returns both file and thumbnail for removal", async () => {
    const a = await createUser();
    const b = await createUser();
    const conv = await directConversation(a.id, b.id);
    const photo = `${conv}/${a.id}/${randomUUID()}-p.jpg`;
    const thumb = `${conv}/${a.id}/${randomUUID()}-t.jpg`;
    await upload(a.id, photo);
    await upload(a.id, thumb);
    const [m] = await asUser<{ id: string }>(a.id, "select * from public.send_message($1, $2, '', $3::jsonb)", [
      conv,
      randomUUID(),
      JSON.stringify([{ path: photo, thumb_path: thumb, name: "p.jpg" }]),
    ]);
    const paths = await asUser<{ p: string }>(a.id, "select p from public.delete_message($1) as p", [m.id]);
    expect(paths.map((r) => r.p).sort()).toEqual([photo, thumb].sort());
  });
});

describe("online status", () => {
  it("heartbeat updates last seen, visible to conversation members", async () => {
    const a = await createUser();
    const b = await createUser();
    const conv = await directConversation(a.id, b.id);
    await send(a.id, conv, "hi");
    await asUser(a.id, "select public.heartbeat()");
    const [row] = await asUser<{ other_last_seen_at: string | null }>(b.id, "select * from public.list_conversations() where id = $1", [conv]);
    expect(row.other_last_seen_at).not.toBeNull();
  });
});
