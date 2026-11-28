import { expect, it } from "vitest";
import { asUser, connect, createUser, directConversation, send } from "./helpers";

it("requires recipient consent, prevents duplicate requests, and opens an accepted chat for both", async () => {
  const sender = await createUser();
  const recipient = await createUser();
  const outsider = await createUser();
  await connect(sender.id, recipient.id);
  await expect(asUser(sender.id, "select public.get_or_create_direct_conversation($1)", [recipient.id]))
    .rejects.toThrow(/wait for it to be accepted/);
  for (let attempt = 0; attempt < 2; attempt++) {
    expect(await asUser(sender.id, "select * from public.request_direct_chat($1)", [recipient.id]))
      .toEqual([{ chat_id: null, request_status: "pending" }]);
  }
  expect(await asUser(outsider.id, "select id from public.direct_message_requests")).toEqual([]);
  expect(await asUser(sender.id, "select id from public.list_conversations()")).toEqual([]);
  const requests = await asUser<{ id: string }>(recipient.id, "select id from public.incoming_direct_requests()");
  expect(requests).toHaveLength(1);
  await expect(asUser(sender.id, "select public.respond_to_direct_request($1, true)", [requests[0].id]))
    .rejects.toThrow(/unavailable/);
  const [{ chat }] = await asUser<{ chat: string }>(
    recipient.id, "select public.respond_to_direct_request($1, true) chat", [requests[0].id],
  );
  for (const user of [sender, recipient]) {
    expect(await asUser(user.id, "select id from public.list_conversations()")).toEqual([{ id: chat }]);
  }
  await send(sender.id, chat, "Hello");
});

it("keeps a declined request closed", async () => {
  const sender = await createUser();
  const recipient = await createUser();
  await connect(sender.id, recipient.id);
  await asUser(sender.id, "select public.request_direct_chat($1)", [recipient.id]);
  const [{ id }] = await asUser<{ id: string }>(recipient.id, "select id from public.incoming_direct_requests()");
  await asUser(recipient.id, "select public.respond_to_direct_request($1, false)", [id]);
  expect(await asUser(sender.id, "select * from public.request_direct_chat($1)", [recipient.id]))
    .toEqual([{ chat_id: null, request_status: "declined" }]);
  expect(await asUser(recipient.id, "select id from public.list_conversations()")).toEqual([]);
});

it("shares themes and pins with members only and preserves the theme when a message is unpinned", async () => {
  const a = await createUser();
  const b = await createUser();
  const outsider = await createUser();
  const chat = await directConversation(a.id, b.id);
  const { id } = await send(a.id, chat, "Remember this");
  await asUser(a.id, "select public.set_shared_chat_theme($1, 'midnight-rose')", [chat]);
  await asUser(b.id, "select public.pin_chat_message($1, $2, true)", [chat, id]);
  expect(await asUser(outsider.id, "select theme from public.shared_chat_style where conversation_id = $1", [chat])).toEqual([]);
  await expect(asUser(outsider.id, "select public.pin_chat_message($1, $2, false)", [chat, id])).rejects.toThrow(/member/);
  expect(await asUser(a.id, "select theme,pinned_message_id from public.shared_chat_style where conversation_id = $1", [chat]))
    .toEqual([{ theme: "midnight-rose", pinned_message_id: id }]);
  await asUser(a.id, "select public.pin_chat_message($1, $2, false)", [chat, id]);
  expect(await asUser(b.id, "select theme,pinned_message_id from public.shared_chat_style where conversation_id = $1", [chat]))
    .toEqual([{ theme: "midnight-rose", pinned_message_id: null }]);
});

it("only signals an active direct-chat peer", async () => {
  const a = await createUser();
  const b = await createUser();
  const outsider = await createUser();
  const chat = await directConversation(a.id, b.id);
  const signal = "select public.signal_direct_call($1, gen_random_uuid(), $2)";
  await asUser(a.id, signal, [chat, "voice"]);
  await expect(asUser(outsider.id, signal, [chat, "voice"])).rejects.toThrow(/direct chat/);
  await expect(asUser(a.id, signal, [chat, "other"])).rejects.toThrow(/Invalid call/);
});
