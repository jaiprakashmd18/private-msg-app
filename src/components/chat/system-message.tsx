import { describeSystemEvent } from "@/lib/system-events";
import type { SystemEvent } from "@/types/app";

export function SystemMessage({
  event,
  actorId,
  nameOf,
}: {
  event: SystemEvent;
  actorId: string | null;
  nameOf: (userId: string | null) => string;
}) {
  return (
    <p className="mx-auto my-2 w-fit max-w-[85%] rounded-full bg-muted px-3 py-1 text-center text-xs text-muted-foreground">
      {describeSystemEvent(event, actorId, nameOf)}
    </p>
  );
}
