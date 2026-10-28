/** Domain types mirroring the database schema and RPC results (supabase/migrations). */

export type AppRole = "member" | "admin";
export type AccessStatus = "active" | "disabled";

export interface Access {
  user_id: string;
  phone_e164: string;
  display_name: string;
  bio: string;
  is_active: boolean;
  role: AppRole | null;
}

export interface AppSettings {
  message_retention_days: number | null;
  audit_retention_days: number;
  admin_can_read_messages: boolean;
  attachments_enabled: boolean;
  edit_window_minutes: number;
  updated_at: string;
}

export interface DirectoryEntry {
  id: string;
  display_name: string;
  phone_e164: string;
}

export interface ConversationSummary {
  id: string;
  created_at: string;
  other_user_id: string | null;
  other_display_name: string | null;
  other_phone_e164: string | null;
  other_is_active: boolean;
  other_last_read_at: string | null;
  other_last_delivered_at: string | null;
  my_last_read_at: string | null;
  last_message_id: string | null;
  last_message_body: string | null;
  last_message_sender_id: string | null;
  last_message_created_at: string | null;
  last_message_deleted: boolean;
  last_message_has_attachments: boolean;
  unread_count: number;
}

export interface Attachment {
  id: string;
  message_id: string;
  conversation_id: string;
  uploader_id: string | null;
  storage_path: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  client_id: string;
  body: string;
  created_at: string;
  edited_at: string | null;
  deleted_at: string | null;
  attachments?: Attachment[];
}

/** A message as held in the UI, including optimistic local state. */
export interface UiMessage extends Message {
  local_status?: "sending" | "failed";
  local_files?: File[];
}

export interface SearchResult {
  message_id: string;
  conversation_id: string;
  sender_id: string | null;
  body: string;
  created_at: string;
}

export interface AdminNumber {
  id: string;
  phone_e164: string;
  label: string | null;
  role: AppRole;
  status: AccessStatus;
  created_at: string;
  disabled_at: string | null;
  user_id: string | null;
  display_name: string | null;
  registered_at: string | null;
  last_seen_at: string | null;
}

export interface AdminConversation {
  id: string;
  created_at: string;
  last_message_at: string | null;
  message_count: number;
  attachment_count: number;
  members: { user_id: string; display_name: string; phone_e164: string }[];
}

export interface AdminStats {
  numbers_total: number;
  numbers_active: number;
  numbers_disabled: number;
  users_registered: number;
  users_without_access: number;
  conversations: number;
  messages: number;
  messages_24h: number;
  attachments: number;
  storage_bytes: number;
  oldest_message_at: string | null;
}

export interface AuditLog {
  id: number;
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}
