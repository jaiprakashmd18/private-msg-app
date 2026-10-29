export const MAX_MESSAGE_LENGTH = 4000;
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;
export const MAX_VOICE_NOTE_MS = 5 * 60 * 1000;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MESSAGES_PAGE_SIZE = 50;
export const ATTACHMENTS_BUCKET = "attachments";

/** Must match allowed_mime_types of the `attachments` bucket (migration 0500). */
export const ALLOWED_ATTACHMENT_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/aac",
  "audio/x-m4a",
  "audio/wav",
  "application/pdf",
  "text/plain",
  "application/zip",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;
