import type { SupabaseClient } from "@supabase/supabase-js";
import { ATTACHMENTS_BUCKET } from "@/lib/constants";
import type { Gif } from "@/lib/giphy";
import type { TapKind } from "@/lib/love";
import type { Attachment, BubbleColor, DailyAnswer, DatePlan, JournalEntry, MemberMood, Message, ChatAppearance, ListItem, ScheduledMessage, SpecialDate, SpecialDateKind } from "@/types/app";

/**
 * Client-side data access for the features for two: view-once photos, chat
 * appearance, "thinking of you", special dates, love notes and the shared list.
 * Every call runs as the signed-in user; the database enforces who may do what.
 */

// --- View-once ----------------------------------------------------------------

/** Opens a view-once photo (marks it opened) and returns a short-lived URL. */
export async function openViewOnce(supabase: SupabaseClient, attachmentId: string): Promise<string> {
  const { data: path, error } = await supabase.rpc("open_view_once", { p_attachment_id: attachmentId });
  if (error) throw error;
  const { data, error: urlError } = await supabase.storage.from(ATTACHMENTS_BUCKET).createSignedUrl(path as string, 60);
  if (urlError || !data) throw urlError ?? new Error("Could not open the photo");
  return data.signedUrl;
}

/** After closing: the server deletes the file for good. */
export function finishViewOnce(attachmentId: string): void {
  void fetch(`/api/view-once/${attachmentId}`, { method: "POST", keepalive: true }).catch(() => undefined);
}

// --- Appearance ---------------------------------------------------------------

export async function getChatAppearance(supabase: SupabaseClient, conversationId: string): Promise<ChatAppearance> {
  const { data, error } = await supabase.rpc("get_chat_appearance", { p_conversation_id: conversationId }).maybeSingle();
  if (error) throw error;
  return (data as ChatAppearance | null) ?? { wallpaper_path: null, bubble_color: null };
}

export async function setChatAppearance(
  supabase: SupabaseClient,
  conversationId: string,
  wallpaperPath: string | null,
  bubbleColor: BubbleColor | null,
): Promise<void> {
  const { error } = await supabase.rpc("set_chat_appearance", {
    p_conversation_id: conversationId,
    p_wallpaper_path: wallpaperPath,
    p_bubble_color: bubbleColor,
  });
  if (error) throw error;
}

// --- Thinking of you ----------------------------------------------------------

export async function sendNudge(supabase: SupabaseClient, conversationId: string, kind: TapKind = "heart"): Promise<string> {
  const { data, error } = await supabase.rpc("send_nudge", { p_conversation_id: conversationId, p_kind: kind });
  if (error) throw error;
  return data as string;
}

// --- Special dates ------------------------------------------------------------

export async function listSpecialDates(supabase: SupabaseClient, conversationId: string): Promise<SpecialDate[]> {
  const { data, error } = await supabase
    .from("special_dates")
    .select("*")
    .eq("conversation_id", conversationId)
    .is("deleted_at", null)
    .order("on_date");
  if (error) throw error;
  return (data ?? []) as SpecialDate[];
}

export async function saveSpecialDate(
  supabase: SupabaseClient,
  input: { id?: string | null; conversationId: string; kind: SpecialDateKind; title: string; onDate: string; yearly: boolean; remind: boolean },
): Promise<SpecialDate> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const { data, error } = await supabase
    .rpc("save_special_date", {
      p_id: input.id ?? null,
      p_conversation_id: input.conversationId,
      p_kind: input.kind,
      p_title: input.title,
      p_on_date: input.onDate,
      p_yearly: input.yearly,
      p_remind: input.remind,
      p_tz: tz,
    })
    .single();
  if (error) throw error;
  return data as SpecialDate;
}

export async function deleteSpecialDate(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.rpc("delete_special_date", { p_id: id });
  if (error) throw error;
}

// --- Love notes for later -----------------------------------------------------

export async function listScheduledMessages(supabase: SupabaseClient, conversationId: string): Promise<ScheduledMessage[]> {
  const { data, error } = await supabase
    .from("scheduled_messages")
    .select("id, conversation_id, body, send_at, delivered_at, canceled_at, created_at")
    .eq("conversation_id", conversationId)
    .is("delivered_at", null)
    .is("canceled_at", null)
    .order("send_at");
  if (error) throw error;
  return (data ?? []) as ScheduledMessage[];
}

export async function scheduleMessage(
  supabase: SupabaseClient,
  conversationId: string,
  body: string,
  sendAt: Date,
): Promise<ScheduledMessage> {
  const { data, error } = await supabase
    .rpc("schedule_message", { p_conversation_id: conversationId, p_body: body, p_send_at: sendAt.toISOString() })
    .single();
  if (error) throw error;
  return data as ScheduledMessage;
}

export async function cancelScheduledMessage(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.rpc("cancel_scheduled_message", { p_id: id });
  if (error) throw error;
}

/** Delivers love notes / reminders that are due in my chats; returns new message ids. */
export async function deliverDueItems(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase.rpc("deliver_due_items");
  if (error) throw error;
  return (data ?? []) as string[];
}

// --- Shared list --------------------------------------------------------------

export async function listItems(supabase: SupabaseClient, conversationId: string): Promise<ListItem[]> {
  const { data, error } = await supabase
    .from("shared_list_items")
    .select("*")
    .eq("conversation_id", conversationId)
    .is("deleted_at", null)
    .order("created_at");
  if (error) throw error;
  return (data ?? []) as ListItem[];
}

export async function addListItem(
  supabase: SupabaseClient,
  conversationId: string,
  text: string,
  kind: "todo" | "bucket" = "todo",
): Promise<ListItem> {
  const { data, error } = await supabase
    .rpc("add_list_item", { p_conversation_id: conversationId, p_text: text, p_kind: kind })
    .single();
  if (error) throw error;
  return data as ListItem;
}

export async function setListItemDone(supabase: SupabaseClient, id: string, done: boolean): Promise<void> {
  const { error } = await supabase.rpc("set_list_item_done", { p_id: id, p_done: done });
  if (error) throw error;
}

export async function setListItemPhoto(supabase: SupabaseClient, id: string, path: string | null): Promise<void> {
  const { error } = await supabase.rpc("set_list_item_photo", { p_id: id, p_path: path });
  if (error) throw error;
}

export async function deleteListItem(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.rpc("delete_list_item", { p_id: id });
  if (error) throw error;
}

export async function clearDoneItems(supabase: SupabaseClient, conversationId: string): Promise<number> {
  const { data, error } = await supabase.rpc("clear_done_list_items", { p_conversation_id: conversationId });
  if (error) throw error;
  return data as number;
}

// --- Memories -----------------------------------------------------------------

export const MEMORIES_PAGE_SIZE = 60;

/** Photos shared in a chat, newest first (view-once photos are never included). */
export async function listMemories(
  supabase: SupabaseClient,
  conversationId: string,
  before?: string,
): Promise<{ photos: Attachment[]; hasMore: boolean; cursor: string | null }> {
  let query = supabase
    .from("attachments")
    .select("*")
    .eq("conversation_id", conversationId)
    .in("mime_type", ["image/jpeg", "image/png", "image/webp", "image/gif"])
    .order("created_at", { ascending: false })
    .limit(MEMORIES_PAGE_SIZE);
  if (before) query = query.lt("created_at", before);
  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as Attachment[];
  // View-once photos never appear here (filtered here, not in the query, so
  // this also works before the database update that adds the column).
  return {
    photos: rows.filter((a) => !a.view_once),
    hasMore: rows.length === MEMORIES_PAGE_SIZE,
    cursor: rows[rows.length - 1]?.created_at ?? null,
  };
}

// --- Stickers & GIFs ----------------------------------------------------------

export type StickerPayload = { sticker: string; text: string } | { gif: Gif };

export async function sendSticker(
  supabase: SupabaseClient,
  conversationId: string,
  clientId: string,
  payload: StickerPayload,
): Promise<Message> {
  const { data, error } = await supabase
    .rpc("send_sticker", {
      p_conversation_id: conversationId,
      p_client_id: clientId,
      p_sticker: "sticker" in payload ? payload.sticker : null,
      p_gif: "gif" in payload ? payload.gif : null,
      p_body: "sticker" in payload ? payload.text : `GIF${payload.gif.title ? `: ${payload.gif.title}` : ""}`.slice(0, 120),
    })
    .single();
  if (error) throw error;
  return data as Message;
}

/** GIF search through our server (null = GIFs aren't switched on). */
export async function searchGifs(query: string, offset = 0): Promise<Gif[] | null> {
  const res = await fetch(`/api/gifs?q=${encodeURIComponent(query)}&offset=${offset}`);
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; gifs?: Gif[]; error?: { code?: string } };
  if (res.status === 503 && json.error?.code === "gifs_off") return null;
  if (!res.ok || !json.ok) throw new Error("GIF search failed");
  return json.gifs ?? [];
}

// --- Daily question -----------------------------------------------------------

/** Answers for one day you're allowed to see (the other person's only after you answered). */
export async function listDailyAnswers(supabase: SupabaseClient, conversationId: string, day: string): Promise<DailyAnswer[]> {
  const { data, error } = await supabase
    .from("daily_answers")
    .select("id, conversation_id, user_id, day, question_index, answer, created_at")
    .eq("conversation_id", conversationId)
    .eq("day", day);
  if (error) throw error;
  return (data ?? []) as DailyAnswer[];
}

/** Earlier days (newest first). */
export async function listDailyHistory(supabase: SupabaseClient, conversationId: string, before: string): Promise<DailyAnswer[]> {
  const { data, error } = await supabase
    .from("daily_answers")
    .select("id, conversation_id, user_id, day, question_index, answer, created_at")
    .eq("conversation_id", conversationId)
    .lt("day", before)
    .order("day", { ascending: false })
    .limit(60);
  if (error) throw error;
  return (data ?? []) as DailyAnswer[];
}

export async function answerDailyQuestion(
  supabase: SupabaseClient,
  conversationId: string,
  day: string,
  questionIndex: number,
  answer: string,
): Promise<void> {
  const { error } = await supabase.rpc("answer_daily_question", {
    p_conversation_id: conversationId,
    p_day: day,
    p_question_index: questionIndex,
    p_answer: answer,
  });
  if (error) throw error;
}

// --- Mood ---------------------------------------------------------------------

export async function getMoods(supabase: SupabaseClient, conversationId: string): Promise<MemberMood[]> {
  const { data, error } = await supabase.rpc("get_moods", { p_conversation_id: conversationId });
  if (error) throw error;
  return (data ?? []) as MemberMood[];
}

export async function setMood(supabase: SupabaseClient, conversationId: string, mood: string | null, note?: string) {
  const { error } = await supabase.rpc("set_mood", { p_conversation_id: conversationId, p_mood: mood, p_note: note ?? null });
  if (error) throw error;
}

// --- Search in one chat -------------------------------------------------------

export interface ChatSearchHit {
  id: string;
  body: string;
  sender_id: string | null;
  created_at: string;
}

/** Newest messages in this chat whose text contains `query` (case-insensitive). */
export async function searchInConversation(supabase: SupabaseClient, conversationId: string, query: string): Promise<ChatSearchHit[]> {
  const q = query.trim().slice(0, 100);
  if (!q) return [];
  // LIKE wildcards in the query are matched literally.
  const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const { data, error } = await supabase
    .from("messages")
    .select("id, body, sender_id, created_at")
    .eq("conversation_id", conversationId)
    .is("deleted_at", null)
    .is("system_event", null)
    .ilike("body", pattern)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as ChatSearchHit[];
}

// --- Streak -------------------------------------------------------------------

export async function getStreak(supabase: SupabaseClient, conversationId: string): Promise<{ days: number; today_done: boolean }> {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const { data, error } = await supabase.rpc("get_streak", { p_conversation_id: conversationId, p_tz: tz }).single();
  if (error) throw error;
  return data as { days: number; today_done: boolean };
}

// --- Date planner -------------------------------------------------------------

/** Plans from yesterday on (and a few recent ones), soonest first. */
export async function listPlans(supabase: SupabaseClient, conversationId: string): Promise<DatePlan[]> {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("date_plans")
    .select("id, conversation_id, created_by, title, starts_at, place, notes, remind_minutes, deleted_at")
    .eq("conversation_id", conversationId)
    .is("deleted_at", null)
    .gte("starts_at", since)
    .order("starts_at");
  if (error) throw error;
  return (data ?? []) as DatePlan[];
}

export async function savePlan(
  supabase: SupabaseClient,
  input: { id?: string | null; conversationId: string; title: string; startsAt: Date; place: string; notes: string; remindMinutes: number },
): Promise<void> {
  const { error } = await supabase.rpc("save_plan", {
    p_id: input.id ?? null,
    p_conversation_id: input.conversationId,
    p_title: input.title,
    p_starts_at: input.startsAt.toISOString(),
    p_place: input.place,
    p_notes: input.notes,
    p_remind_minutes: input.remindMinutes,
  });
  if (error) throw error;
}

export async function deletePlan(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.rpc("delete_plan", { p_id: id });
  if (error) throw error;
}

// --- Journal ------------------------------------------------------------------

export const JOURNAL_PAGE_DAYS = 30;

/** Entries for the newest `JOURNAL_PAGE_DAYS` days before `before` (exclusive), newest first. */
export async function listJournal(supabase: SupabaseClient, conversationId: string, before?: string): Promise<JournalEntry[]> {
  let query = supabase
    .from("journal_entries")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("day", { ascending: false })
    .limit(JOURNAL_PAGE_DAYS * 2);
  if (before) query = query.lt("day", before);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as JournalEntry[];
}

export async function saveJournalEntry(
  supabase: SupabaseClient,
  conversationId: string,
  day: string,
  body: string,
  photoPath: string | null,
): Promise<void> {
  const { error } = await supabase.rpc("save_journal_entry", {
    p_conversation_id: conversationId,
    p_day: day,
    p_body: body,
    p_photo_path: photoPath,
  });
  if (error) throw error;
}
