import type { SupabaseClient } from "@supabase/supabase-js";
import { ATTACHMENTS_BUCKET, MESSAGES_PAGE_SIZE } from "@/lib/constants";
import { sanitizeFileName } from "@/lib/validation";
import type {
  ConversationMember,
  ConversationSummary,
  DirectoryEntry,
  Message,
  PendingFile,
  SearchResult,
} from "@/types/app";

/**
 * Client-side data access for chat. Every call runs as the signed-in user;
 * authorization is enforced by RLS and the RPCs in supabase/migrations.
 */

const MESSAGE_SELECT =
  "*, attachments(*), message_reactions(user_id, emoji), " +
  "reply_to:reply_to_id(id, body, sender_id, deleted_at, attachments(mime_type))";

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
  return (data ?? []) as unknown as Message[];
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
  return (data ?? []) as unknown as Message[];
}

export async function fetchMessage(supabase: SupabaseClient, id: string): Promise<Message | null> {
  const { data, error } = await supabase.from("messages").select(MESSAGE_SELECT).eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as unknown as Message | null) ?? null;
}

export interface UploadedAttachment {
  path: string;
  name: string;
  thumb_path?: string;
  width?: number;
  height?: number;
  duration_ms?: number;
}

async function putObject(supabase: SupabaseClient, path: string, body: Blob, contentType: string) {
  const { error } = await supabase.storage.from(ATTACHMENTS_BUCKET).upload(path, body, {
    contentType,
    upsert: false,
    cacheControl: "3600",
  });
  if (error) throw error;
}

/** Uploads a file (plus its thumbnail, if any) into the sender's folder of the conversation. */
export async function uploadAttachment(
  supabase: SupabaseClient,
  conversationId: string,
  userId: string,
  pending: PendingFile,
): Promise<UploadedAttachment> {
  const { file } = pending;
  const folder = `${conversationId}/${userId}`;
  const name = sanitizeFileName(file.name);
  // Storage matches the bare MIME type ("audio/webm", not "audio/webm;codecs=opus").
  const contentType = file.type.split(";")[0]!.trim();
  const path = `${folder}/${crypto.randomUUID()}-${name}`;
  await putObject(supabase, path, file, contentType);
  const uploaded: UploadedAttachment = { path, name: file.name.slice(0, 200) };
  if (pending.thumb) {
    const thumbPath = `${folder}/${crypto.randomUUID()}-thumb.jpg`;
    await putObject(supabase, thumbPath, pending.thumb, "image/jpeg");
    uploaded.thumb_path = thumbPath;
  }
  if (pending.width && pending.height) {
    uploaded.width = Math.round(pending.width);
    uploaded.height = Math.round(pending.height);
  }
  if (pending.durationMs !== undefined) uploaded.duration_ms = Math.round(pending.durationMs);
  return uploaded;
}

export async function sendMessage(
  supabase: SupabaseClient,
  input: {
    conversationId: string;
    clientId: string;
    body: string;
    attachments?: UploadedAttachment[];
    replyTo?: string | null;
  },
): Promise<Message> {
  const { data, error } = await supabase.rpc("send_message", {
    p_conversation_id: input.conversationId,
    p_client_id: input.clientId,
    p_body: input.body,
    p_attachments: input.attachments ?? [],
    p_reply_to: input.replyTo ?? null,
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

export async function toggleReaction(supabase: SupabaseClient, messageId: string, emoji: string) {
  const { error } = await supabase.rpc("toggle_reaction", { p_message_id: messageId, p_emoji: emoji });
  if (error) throw error;
}

export async function heartbeat(supabase: SupabaseClient) {
  await supabase.rpc("heartbeat");
}

export async function listConversationMembers(
  supabase: SupabaseClient,
  conversationId: string,
): Promise<ConversationMember[]> {
  const { data, error } = await supabase.rpc("list_conversation_members", { p_conversation_id: conversationId });
  if (error) throw error;
  return (data ?? []) as ConversationMember[];
}

export async function createGroup(supabase: SupabaseClient, title: string, memberIds: string[]): Promise<string> {
  const { data, error } = await supabase.rpc("create_group", { p_title: title, p_member_ids: memberIds });
  if (error) throw error;
  return data as string;
}

export async function addGroupMembers(supabase: SupabaseClient, conversationId: string, userIds: string[]) {
  const { error } = await supabase.rpc("add_group_members", { p_conversation_id: conversationId, p_user_ids: userIds });
  if (error) throw error;
}

export async function removeGroupMember(supabase: SupabaseClient, conversationId: string, userId: string) {
  const { error } = await supabase.rpc("remove_group_member", { p_conversation_id: conversationId, p_user_id: userId });
  if (error) throw error;
}

export async function renameGroup(supabase: SupabaseClient, conversationId: string, title: string) {
  const { error } = await supabase.rpc("rename_group", { p_conversation_id: conversationId, p_title: title });
  if (error) throw error;
}

export async function setGroupAdmin(supabase: SupabaseClient, conversationId: string, userId: string, isAdmin: boolean) {
  const { error } = await supabase.rpc("set_group_admin", {
    p_conversation_id: conversationId,
    p_user_id: userId,
    p_is_admin: isAdmin,
  });
  if (error) throw error;
}
