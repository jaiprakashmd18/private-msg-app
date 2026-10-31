import { describe, expect, it } from "vitest";
import { DAILY_QUESTIONS, describeMood, describeTap, questionIndexFor } from "@/lib/love";

describe("love taps, moods and daily questions", () => {
  it("describes taps for both people", () => {
    expect(describeTap("miss_you", "Jai")).toBe("Jai misses you 🥺");
    expect(describeTap("miss_you", "You")).toBe("You sent “I miss you” 🥺");
    expect(describeTap(undefined, "You")).toBe("You sent a ❤️");
  });

  it("describes moods", () => {
    expect(describeMood("😴", "Long day", "Meenu")).toBe("Meenu is feeling 😴 tired — “Long day”");
    expect(describeMood("🥰", null, "You")).toBe("You are feeling 🥰 loved");
  });

  it("gives both of you the same question each day, and a new one the next day", () => {
    const a = questionIndexFor("2026-11-01");
    expect(questionIndexFor("2026-11-01")).toBe(a);
    expect(questionIndexFor("2026-11-02")).toBe((a + 1) % DAILY_QUESTIONS.length);
    expect(questionIndexFor("1999-01-01")).toBeGreaterThanOrEqual(0);
  });
});
