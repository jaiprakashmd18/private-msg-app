"use client";

import { AlertCircle, Check, CheckCheck, Clock, Copy, MoreHorizontal, Pencil, RotateCw, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { AttachmentView } from "@/components/chat/attachment-view";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatBytes, formatMessageTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { UiMessage } from "@/types/app";

export type Receipt = "sending" | "failed" | "sent" | "delivered" | "read";

function ReceiptIcon({ receipt }: { receipt: Receipt }) {
  switch (receipt) {
    case "sending":
      return <Clock className="size-3.5" aria-label="Sending" />;
    case "failed":
      return <AlertCircle className="size-3.5 text-destructive" aria-label="Not sent" />;
    case "sent":
      return <Check className="size-3.5" aria-label="Sent" />;
    case "delivered":
      return <CheckCheck className="size-3.5" aria-label="Delivered" />;
    case "read":
      return <CheckCheck className="size-3.5 text-sky-300" aria-label="Read" />;
  }
}

export function MessageBubble({
  message,
  mine,
  receipt,
  grouped,
  canEdit,
  onEdit,
  onDelete,
  onRetry,
  onDiscard,
}: {
  message: UiMessage;
  mine: boolean;
  receipt?: Receipt;
  grouped: boolean;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  const deleted = Boolean(message.deleted_at);
  const local = Boolean(message.local_status);
  const showMenu = !deleted && !local;

  return (
    <div
      id={`message-${message.id}`}
      className={cn("group flex px-3 sm:px-6", mine ? "justify-end" : "justify-start", grouped ? "mt-0.5" : "mt-3")}
    >
      <div className={cn("flex max-w-[85%] items-end gap-1 sm:max-w-[70%]", mine && "flex-row-reverse")}>
        <div
          className={cn(
            "min-w-0 rounded-2xl px-3.5 py-2 shadow-sm transition-shadow",
            mine ? "bg-bubble-mine text-bubble-mine-foreground" : "bg-bubble-theirs text-bubble-theirs-foreground",
            mine ? (grouped ? "rounded-tr-md" : "rounded-br-md") : grouped ? "rounded-tl-md" : "rounded-bl-md",
            "group-data-[highlighted=true]:ring-2 group-data-[highlighted=true]:ring-primary group-data-[highlighted=true]:ring-offset-2 group-data-[highlighted=true]:ring-offset-background",
            local && "opacity-80",
          )}
        >
          {deleted ? (
            <p className="text-sm italic opacity-70">This message was deleted</p>
          ) : (
            <>
              {(message.attachments?.length ?? 0) > 0 && (
                <div className="mb-1.5 grid gap-1.5">
                  {message.attachments!.map((a) => (
                    <AttachmentView key={a.id} attachment={a} mine={mine} />
                  ))}
                </div>
              )}
              {local && (message.local_files?.length ?? 0) > 0 && (
                <ul className="mb-1.5 space-y-1 text-xs opacity-80">
                  {message.local_files!.map((f, i) => (
                    <li key={i}>
                      📎 {f.name} ({formatBytes(f.size)})
                    </li>
                  ))}
                </ul>
              )}
              {message.body && (
                <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{message.body}</p>
              )}
            </>
          )}
          <div className={cn("mt-0.5 flex items-center justify-end gap-1 text-[11px]", mine ? "opacity-80" : "opacity-60")}>
            {message.edited_at && !deleted && <span>edited ·</span>}
            <time dateTime={message.created_at}>{formatMessageTime(message.created_at)}</time>
            {mine && receipt && <ReceiptIcon receipt={receipt} />}
          </div>
        </div>

        {message.local_status === "failed" && (
          <div className="flex flex-col gap-1">
            <button
              type="button"
              onClick={onRetry}
              className="rounded-full p-1.5 text-destructive hover:bg-destructive/10"
              aria-label="Retry sending"
              title="Retry"
            >
              <RotateCw className="size-4" />
            </button>
            <button
              type="button"
              onClick={onDiscard}
              className="rounded-full p-1.5 text-muted-foreground hover:bg-accent"
              aria-label="Discard unsent message"
              title="Discard"
            >
              <X className="size-4" />
            </button>
          </div>
        )}

        {showMenu && (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Message actions"
              className="rounded-full p-1.5 text-muted-foreground opacity-100 transition-opacity hover:bg-accent focus-visible:opacity-100 data-[state=open]:opacity-100 md:opacity-0 md:group-hover:opacity-100"
            >
              <MoreHorizontal className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align={mine ? "end" : "start"}>
              {message.body && (
                <DropdownMenuItem
                  onSelect={() => {
                    navigator.clipboard
                      .writeText(message.body)
                      .then(() => toast.success("Copied"))
                      .catch(() => toast.error("Could not copy"));
                  }}
                >
                  <Copy /> Copy text
                </DropdownMenuItem>
              )}
              {mine && canEdit && (
                <DropdownMenuItem onSelect={onEdit}>
                  <Pencil /> Edit
                </DropdownMenuItem>
              )}
              {mine && (
                <DropdownMenuItem destructive onSelect={onDelete}>
                  <Trash2 /> Delete for everyone
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  );
}
