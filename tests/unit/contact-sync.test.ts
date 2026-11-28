import { expect, it } from "vitest";
import { normalizeContactDetails, readVCard } from "@/lib/contact-sync";

it("imports vCards without sending contact names or ambiguous local phone numbers", () => {
  const card = "BEGIN:VCARD\r\nFN:Example Name\r\nitem1.EMAIL: Name@Example.COM\r\nTEL;TYPE=CELL:tel:+995 555-123456\r\nTEL:555123456\r\nEND:VCARD";
  expect(normalizeContactDetails([readVCard(card), { email: ["name@example.com"] }])).toEqual({
    emails: ["name@example.com"], phones: ["+995555123456"],
  });
  expect(() => readVCard("not a card")).toThrow(/vCard/);
});
