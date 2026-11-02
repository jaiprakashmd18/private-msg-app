import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { asOwner, asUser, connect, createUser, directConversation, freshEmail, insertAuthUser, send } from "./helpers";

type Invite = { status: string; user_id: string | null; display_name: string | null };
const invite = (by: string, email: string, name: string | null = null) =>
  asUser<Invite>(by, "select * from public.invite_contact($1, $2)", [email, name]).then((r) => r[0]!);
const directory = (userId: string) =>
  asUser<{ id: string }>(userId, "select id from public.list_directory()").then((r) => r.map((x) => x.id));

/** Signs in for the first time, like Supabase Auth after Google. */
async function signIn(email: string) {
  const id = randomUUID();
  await insertAuthUser(id, email);
  return id;
}

describe("members invite their own contacts", () => {
  it("lets a member invite someone, who can sign in without the administrator", async () => {
    const a = await createUser();
    const email = freshEmail();
    expect(await invite(a.id, email.toUpperCase(), "Meenu")).toEqual({ status: "invited", user_id: null, display_name: null });
    const [entry] = await asOwner<{ status: string; added_by: string; label: string }>(
      "select status, added_by, label from public.authorized_emails where email = $1",
      [email],
    );
    expect(entry).toEqual({ status: "active", added_by: a.id, label: "Meenu" });
    expect(await asUser<{ email: string }>(a.id, "select email from public.list_my_invitations()")).toEqual([{ email }]);

    const meenu = await signIn(email);
    const [access] = await asUser<{ is_active: boolean }>(meenu, "select is_active from public.my_access()");
    expect(access?.is_active).toBe(true);
    // Both see each other, and can chat.
    expect(await directory(a.id)).toContain(meenu);
    expect(await directory(meenu)).toEqual([a.id]);
    await asUser(meenu, "select public.get_or_create_direct_conversation($1)", [a.id]);
    expect(await asUser(a.id, "select 1 from public.list_my_invitations()")).toHaveLength(0);
  });

  it("connects two existing members, and everyone who invited the same person", async () => {
    const a = await createUser();
    const b = await createUser();
    const c = await createUser();
    expect(await invite(a.id, b.email)).toMatchObject({ status: "connected", user_id: b.id });
    expect(await directory(b.id)).toContain(a.id);

    const email = freshEmail();
    await invite(a.id, email);
    await invite(c.id, email);
    const newcomer = await signIn(email);
    expect((await directory(newcomer)).sort()).toEqual([a.id, c.id].sort());
  });

  it("refuses bad emails, yourself, people the administrator disabled, and too many invites", async () => {
    const a = await createUser();
    const blocked = await createUser();
    await asOwner("update public.authorized_emails set status = 'disabled' where id = $1", [blocked.entryId]);
    await expect(invite(a.id, "not-an-email")).rejects.toThrow(/valid email/);
    await expect(invite(a.id, a.email)).rejects.toThrow(/your own email/);
    await expect(invite(a.id, blocked.email)).rejects.toThrow(/can't be invited/);
    for (let i = 0; i < 20; i++) await invite(a.id, freshEmail());
    await expect(invite(a.id, freshEmail())).rejects.toThrow(/20 people a day/);
    await expect(asUser(null, "select * from public.invite_contact('x@example.com')", [], "anon")).rejects.toThrow(
      /permission denied/,
    );
  });

  it("accepts a pending 'asked to join' request when a member invites that email", async () => {
    const a = await createUser();
    const email = freshEmail();
    await asOwner("insert into public.access_requests (email, display_name) values ($1, 'Stranger')", [email]);
    await invite(a.id, email);
    const [req] = await asOwner<{ status: string; decided_by: string }>(
      "select status, decided_by from public.access_requests where email = $1",
      [email],
    );
    expect(req).toEqual({ status: "accepted", decided_by: a.id });
  });

  it("withdrawing an unused invite takes the access away again", async () => {
    const a = await createUser();
    const c = await createUser();
    const email = freshEmail();
    await invite(a.id, email);
    await asUser(a.id, "select public.cancel_invitation($1)", [email]);
    expect(await asOwner("select 1 from public.authorized_emails where email = $1", [email])).toHaveLength(0);

    // Still allowed while someone else's invite stands.
    const shared = freshEmail();
    await invite(a.id, shared);
    await invite(c.id, shared);
    await asUser(a.id, "select public.cancel_invitation($1)", [shared]);
    expect(await asOwner("select 1 from public.authorized_emails where email = $1", [shared])).toHaveLength(1);
    await expect(asUser(a.id, "select public.cancel_invitation($1)", [shared])).rejects.toThrow(/not found/);
  });
});

describe("people only see their own contacts", () => {
  it("hides other members' names, emails and photos, and blocks chats with strangers", async () => {
    const a = await createUser();
    const b = await createUser();
    const stranger = await createUser();
    await connect(a.id, b.id);

    expect(await directory(stranger.id)).toEqual([]);
    expect(await asUser(stranger.id, "select id from public.profiles where id = any($1)", [[a.id, b.id]])).toHaveLength(0);
    expect(await asUser(a.id, "select id from public.profiles where id = $1", [b.id])).toHaveLength(1);
    expect(await asUser(a.id, "select id from public.profiles where id = $1", [stranger.id])).toHaveLength(0);
    await expect(
      asUser(stranger.id, "select public.get_or_create_direct_conversation($1)", [a.id]),
    ).rejects.toThrow(/only message your contacts/);
    await expect(
      asUser(stranger.id, "select public.create_group('x', $1::uuid[])", [[a.id]]),
    ).rejects.toThrow(/only add your contacts/);
    // Nobody can read someone else's contact list.
    expect(await asUser(stranger.id, "select 1 from public.contacts where user_id = $1", [a.id])).toHaveLength(0);
  });

  it("group members see each other inside the group, without becoming contacts", async () => {
    const a = await createUser();
    const b = await createUser();
    const c = await createUser();
    await connect(a.id, b.id);
    await connect(a.id, c.id);
    await asUser(a.id, "select public.create_group('Trip', $1::uuid[])", [[b.id, c.id]]);
    expect(await asUser(b.id, "select id from public.profiles where id = $1", [c.id])).toHaveLength(1);
    expect(await directory(b.id)).toEqual([a.id]);
  });

  it("the administrator can still reach everyone", async () => {
    const admin = await createUser({ role: "admin" });
    const member = await createUser();
    expect(await asUser(admin.id, "select id from public.profiles where id = $1", [member.id])).toHaveLength(1);
    await asUser(admin.id, "select public.get_or_create_direct_conversation($1)", [member.id]);
    expect(await directory(member.id)).toContain(admin.id);
  });
});

describe("delete chat (for me)", () => {
  it("hides the chat and its history only for me; a new message brings it back, starting empty", async () => {
    const a = await createUser();
    const b = await createUser();
    const conv = await directConversation(a.id, b.id);
    await send(a.id, conv, "secret plans");
    await send(b.id, conv, "sounds good");

    await asUser(a.id, "select public.delete_chat_for_me($1)", [conv]);
    expect(await asUser(a.id, "select 1 from public.messages where conversation_id = $1", [conv])).toHaveLength(0);
    expect(await asUser(a.id, "select 1 from public.list_conversations() where id = $1", [conv])).toHaveLength(0);
    expect(await asUser(a.id, "select 1 from public.search_messages('secret')")).toHaveLength(0);
    // The other person keeps everything.
    expect(await asUser(b.id, "select 1 from public.messages where conversation_id = $1", [conv])).toHaveLength(2);
    expect(await asUser(b.id, "select 1 from public.list_conversations() where id = $1", [conv])).toHaveLength(1);

    await send(b.id, conv, "you there?");
    const [row] = await asUser<{ last_message_body: string; unread_count: number }>(
      a.id,
      "select last_message_body, unread_count from public.list_conversations() where id = $1",
      [conv],
    );
    expect(row).toEqual({ last_message_body: "you there?", unread_count: 1 });
    const bodies = await asUser<{ body: string }>(a.id, "select body from public.messages where conversation_id = $1", [conv]);
    expect(bodies.map((m) => m.body)).toEqual(["you there?"]);

    const outsider = await createUser();
    await expect(asUser(outsider.id, "select public.delete_chat_for_me($1)", [conv])).rejects.toThrow(/not a member/);
  });
});
