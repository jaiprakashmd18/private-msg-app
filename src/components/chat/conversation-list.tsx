"use client";

import { Film, ImageIcon, Mic, Paperclip, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/components/app-provider";
import { useChat } from "@/components/chat/chat-provider";
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
import { Avatar, GroupAvatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { deleteChatForMe } from "@/lib/data/chat";
import { displayNameOf, formatListTime } from "@/lib/format";
import { parseLocation } from "@/lib/location";
import { describeSystemEvent } from "@/lib/system-events";
import { cn } from "@/lib/utils";
import type { ConversationSummary } from "@/types/app";

/** The name shown for a conversation in lists and search. */
export function conversationName(c: ConversationSummary): string {
  return c.kind === "group" ? (c.title ?? "Group") : displayNameOf(c.other_display_name, c.other_email);
}

function preview(c: ConversationSummary, myId: string) {
  if (!c.last_message_id) return <span className="italic">No messages yet</span>;
  if (c.last_message_system_event) {
    return (
      <span className="italic">
        {describeSystemEvent(c.last_message_system_event, c.last_message_sender_id, (id) =>
          id === myId ? "You" : id === c.last_message_sender_id ? (c.last_message_sender_name ?? "Someone") : "someone",
        )}
      </span>
    );
  }
  const sender =
    c.last_message_sender_id === myId
      ? "You: "
      : c.kind === "group" && c.last_message_sender_name
        ? `${c.last_message_sender_name.split(" ")[0]}: `
        : "";
  if (c.last_message_deleted) return <span className="italic">{sender}Message deleted</span>;
  if (!c.last_message_body && c.last_message_has_attachments) {
    const kind = c.last_message_attachment_kind;
    return (
      <span className="inline-flex items-center gap-1">
        {sender}
        {kind === "image" ? (
          <>
            <ImageIcon className="size-3.5" aria-hidden /> Photo
          </>
        ) : kind === "audio" ? (
          <>
            <Mic className="size-3.5" aria-hidden /> Voice message
          </>
        ) : kind === "video" ? (
          <>
            <Film className="size-3.5" aria-hidden /> Video
          </>
        ) : (
          <>
            <Paperclip className="size-3.5" aria-hidden /> Attachment
          </>
        )}
      </span>
    );
  }
  return (
    <>
      {sender}
      {parseLocation(c.last_message_body) ? "📍 Location" : c.last_message_body}
    </>
  );
}

export function ConversationList({
  activeId,
  filter,
  onNew,
}: {
  activeId?: string;
  filter: string;
  onNew: () => void;
}) {
  const { access, supabase, reportError } = useApp();
  const { conversations, loading, onlineIds, refreshSoon } = useChat();
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConversationSummary | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function deleteChat(c: ConversationSummary) {
    setDeleting(true);
    try {
      await deleteChatForMe(supabase, c.id);
      refreshSoon();
      toast.success("Chat deleted");
      if (c.id === activeId) router.push("/chat");
    } catch (err) {
      reportError(err, "Could not delete the chat.");
    } finally {
      setDeleting(false);
      setConfirm(null);
      setOpenId(null);
    }
  }

  if (loading) {
    return (
      <ul aria-busy="true" className="space-y-1 px-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <li key={i} className="flex items-center gap-3 rounded-xl px-2 py-3">
            <Skeleton className="size-11 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3.5 w-2/5" />
              <Skeleton className="h-3 w-4/5" />
            </div>
          </li>
        ))}
      </ul>
    );
  }

  const needle = filter.trim().toLowerCase();
  const visible = needle
    ? conversations.filter((c) =>
        `${c.title ?? ""} ${c.other_display_name ?? ""} ${c.other_email ?? ""}`.toLowerCase().includes(needle),
      )
    : conversations;

  if (conversations.length === 0) {
    return (
      <div className="px-6 py-16 text-center">
        <p className="font-medium">No conversations yet</p>
        <p className="mt-1 text-sm text-muted-foreground">Start a private conversation with another member.</p>
        <Button className="mt-5" onClick={onNew}>
          New conversation
        </Button>
      </div>
    );
  }

  if (visible.length === 0) {
    return <p className="px-6 py-10 text-center text-sm text-muted-foreground">No matching conversations.</p>;
  }

  return (
    <>
      <ul className="pb-4">
        {visible.map((c) => (
          <ConversationRow
            key={c.id}
            c={c}
            myId={access.user_id}
            active={c.id === activeId}
            online={c.kind === "direct" && c.other_user_id !== null && onlineIds.has(c.other_user_id) && c.other_is_active}
            open={openId === c.id}
            onOpenChange={(o) => setOpenId(o ? c.id : null)}
            onAskDelete={() => setConfirm(c)}
          />
        ))}
      </ul>

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && !deleting && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm &&
                (confirm.kind === "group"
                  ? "This chat and its history are removed for you. The others keep theirs."
                  : `This chat and its history are removed for you. ${conversationName(confirm)} keeps their copy.`)}{" "}
              If a new message arrives, the chat comes back, starting empty.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction destructive disabled={deleting} onClick={() => confirm && void deleteChat(confirm)}>
              Delete chat
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

const DELETE_WIDTH = 84;

/** One conversation row that swipes left (touch) or shows a trash button (pointer) to delete. */
function ConversationRow({
  c,
  myId,
  active,
  online,
  open,
  onOpenChange,
  onAskDelete,
}: {
  c: ConversationSummary;
  myId: string;
  active: boolean;
  online: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAskDelete: () => void;
}) {
  const name = conversationName(c);
  const unread = c.unread_count > 0;
  const [drag, setDrag] = useState<number | null>(null);
  const start = useRef<{ x: number; y: number; swiping: boolean } | null>(null);

  // How far the row is slid left right now.
  const offset = drag ?? (open ? -DELETE_WIDTH : 0);

  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0]!;
    start.current = { x: t.clientX, y: t.clientY, swiping: false };
  }
  function onTouchMove(e: React.TouchEvent) {
    if (!start.current) return;
    const t = e.touches[0]!;
    const dx = t.clientX - start.current.x;
    const dy = t.clientY - start.current.y;
    if (!start.current.swiping && Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) start.current.swiping = true;
    if (start.current.swiping) {
      const base = open ? -DELETE_WIDTH : 0;
      setDrag(Math.max(-DELETE_WIDTH - 12, Math.min(0, base + dx)));
    }
  }
  function onTouchEnd() {
    if (start.current?.swiping) onOpenChange(offset < -DELETE_WIDTH / 2);
    setDrag(null);
    start.current = null;
  }

  return (
    <li className="relative overflow-hidden">
      {/* Delete action revealed behind the row. */}
      <div className="absolute inset-y-0 right-0 flex items-stretch pr-2" aria-hidden={!open}>
        <button
          type="button"
          onClick={onAskDelete}
          tabIndex={open ? 0 : -1}
          aria-label={`Delete chat with ${name}`}
          className="my-1 flex w-[76px] flex-col items-center justify-center gap-0.5 rounded-2xl bg-destructive text-xs font-medium text-white"
        >
          <Trash2 className="size-5" />
          Delete
        </button>
      </div>

      <Link
        href={`/chat/${c.id}`}
        aria-current={active ? "page" : undefined}
        onClick={(e) => {
          // A swipe (or an open row) shouldn't navigate — it should just close.
          if (open || drag !== null) {
            e.preventDefault();
            onOpenChange(false);
          }
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        style={{ transform: `translateX(${offset}px)`, transition: drag === null ? "transform 0.2s ease" : "none" }}
        className={cn(
          "group relative z-10 mx-2 flex items-center gap-2 rounded-2xl bg-sidebar py-2 pl-1 pr-3 transition-colors active:bg-accent pointer-fine:hover:bg-accent/60",
          active && "bg-accent pointer-fine:hover:bg-accent",
        )}
      >
        {/* Unread: a blue dot, like iMessage. */}
        <span className="grid w-3 shrink-0 place-items-center" aria-hidden>
          {unread && <span className="size-2.5 rounded-full bg-primary" />}
        </span>
        <span className="relative shrink-0">
          {c.kind === "group" ? (
            <GroupAvatar path={c.avatar_path} name={name} className="size-[52px]" />
          ) : (
            <Avatar
              name={name}
              seed={c.other_user_id}
              path={c.other_avatar_path}
              className={cn("size-[52px]", !c.other_is_active && "opacity-50")}
            />
          )}
          {online && (
            <span className="absolute bottom-0.5 right-0.5 size-3.5 rounded-full border-2 border-sidebar bg-success">
              <span className="sr-only">online</span>
            </span>
          )}
        </span>
        <div
          className={cn(
            "min-w-0 flex-1 border-b border-border/50 py-1.5 pl-1 group-last-of-type:border-transparent",
            active && "border-transparent",
          )}
        >
          <div className="flex items-baseline gap-2">
            <span className="flex-1 truncate text-[17px] font-semibold tracking-[-0.01em]">{name}</span>
            {c.last_message_created_at && (
              <time dateTime={c.last_message_created_at} className="shrink-0 text-[15px] text-muted-foreground">
                {formatListTime(c.last_message_created_at)}
              </time>
            )}
          </div>
          <p className={cn("line-clamp-2 text-[15px] leading-5", unread ? "text-foreground" : "text-muted-foreground")}>
            {preview(c, myId)}
          </p>
          {unread && <span className="sr-only">Unread messages: {c.unread_count > 99 ? "99+" : c.unread_count}</span>}
        </div>

        {/* Pointer devices: a trash button on hover (no swipe with a mouse). */}
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onAskDelete();
          }}
          aria-label={`Delete chat with ${name}`}
          className="hidden shrink-0 rounded-full p-2 text-muted-foreground hover:bg-destructive hover:text-white focus-visible:opacity-100 pointer-fine:block pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100"
        >
          <Trash2 className="size-4" />
        </button>
      </Link>
    </li>
  );
}
