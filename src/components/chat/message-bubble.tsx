"use client";

import {
  AlertCircle,
  Check,
  CheckCheck,
  Clock,
  Copy,
  Mic,
  MoreHorizontal,
  Pencil,
  Reply,
  RotateCw,
  Trash2,
  X,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { MessageAttachments } from "@/components/chat/attachment-view";
import { Sticker } from "@/components/chat/sticker";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatBytes, formatMessageTime } from "@/lib/format";
import { formatDuration, isAudio, isImage } from "@/lib/media";
import { isEmojiOnly } from "@/lib/stickers";
import { cn } from "@/lib/utils";
import type { Reaction, ReplyPreview, UiMessage } from "@/types/app";

export type Receipt = "sending" | "failed" | "sent" | "delivered" | "read";

export const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

/**
 * ✓ sent (saved on the server) · ✓✓ delivered (reached their phone) ·
 * ✓✓ in bright cyan, bolder: seen. Cyan stays distinct on every bubble colour.
 */
export function ReceiptIcon({ receipt, className }: { receipt: Receipt; className?: string }) {
  switch (receipt) {
    case "sending":
      return <Clock className={cn("size-3.5", className)} aria-label="Sending" />;
    case "failed":
      return <AlertCircle className={cn("size-3.5 text-destructive", className)} aria-label="Not sent" />;
    case "sent":
      return <Check className={cn("size-4", className)} aria-label="Sent" />;
    case "delivered":
      return <CheckCheck className={cn("size-4", className)} aria-label="Delivered" />;
    case "read":
      return (
        <CheckCheck
          className={cn("size-4 text-[oklch(0.86_0.15_200)] [filter:drop-shadow(0_0_1px_rgb(0_0_0/0.35))]", className)}
          strokeWidth={2.75}
          aria-label="Seen"
        />
      );
  }
}

/** A GIF (from GIPHY), with the attribution GIPHY asks for. */
function GifImage({ gif }: { gif: NonNullable<UiMessage["gif"]> }) {
  const ratio = gif.width && gif.height ? gif.width / gif.height : 1;
  return (
    <span className="relative block w-56 max-w-full overflow-hidden rounded-xl bg-muted sm:w-64" style={{ aspectRatio: String(ratio) }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- animated GIF from GIPHY's CDN */}
      <img src={gif.url} alt={gif.title || "GIF"} loading="lazy" className="size-full object-cover" />
      <span className="absolute bottom-1 left-1 rounded bg-black/55 px-1 text-[9px] font-bold tracking-wide text-white">GIPHY</span>
    </span>
  );
}

/** One-line description of a message, for reply quotes. */
export function describeMessage(m: Pick<ReplyPreview, "body" | "deleted_at" | "attachments">): string {
  if (m.deleted_at) return "Message deleted";
  if (m.body.trim()) return m.body;
  const first = m.attachments?.[0]?.mime_type ?? "";
  if (m.attachments?.[0]?.view_once) return "📷 View-once photo";
  if (isImage(first)) return "📷 Photo";
  if (isAudio(first)) return "🎤 Voice message";
  if (first) return "📎 File";
  return "Message";
}

function ReactionChips({
  reactions,
  myId,
  nameOf,
  onReact,
  mine,
}: {
  reactions: Reaction[];
  myId: string;
  nameOf: (userId: string | null) => string;
  onReact: (emoji: string) => void;
  mine: boolean;
}) {
  const groups = new Map<string, string[]>();
  for (const r of reactions) {
    if (!r.emoji) continue;
    groups.set(r.emoji, [...(groups.get(r.emoji) ?? []), r.user_id]);
  }
  if (groups.size === 0) return null;
  return (
    <div className={cn("-mt-1.5 flex flex-wrap gap-1", mine ? "justify-end pr-2" : "pl-2")}>
      {[...groups.entries()].map(([emoji, users]) => {
        const byMe = users.includes(myId);
        const who = users.map((u) => (u === myId ? "You" : nameOf(u))).join(", ");
        return (
          <button
            key={emoji}
            type="button"
            onClick={() => onReact(emoji)}
            title={who}
            aria-label={`${emoji} ${users.length}: ${who}${byMe ? ". Tap to remove yours" : ". Tap to react the same"}`}
            aria-pressed={byMe}
            className={cn(
              "relative z-10 inline-flex items-center gap-1 rounded-full border bg-popover px-1.5 py-0.5 text-xs shadow-sm transition-colors hover:bg-accent",
              byMe && "border-primary/60 bg-primary/15",
            )}
          >
            <span>{emoji}</span>
            {users.length > 1 && <span className="tabular-nums text-muted-foreground">{users.length}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function MessageBubble({
  message,
  mine,
  myId,
  receipt,
  grouped,
  senderName,
  nameOf,
  canEdit,
  onEdit,
  onDelete,
  onRetry,
  onDiscard,
  onReply,
  onReact,
  onOpenImage,
  onJumpTo,
}: {
  message: UiMessage;
  mine: boolean;
  myId: string;
  receipt?: Receipt;
  grouped: boolean;
  /** Shown above other people's messages in groups. */
  senderName?: string;
  nameOf: (userId: string | null) => string;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onRetry: () => void;
  onDiscard: () => void;
  onReply: () => void;
  onReact: (emoji: string) => void;
  onOpenImage: (attachmentId: string) => void;
  onJumpTo: (messageId: string) => void;
}) {
  const deleted = Boolean(message.deleted_at);
  const special = !deleted && Boolean(message.sticker || message.gif);
  // One to three emoji on their own are shown big, without a bubble.
  const bigEmoji =
    !deleted &&
    !special &&
    !message.reply_to &&
    !(message.attachments?.length || message.local_files?.length) &&
    isEmojiOnly(message.body);
  const bare = special || bigEmoji;
  const local = Boolean(message.local_status);
  const interactive = !deleted && !local;
  const [dragX, setDragX] = useState(0);
  const touch = useRef<{ x: number; y: number; active: boolean } | null>(null);
  const myReaction = message.message_reactions?.find((r) => r.user_id === myId)?.emoji ?? null;

  // Swipe right on a message to reply (touch screens).
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    if (!interactive || !t) return;
    touch.current = { x: t.clientX, y: t.clientY, active: false };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const start = touch.current;
    const t = e.touches[0];
    if (!start || !t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (!start.active && Math.abs(dy) > Math.abs(dx)) {
      touch.current = null;
      return;
    }
    if (dx > 8) start.active = true;
    if (start.active) setDragX(Math.max(0, Math.min(dx, 80)));
  };
  const onTouchEnd = () => {
    if (dragX > 56) {
      navigator.vibrate?.(15);
      onReply();
    }
    touch.current = null;
    setDragX(0);
  };

  return (
    <div
      id={`message-${message.id}`}
      className={cn("group relative flex px-3 sm:px-6", mine ? "justify-end" : "justify-start", grouped ? "mt-0.5" : "mt-3")}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {dragX > 0 && (
        <Reply
          aria-hidden
          className="absolute left-2 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
          style={{ opacity: Math.min(dragX / 56, 1) }}
        />
      )}
      <div
        className={cn("flex min-w-0 max-w-[85%] flex-col sm:max-w-[70%]", mine ? "items-end" : "items-start")}
        style={{ transform: dragX ? `translateX(${dragX}px)` : undefined, transition: dragX ? "none" : "transform 150ms" }}
      >
        {senderName && !mine && !grouped && (
          <span className="mb-0.5 px-1 text-xs font-medium text-primary">{senderName}</span>
        )}
        <div className={cn("flex items-end gap-1", mine && "flex-row-reverse")}>
          <div
            className={cn(
              "min-w-0 rounded-2xl",
              bare
                ? "px-0.5 py-0.5"
                : cn(
                    "px-3.5 py-2 shadow-sm",
                    mine ? "bg-bubble-mine text-bubble-mine-foreground" : "bg-bubble-theirs text-bubble-theirs-foreground",
                    mine ? (grouped ? "rounded-tr-md" : "rounded-br-md") : grouped ? "rounded-tl-md" : "rounded-bl-md",
                  ),
              "group-data-[highlighted=true]:ring-2 group-data-[highlighted=true]:ring-primary group-data-[highlighted=true]:ring-offset-2 group-data-[highlighted=true]:ring-offset-background",
              local && "opacity-80",
            )}
          >
            {deleted ? (
              <p className="text-sm italic opacity-70">This message was deleted</p>
            ) : (
              <>
                {message.reply_to && (
                  <button
                    type="button"
                    onClick={() => onJumpTo(message.reply_to!.id)}
                    className={cn(
                      "mb-1.5 block w-full rounded-lg border-l-4 px-2.5 py-1.5 text-left text-xs",
                      mine ? "border-white/60 bg-black/15" : "border-primary bg-foreground/5",
                    )}
                  >
                    <span className="block font-semibold">
                      {message.reply_to.sender_id === myId ? "You" : nameOf(message.reply_to.sender_id)}
                    </span>
                    <span className="line-clamp-2 opacity-80">{describeMessage(message.reply_to)}</span>
                  </button>
                )}
                {(message.attachments?.length ?? 0) > 0 && (
                  <div className="mb-1">
                    <MessageAttachments attachments={message.attachments!} mine={mine} onOpenImage={onOpenImage} />
                  </div>
                )}
                {local && (message.local_files?.length ?? 0) > 0 && (
                  <div className="mb-1.5 flex flex-wrap gap-1">
                    {message.local_files!.map((f, i) =>
                      f.previewUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- local preview (blob URL) while uploading
                        <img key={i} src={f.previewUrl} alt="" className="size-24 rounded-lg object-cover" />
                      ) : (
                        <span key={i} className="flex items-center gap-1.5 text-xs opacity-80">
                          {isAudio(f.file.type) ? <Mic className="size-3.5" /> : "📎"}
                          {isAudio(f.file.type) && f.durationMs !== undefined
                            ? `Voice message (${formatDuration(f.durationMs)})`
                            : `${f.file.name} (${formatBytes(f.file.size)})`}
                        </span>
                      ),
                    )}
                  </div>
                )}
                {message.sticker ? (
                  <Sticker id={message.sticker} />
                ) : message.gif ? (
                  <GifImage gif={message.gif} />
                ) : bigEmoji ? (
                  <p className="text-5xl leading-tight" aria-label={message.body}>
                    {message.body}
                  </p>
                ) : (
                  message.body && (
                    <p className="whitespace-pre-wrap text-[15px] leading-relaxed [overflow-wrap:anywhere]">{message.body}</p>
                  )
                )}
              </>
            )}
            <div
              className={cn(
                "mt-0.5 flex items-center justify-end gap-1 text-[11px]",
                bare ? "text-muted-foreground" : mine ? "opacity-80" : "opacity-60",
              )}
            >
              {message.was_scheduled && !deleted && <span title="Love note sent on schedule">scheduled ·</span>}
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

          {interactive && (
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="Message actions"
                className="rounded-full p-1.5 text-muted-foreground transition-opacity hover:bg-accent focus-visible:opacity-100 data-[state=open]:opacity-100 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100"
              >
                <MoreHorizontal className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align={mine ? "end" : "start"}>
                <div role="group" aria-label="React" className="flex gap-0.5 px-1 py-1">
                  {QUICK_REACTIONS.map((emoji) => (
                    <DropdownMenuItem
                      key={emoji}
                      onSelect={() => onReact(emoji)}
                      aria-label={myReaction === emoji ? `Remove ${emoji} reaction` : `React ${emoji}`}
                      className={cn("justify-center px-1.5 text-lg", myReaction === emoji && "bg-primary/20")}
                    >
                      {emoji}
                    </DropdownMenuItem>
                  ))}
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={onReply}>
                  <Reply /> Reply
                </DropdownMenuItem>
                {message.body && !special && (
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
                {mine && canEdit && message.body && !special && (
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
        {!deleted && (
          <ReactionChips
            reactions={message.message_reactions ?? []}
            myId={myId}
            nameOf={nameOf}
            onReact={onReact}
            mine={mine}
          />
        )}
      </div>
    </div>
  );
}
