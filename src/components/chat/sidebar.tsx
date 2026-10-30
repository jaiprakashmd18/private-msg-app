"use client";

import { Search, Settings, Shield, SquarePen, WifiOff, X } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useApp } from "@/components/app-provider";
import { useChat } from "@/components/chat/chat-provider";
import { ConversationList } from "@/components/chat/conversation-list";
import { NewConversationDialog } from "@/components/chat/new-conversation-dialog";
import { SearchResults } from "@/components/chat/search-results";
import { UserMenu } from "@/components/chat/user-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePendingRequests } from "@/hooks/use-pending-requests";
import { APP_NAME } from "@/lib/env";

export function Sidebar() {
  const { access } = useApp();
  const { connection } = useChat();
  const params = useParams<{ conversationId?: string }>();
  const [query, setQuery] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const pendingRequests = usePendingRequests();

  return (
    <>
      <header className="flex items-center gap-2 px-4 pb-2 pt-[max(1rem,env(safe-area-inset-top))]">
        <h1 className="flex-1 text-lg font-semibold tracking-tight">{APP_NAME}</h1>
        {access.role === "admin" && (
          <Button asChild variant="ghost" size="icon-sm" aria-label={pendingRequests ? `Admin dashboard, ${pendingRequests} access requests waiting` : "Admin dashboard"} title="Admin dashboard">
            <Link href="/admin">
              <span className="relative">
                <Shield />
                {pendingRequests > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 grid size-4 place-items-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                    {pendingRequests > 9 ? "9+" : pendingRequests}
                  </span>
                )}
              </span>
            </Link>
          </Button>
        )}
        <Button asChild variant="ghost" size="icon-sm" aria-label="Settings" title="Settings">
          <Link href="/settings">
            <Settings />
          </Link>
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="New conversation"
          title="New conversation"
          onClick={() => setNewOpen(true)}
        >
          <SquarePen />
        </Button>
        <UserMenu />
      </header>

      <div className="px-4 pb-3">
        <div className="relative">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            aria-label="Search conversations and messages"
            placeholder="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQuery("")}
            className="h-9 rounded-full border-transparent bg-muted pl-9 pr-9"
            maxLength={100}
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      </div>

      {connection === "reconnecting" && (
        <div role="status" className="mx-4 mb-2 flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          <WifiOff className="size-3.5" aria-hidden /> Reconnecting… new messages will appear when back online.
        </div>
      )}

      <nav aria-label="Conversation list" className="min-h-0 flex-1 overflow-y-auto">
        {query.trim().length >= 2 ? (
          <SearchResults query={query.trim()} onNavigate={() => setQuery("")} />
        ) : (
          <ConversationList activeId={params?.conversationId} filter={query} onNew={() => setNewOpen(true)} />
        )}
      </nav>

      <NewConversationDialog open={newOpen} onOpenChange={setNewOpen} />
    </>
  );
}
