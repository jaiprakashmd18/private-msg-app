import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { asOwner, asUser, createUser, directConversation } from "./helpers";

const pushTargets = (messageId: string, caller: string) =>
  asUser<{ event: Record<string, unknown> | null }>(
    null,
    "select * from public.server_push_targets($1, $2)",
    [messageId, caller],
    "service_role",
  );

async function subscribePush(userId: string) {
  await asUser(userId, "select public.save_push_subscription($1, 'k', 'a', true, 'test')", [
    `https://push.example.com/${randomUUID()}`,
  ]);
}

describe("stickers and GIFs", () => {
  const sticker = (userId: string, conv: string, s: string | null, gif: object | null, body = "") =>
    asUser<{ id: string; body: string; sticker: string | null; gif: Record<string, unknown> | null }>(
      userId,
      "select * from public.send_sticker($1, $2, $3, $4::jsonb, $5)",
      [conv, randomUUID(), s, gif ? JSON.stringify(gif) : null, body],
    );

  it("sends a sticker or a GIPHY GIF, with a text version for previews", async () => {
    const a = await createUser();
    const b = await createUser();
    const conv = await directConversation(a.id, b.id);
    const [s] = await sticker(a.id, conv, "love-you", null, "💖 Love you");
    expect(s).toMatchObject({ sticker: "love-you", body: "💖 Love you", gif: null });

    const [g] = await sticker(a.id, conv, null, {
      url: "https://media2.giphy.com/media/v1.Y2lk/3oriO0OEd9QIDdllqo/giphy.gif?cid=abc&rid=giphy.gif&ct=g",
      width: "480",
      height: 270,
      title: "Hug",
      extra: "dropped",
    });
    expect(g.body).toBe("GIF");
    expect(g.gif).toEqual({
      url: "https://media2.giphy.com/media/v1.Y2lk/3oriO0OEd9QIDdllqo/giphy.gif?cid=abc&rid=giphy.gif&ct=g",
      id: "",
      title: "Hug",
      width: 480,
      height: 270,
    });
    const [seen] = await asUser<{ n: number }>(b.id, "select count(*)::int as n from public.messages where conversation_id = $1", [conv]);
    expect(seen.n).toBe(2);
  });

  it("refuses other image hosts, unknown stickers, both or neither, and outsiders", async () => {
    const a = await createUser();
    const b = await createUser();
    const c = await createUser();
    const conv = await directConversation(a.id, b.id);
    for (const url of [
      "https://evil.example/giphy.gif",
      "http://media.giphy.com/media/x/giphy.gif",
      "https://media.giphy.com.evil.example/x.gif",
      "javascript:alert(1)",
    ]) {
      await expect(sticker(a.id, conv, null, { url })).rejects.toThrow(/Only GIPHY/);
    }
    await expect(sticker(a.id, conv, "../../etc", null)).rejects.toThrow(/Unknown sticker/);
    await expect(sticker(a.id, conv, "hug", { url: "https://media.giphy.com/media/x/giphy.gif" })).rejects.toThrow(/either/);
    await expect(sticker(a.id, conv, null, null)).rejects.toThrow(/either/);
    await expect(sticker(c.id, conv, "hug", null)).rejects.toThrow(/not a member/);
  });
});

describe("love taps", () => {
  it("'I miss you' reaches the other person's lock screen; unknown kinds are refused", async () => {
    const a = await createUser();
    const b = await createUser();
    const conv = await directConversation(a.id, b.id);
    await subscribePush(b.id);
    const [miss] = await asUser<{ id: string }>(a.id, "select public.send_nudge($1, 'miss_you') as id", [conv]);
    const targets = await pushTargets(miss.id, a.id);
    expect(targets).toHaveLength(1);
    expect(targets[0]!.event).toEqual({ type: "nudge", kind: "miss_you" });
    await expect(asUser(a.id, "select public.send_nudge($1, 'slap')", [conv])).rejects.toThrow(/Unknown kind/);
    // Old one-argument calls still mean a heart.
    const [heart] = await asUser<{ id: string }>(a.id, "select public.send_nudge($1) as id", [conv]);
    const [row] = await asOwner<{ e: { kind: string } }>("select system_event as e from public.messages where id = $1", [heart.id]);
    expect(row.e.kind).toBe("heart");
  });
});

describe("daily question", () => {
  it("each answer stays hidden from the other person until they've answered too", async () => {
    const a = await createUser();
    const b = await createUser();
    const c = await createUser();
    const conv = await directConversation(a.id, b.id);
    await subscribePush(b.id);
    const answer = (userId: string, text: string, day = "current_date") =>
      asUser(userId, `select * from public.answer_daily_question($1, ${day}, 7, $2)`, [conv, text]);
    const visible = (userId: string) =>
      asUser<{ user_id: string; answer: string }>(
        userId,
        "select user_id, answer from public.daily_answers where conversation_id = $1 and day = current_date order by created_at",
        [conv],
      );

    await answer(a.id, "Our trip to the hills");
    expect((await visible(a.id)).map((r) => r.answer)).toEqual(["Our trip to the hills"]);
    expect(await visible(b.id)).toHaveLength(0); // b hasn't answered yet
    expect(await visible(c.id)).toHaveLength(0);

    // a's answer posts "answered today's question" and notifies b.
    const [note] = await asOwner<{ id: string; e: Record<string, unknown> }>(
      "select id, system_event as e from public.messages where conversation_id = $1 and system_event ->> 'type' = 'daily_answered'",
      [conv],
    );
    expect(note.e).toMatchObject({ type: "daily_answered", both: false });
    expect(await pushTargets(note.id, a.id)).toHaveLength(1);

    await answer(b.id, "The first coffee date");
    expect((await visible(b.id)).map((r) => r.answer).sort()).toEqual(["Our trip to the hills", "The first coffee date"]);
    expect(await visible(a.id)).toHaveLength(2);
    const [both] = await asOwner<{ e: Record<string, unknown> }>(
      "select system_event as e from public.messages where conversation_id = $1 and system_event ->> 'type' = 'daily_answered' order by created_at desc limit 1",
      [conv],
    );
    expect(both.e.both).toBe(true);

    // Editing your answer doesn't post again; old days and outsiders are refused.
    await answer(a.id, "Our trip to the hills ⛰️");
    const [count] = await asOwner<{ n: number }>(
      "select count(*)::int as n from public.messages where conversation_id = $1 and system_event ->> 'type' = 'daily_answered'",
      [conv],
    );
    expect(count.n).toBe(2);
    await expect(answer(a.id, "late", "current_date - 5")).rejects.toThrow(/today/);
    await expect(asUser(c.id, "select public.answer_daily_question($1, current_date, 7, 'x')", [conv])).rejects.toThrow(/not a member/);
    await expect(asUser(a.id, "insert into public.daily_answers (conversation_id, user_id, day, question_index, answer) values ($1, $2, current_date + 1, 1, 'x')", [conv, a.id])).rejects.toThrow(/permission denied/);
  });
});

describe("mood check-in", () => {
  it("shows each person's mood for 24 hours to the other member only", async () => {
    const a = await createUser();
    const b = await createUser();
    const c = await createUser();
    const conv = await directConversation(a.id, b.id);
    await asUser(a.id, "select public.set_mood($1, '😴', 'Long day at work')", [conv]);
    const moods = (userId: string) =>
      asUser<{ user_id: string; mood: string; mood_note: string | null }>(userId, "select * from public.get_moods($1)", [conv]);
    expect(await moods(b.id)).toEqual([expect.objectContaining({ user_id: a.id, mood: "😴", mood_note: "Long day at work" })]);
    expect(await moods(c.id)).toHaveLength(0);
    await expect(asUser(c.id, "select public.set_mood($1, '😊')", [conv])).rejects.toThrow(/not a member/);

    const [msg] = await asOwner<{ e: Record<string, unknown> }>(
      "select system_event as e from public.messages where conversation_id = $1 and system_event ->> 'type' = 'mood'",
      [conv],
    );
    expect(msg.e).toEqual({ type: "mood", mood: "😴", note: "Long day at work" });

    await asOwner("update public.conversation_members set mood_at = now() - interval '25 hours' where user_id = $1", [a.id]);
    expect(await moods(b.id)).toHaveLength(0);
    await asUser(a.id, "select public.set_mood($1, '🥰')", [conv]);
    await asUser(a.id, "select public.set_mood($1, null)", [conv]);
    expect(await moods(b.id)).toHaveLength(0);
    await expect(asUser(a.id, "select public.set_mood($1, $2)", [conv, "x".repeat(20)])).rejects.toThrow(/Pick a mood/);
  });
});
