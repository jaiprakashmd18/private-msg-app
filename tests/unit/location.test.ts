import { describe, expect, it } from "vitest";
import { locationMessage, mapsUrl, parseLocation } from "@/lib/location";
import { buildPayload } from "@/lib/push.server";

describe("shared location messages", () => {
  it("round-trips a location through the message text", () => {
    const body = locationMessage({ lat: 12.9716, lng: 77.5946 });
    expect(body).toBe("📍 Location\nhttps://www.google.com/maps/search/?api=1&query=12.971600,77.594600");
    expect(parseLocation(body)).toEqual({ lat: 12.9716, lng: 77.5946 });
    expect(parseLocation(locationMessage({ lat: -33.8688, lng: -151.2093 }))).toEqual({ lat: -33.8688, lng: -151.2093 });
  });

  it("only recognises the exact format, with valid coordinates", () => {
    expect(parseLocation("📍 Location")).toBeNull();
    expect(parseLocation("look https://www.google.com/maps/search/?api=1&query=1.0,2.0")).toBeNull();
    expect(parseLocation("📍 Location\nhttps://evil.example/maps/search/?api=1&query=1.0,2.0")).toBeNull();
    expect(parseLocation("📍 Location\nhttps://www.google.com/maps/search/?api=1&query=95.0,2.0")).toBeNull();
    expect(parseLocation(null)).toBeNull();
  });

  it("opens Apple Maps on iPhone and Google Maps elsewhere", () => {
    expect(mapsUrl({ lat: 1.5, lng: 2.25 }, "ios")).toBe("https://maps.apple.com/?ll=1.500000,2.250000&q=Shared%20location");
    expect(mapsUrl({ lat: 1.5, lng: 2.25 }, "android")).toBe("https://www.google.com/maps/search/?api=1&query=1.500000,2.250000");
  });

  it("notifications say '📍 Location' instead of the link", () => {
    const p = buildPayload({
      show_preview: true,
      conversation_id: "c1",
      sender_name: "Meenu",
      body: locationMessage({ lat: 1, lng: 2 }),
      has_attachments: false,
    });
    expect(p.body).toBe("📍 Location");
  });
});
