"use client";

import { ArrowLeft, Eye } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useApp } from "@/components/app-provider";
import { useChat } from "@/components/chat/chat-provider";
import { Composer, type EditingState } from "@/components/chat/composer";
import { MessageBubble, type Receipt } from "@/components/chat/message-bubble";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useConversationMessages } from "@/hooks/use-conversation-messages";
import { displayNameOf, formatDayDivider } from "@/lib/format";
import type { UiMessage } from "@/types/app";

const GROUP_WINDOW_MS = 5 * 60 * 1000;

function receiptFor(m: UiMessage, otherRead: string | null, otherDelivered: string | null): Receipt {
  if (m.local_status) return m.local_status;
  if (otherRead && otherRead >= m.created_at) return "read";
  if (otherDelivered && otherDelivered >= m.created_at) return "delivered";
  return "sent";
}

export function ConversationView({ conversationId }: { conversationId: string }) {
  const { access, settings } = useApp();
  const { getConversation, loading: inboxLoading } = useChat();
  const summary = getConversation(conversationId);
  const searchParams = useSearchParams();
  const targetId = searchParams.get("m");

  const { messages, loading, loadingOlder, hasMore, error, loadOlder, send, retry, discard, edit, remove } =
    useConversationMessages(conversationId);

  const [editing, setEditing] = useState<EditingState | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const prevCountRef = useRef(0);
  const prevFirstIdRef = useRef<string | undefined>(undefined);
  const prevScrollHeightRef = useRef(0);
  const [now, setNow] = useState(() => Date.now());

  // Re-evaluate edit eligibility periodically.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const name = displayNameOf(summary?.other_display_name, summary?.other_email);
  const editWindowMs = (settings?.edit_window_minutes ?? 15) * 60_000;

  // Keep scroll anchored: stick to bottom for new messages, preserve position
  // when older messages are prepended.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const firstId = messages[0]?.id;
    const prepended = prevFirstIdRef.current !== undefined && firstId !== prevFirstIdRef.current && messages.length > prevCountRef.current && !atBottomRef.current;
    if (prepended) {
      el.scrollTop = el.scrollHeight - prevScrollHeightRef.current + el.scrollTop;
    } else if (messages.length > prevCountRef.current) {
      const last = messages[messages.length - 1];
      if (atBottomRef.current || last?.sender_id === access.user_id || prevCountRef.current === 0) {
        el.scrollTop = el.scrollHeight;
      }
    }
    prevCountRef.current = messages.length;
    prevFirstIdRef.current = firstId;
    prevScrollHeightRef.current = el.scrollHeight;
  }, [messages, access.user_id]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    prevScrollHeightRef.current = el.scrollHeight;
    if (el.scrollTop < 120 && hasMore && !loadingOlder && !loading) void loadOlder();
  }, [hasMore, loadingOlder, loading, loadOlder]);

  // Jump to a search result, loading older pages until it is found.
  useEffect(() => {
    if (!targetId || loading) return;
    const found = messages.some((m) => m.id === targetId);
    if (found) {
      atBottomRef.current = false;
      const el = document.getElementById(`message-${targetId}`);
      el?.scrollIntoView({ block: "center" });
      el?.setAttribute("data-highlighted", "true");
      const t = setTimeout(() => el?.removeAttribute("data-highlighted"), 2500);
      return () => clearTimeout(t);
    }
    if (hasMore && !loadingOlder) void loadOlder();
  }, [targetId, loading, messages, hasMore, loadingOlder, loadOlder]);

  if (!summary && !inboxLoading && !loading && error) {
    return (
      <div className="grid flex-1 place-items-center p-6 text-center">
        <div>
          <p className="font-medium">Conversation unavailable</p>
          <p className="mt-1 text-sm text-muted-foreground">It may have been deleted, or you don&apos;t have access.</p>
          <Button asChild variant="outline" className="mt-4">
            <Link href="/chat">Back to inbox</Link>
          </Button>
        </div>
      </div>
    );
  }

  const otherInactive = summary ? !summary.other_is_active : false;

  return (
    <>
      <header className="flex items-center gap-3 border-b px-3 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-6">
        <Button asChild variant="ghost" size="icon-sm" className="md:hidden" aria-label="Back to conversations">
          <Link href="/chat">
            <ArrowLeft />
          </Link>
        </Button>
        {summary ? (
          <>
            <Avatar name={name} seed={summary.other_user_id} />
            <div className="min-w-0 flex-1">
              <h2 className="truncate font-semibold">{name}</h2>
              <p className="truncate text-xs text-muted-foreground">
                {otherInactive ? "No longer has access" : summary.other_email}
              </p>
            </div>
          </>
        ) : (
          <div className="flex flex-1 items-center gap-3">
            <Skeleton className="size-10 rounded-full" />
            <Skeleton className="h-4 w-32" />
          </div>
        )}
      </header>

      {settings?.admin_can_read_messages && (
        <div role="note" className="flex items-center gap-2 border-b bg-amber-500/10 px-4 py-2 text-xs text-amber-800 dark:text-amber-200 sm:px-6">
          <Eye className="size-3.5 shrink-0" aria-hidden />
          The administrator has enabled audited access to message content in this app.
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain py-4"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label={`Messages with ${name}`}
      >
        {loading ? (
          <div className="space-y-3 px-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className={i % 2 ? "flex justify-end" : "flex"}>
                <Skeleton className="h-10 w-2/5 rounded-2xl" />
              </div>
            ))}
          </div>
        ) : (
          <>
            {hasMore ? (
              <div className="flex justify-center py-2">
                <Button variant="ghost" size="sm" onClick={() => void loadOlder()} disabled={loadingOlder}>
                  {loadingOlder ? <Spinner label="Loading earlier messages" /> : "Load earlier messages"}
                </Button>
              </div>
            ) : (
              messages.length > 0 && (
                <p className="py-3 text-center text-xs text-muted-foreground">Beginning of your conversation</p>
              )
            )}
            {messages.length === 0 && (
              <div className="grid h-full place-items-center px-6 text-center">
                <div>
                  <p className="font-medium">No messages yet</p>
                  <p className="mt-1 text-sm text-muted-foreground">Say hello to {name}.</p>
                </div>
              </div>
            )}
            {messages.map((m, i) => {
              const prev = messages[i - 1];
              const mine = m.sender_id === access.user_id;
              const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString();
              const grouped =
                !newDay &&
                prev?.sender_id === m.sender_id &&
                new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < GROUP_WINDOW_MS;
              const canEdit =
                editWindowMs > 0 && now - new Date(m.created_at).getTime() < editWindowMs;
              return (
                <Fragment key={m.id}>
                  {newDay && (
                    <div className="my-4 flex justify-center">
                      <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
                        {formatDayDivider(m.created_at)}
                      </span>
                    </div>
                  )}
                  <MessageBubble
                    message={m}
                    mine={mine}
                    grouped={grouped}
                    receipt={mine ? receiptFor(m, summary?.other_last_read_at ?? null, summary?.other_last_delivered_at ?? null) : undefined}
                    canEdit={canEdit}
                    onEdit={() => setEditing({ id: m.id, body: m.body })}
                    onDelete={() => setConfirmDelete(m.id)}
                    onRetry={() => retry(m.client_id)}
                    onDiscard={() => discard(m.client_id)}
                  />
                </Fragment>
              );
            })}
          </>
        )}
      </div>

      <Composer
        disabled={loading || otherInactive}
        disabledReason={otherInactive ? `${name} no longer has access, so you can't send new messages.` : undefined}
        attachmentsEnabled={settings?.attachments_enabled ?? false}
        editing={editing}
        onSend={send}
        onSaveEdit={edit}
        onCancelEdit={() => setEditing(null)}
      />

      <AlertDialog open={confirmDelete !== null} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this message?</AlertDialogTitle>
            <AlertDialogDescription>
              It will be removed for everyone in this conversation, including any attached files. This can&apos;t be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              destructive
              onClick={() => {
                if (confirmDelete) void remove(confirmDelete);
                setConfirmDelete(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
