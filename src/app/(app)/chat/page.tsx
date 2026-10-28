import { MessagesSquare } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Messages" };

export default function InboxPage() {
  return (
    <div className="grid flex-1 place-items-center p-6 text-center">
      <div>
        <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-muted text-muted-foreground">
          <MessagesSquare className="size-7" aria-hidden />
        </div>
        <p className="font-medium">Select a conversation</p>
        <p className="mt-1 text-sm text-muted-foreground">Choose a chat from the list or start a new one.</p>
      </div>
    </div>
  );
}
