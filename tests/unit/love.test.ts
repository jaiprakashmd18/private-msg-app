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

describe("plans and the journal", () => {
  it("describes plans, reminders and journal entries", async () => {
    const { describePlanAdded, describePlanReminder, describeJournal } = await import("@/lib/love");
    const at = new Date(2026, 10, 7, 19, 0).toISOString();
    expect(describePlanAdded("Jai", "Dinner", at, "Marina")).toMatch(/^📅 Jai planned “Dinner” · .+ · Marina$/);
    const now = new Date(2026, 10, 7, 18, 0).getTime();
    expect(describePlanReminder("Dinner", at, now)).toBe("⏰ “Dinner” in 1 h");
    expect(describePlanReminder("Dinner", at, new Date(2026, 10, 7, 18, 45).getTime())).toBe("⏰ “Dinner” in 15 minutes");
    expect(describeJournal("Meenu")).toBe("Meenu wrote in your journal 📔");
  });

  it("counts down to the next meet", async () => {
    const { describeMeet, describeDateReminder } = await import("@/lib/dates");
    expect([0, 1, 12].map(describeMeet)).toEqual(["💞 We meet today!", "💞 We meet tomorrow!", "💞 12 days until we meet"]);
    expect(describeDateReminder({ kind: "meet", title: "We meet", years: 0 })).toBe("💞 Today we meet!");
  });
});

describe("short plan times", () => {
  it("says today / tmrw / weekday", async () => {
    const { formatPlanTimeShort } = await import("@/lib/love");
    const now = new Date(2026, 10, 7, 10, 0);
    expect(formatPlanTimeShort(new Date(2026, 10, 7, 19, 0).toISOString(), now)).toMatch(/^today 7/);
    expect(formatPlanTimeShort(new Date(2026, 10, 8, 19, 30).toISOString(), now)).toMatch(/^tmrw 7:30/);
    expect(formatPlanTimeShort(new Date(2026, 10, 10, 19, 0).toISOString(), now)).toMatch(/^Tue 7/);
  });
});
