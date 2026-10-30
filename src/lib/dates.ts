import type { SpecialDate } from "@/types/app";

/**
 * Calendar maths for special dates, in the viewer's local time zone.
 * Dates are plain "YYYY-MM-DD" strings (no time, no zone).
 */

const DAY_MS = 86_400_000;

function parts(date: string): [number, number, number] {
  const [y, m, d] = date.split("-").map(Number);
  return [y!, m!, d!];
}

/** Days between two calendar days, ignoring clock changes. */
function dayIndex(y: number, m: number, d: number): number {
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

function todayParts(now: Date): [number, number, number] {
  return [now.getFullYear(), now.getMonth() + 1, now.getDate()];
}

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** "Day 1" is the day you got together. */
export function daysTogether(onDate: string, now = new Date()): number {
  const [y, m, d] = parts(onDate);
  const [ty, tm, td] = todayParts(now);
  return dayIndex(ty, tm, td) - dayIndex(y, m, d) + 1;
}

export interface Occurrence {
  /** YYYY-MM-DD of the next (or today's) occurrence. */
  date: string;
  daysUntil: number;
  /** Years since the original date on that occurrence. */
  years: number;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Next time the date comes round (today counts). Feb 29 → Feb 28 in other years. */
export function nextOccurrence(d: Pick<SpecialDate, "on_date" | "yearly">, now = new Date()): Occurrence | null {
  const [y, m, day] = parts(d.on_date);
  const [ty, tm, td] = todayParts(now);
  const today = dayIndex(ty, tm, td);
  if (!d.yearly) {
    const at = dayIndex(y, m, day);
    return at >= today ? { date: d.on_date, daysUntil: at - today, years: 0 } : null;
  }
  for (const year of [Math.max(ty, y), Math.max(ty, y) + 1]) {
    const dd = m === 2 && day === 29 && !isLeap(year) ? 28 : day;
    const at = dayIndex(year, m, dd);
    if (at >= today) return { date: `${year}-${pad(m)}-${pad(dd)}`, daysUntil: at - today, years: year - y };
  }
  return null;
}

export function describeCountdown(daysUntil: number): string {
  if (daysUntil === 0) return "today";
  if (daysUntil === 1) return "tomorrow";
  return `in ${daysUntil} days`;
}

/** Short label for a reminder posted into the chat. */
export function describeDateReminder(e: { kind: string; title: string; years: number }): string {
  const span = `${e.years} year${e.years === 1 ? "" : "s"}`;
  if (e.kind === "together") return `🎉 ${span} together today! ❤️`;
  if (e.kind === "anniversary" && e.years > 0) return `🎉 ${e.title} — ${span} today`;
  if (e.kind === "birthday") return `🎂 Today: ${e.title}`;
  return `🎉 Today: ${e.title}`;
}

/** Local "YYYY-MM-DD" for an <input type="date"> default. */
export function localDateString(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
