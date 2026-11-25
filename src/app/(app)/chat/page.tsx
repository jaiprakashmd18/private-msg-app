import { MessagesSquare } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Messages" };

export default function InboxPage() {
  return (
    <div className="conversation-canvas grid flex-1 place-items-center p-6 text-center">
      <div className="w-full max-w-md rounded-[2rem] border bg-card px-6 py-10 shadow-sm">
        <div className="mx-auto mb-4 grid size-16 place-items-center rounded-[1.25rem] bg-accent text-primary">
          <MessagesSquare className="size-7" aria-hidden />
        </div>
        <p className="text-xl font-semibold tracking-tight">Select a conversation</p>
        <p className="mt-1 text-sm text-muted-foreground">Choose a chat from the list or start a new one.</p>
      </div>
    </div>
  );
}
