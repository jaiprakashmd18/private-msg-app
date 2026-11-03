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
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { MessageAttachments } from "@/components/chat/attachment-view";
import { LinkifiedText, LinkPreviewCard } from "@/components/chat/link-preview";
import { LocationCard } from "@/components/chat/location-card";
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
import { parseLocation } from "@/lib/location";
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
  if (parseLocation(m.body)) return "📍 Location";
  if (m.body.trim()) return m.body;
  const first = m.attachments?.[0]?.mime_type ?? "";
  if (m.attachments?.[0]?.view_once) return "📷 View-once photo";
  if (isImage(first)) return "📷 Photo";
  if (isAudio(first)) return "🎤 Voice message";
  if (first.startsWith("video/")) return "🎬 Video";
  if (first) return "📎 File";
  return "Message";
}

/**
 * Reactions shown iMessage-style: small glass badges on the bubble's top
 * corner (left for your messages, right for theirs). Tap one to add or
 * remove the same reaction.
 */
function Tapbacks({
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
    <div className={cn("absolute -top-4 z-10 flex", mine ? "-left-3 flex-row-reverse" : "-right-3")}>
      {[...groups.entries()].map(([emoji, users], i) => {
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
              "glass relative inline-flex h-7 min-w-7 items-center justify-center gap-0.5 rounded-full px-1.5 text-sm shadow-md transition-transform active:scale-90",
              i > 0 && (mine ? "-mr-2" : "-ml-2"),
              byMe && "ring-2 ring-primary/70",
            )}
          >
            <span className="leading-none">{emoji}</span>
            {users.length > 1 && <span className="text-[10px] font-semibold tabular-nums">{users.length}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** The little tail on the last bubble of a run (drawn in the bubble's colour). */
function BubbleTail({ mine }: { mine: boolean }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 17 21"
      className={cn(
        "pointer-events-none absolute bottom-0 h-[21px] w-[17px]",
        mine ? "-right-[5px] fill-bubble-mine" : "-left-[5px] -scale-x-100 fill-bubble-theirs",
      )}
    >
      <path d="M0 0v13.5C0 17.6 6.2 20.4 16.6 20.8c.3 0 .4-.3.2-.5C12.9 17.9 11 14.7 11 10V0z" />
    </svg>
  );
}

const LONG_PRESS_MS = 450;

export function MessageBubble({
  message,
  mine,
  myId,
  receipt,
  grouped,
  tail = true,
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
  /** Follows a message from the same person (smaller gap). */
  grouped: boolean;
  /** Last of a run: draw the tail. */
  tail?: boolean;
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
  const hasMedia = (message.attachments?.length ?? 0) > 0 && !message.body;
  const sharedLocation = !deleted && !special ? parseLocation(message.body) : null;
  const bare = special || bigEmoji;
  const local = Boolean(message.local_status);
  const interactive = !deleted && !local;
  const [dragX, setDragX] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showTime, setShowTime] = useState(false);
  const touch = useRef<{ x: number; y: number; active: boolean; timer: ReturnType<typeof setTimeout> | null } | null>(null);
  const longPressed = useRef(false);
  const myReaction = message.message_reactions?.find((r) => r.user_id === myId)?.emoji ?? null;
  const reactions = (message.message_reactions ?? []).filter((r) => r.emoji);

  useEffect(() => () => {
    if (touch.current?.timer) clearTimeout(touch.current.timer);
  }, []);

  // Touch: swipe right to reply; press and hold for the menu.
  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    if (!interactive || !t) return;
    longPressed.current = false;
    const timer = setTimeout(() => {
      longPressed.current = true;
      navigator.vibrate?.(10);
      setMenuOpen(true);
    }, LONG_PRESS_MS);
    touch.current = { x: t.clientX, y: t.clientY, active: false, timer };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const start = touch.current;
    const t = e.touches[0];
    if (!start || !t) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
      if (start.timer) clearTimeout(start.timer);
      start.timer = null;
    }
    if (!start.active && Math.abs(dy) > Math.abs(dx)) {
      touch.current = null;
      return;
    }
    if (dx > 8) start.active = true;
    if (start.active) setDragX(Math.max(0, Math.min(dx, 80)));
  };
  const onTouchEnd = () => {
    if (touch.current?.timer) clearTimeout(touch.current.timer);
    if (dragX > 56) {
      navigator.vibrate?.(15);
      onReply();
    }
    touch.current = null;
    setDragX(0);
  };

  const meta = [
    message.was_scheduled && !deleted ? "Scheduled" : null,
    message.edited_at && !deleted ? "Edited" : null,
  ].filter(Boolean);

  return (
    <div
      id={`message-${message.id}`}
      className={cn(
        "group relative flex px-3 sm:px-5",
        mine ? "justify-end" : "justify-start",
        grouped ? "mt-[3px]" : "mt-2.5",
        reactions.length > 0 && "mt-5",
        menuOpen && "z-50",
      )}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
      onContextMenu={(e) => {
        if (!interactive) return;
        e.preventDefault();
        setMenuOpen(true);
      }}
    >
      {dragX > 0 && (
        <Reply
          aria-hidden
          className="absolute left-2 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
          style={{ opacity: Math.min(dragX / 56, 1) }}
        />
      )}
      <div
        className={cn("flex min-w-0 max-w-[78%] flex-col sm:max-w-[65%]", mine ? "items-end" : "items-start")}
        style={{ transform: dragX ? `translateX(${dragX}px)` : undefined, transition: dragX ? "none" : "transform 150ms" }}
      >
        {senderName && !mine && !grouped && (
          <span className="mb-0.5 px-3 text-xs text-muted-foreground">{senderName}</span>
        )}
        <div className={cn("relative flex items-center gap-1.5", mine && "flex-row-reverse")}>
          <div
            onClick={(e) => {
              if (longPressed.current) {
                longPressed.current = false;
                return;
              }
              if ((e.target as HTMLElement).closest("a, button, video, input, textarea")) return;
              setShowTime((v) => !v);
            }}
            className={cn(
              "relative min-w-0 transition-transform",
              menuOpen && "scale-[1.03]",
              bare
                ? "px-0.5 py-0.5"
                : cn(
                    "rounded-[19px]",
                    hasMedia && !message.reply_to ? "p-1" : "px-3 py-[7px]",
                    mine ? "bg-bubble-mine text-bubble-mine-foreground" : "bg-bubble-theirs text-bubble-theirs-foreground",
                  ),
              "group-data-[highlighted=true]:ring-2 group-data-[highlighted=true]:ring-primary group-data-[highlighted=true]:ring-offset-2 group-data-[highlighted=true]:ring-offset-background",
              local && "opacity-70",
            )}
          >
            {!bare && tail && !deleted && <BubbleTail mine={mine} />}
            {!deleted && (
              <Tapbacks reactions={reactions} myId={myId} nameOf={nameOf} onReact={onReact} mine={mine} />
            )}
            {deleted ? (
              <p className="text-[15px] italic opacity-70">This message was deleted</p>
            ) : (
              <>
                {message.reply_to && (
                  <button
                    type="button"
                    onClick={() => onJumpTo(message.reply_to!.id)}
                    className={cn(
                      "mb-1 block w-full rounded-xl border-l-[3px] px-2.5 py-1.5 text-left text-[13px]",
                      mine ? "border-white/70 bg-white/15" : "border-primary bg-foreground/[0.06]",
                    )}
                  >
                    <span className="block font-semibold">
                      {message.reply_to.sender_id === myId ? "You" : nameOf(message.reply_to.sender_id)}
                    </span>
                    <span className="line-clamp-2 opacity-80">{describeMessage(message.reply_to)}</span>
                  </button>
                )}
                {(message.attachments?.length ?? 0) > 0 && (
                  <div className={cn(message.body && "mb-1")}>
                    <MessageAttachments attachments={message.attachments!} mine={mine} onOpenImage={onOpenImage} />
                  </div>
                )}
                {local && (message.local_files?.length ?? 0) > 0 && (
                  <div className="mb-1.5 flex flex-wrap gap-1">
                    {message.local_files!.map((f, i) =>
                      f.previewUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- local preview (blob URL) while uploading
                        <img key={i} src={f.previewUrl} alt="" className="size-24 rounded-[14px] object-cover" />
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
                ) : sharedLocation ? (
                  <LocationCard location={sharedLocation} mine={mine} />
                ) : bigEmoji ? (
                  <p className="text-5xl leading-tight" aria-label={message.body}>
                    {message.body}
                  </p>
                ) : (
                  message.body && (
                    <>
                      <p className="whitespace-pre-wrap text-[17px] leading-[22px] tracking-[-0.01em] [overflow-wrap:anywhere] pointer-fine:text-[15px] pointer-fine:leading-[20px]">
                        <LinkifiedText text={message.body} mine={mine} />
                      </p>
                      {!local && <LinkPreviewCard text={message.body} mine={mine} />}
                    </>
                  )
                )}
              </>
            )}
            {mine && receipt && receipt !== "failed" && (
              <span className="sr-only">
                <ReceiptIcon receipt={receipt} />
              </span>
            )}
          </div>

          {message.local_status === "failed" && (
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={onRetry}
                className="grid size-7 place-items-center rounded-full bg-destructive text-white"
                aria-label="Retry sending"
                title="Not delivered — tap to retry"
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
            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger
                aria-label="Message actions"
                className="rounded-full p-1.5 text-muted-foreground transition-opacity hover:bg-accent focus-visible:opacity-100 data-[state=open]:opacity-0 pointer-coarse:pointer-events-none pointer-coarse:absolute pointer-coarse:inset-0 pointer-coarse:opacity-0 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100"
              >
                <MoreHorizontal className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align={mine ? "end" : "start"} className="min-w-56">
                <div role="group" aria-label="React" className="flex gap-0.5 px-1 py-1">
                  {QUICK_REACTIONS.map((emoji) => (
                    <DropdownMenuItem
                      key={emoji}
                      onSelect={() => onReact(emoji)}
                      aria-label={myReaction === emoji ? `Remove ${emoji} reaction` : `React ${emoji}`}
                      className={cn("size-10 justify-center rounded-full p-0 text-xl", myReaction === emoji && "bg-primary/25")}
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
                    <Copy /> Copy
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
        {(showTime || meta.length > 0) && !local && (
          <p className={cn("mt-1 px-3 text-[11px] text-muted-foreground", mine ? "text-right" : "text-left")}>
            {[showTime ? formatMessageTime(message.created_at) : null, ...meta].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>
      {/* While the menu is open the chat behind blurs, like on iPhone. */}
      {menuOpen && <div aria-hidden className="fixed inset-0 -z-10 bg-black/25 backdrop-blur-[3px]" />}
    </div>
  );
}
