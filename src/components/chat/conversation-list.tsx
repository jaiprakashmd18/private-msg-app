"use client";

import { ImageIcon, Mic, Paperclip } from "lucide-react";
import Link from "next/link";
import { useApp } from "@/components/app-provider";
import { useChat } from "@/components/chat/chat-provider";
import { Avatar, GroupAvatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { displayNameOf, formatListTime } from "@/lib/format";
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
      {c.last_message_body}
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
  const { access } = useApp();
  const { conversations, loading, onlineIds } = useChat();

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
    <ul className="space-y-0.5 px-2 pb-4">
      {visible.map((c) => {
        const name = conversationName(c);
        const online = c.kind === "direct" && c.other_user_id !== null && onlineIds.has(c.other_user_id) && c.other_is_active;
        const unread = c.unread_count > 0;
        const active = c.id === activeId;
        return (
          <li key={c.id}>
            <Link
              href={`/chat/${c.id}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-accent/60",
                active && "bg-accent",
              )}
            >
              <span className="relative shrink-0">
                {c.kind === "group" ? (
                  <GroupAvatar path={c.avatar_path} name={name} className="size-11" />
                ) : (
                  <Avatar
                    name={name}
                    seed={c.other_user_id}
                    path={c.other_avatar_path}
                    className={cn("size-11", !c.other_is_active && "opacity-50")}
                  />
                )}
                {online && (
                  <span className="absolute bottom-0 right-0 size-3 rounded-full border-2 border-sidebar bg-success">
                    <span className="sr-only">online</span>
                  </span>
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className={cn("flex-1 truncate", unread ? "font-semibold" : "font-medium")}>{name}</span>
                  {c.last_message_created_at && (
                    <time
                      dateTime={c.last_message_created_at}
                      className={cn("shrink-0 text-xs", unread ? "text-primary" : "text-muted-foreground")}
                    >
                      {formatListTime(c.last_message_created_at)}
                    </time>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <p className={cn("flex-1 truncate text-sm", unread ? "text-foreground" : "text-muted-foreground")}>
                    {preview(c, access.user_id)}
                  </p>
                  {unread && (
                    <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
                      <span className="sr-only">Unread messages: </span>
                      {c.unread_count > 99 ? "99+" : c.unread_count}
                    </span>
                  )}
                </div>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
