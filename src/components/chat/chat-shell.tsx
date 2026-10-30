"use client";

import { useParams } from "next/navigation";
import { ChatProvider } from "@/components/chat/chat-provider";
import { Sidebar } from "@/components/chat/sidebar";
import { cn } from "@/lib/utils";

/**
 * Tablet/desktop: sidebar + conversation side by side.
 * Phone (also sideways): inbox OR conversation, full screen.
 *
 * The shell fills the screen (edge to edge in the installed app) and, while
 * the keyboard is open, shrinks to the visible area (see ViewportSync and
 * .app-shell), so the header and message box stay on screen.
 */
export function ChatShell({ children }: { children: React.ReactNode }) {
  const params = useParams<{ conversationId?: string }>();
  const inConversation = Boolean(params?.conversationId);

  return (
    <ChatProvider>
      <div className="app-shell flex overflow-hidden pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)]">
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
