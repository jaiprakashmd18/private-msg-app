import { describe, expect, it } from "vitest";
import { GIPHY_URL, parseGiphyResponse } from "@/lib/giphy";
import { isEmojiOnly, STICKERS, stickerById } from "@/lib/stickers";

describe("stickers", () => {
  it("has unique ids the database accepts", () => {
    const ids = STICKERS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]{1,40}$/);
    expect(stickerById("love-you")?.label).toBe("Love you");
  });

  it("detects emoji-only messages (shown big)", () => {
    expect(["❤️", "😂😂", "👩‍❤️‍👨", "🥰 🥰 🥰"].every(isEmojiOnly)).toBe(true);
    expect(["hi ❤️", "😂😂😂😂", "", "123", "ok"].some(isEmojiOnly)).toBe(false);
  });
});

describe("GIPHY results", () => {
  it("keeps only GIPHY image URLs and the fields the app needs", () => {
    const gifs = parseGiphyResponse({
      data: [
        { id: "abc", title: "Hug", images: { fixed_width: { url: "https://media1.giphy.com/media/abc/200w.gif?cid=1&ct=g", width: "200", height: "150" } } },
        { id: "bad", title: "x", images: { fixed_width: { url: "https://evil.example/x.gif", width: "200", height: "150" } } },
        { id: "nourl", images: {} },
      ],
    });
    expect(gifs).toEqual([{ id: "abc", title: "Hug", url: "https://media1.giphy.com/media/abc/200w.gif?cid=1&ct=g", width: 200, height: 150 }]);
    expect(parseGiphyResponse(null)).toEqual([]);
    expect(GIPHY_URL.test("https://media.giphy.com.evil.example/x.gif")).toBe(false);
  });
});
