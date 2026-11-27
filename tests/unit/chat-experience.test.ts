import { expect, it } from "vitest";
import { parseSongLink } from "@/lib/chat-experience";

it("recognizes track links and strips tracking while retaining Apple Music track IDs", () => {
  expect(parseSongLink("https://open.spotify.com/track/1234567890123456789012?si=test")).toEqual({
    provider: "Spotify", url: "https://open.spotify.com/track/1234567890123456789012",
  });
  expect(parseSongLink("https://music.apple.com/us/album/example/123?i=456&at=tracking")).toEqual({
    provider: "Apple Music", url: "https://music.apple.com/us/album/example/123?i=456",
  });
  expect(parseSongLink("https://open.spotify.com.example.test/track/1234567890123456789012")).toBeNull();
  expect(parseSongLink("https://music.apple.com/us/album/example/123")).toBeNull();
});
