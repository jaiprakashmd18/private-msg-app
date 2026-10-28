import type { SupabaseClient } from "@supabase/supabase-js";
import { ATTACHMENTS_BUCKET, MESSAGES_PAGE_SIZE } from "@/lib/constants";
import { sanitizeFileName } from "@/lib/validation";
import type {
  ConversationSummary,
  DirectoryEntry,
  Message,
  SearchResult,
} from "@/types/app";

/**
 * Client-side data access for chat. Every call runs as the signed-in user;
 * authorization is enforced by RLS and the RPCs in supabase/migrations.
 */

const MESSAGE_SELECT = "*, attachments(*)";

export async function listConversations(supabase: SupabaseClient): Promise<ConversationSummary[]> {
  const { data, error } = await supabase.rpc("list_conversations");
  if (error) throw error;
  return (data ?? []) as ConversationSummary[];
}

export async function listDirectory(supabase: SupabaseClient): Promise<DirectoryEntry[]> {
  const { data, error } = await supabase.rpc("list_directory");
  if (error) throw error;
  return (data ?? []) as DirectoryEntry[];
}

export async function getOrCreateConversation(supabase: SupabaseClient, otherUserId: string): Promise<string> {
  const { data, error } = await supabase.rpc("get_or_create_direct_conversation", {
    p_other_user_id: otherUserId,
  });
  if (error) throw error;
  return data as string;
}

/** Newest-first page of messages older than `before` (keyset pagination). */
export async function fetchMessages(
  supabase: SupabaseClient,
  conversationId: string,
  before?: string,
): Promise<Message[]> {
  let query = supabase
    .from("messages")
    .select(MESSAGE_SELECT)
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(MESSAGES_PAGE_SIZE);
  if (before) query = query.lt("created_at", before);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Message[];
}

/** Messages newer than `after` — used to catch up after a reconnect. */
export async function fetchMessagesSince(
  supabase: SupabaseClient,
  conversationId: string,
  after: string,
): Promise<Message[]> {
  const { data, error } = await supabase
    .from("messages")
    .select(MESSAGE_SELECT)
    .eq("conversation_id", conversationId)
    .gte("created_at", after)
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as Message[];
}

export async function fetchMessage(supabase: SupabaseClient, id: string): Promise<Message | null> {
  const { data, error } = await supabase.from("messages").select(MESSAGE_SELECT).eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as Message | null) ?? null;
}

export interface UploadedAttachment {
  path: string;
  name: string;
}

export async function uploadAttachment(
  supabase: SupabaseClient,
  conversationId: string,
  userId: string,
  file: File,
): Promise<UploadedAttachment> {
  const name = sanitizeFileName(file.name);
  const path = `${conversationId}/${userId}/${crypto.randomUUID()}-${name}`;
  const { error } = await supabase.storage.from(ATTACHMENTS_BUCKET).upload(path, file, {
    contentType: file.type,
    upsert: false,
    cacheControl: "3600",
  });
  if (error) throw error;
  return { path, name: file.name.slice(0, 200) };
}

export async function sendMessage(
  supabase: SupabaseClient,
  input: { conversationId: string; clientId: string; body: string; attachments?: UploadedAttachment[] },
): Promise<Message> {
  const { data, error } = await supabase.rpc("send_message", {
    p_conversation_id: input.conversationId,
    p_client_id: input.clientId,
    p_body: input.body,
    p_attachments: input.attachments ?? [],
  });
  if (error) throw error;
  return data as Message;
}

export async function editMessage(supabase: SupabaseClient, id: string, body: string): Promise<Message> {
  const { data, error } = await supabase.rpc("edit_message", { p_message_id: id, p_body: body });
  if (error) throw error;
  return data as Message;
}

export async function deleteMessage(supabase: SupabaseClient, id: string): Promise<void> {
  const { data, error } = await supabase.rpc("delete_message", { p_message_id: id });
  if (error) throw error;
  const paths = ((data ?? []) as string[]).filter(Boolean);
  if (paths.length > 0) {
    // Best effort: files are already unreachable (no attachment row), and the
    // retention job removes any leftovers.
    await supabase.storage.from(ATTACHMENTS_BUCKET).remove(paths);
  }
}

export async function markConversationRead(supabase: SupabaseClient, conversationId: string) {
  const { error } = await supabase.rpc("mark_conversation_read", { p_conversation_id: conversationId });
  if (error) throw error;
}

export async function markAllDelivered(supabase: SupabaseClient) {
  const { error } = await supabase.rpc("mark_all_delivered");
  if (error) throw error;
}

export async function searchMessages(supabase: SupabaseClient, query: string): Promise<SearchResult[]> {
  const { data, error } = await supabase.rpc("search_messages", { p_query: query, p_limit: 30 });
  if (error) throw error;
  return (data ?? []) as SearchResult[];
}

export async function signedAttachmentUrl(supabase: SupabaseClient, path: string, download?: string) {
  const { data, error } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .createSignedUrl(path, 60 * 30, download ? { download } : undefined);
  if (error) throw error;
  return data.signedUrl;
}
