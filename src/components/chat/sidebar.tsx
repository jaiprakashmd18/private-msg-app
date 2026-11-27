"use client";

import { Inbox, Search, Settings, Shield, SquarePen, WifiOff, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useApp } from "@/components/app-provider";
import { useChat } from "@/components/chat/chat-provider";
import { ConversationList } from "@/components/chat/conversation-list";
import { MessageRequests } from "@/components/chat/message-requests";
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
  const [requestsOpen, setRequestsOpen] = useState(false);
  const pendingRequests = usePendingRequests();

  return (
    <>
      <header className="shrink-0 px-4 pb-4 pt-[max(1rem,env(safe-area-inset-top))] split:pt-4">
        <div className="flex h-11 items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Image src="/icon.svg" width={36} height={36} alt="" className="shrink-0 rounded-xl ring-1 ring-border" unoptimized />
            <span className="truncate font-semibold">{APP_NAME}</span>
          </div>
          <div className="flex items-center gap-1">
            {access.role === "admin" && (
              <Button
                asChild
                variant="ghost"
                size="icon-sm"
                className="text-primary hover:bg-transparent"
                aria-label={pendingRequests ? `Admin dashboard, ${pendingRequests} access requests waiting` : "Admin dashboard"}
                title="Admin dashboard"
              >
                <Link href="/admin">
                  <span className="relative">
                    <Shield />
                    {pendingRequests > 0 && (
                      <span className="absolute -right-1.5 -top-1.5 grid size-4 place-items-center rounded-full bg-destructive text-[10px] font-semibold text-white">
                        {pendingRequests > 9 ? "9+" : pendingRequests}
                      </span>
                    )}
                  </span>
                </Link>
              </Button>
            )}
            <Button asChild variant="ghost" size="icon-sm" className="text-primary hover:bg-transparent" aria-label="Settings" title="Settings">
              <Link href="/settings">
                <Settings />
              </Link>
            </Button>
            <UserMenu />
          </div>
        </div>
        <div className="mb-3 mt-5 flex items-center justify-between gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">Inbox</h1>
          <Button onClick={() => setNewOpen(true)} className="shrink-0 gap-2 rounded-xl" aria-label="New conversation">
            <SquarePen className="size-4" aria-hidden />
            New chat
          </Button>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setRequestsOpen(true)} className="mb-1 px-2">
          <Inbox /> Message requests
        </Button>
        <div className="relative mt-2">
          <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            aria-label="Search conversations and messages"
            placeholder="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setQuery("")}
            className="h-11 rounded-xl bg-background pl-9 pr-9 text-[17px] pointer-fine:text-[15px]"
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
      </header>

      {connection === "reconnecting" && (
        <div role="status" className="mx-4 mb-2 flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
          <WifiOff className="size-3.5" aria-hidden /> Reconnecting… new messages will appear when back online.
        </div>
      )}

      <nav aria-label="Conversation list" className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
        {query.trim().length >= 2 ? (
          <SearchResults query={query.trim()} onNavigate={() => setQuery("")} />
        ) : (
          <ConversationList activeId={params?.conversationId} filter={query} onNew={() => setNewOpen(true)} />
        )}
      </nav>

      <MessageRequests open={requestsOpen} onOpenChange={setRequestsOpen} />
      <NewConversationDialog open={newOpen} onOpenChange={setNewOpen} />
    </>
  );
}
