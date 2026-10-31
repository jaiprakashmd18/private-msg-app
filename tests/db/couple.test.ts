import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { asOwner, asUser, createUser, directConversation } from "./helpers";

async function upload(userId: string, path: string, mimetype = "image/jpeg", bucket = "attachments") {
  await asUser(
    userId,
    "insert into storage.objects (bucket_id, name, owner_id, metadata) values ($1, $2, $3, $4)",
    [bucket, path, userId, JSON.stringify({ size: 2000, mimetype })],
  );
}

async function subscribePush(userId: string) {
  await asUser(userId, "select public.save_push_subscription($1, $2, $3, true, 'test')", [
    `https://push.example.com/${randomUUID()}`,
    "p256dh-key",
    "auth-key",
  ]);
}

const pushTargets = (messageId: string, caller: string | null) =>
  asUser<{ endpoint: string; event: { type: string } | null }>(
    null,
    "select * from public.server_push_targets($1, $2)",
    [messageId, caller],
    "service_role",
  );

/** A time zone where it is currently daytime (reminders start at 08:00 local). */
async function daytimeZone(): Promise<string> {
  const [row] = await asOwner<{ name: string }>(
    `select name from pg_timezone_names
     where extract(hour from now() at time zone name) between 9 and 20 and name like '%/%'
     order by name limit 1`,
  );
  return row.name;
}

describe("view-once photos", () => {
  async function sendViewOnce(senderId: string, conv: string, extra: Record<string, unknown> = {}, body = "") {
    const path = `${conv}/${senderId}/${randomUUID()}-secret.jpg`;
    await upload(senderId, path);
    const [msg] = await asUser<{ id: string }>(senderId, "select * from public.send_message($1, $2, $3, $4::jsonb)", [
      conv,
      randomUUID(),
      body,
      JSON.stringify([{ path, name: "secret.jpg", view_once: true, ...extra }]),
    ]);
    const [att] = await asOwner<{ id: string }>("select id from public.attachments where message_id = $1", [msg.id]);
    return { path, attachmentId: att.id };
  }

  it("must be a single photo without caption", async () => {
    const a = await createUser();
    const b = await createUser();
    const conv = await directConversation(a.id, b.id);
    await expect(sendViewOnce(a.id, conv, {}, "caption")).rejects.toThrow(/on its own/);
    const pdf = `${conv}/${a.id}/${randomUUID()}-doc.pdf`;
    await upload(a.id, pdf, "application/pdf");
    await expect(
      asUser(a.id, "select public.send_message($1, $2, '', $3::jsonb)", [
        conv,
        randomUUID(),
        JSON.stringify([{ path: pdf, name: "doc.pdf", view_once: true }]),
      ]),
    ).rejects.toThrow(/Only photos/);
  });

  it("only the recipient can open it, once; nobody can read the file before or after", async () => {
    const a = await createUser();
    const b = await createUser();
    const c = await createUser();
    const conv = await directConversation(a.id, b.id);
    const { path, attachmentId } = await sendViewOnce(a.id, conv);
    const canRead = (userId: string) =>
      asUser(userId, "select 1 from storage.objects where bucket_id = 'attachments' and name = $1", [path]);

    // Before opening: nobody, not even the sender, can read the file.
    expect(await canRead(b.id)).toHaveLength(0);
    expect(await canRead(a.id)).toHaveLength(0);

    await expect(asUser(a.id, "select public.open_view_once($1)", [attachmentId])).rejects.toThrow(/person you sent it to/);
    await expect(asUser(c.id, "select public.open_view_once($1)", [attachmentId])).rejects.toThrow(/not found/);

    const [opened] = await asUser<{ p: string }>(b.id, "select public.open_view_once($1) as p", [attachmentId]);
    expect(opened.p).toBe(path);
    expect(await canRead(b.id)).toHaveLength(1);
    expect(await canRead(a.id)).toHaveLength(0);
    expect(await canRead(c.id)).toHaveLength(0);
    // A retry right away (e.g. a dropped connection) still works.
    await asUser(b.id, "select public.open_view_once($1)", [attachmentId]);

    // A minute later it is gone for good.
    await asOwner("update public.attachments set viewed_at = now() - interval '2 minutes' where id = $1", [attachmentId]);
    expect(await canRead(b.id)).toHaveLength(0);
    await expect(asUser(b.id, "select public.open_view_once($1)", [attachmentId])).rejects.toThrow(/already opened/);

    // The server can find the file to delete it only for the person who opened it.
    const [forB] = await asUser<{ p: string | null }>(
      null,
      "select public.server_view_once_opened_path($1, $2) as p",
      [attachmentId, b.id],
      "service_role",
    );
    expect(forB.p).toBe(path);
    const [forC] = await asUser<{ p: string | null }>(
      null,
      "select public.server_view_once_opened_path($1, $2) as p",
      [attachmentId, c.id],
      "service_role",
    );
    expect(forC.p).toBeNull();
    await expect(asUser(b.id, "select public.server_view_once_opened_path($1, $2)", [attachmentId, b.id])).rejects.toThrow(
      /permission denied/,
    );
  });

  it("is not allowed in groups", async () => {
    const a = await createUser();
    const b = await createUser();
    const [g] = await asUser<{ id: string }>(a.id, "select public.create_group('Fam', $1::uuid[]) as id", [[b.id]]);
    await expect(sendViewOnce(a.id, g.id)).rejects.toThrow(/one-to-one/);
  });
});

describe("chat wallpaper and colours", () => {
  it("each member sets their own, only with their own photo", async () => {
    const a = await createUser();
    const b = await createUser();
    const conv = await directConversation(a.id, b.id);
    const mine = `users/${a.id}/${randomUUID()}.jpg`;
    await upload(a.id, mine, "image/jpeg", "avatars");
    const theirs = `users/${b.id}/${randomUUID()}.jpg`;
    await upload(b.id, theirs, "image/jpeg", "avatars");

    await expect(
      asUser(a.id, "select public.set_chat_appearance($1, $2, 'rose')", [conv, theirs]),
    ).rejects.toThrow(/Invalid wallpaper/);
    await expect(
      asUser(a.id, "select public.set_chat_appearance($1, null, 'neon')", [conv]),
    ).rejects.toThrow(/Unknown colour/);
    await asUser(a.id, "select public.set_chat_appearance($1, $2, 'rose')", [conv, mine]);

    const [forA] = await asUser<{ wallpaper_path: string; bubble_color: string }>(
      a.id,
      "select * from public.get_chat_appearance($1)",
      [conv],
    );
    expect(forA).toEqual({ wallpaper_path: mine, bubble_color: "rose" });
    const [forB] = await asUser<{ wallpaper_path: string | null }>(b.id, "select * from public.get_chat_appearance($1)", [conv]);
    expect(forB.wallpaper_path).toBeNull();

    const c = await createUser();
    await expect(asUser(c.id, "select public.set_chat_appearance($1, null, 'blue')", [conv])).rejects.toThrow(/not a member/);
  });
});

describe("thinking of you", () => {
  it("sends a heart to the other person, notifies them, and is rate-limited", async () => {
    const a = await createUser();
    const b = await createUser();
    const c = await createUser();
    const conv = await directConversation(a.id, b.id);
    await subscribePush(a.id);
    await subscribePush(b.id);

    const [n] = await asUser<{ id: string }>(a.id, "select public.send_nudge($1) as id", [conv]);
    const [msg] = await asUser<{ sender_id: string; system_event: { type: string } }>(
      b.id,
      "select sender_id, system_event from public.messages where id = $1",
      [n.id],
    );
    expect(msg).toEqual({ sender_id: a.id, system_event: { type: "nudge", kind: "heart" } });

    // Only the sender may trigger its notification; it goes to the other person only.
    expect(await pushTargets(n.id, b.id)).toHaveLength(0);
    const targets = await pushTargets(n.id, a.id);
    expect(targets).toHaveLength(1);
    expect(targets[0]!.event).toEqual({ type: "nudge", kind: "heart" });
    expect(await pushTargets(n.id, a.id)).toHaveLength(0); // once

    await asUser(a.id, "select public.send_nudge($1)", [conv]);
    await asUser(a.id, "select public.send_nudge($1)", [conv]);
    await expect(asUser(a.id, "select public.send_nudge($1)", [conv])).rejects.toThrow(/lot of love/);
    await expect(asUser(c.id, "select public.send_nudge($1)", [conv])).rejects.toThrow(/not a member/);
  });
});

describe("special dates", () => {
  it("are shared by the two people, one 'together since' per chat, and private to them", async () => {
    const a = await createUser();
    const b = await createUser();
    const c = await createUser();
    const conv = await directConversation(a.id, b.id);
    const save = (userId: string, kind: string, title: string, date: string, id: string | null = null) =>
      asUser<{ id: string; title: string; tz: string; yearly: boolean }>(
        userId,
        "select * from public.save_special_date($1, $2, $3, $4, $5::date, true, true, $6)",
        [id, conv, kind, title, date, "Asia/Kolkata"],
      );

    const [together] = await save(a.id, "together", "", "2023-02-14");
    expect(together.title).toBe("Together");
    expect(together.tz).toBe("Asia/Kolkata");
    await expect(save(b.id, "together", "Again", "2024-01-01")).rejects.toThrow(/already have/);
    const [bday] = await save(b.id, "birthday", "Alex's birthday", "1995-06-30");
    await save(a.id, "birthday", "Alex's birthday 🎂", "1995-06-30", bday.id);

    const rows = await asUser<{ title: string }>(b.id, "select title from public.special_dates where conversation_id = $1 and deleted_at is null order by title", [conv]);
    expect(rows.map((r) => r.title)).toEqual(["Alex's birthday 🎂", "Together"]);
    expect(await asUser(c.id, "select 1 from public.special_dates where conversation_id = $1", [conv])).toHaveLength(0);
    await expect(save(c.id, "other", "Hack", "2024-01-01")).rejects.toThrow(/not a member/);

    // Unknown time zones fall back to UTC; deleting is soft and frees the "together" slot.
    const [odd] = await asUser<{ tz: string }>(
      a.id,
      "select * from public.save_special_date(null, $1, 'other', 'Trip', '2030-05-01', false, true, 'Mars/Olympus')",
      [conv],
    );
    expect(odd.tz).toBe("UTC");
    await asUser(a.id, "select public.delete_special_date($1)", [together.id]);
    await save(b.id, "together", "Us", "2023-02-15");
  });

  it("posts a reminder on the day (once) and notifies both people", async () => {
    const a = await createUser();
    const b = await createUser();
    const conv = await directConversation(a.id, b.id);
    await subscribePush(a.id);
    await subscribePush(b.id);
    const tz = await daytimeZone();
    const [row] = await asUser<{ id: string }>(
      a.id,
      `select * from public.save_special_date(null, $1, 'anniversary', 'Our wedding',
         ((now() at time zone $2)::date - interval '3 years')::date, true, true, $2)`,
      [conv, tz],
    );
    // A date that isn't today and one with reminders off: no message.
    await asUser(
      a.id,
      `select public.save_special_date(null, $1, 'birthday', 'Not today',
         ((now() at time zone $2)::date + 10)::date, true, true, $2)`,
      [conv, tz],
    );
    await asUser(
      a.id,
      `select public.save_special_date(null, $1, 'other', 'Quiet', (now() at time zone $2)::date, false, false, $2)`,
      [conv, tz],
    );

    const [delivered] = await asUser<{ ids: string[] }>(b.id, "select public.deliver_due_items() as ids");
    expect(delivered.ids).toHaveLength(1);
    const [msg] = await asUser<{ sender_id: string | null; system_event: Record<string, unknown>; was_scheduled: boolean }>(
      a.id,
      "select sender_id, system_event, was_scheduled from public.messages where id = $1",
      [delivered.ids[0]],
    );
    expect(msg.sender_id).toBeNull();
    expect(msg.was_scheduled).toBe(true);
    expect(msg.system_event).toMatchObject({ type: "date_reminder", date_id: row.id, title: "Our wedding", years: 3 });

    const [again] = await asUser<{ ids: string[] }>(a.id, "select public.deliver_due_items() as ids");
    expect(again.ids).toHaveLength(0);
    // Reminders notify both people (it has no sender); the database hook may ask too.
    expect(await pushTargets(delivered.ids[0]!, null)).toHaveLength(2);
  });
});

describe("love notes for later", () => {
  it("stay private to the author until delivered, then arrive exactly once", async () => {
    const a = await createUser();
    const b = await createUser();
    const c = await createUser();
    const conv = await directConversation(a.id, b.id);
    await subscribePush(b.id);

    await expect(
      asUser(a.id, "select public.schedule_message($1, 'Too late', now() - interval '1 minute')", [conv]),
    ).rejects.toThrow(/future/);
    await expect(
      asUser(c.id, "select public.schedule_message($1, 'Hi', now() + interval '1 hour')", [conv]),
    ).rejects.toThrow(/not a member/);
    const [note] = await asUser<{ id: string }>(
      a.id,
      "select * from public.schedule_message($1, 'Good morning ☀️', now() + interval '1 hour')",
      [conv],
    );
    expect(await asUser(a.id, "select 1 from public.scheduled_messages where id = $1", [note.id])).toHaveLength(1);
    expect(await asUser(b.id, "select 1 from public.scheduled_messages where id = $1", [note.id])).toHaveLength(0);

    // Not due yet.
    const [early] = await asUser<{ ids: string[] }>(b.id, "select public.deliver_due_items() as ids");
    expect(early.ids).toHaveLength(0);

    await asOwner("update public.scheduled_messages set send_at = now() - interval '1 second' where id = $1", [note.id]);
    const [outsider] = await asUser<{ ids: string[] }>(c.id, "select public.deliver_due_items() as ids");
    expect(outsider.ids).toHaveLength(0);
    // The recipient's open app may deliver it; it still comes from the author.
    const [due] = await asUser<{ ids: string[] }>(b.id, "select public.deliver_due_items() as ids");
    expect(due.ids).toHaveLength(1);
    const [msg] = await asUser<{ sender_id: string; body: string; was_scheduled: boolean }>(
      b.id,
      "select sender_id, body, was_scheduled from public.messages where id = $1",
      [due.ids[0]],
    );
    expect(msg).toEqual({ sender_id: a.id, body: "Good morning ☀️", was_scheduled: true });
    const [again] = await asUser<{ ids: string[] }>(a.id, "select public.deliver_due_items() as ids");
    expect(again.ids).toHaveLength(0);
    await expect(asUser(a.id, "select public.cancel_scheduled_message($1)", [note.id])).rejects.toThrow(/already sent/);

    // Any member may ask for its notification (once); outsiders may not.
    expect(await pushTargets(due.ids[0]!, c.id)).toHaveLength(0);
    expect(await pushTargets(due.ids[0]!, b.id)).toHaveLength(1);
  });

  it("can be cancelled, and is dropped if the other person loses access", async () => {
    const a = await createUser();
    const b = await createUser();
    const conv = await directConversation(a.id, b.id);
    const [n1] = await asUser<{ id: string }>(a.id, "select * from public.schedule_message($1, 'one', now() + interval '1 hour')", [conv]);
    await asUser(a.id, "select public.cancel_scheduled_message($1)", [n1.id]);
    const [n2] = await asUser<{ id: string }>(a.id, "select * from public.schedule_message($1, 'two', now() + interval '1 hour')", [conv]);
    await asOwner("update public.scheduled_messages set send_at = now() - interval '1 second' where id = any($1)", [[n1.id, n2.id]]);
    await asOwner("update public.authorized_emails set status = 'disabled' where id = $1", [b.entryId]);

    await asOwner("select private.run_scheduled_jobs()");
    const rows = await asOwner<{ id: string; delivered_at: string | null; canceled_at: string | null }>(
      "select id, delivered_at, canceled_at from public.scheduled_messages where id = any($1)",
      [[n1.id, n2.id]],
    );
    for (const r of rows) {
      expect(r.delivered_at).toBeNull();
      expect(r.canceled_at).not.toBeNull();
    }
    const [count] = await asOwner<{ n: number }>("select count(*)::int as n from public.messages where conversation_id = $1", [conv]);
    expect(count.n).toBe(0);
  });
});

describe("shared list", () => {
  it("both people add, tick and clear items; outsiders see nothing", async () => {
    const a = await createUser();
    const b = await createUser();
    const c = await createUser();
    const conv = await directConversation(a.id, b.id);
    const [milk] = await asUser<{ id: string }>(a.id, "select * from public.add_list_item($1, ' Milk ')", [conv]);
    const [eggs] = await asUser<{ id: string }>(b.id, "select * from public.add_list_item($1, 'Eggs')", [conv]);
    await expect(asUser(a.id, "select public.add_list_item($1, '   ')", [conv])).rejects.toThrow(/Write something/);
    await expect(asUser(c.id, "select public.add_list_item($1, 'Hack')", [conv])).rejects.toThrow(/not a member/);
    await expect(asUser(c.id, "select public.set_list_item_done($1, true)", [milk.id])).rejects.toThrow(/not found/);

    await asUser(b.id, "select public.set_list_item_done($1, true)", [milk.id]);
    const list = () =>
      asUser<{ text: string; done: boolean; done_by: string | null }>(
        a.id,
        "select text, done, done_by from public.shared_list_items where conversation_id = $1 and deleted_at is null order by created_at",
        [conv],
      );
    expect(await list()).toEqual([
      { text: "Milk", done: true, done_by: b.id },
      { text: "Eggs", done: false, done_by: null },
    ]);
    expect(await asUser(c.id, "select 1 from public.shared_list_items where conversation_id = $1", [conv])).toHaveLength(0);
    await expect(asUser(a.id, "insert into public.shared_list_items (conversation_id, text) values ($1, 'x')", [conv])).rejects.toThrow(
      /permission denied/,
    );

    const [cleared] = await asUser<{ n: number }>(a.id, "select public.clear_done_list_items($1) as n", [conv]);
    expect(cleared.n).toBe(1);
    await asUser(a.id, "select public.delete_list_item($1)", [eggs.id]);
    expect(await list()).toEqual([]);
  });
});

describe("app address for timed notifications", () => {
  it("only the server can register it; the secret stays the same", async () => {
    await asOwner("delete from private.app_hook");
    const u = await createUser();
    await expect(asUser(u.id, "select public.server_register_app('https://evil.example')")).rejects.toThrow(/permission denied/);
    await expect(asUser(u.id, "select public.server_app_hook_secret()")).rejects.toThrow(/permission denied/);
    await expect(
      asUser(null, "select public.server_register_app('javascript:alert(1)')", [], "service_role"),
    ).rejects.toThrow(/Invalid app URL/);
    const [s1] = await asUser<{ s: string }>(null, "select public.server_register_app('https://app.example.com/') as s", [], "service_role");
    const [s2] = await asUser<{ s: string }>(null, "select public.server_register_app('https://app.example.com') as s", [], "service_role");
    expect(s1.s).toHaveLength(64);
    expect(s2.s).toBe(s1.s);
    const [hook] = await asOwner<{ url: string }>("select url from private.app_hook");
    expect(hook.url).toBe("https://app.example.com");
  });
});
