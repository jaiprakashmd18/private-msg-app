import { describeDateReminder } from "@/lib/dates";
import { describeJournal, describeMood, describePlanAdded, describeTap } from "@/lib/love";
import type { SystemEvent } from "@/types/app";

/** Human text for a chat event, e.g. "Alex added Sam". */
export function describeSystemEvent(
  event: SystemEvent,
  actorId: string | null,
  nameOf: (userId: string | null) => string,
): string {
  const actor = nameOf(actorId);
  switch (event.type) {
    case "group_created":
      return `${actor} created the group "${event.title}"`;
    case "member_added":
      return `${actor} added ${nameOf(event.user_id)}`;
    case "member_removed":
      return `${actor} removed ${nameOf(event.user_id)}`;
    case "member_left":
      return `${nameOf(event.user_id)} left`;
    case "renamed":
      return `${actor} renamed the group to "${event.title}"`;
    case "photo_changed":
      return `${actor} changed the group photo`;
    case "photo_removed":
      return `${actor} removed the group photo`;
    case "nudge":
      return describeTap(event.kind, actor);
    case "daily_answered":
      if (event.both) return "You both answered today's question ✨";
      return actor === "You" ? "You answered today's question 💬" : `${actor} answered today's question 💬`;
    case "mood":
      return describeMood(event.mood, event.note, actor);
    case "plan_added":
      return describePlanAdded(actor, event.title, event.starts_at, event.place);
    case "plan_reminder":
      return `⏰ Coming up: “${event.title}”${event.place ? ` at ${event.place}` : ""}`;
    case "journal":
      return describeJournal(actor);
    case "date_reminder":
      return describeDateReminder(event);
    default:
      return "Group updated";
  }
}
