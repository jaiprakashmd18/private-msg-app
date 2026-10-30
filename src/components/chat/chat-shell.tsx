"use client";

import { useParams } from "next/navigation";
import { ChatProvider } from "@/components/chat/chat-provider";
import { Sidebar } from "@/components/chat/sidebar";
import { cn } from "@/lib/utils";

/**
 * Tablet/desktop: sidebar + conversation side by side.
 * Phone (also sideways): inbox OR conversation, full screen.
 *
 * The shell is pinned to the visible area (see ViewportSync), so on iPhone the
 * header and message box stay on screen while the keyboard is open.
 */
export function ChatShell({ children }: { children: React.ReactNode }) {
  const params = useParams<{ conversationId?: string }>();
  const inConversation = Boolean(params?.conversationId);

  return (
    <ChatProvider>
      <div className="fixed inset-x-0 top-[var(--vv-top,0px)] flex h-[var(--vv-height,100dvh)] overflow-hidden pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
        <aside
          aria-label="Conversations"
          className={cn(
            "w-full shrink-0 flex-col bg-sidebar split:flex split:w-[320px] split:border-r lg:w-[360px] xl:w-[400px]",
            inConversation ? "hidden" : "flex",
          )}
        >
          <Sidebar />
        </aside>
        <main id="main" className={cn("min-w-0 flex-1 flex-col", inConversation ? "flex" : "hidden split:flex")}>
          {children}
        </main>
      </div>
    </ChatProvider>
  );
}
