import { describe, expect, it } from "vitest";
import { MAX_ATTACHMENT_BYTES } from "@/lib/constants";
import {
  addEmailSchema,
  emailSchema,
  messageBodySchema,
  profileSchema,
  sanitizeFileName,
  settingsSchema,
  validateAttachment,
} from "@/lib/validation";

describe("email allowlist input", () => {
  it("normalizes email addresses", () => {
    expect(emailSchema.parse("  Alex.Smith@Gmail.com ")).toBe("alex.smith@gmail.com");
    expect(emailSchema.parse("someone@company.co.uk")).toBe("someone@company.co.uk");
  });

  it("rejects invalid addresses", () => {
    for (const bad of ["", "alex", "alex@", "@gmail.com", "a b@gmail.com", `${"x".repeat(250)}@gmail.com`]) {
      expect(emailSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("validates admin input for new accounts", () => {
    expect(addEmailSchema.safeParse({ email: "alex@gmail.com", label: "Alex" }).success).toBe(true);
    expect(addEmailSchema.safeParse({ email: "alex@gmail.com", label: "x".repeat(81) }).success).toBe(false);
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
