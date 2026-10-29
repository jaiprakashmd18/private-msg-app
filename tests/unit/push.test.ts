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
