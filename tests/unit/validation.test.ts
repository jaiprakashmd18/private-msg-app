import { describe, expect, it } from "vitest";
import { MAX_ATTACHMENT_BYTES } from "@/lib/constants";
import { maskPhone, normalizePhone } from "@/lib/phone";
import {
  addNumberSchema,
  messageBodySchema,
  otpRequestSchema,
  otpVerifySchema,
  profileSchema,
  sanitizeFileName,
  settingsSchema,
  validateAttachment,
} from "@/lib/validation";

describe("phone numbers", () => {
  it("normalizes international input to E.164", () => {
    expect(normalizePhone("+1 (415) 555-0123")).toBe("+14155550123");
    expect(normalizePhone("0044 20 7946 0958")).toBe("+442079460958");
    expect(normalizePhone("  +91 98765 43210 ")).toBe("+919876543210");
  });

  it("rejects numbers without a country code or with junk", () => {
    expect(normalizePhone("4155550123")).toBeNull();
    expect(normalizePhone("+1 12")).toBeNull();
    expect(normalizePhone("hello")).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });

  it("validates OTP request and verification payloads", () => {
    expect(otpRequestSchema.safeParse({ phone: "+14155550123" }).success).toBe(true);
    expect(otpRequestSchema.safeParse({ phone: "not a phone" }).success).toBe(false);
    expect(otpRequestSchema.safeParse({ phone: "+1".padEnd(64, "1") }).success).toBe(false);
    expect(otpVerifySchema.safeParse({ phone: "+14155550123", token: "123456" }).success).toBe(true);
    expect(otpVerifySchema.safeParse({ phone: "+14155550123", token: "12345" }).success).toBe(false);
    expect(otpVerifySchema.safeParse({ phone: "+14155550123", token: "12345a" }).success).toBe(false);
  });

  it("masks phone numbers for logs", () => {
    expect(maskPhone("+14155550123")).toBe("+14•••••••23");
    expect(maskPhone("+1")).toBe("***");
  });

  it("validates admin input for new numbers", () => {
    expect(addNumberSchema.safeParse({ phone: "+14155550123", label: "Alex" }).success).toBe(true);
    expect(addNumberSchema.safeParse({ phone: "+14155550123", label: "x".repeat(81) }).success).toBe(false);
  });
});

describe("messages and profiles", () => {
  it("enforces the message length limit", () => {
    expect(messageBodySchema.safeParse("x".repeat(4000)).success).toBe(true);
    expect(messageBodySchema.safeParse("x".repeat(4001)).success).toBe(false);
  });

  it("requires a display name and limits bio length", () => {
    expect(profileSchema.safeParse({ display_name: "  ", bio: "" }).success).toBe(false);
    expect(profileSchema.safeParse({ display_name: "Sam", bio: "x".repeat(281) }).success).toBe(false);
    expect(profileSchema.safeParse({ display_name: "Sam", bio: "hi" }).success).toBe(true);
  });
});

describe("attachments", () => {
  it("accepts allowed types within the size limit", () => {
    expect(validateAttachment({ size: 1000, type: "image/png" })).toBeNull();
    expect(validateAttachment({ size: MAX_ATTACHMENT_BYTES, type: "application/pdf" })).toBeNull();
  });

  it("rejects empty, oversized and disallowed files", () => {
    expect(validateAttachment({ size: 0, type: "image/png" })).toMatch(/empty/);
    expect(validateAttachment({ size: MAX_ATTACHMENT_BYTES + 1, type: "image/png" })).toMatch(/10 MB/);
    expect(validateAttachment({ size: 10, type: "text/html" })).toMatch(/not supported/);
    expect(validateAttachment({ size: 10, type: "image/svg+xml" })).toMatch(/not supported/);
  });

  it("sanitizes file names used in storage paths", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("etc_passwd");
    expect(sanitizeFileName("my photo (1).png")).toBe("my_photo_1_.png");
    expect(sanitizeFileName("a/b\\c.txt")).not.toMatch(/[/\\]/);
    expect(sanitizeFileName("...")).toBe("file");
  });
});

describe("admin settings", () => {
  it("bounds retention and edit-window values", () => {
    const ok = {
      message_retention_days: null,
      audit_retention_days: 365,
      admin_can_read_messages: false,
      attachments_enabled: true,
      edit_window_minutes: 15,
    };
    expect(settingsSchema.safeParse(ok).success).toBe(true);
    expect(settingsSchema.safeParse({ ...ok, message_retention_days: 0 }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...ok, audit_retention_days: 7 }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...ok, edit_window_minutes: 2000 }).success).toBe(false);
  });
});
