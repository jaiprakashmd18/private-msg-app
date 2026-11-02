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
    <p className="mx-auto my-2.5 w-fit max-w-[85%] px-3 text-center text-[11px] font-medium leading-snug text-muted-foreground">
      {describeSystemEvent(event, actorId, nameOf)}
    </p>
  );
}
