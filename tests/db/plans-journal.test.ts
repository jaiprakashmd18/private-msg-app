import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { asOwner, asUser, createUser, directConversation } from "./helpers";

async function upload(userId: string, path: string, mimetype: string, size: number, bucket = "attachments") {
  await asUser(userId, "insert into storage.objects (bucket_id, name, owner_id, metadata) values ($1, $2, $3, $4)", [
    bucket,
    path,
    userId,
    JSON.stringify({ size, mimetype }),
  ]);
}

describe("videos", () => {
  it("allows videos up to 50 MB, other files still up to 10 MB", async () => {
    const a = await createUser();
    const b = await createUser();
    const conv = await directConversation(a.id, b.id);
    const send = (path: string) =>
      asUser(a.id, "select public.send_message($1, $2, '', $3::jsonb)", [
        conv,
        randomUUID(),
        JSON.stringify([{ path, name: "clip", duration_ms: 12000, width: 1080, height: 1920 }]),
      ]);
    const video = `${conv}/${a.id}/${randomUUID()}-clip.mp4`;
    await upload(a.id, video, "video/mp4", 30 * 1024 * 1024);
    await send(video);
    const big = `${conv}/${a.id}/${randomUUID()}-huge.mp4`;
    await upload(a.id, big, "video/mp4", 60 * 1024 * 1024);
    await expect(send(big)).rejects.toThrow(/too large/);
    const photo = `${conv}/${a.id}/${randomUUID()}-big.jpg`;
    await upload(a.id, photo, "image/jpeg", 30 * 1024 * 1024);
    await expect(send(photo)).rejects.toThrow(/too large/);
  });
});

describe("countdown to the next meet", () => {
  it("is a one-off date that gets a reminder on the day", async () => {
    const a = await createUser();
    const b = await createUser();
    const conv = await directConversation(a.id, b.id);
    const [tz] = await asOwner<{ name: string }>(
      "select name from pg_timezone_names where extract(hour from now() at time zone name) between 9 and 20 and name like '%/%' order by name limit 1",
    );
    const [meet] = await asUser<{ yearly: boolean; title: string }>(
      a.id,
      "select * from public.save_special_date(null, $1, 'meet', '', (now() at time zone $2)::date, true, true, $2)",
      [conv, tz.name],
    );
    expect(meet).toMatchObject({ yearly: false, title: "We meet" });
    const [due] = await asUser<{ ids: string[] }>(b.id, "select public.deliver_due_items() as ids");
    const [msg] = await asOwner<{ e: Record<string, unknown> }>("select system_event as e from public.messages where id = $1", [due.ids[0]]);
    expect(msg.e).toMatchObject({ type: "date_reminder", kind: "meet" });
  });
});

describe("streaks", () => {
  it("counts days in a row on which both people wrote", async () => {
    const a = await createUser();
    const b = await createUser();
    const conv = await directConversation(a.id, b.id);
    const write = (userId: string, daysAgo: number) =>
      asOwner(
        `insert into public.messages (conversation_id, sender_id, client_id, body, created_at)
         values ($1, $2, gen_random_uuid(), 'hi', ((current_date - $3::int) + time '12:00') at time zone 'UTC')`,
        [conv, userId, daysAgo],
      );
    const streak = () =>
      asUser<{ days: number; today_done: boolean }>(a.id, "select * from public.get_streak($1, 'UTC')", [conv]);

    for (const d of [1, 2, 3]) {
      await write(a.id, d);
      await write(b.id, d);
    }
    await write(a.id, 5); // a gap at day 4
    await write(b.id, 5);
    expect((await streak())[0]).toEqual({ days: 3, today_done: false }); // still alive from yesterday
    await write(a.id, 0);
    expect((await streak())[0]).toEqual({ days: 3, today_done: false }); // only one of them today
    await write(b.id, 0);
    expect((await streak())[0]).toEqual({ days: 4, today_done: true });
    const c = await createUser();
    await expect(asUser(c.id, "select * from public.get_streak($1)", [conv])).rejects.toThrow(/not a member/);
  });
});

describe("bucket list", () => {
  it("lives next to the to-do list, keeps done items, and takes your own photo", async () => {
    const a = await createUser();
    const b = await createUser();
    const conv = await directConversation(a.id, b.id);
    const [todo] = await asUser<{ id: string }>(a.id, "select * from public.add_list_item($1, 'Milk')", [conv]);
    const [goa] = await asUser<{ id: string; list_kind: string }>(a.id, "select * from public.add_list_item($1, 'Trip to Goa', 'bucket')", [conv]);
    expect(goa.list_kind).toBe("bucket");
    await expect(asUser(a.id, "select public.add_list_item($1, 'x', 'wish')", [conv])).rejects.toThrow(/Unknown list/);
    await asUser(b.id, "select public.set_list_item_done($1, true)", [todo.id]);
    await asUser(b.id, "select public.set_list_item_done($1, true)", [goa.id]);
    await asUser(a.id, "select public.clear_done_list_items($1)", [conv]);
    const left = await asUser<{ text: string }>(a.id, "select text from public.shared_list_items where conversation_id = $1 and deleted_at is null", [conv]);
    expect(left.map((r) => r.text)).toEqual(["Trip to Goa"]);

    const mine = `users/${b.id}/${randomUUID()}.jpg`;
    await upload(b.id, mine, "image/jpeg", 1000, "avatars");
    const theirs = `users/${a.id}/${randomUUID()}.jpg`;
    await upload(a.id, theirs, "image/jpeg", 1000, "avatars");
    await expect(asUser(b.id, "select public.set_list_item_photo($1, $2)", [goa.id, theirs])).rejects.toThrow(/Invalid photo/);
    await asUser(b.id, "select public.set_list_item_photo($1, $2)", [goa.id, mine]);
    const [row] = await asUser<{ photo_path: string }>(a.id, "select photo_path from public.shared_list_items where id = $1", [goa.id]);
    expect(row.photo_path).toBe(mine);
  });
});

describe("date planner", () => {
  it("shares plans, announces new ones and reminds both people once before", async () => {
    const a = await createUser();
    const b = await createUser();
    const c = await createUser();
    const conv = await directConversation(a.id, b.id);
    await asUser(b.id, "select public.save_push_subscription($1, 'k', 'a', true, 'test')", [`https://push.example.com/${randomUUID()}`]);
    const [plan] = await asUser<{ id: string }>(
      a.id,
      "select * from public.save_plan(null, $1, 'Dinner at Marina', now() + interval '3 hours', 'Marina Beach', null, 60)",
      [conv],
    );
    const [added] = await asOwner<{ id: string; e: Record<string, unknown> }>(
      "select id, system_event as e from public.messages where conversation_id = $1 and system_event ->> 'type' = 'plan_added'",
      [conv],
    );
    expect(added.e).toMatchObject({ title: "Dinner at Marina", place: "Marina Beach" });
    expect(
      await asUser(null, "select * from public.server_push_targets($1, $2)", [added.id, a.id], "service_role"),
    ).toHaveLength(1);

    expect(await asUser(c.id, "select 1 from public.date_plans where conversation_id = $1", [conv])).toHaveLength(0);
    await expect(
      asUser(c.id, "select public.save_plan(null, $1, 'x', now() + interval '1 day')", [conv]),
    ).rejects.toThrow(/not a member/);

    // Not due yet (reminder 1 hour before a plan 3 hours away).
    expect((await asUser<{ ids: string[] }>(b.id, "select public.deliver_due_items() as ids"))[0].ids).toHaveLength(0);
    await asUser(a.id, "select public.save_plan($1, $2, 'Dinner at Marina', now() + interval '30 minutes', 'Marina Beach', null, 60)", [plan.id, conv]);
    const [due] = await asUser<{ ids: string[] }>(b.id, "select public.deliver_due_items() as ids");
    expect(due.ids).toHaveLength(1);
    const [reminder] = await asOwner<{ e: Record<string, unknown>; sender_id: string | null }>(
      "select system_event as e, sender_id from public.messages where id = $1",
      [due.ids[0]],
    );
    expect(reminder).toMatchObject({ sender_id: null, e: { type: "plan_reminder", title: "Dinner at Marina" } });
    expect((await asUser<{ ids: string[] }>(a.id, "select public.deliver_due_items() as ids"))[0].ids).toHaveLength(0);

    await asUser(b.id, "select public.delete_plan($1)", [plan.id]);
    expect(await asUser(a.id, "select 1 from public.date_plans where id = $1 and deleted_at is null", [plan.id])).toHaveLength(0);
    await expect(
      asUser(a.id, "select public.save_plan(null, $1, 'Old', now() - interval '3 days')", [conv]),
    ).rejects.toThrow(/from today/);
  });
});

describe("our journal", () => {
  it("both write an entry per day; the first one tells the other person", async () => {
    const a = await createUser();
    const b = await createUser();
    const c = await createUser();
    const conv = await directConversation(a.id, b.id);
    await asUser(a.id, "select * from public.save_journal_entry($1, current_date, 'Rainy day, missed you')", [conv]);
    await asUser(a.id, "select * from public.save_journal_entry($1, current_date, 'Rainy day, missed you a lot')", [conv]);
    const [notes] = await asOwner<{ n: number }>(
      "select count(*)::int as n from public.messages where conversation_id = $1 and system_event ->> 'type' = 'journal'",
      [conv],
    );
    expect(notes.n).toBe(1);
    const rows = await asUser<{ body: string }>(b.id, "select body from public.journal_entries where conversation_id = $1", [conv]);
    expect(rows.map((r) => r.body)).toEqual(["Rainy day, missed you a lot"]);
    expect(await asUser(c.id, "select 1 from public.journal_entries where conversation_id = $1", [conv])).toHaveLength(0);
    await expect(asUser(a.id, "select public.save_journal_entry($1, current_date - 7, 'late')", [conv])).rejects.toThrow(/today/);
    await expect(asUser(a.id, "select public.save_journal_entry($1, current_date, '  ')", [conv])).rejects.toThrow(/Write something/);
    const photo = `users/${b.id}/${randomUUID()}.jpg`;
    await upload(b.id, photo, "image/jpeg", 1000, "avatars");
    await asUser(b.id, "select public.save_journal_entry($1, current_date, null, $2)", [conv, photo]);
    await expect(asUser(a.id, "select public.save_journal_entry($1, current_date, 'x', $2)", [conv, photo])).rejects.toThrow(/Invalid photo/);
  });
});
