/** Domain types mirroring the database schema and RPC results (supabase/migrations). */

export type AppRole = "member" | "admin";
export type AccessStatus = "active" | "disabled";

export interface Access {
  user_id: string;
  email: string;
  display_name: string;
  bio: string;
  avatar_path: string | null;
  is_active: boolean;
  role: AppRole | null;
  has_password: boolean;
  has_google: boolean;
  must_change_password: boolean;
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
  email: string;
  avatar_path: string | null;
}

export type ConversationKind = "direct" | "group";
export type AttachmentKind = "image" | "audio" | "file";

/** Group events shown as centered notes ("Alex added Sam"). */
export type SystemEvent =
  | { type: "group_created"; title: string }
  | { type: "member_added"; user_id: string }
  | { type: "member_removed"; user_id: string }
  | { type: "member_left"; user_id: string }
  | { type: "renamed"; title: string }
  | { type: "photo_changed" }
  | { type: "photo_removed" }
  | { type: "nudge" }
  | { type: "date_reminder"; date_id: string; kind: SpecialDateKind; title: string; years: number };

export interface ConversationSummary {
  id: string;
  kind: ConversationKind;
  /** Group name (groups only). */
  title: string | null;
  /** Group photo (groups only). */
  avatar_path: string | null;
  created_at: string;
  member_count: number;
  is_group_admin: boolean;
  /** Direct chats only: the other person. */
  other_user_id: string | null;
  other_display_name: string | null;
  other_email: string | null;
  other_avatar_path: string | null;
  other_is_active: boolean;
  other_last_seen_at: string | null;
  /** Earliest read/delivered watermark among the other members. */
  other_last_read_at: string | null;
  other_last_delivered_at: string | null;
  my_last_read_at: string | null;
  last_message_id: string | null;
  last_message_body: string | null;
  last_message_sender_id: string | null;
  last_message_sender_name: string | null;
  last_message_created_at: string | null;
  last_message_deleted: boolean;
  last_message_has_attachments: boolean;
  last_message_attachment_kind: AttachmentKind | null;
  last_message_system_event: SystemEvent | null;
  unread_count: number;
}

export interface ConversationMember {
  user_id: string;
  display_name: string;
  email: string;
  avatar_path: string | null;
  is_admin: boolean;
  is_active: boolean;
  last_seen_at: string | null;
  joined_at: string;
  /** Set for people who left or were removed. */
  left_at: string | null;
}

export interface Attachment {
  id: string;
  message_id: string;
  conversation_id: string;
  uploader_id: string | null;
  storage_path: string;
  thumb_path: string | null;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  /** View-once photo: opened at most once, by the recipient. */
  view_once?: boolean;
  viewed_at?: string | null;
  viewed_by?: string | null;
  created_at: string;
}

export interface Reaction {
  user_id: string;
  emoji: string | null;
}

export interface ReplyPreview {
  id: string;
  body: string;
  sender_id: string | null;
  deleted_at: string | null;
  attachments?: Pick<Attachment, "mime_type" | "view_once">[];
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
  reply_to_id: string | null;
  system_event: SystemEvent | null;
  /** Delivered by the scheduler (a love note sent for later, or a reminder). */
  was_scheduled?: boolean;
  attachments?: Attachment[];
  message_reactions?: Reaction[];
  reply_to?: ReplyPreview | null;
}

/** A local file waiting to be sent, with optional image/voice extras. */
export interface PendingFile {
  file: File;
  thumb?: Blob;
  width?: number;
  height?: number;
  durationMs?: number;
  previewUrl?: string;
  /** Send as a view-once photo (no thumbnail is made). */
  viewOnce?: boolean;
}

/** A message as held in the UI, including optimistic local state. */
export interface UiMessage extends Message {
  local_status?: "sending" | "failed";
  local_files?: PendingFile[];
}

export interface SearchResult {
  message_id: string;
  conversation_id: string;
  sender_id: string | null;
  body: string;
  created_at: string;
}

export interface AllowlistEntry {
  id: string;
  email: string;
  label: string | null;
  role: AppRole;
  status: AccessStatus;
  created_at: string;
  disabled_at: string | null;
  user_id: string | null;
  display_name: string | null;
  registered_at: string | null;
  last_seen_at: string | null;
  has_password: boolean;
  password_pending: boolean;
}

export interface AdminConversation {
  id: string;
  kind: ConversationKind;
  title: string | null;
  created_at: string;
  last_message_at: string | null;
  message_count: number;
  attachment_count: number;
  members: { user_id: string; display_name: string; email: string }[];
}

export interface AdminStats {
  requests_pending?: number;
  allowlist_total: number;
  allowlist_active: number;
  allowlist_disabled: number;
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

export interface AccessRequest {
  id: string;
  email: string;
  display_name: string | null;
  picture_url: string | null;
  status: "pending" | "accepted" | "declined";
  attempts: number;
  first_requested_at: string;
  last_requested_at: string;
  decided_at: string | null;
}

export type SpecialDateKind = "together" | "birthday" | "anniversary" | "other";

export interface SpecialDate {
  id: string;
  conversation_id: string;
  created_by: string | null;
  kind: SpecialDateKind;
  title: string;
  /** YYYY-MM-DD */
  on_date: string;
  yearly: boolean;
  remind: boolean;
  tz: string;
  deleted_at: string | null;
}

export interface ScheduledMessage {
  id: string;
  conversation_id: string;
  body: string;
  send_at: string;
  delivered_at: string | null;
  canceled_at: string | null;
  created_at: string;
}

export interface ListItem {
  id: string;
  conversation_id: string;
  created_by: string | null;
  text: string;
  done: boolean;
  done_by: string | null;
  deleted_at: string | null;
  created_at: string;
}

export const BUBBLE_COLORS = ["blue", "rose", "purple", "green", "orange", "teal", "graphite"] as const;
export type BubbleColor = (typeof BUBBLE_COLORS)[number];

export interface ChatAppearance {
  wallpaper_path: string | null;
  bubble_color: BubbleColor | null;
}
