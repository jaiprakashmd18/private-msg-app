"use client";

import { kindEmoji } from "@/components/chat/couple/special-dates-dialog";
import { daysTogether, describeCountdown, nextOccurrence } from "@/lib/dates";
import type { SpecialDate } from "@/types/app";

/**
 * "❤️ Day 412 together · 🎂 Sam's birthday in 3 days" under the chat header.
 * Shows only what's set: the day counter, and the next date within 30 days.
 */
export function TogetherChip({ dates, onOpen }: { dates: SpecialDate[]; onOpen: () => void }) {
  const together = dates.find((d) => d.kind === "together");
  const upcoming = dates
    .filter((d) => d.kind !== "together")
    .map((d) => ({ d, next: nextOccurrence(d) }))
    .filter((x) => x.next && x.next.daysUntil <= 30)
    .sort((a, b) => a.next!.daysUntil - b.next!.daysUntil)[0];
  const days = together ? daysTogether(together.on_date) : null;
  if ((days === null || days < 1) && !upcoming) return null;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center justify-center gap-2 border-b bg-gradient-to-r from-rose-500/10 via-primary/10 to-rose-500/10 px-4 py-1.5 text-xs font-medium hover:from-rose-500/15 hover:to-rose-500/15"
    >
      {days !== null && days >= 1 && <span>❤️ Day {days.toLocaleString()} together</span>}
      {days !== null && days >= 1 && upcoming && <span aria-hidden>·</span>}
      {upcoming && (
        <span className="truncate">
          {kindEmoji(upcoming.d.kind)} {upcoming.d.title} {describeCountdown(upcoming.next!.daysUntil)}
        </span>
      )}
    </button>
  );
}
