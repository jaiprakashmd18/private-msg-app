import { describe, expect, it } from "vitest";
import { daysTogether, describeCountdown, describeDateReminder, nextOccurrence } from "@/lib/dates";

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h);

describe("special dates", () => {
  it("counts days together, starting at day 1", () => {
    expect(daysTogether("2024-01-01", at(2024, 1, 1))).toBe(1);
    expect(daysTogether("2024-01-01", at(2024, 1, 2, 0))).toBe(2);
    expect(daysTogether("2023-01-01", at(2024, 1, 1))).toBe(366);
    // Across a daylight-saving change it is still whole days.
    expect(daysTogether("2024-03-01", at(2024, 4, 1, 23))).toBe(32);
  });

  it("finds the next yearly occurrence, today included", () => {
    expect(nextOccurrence({ on_date: "1995-06-30", yearly: true }, at(2026, 6, 30))).toEqual({
      date: "2026-06-30",
      daysUntil: 0,
      years: 31,
    });
    expect(nextOccurrence({ on_date: "1995-06-30", yearly: true }, at(2026, 7, 1))?.date).toBe("2027-06-30");
    expect(nextOccurrence({ on_date: "2026-12-31", yearly: true }, at(2026, 12, 30))).toEqual({
      date: "2026-12-31",
      daysUntil: 1,
      years: 0,
    });
  });

  it("celebrates Feb 29 on Feb 28 in other years", () => {
    expect(nextOccurrence({ on_date: "2024-02-29", yearly: true }, at(2025, 2, 1))?.date).toBe("2025-02-28");
    expect(nextOccurrence({ on_date: "2024-02-29", yearly: true }, at(2027, 3, 1))?.date).toBe("2028-02-29");
  });

  it("one-off dates disappear once past", () => {
    expect(nextOccurrence({ on_date: "2026-05-01", yearly: false }, at(2026, 4, 29))?.daysUntil).toBe(2);
    expect(nextOccurrence({ on_date: "2026-05-01", yearly: false }, at(2026, 5, 2))).toBeNull();
  });

  it("describes countdowns and reminders", () => {
    expect([0, 1, 12].map(describeCountdown)).toEqual(["today", "tomorrow", "in 12 days"]);
    expect(describeDateReminder({ kind: "together", title: "Us", years: 3 })).toBe("🎉 3 years together today! ❤️");
    expect(describeDateReminder({ kind: "anniversary", title: "Wedding", years: 1 })).toBe("🎉 Wedding — 1 year today");
    expect(describeDateReminder({ kind: "birthday", title: "Sam's birthday", years: 30 })).toBe("🎂 Today: Sam's birthday");
  });
});
