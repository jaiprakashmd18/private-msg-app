"use client";

import { useParams } from "next/navigation";
import { ChatProvider } from "@/components/chat/chat-provider";
import { Sidebar } from "@/components/chat/sidebar";
import { cn } from "@/lib/utils";

/**
 * Desktop: sidebar + conversation side by side.
 * Mobile: inbox OR conversation, full screen.
 */
export function ChatShell({ children }: { children: React.ReactNode }) {
  const params = useParams<{ conversationId?: string }>();
  const inConversation = Boolean(params?.conversationId);

  return (
    <ChatProvider>
      <div className="flex h-dvh overflow-hidden">
        <aside
          aria-label="Conversations"
          className={cn(
            "w-full shrink-0 flex-col border-r bg-sidebar md:flex md:w-[340px] lg:w-[380px]",
            inConversation ? "hidden" : "flex",
          )}
        >
          <Sidebar />
        </aside>
        <main id="main" className={cn("min-w-0 flex-1 flex-col", inConversation ? "flex" : "hidden md:flex")}>
          {children}
        </main>
      </div>
    </ChatProvider>
  );
}
