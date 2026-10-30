import type { SystemEvent } from "@/types/app";

/** Human text for a group event, e.g. "Alex added Sam". */
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
    default:
      return "Group updated";
  }
}
