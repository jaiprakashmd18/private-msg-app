import Image from "next/image";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Messages" };

export default function InboxPage() {
  return (
    <div className="conversation-canvas grid flex-1 place-items-center p-6 text-center">
      <div className="w-full max-w-md rounded-[2rem] border bg-card px-6 py-10 shadow-sm">
        <Image src="/icon.svg" width={64} height={64} alt="" className="mx-auto mb-4 rounded-2xl ring-1 ring-border" unoptimized />
        <p className="text-xl font-semibold tracking-tight">Select a conversation</p>
        <p className="mt-1 text-sm text-muted-foreground">Choose a chat from the list or start a new one.</p>
      </div>
    </div>
  );
}
