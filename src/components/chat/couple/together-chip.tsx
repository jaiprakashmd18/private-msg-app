"use client";

import { useState } from "react";
import { kindEmoji } from "@/components/chat/couple/special-dates-dialog";
import { daysTogether, describeCountdown, describeMeet, nextOccurrence } from "@/lib/dates";
import { formatPlanTime, formatPlanTimeShort } from "@/lib/love";
import type { DatePlan, SpecialDate } from "@/types/app";

/**
 * The quiet line under the chat header: "🔥 5 · ❤️ Day 412 together ·
 * 💞 12 days until we meet · 🎂 Sam's birthday in 3 days". Shows only what's
 * set: the streak, the day counter, the next meet, and the next other date
 * within 30 days.
 */
export function TogetherChip({
  dates,
  streak,
  plans,
  onOpen,
  onOpenPlans,
}: {
  dates: SpecialDate[];
  streak: { days: number; today_done: boolean } | null;
  plans: DatePlan[];
  onOpen: () => void;
  onOpenPlans: () => void;
}) {
  // The next date plan in the coming week.
  const [now] = useState(() => Date.now());
  const nextPlan = plans
    .filter((p) => {
      const t = new Date(p.starts_at).getTime();
      return t > now - 3_600_000 && t < now + 7 * 86_400_000;
    })
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0];
  const together = dates.find((d) => d.kind === "together");
  const meet = dates
    .filter((d) => d.kind === "meet")
    .map((d) => ({ d, next: nextOccurrence(d) }))
    .filter((x) => x.next)
    .sort((a, b) => a.next!.daysUntil - b.next!.daysUntil)[0];
  const upcoming = dates
    .filter((d) => d.kind !== "together" && d.kind !== "meet")
    .map((d) => ({ d, next: nextOccurrence(d) }))
    .filter((x) => x.next && x.next.daysUntil <= 30)
    .sort((a, b) => a.next!.daysUntil - b.next!.daysUntil)[0];
  const days = together ? daysTogether(together.on_date) : null;

  const items: React.ReactNode[] = [];
  if (streak && streak.days > 0) {
    items.push(
      <span
        key="streak"
        title={streak.today_done ? "You both wrote today" : "Write to each other today to keep it going"}
        className={streak.today_done ? "" : "opacity-70"}
      >
        🔥 {streak.days}
      </span>,
    );
  }
  if (days !== null && days >= 1) items.push(<span key="days">❤️ Day {days.toLocaleString()} together</span>);
  if (meet) items.push(<span key="meet">{describeMeet(meet.next!.daysUntil)}</span>);
  if (upcoming) {
    items.push(
      <span key="next" className="truncate">
        {kindEmoji(upcoming.d.kind)} {upcoming.d.title} {describeCountdown(upcoming.next!.daysUntil)}
      </span>,
    );
  }
  if (items.length === 0 && !nextPlan) return null;

  // Minimal: one quiet line of small grey text, no pill.
  return (
    <div className="mx-auto flex max-w-full items-center justify-center gap-1.5 whitespace-nowrap text-[11px] text-muted-foreground">
      {items.length > 0 && (
        <button
          type="button"
          onClick={onOpen}
          aria-label="Special dates and streak"
          className="flex min-w-0 items-center gap-1.5 overflow-hidden rounded-full px-1 hover:text-foreground"
        >
          {items.flatMap((item, i) => (i === 0 ? [item] : [<span key={`sep${i}`} aria-hidden>·</span>, item]))}
        </button>
      )}
      {items.length > 0 && nextPlan && <span aria-hidden>·</span>}
      {nextPlan && (
        <button
          type="button"
          onClick={onOpenPlans}
          className="flex min-w-0 shrink items-center gap-1 overflow-hidden rounded-full px-1 hover:text-foreground"
          aria-label={`Next date: ${nextPlan.title}, ${formatPlanTime(nextPlan.starts_at)}`}
        >
          <span aria-hidden>📅</span>
          <span className="truncate">{nextPlan.title}</span>
          <span className="shrink-0">{formatPlanTimeShort(nextPlan.starts_at)}</span>
        </button>
      )}
    </div>
  );
}
