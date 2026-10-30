import { describe, expect, it } from "vitest";
import { buildPayload } from "@/lib/push.server";

const base = { conversation_id: "c1", sender_name: "Alex", body: "See you at 8", has_attachments: false, show_preview: true };

describe("push notification payload", () => {
  it("shows sender and message text when previews are on", () => {
    expect(buildPayload(base)).toEqual({ title: "Alex", body: "See you at 8", url: "/chat/c1", tag: "c1" });
  });

  it("hides the message text when previews are off", () => {
    expect(buildPayload({ ...base, show_preview: false }).body).toBe("New message");
  });

  it("describes attachment-only messages and truncates long text", () => {
    expect(buildPayload({ ...base, body: "", has_attachments: true }).body).toBe("📎 Attachment");
    expect(buildPayload({ ...base, body: "x".repeat(500) }).body).toHaveLength(140);
  });
});

describe("push payload for groups and media", () => {
  const group = { ...base, conversation_kind: "group" as const, conversation_title: "Family" };

  it("titles group notifications with the group name and prefixes the sender", () => {
    expect(buildPayload(group)).toMatchObject({ title: "Family", body: "Alex: See you at 8" });
    expect(buildPayload({ ...group, show_preview: false }).body).toBe("New message from Alex");
  });

  it("describes photos and voice notes", () => {
    expect(buildPayload({ ...base, body: "", has_attachments: true, attachment_kind: "image" }).body).toBe("📷 Photo");
    expect(buildPayload({ ...base, body: "", has_attachments: true, attachment_kind: "audio" }).body).toBe("🎤 Voice message");
  });
});

describe("push payload for taps, reminders and view-once photos", () => {
  it("buzzes for 'thinking of you'", () => {
    const p = buildPayload({ ...base, body: "", event: { type: "nudge" } });
    expect(p).toMatchObject({ title: "Alex", body: "is thinking of you ❤️", url: "/chat/c1" });
    expect(p.vibrate?.length).toBeGreaterThan(0);
  });

  it("announces special days, without details when previews are off", () => {
    const event = { type: "date_reminder", kind: "together", title: "Us", years: 2 };
    expect(buildPayload({ ...base, sender_name: "", body: "", event }).body).toBe("🎉 2 years together today! ❤️");
    expect(buildPayload({ ...base, show_preview: false, body: "", event }).body).toBe("You have a special day today");
  });

  it("never reveals a view-once photo", () => {
    expect(buildPayload({ ...base, body: "", has_attachments: true, attachment_kind: "view_once" }).body).toBe(
      "📷 View-once photo",
    );
  });
});
