import type { SupabaseClient } from "@supabase/supabase-js";
import { ATTACHMENTS_BUCKET } from "@/lib/constants";
import type { Attachment, BubbleColor, ChatAppearance, ListItem, ScheduledMessage, SpecialDate, SpecialDateKind } from "@/types/app";

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

export async function sendNudge(supabase: SupabaseClient, conversationId: string): Promise<string> {
  const { data, error } = await supabase.rpc("send_nudge", { p_conversation_id: conversationId });
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
    .select("id, conversation_id, created_by, text, done, done_by, deleted_at, created_at")
    .eq("conversation_id", conversationId)
    .is("deleted_at", null)
    .order("created_at");
  if (error) throw error;
  return (data ?? []) as ListItem[];
}

export async function addListItem(supabase: SupabaseClient, conversationId: string, text: string): Promise<ListItem> {
  const { data, error } = await supabase.rpc("add_list_item", { p_conversation_id: conversationId, p_text: text }).single();
  if (error) throw error;
  return data as ListItem;
}

export async function setListItemDone(supabase: SupabaseClient, id: string, done: boolean): Promise<void> {
  const { error } = await supabase.rpc("set_list_item_done", { p_id: id, p_done: done });
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
export async function listMemories(supabase: SupabaseClient, conversationId: string, before?: string): Promise<Attachment[]> {
  let query = supabase
    .from("attachments")
    .select("*")
    .eq("conversation_id", conversationId)
    .eq("view_once", false)
    .in("mime_type", ["image/jpeg", "image/png", "image/webp", "image/gif"])
    .order("created_at", { ascending: false })
    .limit(MEMORIES_PAGE_SIZE);
  if (before) query = query.lt("created_at", before);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Attachment[];
}
