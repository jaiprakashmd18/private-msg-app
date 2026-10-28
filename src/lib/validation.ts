import { z } from "zod";
import {
  ALLOWED_ATTACHMENT_TYPES,
  MAX_ATTACHMENT_BYTES,
  MAX_MESSAGE_LENGTH,
} from "./constants";
import { normalizePhone } from "./phone";

export const phoneSchema = z
  .string()
  .max(32)
  .transform((value, ctx) => {
    const normalized = normalizePhone(value);
    if (!normalized) {
      ctx.addIssue({
        code: "custom",
        message: "Enter a valid number in international format, e.g. +14155550123",
      });
      return z.NEVER;
    }
    return normalized;
  });

export const otpRequestSchema = z.object({ phone: phoneSchema });

export const otpVerifySchema = z.object({
  phone: phoneSchema,
  token: z.string().regex(/^\d{6}$/, "Enter the 6-digit code"),
});

export const messageBodySchema = z
  .string()
  .max(MAX_MESSAGE_LENGTH, `Messages can be at most ${MAX_MESSAGE_LENGTH} characters`);

export const profileSchema = z.object({
  display_name: z.string().trim().min(1, "Name is required").max(60),
  bio: z.string().trim().max(280),
});

export const addNumberSchema = z.object({
  phone: phoneSchema,
  label: z.string().trim().max(80).optional(),
});

export const settingsSchema = z.object({
  message_retention_days: z.number().int().min(1).max(3650).nullable(),
  audit_retention_days: z.number().int().min(30).max(3650),
  admin_can_read_messages: z.boolean(),
  attachments_enabled: z.boolean(),
  edit_window_minutes: z.number().int().min(0).max(1440),
});

export const uuidSchema = z.uuid();

export function validateAttachment(file: { size: number; type: string }): string | null {
  if (file.size <= 0) return "File is empty";
  if (file.size > MAX_ATTACHMENT_BYTES) return "Files can be at most 10 MB";
  if (!(ALLOWED_ATTACHMENT_TYPES as readonly string[]).includes(file.type)) {
    return "This file type is not supported";
  }
  return null;
}

/** Safe object name: keeps letters, numbers, dot, dash, underscore. */
export function sanitizeFileName(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^[._]+/, "")
    .slice(-100);
  return cleaned || "file";
}
