"use client";

import {
  ArrowLeft,
  CalendarHeart,
  Clock,
  Eye,
  Heart,
  Images,
  Info,
  ListChecks,
  MessageCircleHeart,
  MoreVertical,
  Palette,
  Smile,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/components/app-provider";
import { useChat } from "@/components/chat/chat-provider";
import { Composer, type EditingState, type ReplyingState } from "@/components/chat/composer";
import { ConversationInfoDialog } from "@/components/chat/conversation-info-dialog";
import { AppearanceDialog } from "@/components/chat/couple/appearance-dialog";
import { DailyQuestionBar, DailyQuestionDialog } from "@/components/chat/couple/daily-question";
import { MoodDialog } from "@/components/chat/couple/mood-dialog";
import { HeartBurst } from "@/components/chat/couple/heart-burst";
import { LoveNotesDialog } from "@/components/chat/couple/love-notes-dialog";
import { SharedListDialog } from "@/components/chat/couple/shared-list-dialog";
import { SpecialDatesDialog } from "@/components/chat/couple/special-dates-dialog";
import { TogetherChip } from "@/components/chat/couple/together-chip";
import { Lightbox, type LightboxItem } from "@/components/chat/lightbox";
import { describeMessage, MessageBubble, ReceiptIcon, type Receipt } from "@/components/chat/message-bubble";
import { SystemMessage } from "@/components/chat/system-message";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useConversationMessages } from "@/hooks/use-conversation-messages";
import { useLiveRows } from "@/hooks/use-live-rows";
import { useSignedUrl } from "@/hooks/use-signed-url";
import { useTyping } from "@/hooks/use-typing";
import { AVATARS_BUCKET } from "@/lib/constants";
import { listConversationMembers } from "@/lib/data/chat";
import { getChatAppearance, getMoods, listDailyAnswers, listSpecialDates, sendNudge } from "@/lib/data/couple";
import { localDateString } from "@/lib/dates";
import { moodLabel, TAPS, tapFor, type TapKind } from "@/lib/love";
import { requestPushForMessage } from "@/lib/pwa-client";
import { displayNameOf, formatDayDivider, formatLastSeen, formatTyping } from "@/lib/format";
import { isImage } from "@/lib/media";
import { cn } from "@/lib/utils";
import type {
  ChatAppearance,
  ConversationMember,
  DailyAnswer,
  MemberMood,
  PendingFile,
  SpecialDate,
  UiMessage,
} from "@/types/app";

const GROUP_WINDOW_MS = 5 * 60 * 1000;

function receiptFor(m: UiMessage, othersRead: string | null, othersDelivered: string | null): Receipt {
  if (m.local_status) return m.local_status;
  if (othersRead && othersRead >= m.created_at) return "read";
  if (othersDelivered && othersDelivered >= m.created_at) return "delivered";
  return "sent";
}

export function ConversationView({ conversationId }: { conversationId: string }) {
  const { access, settings, supabase, reportError } = useApp();
  const { getConversation, loading: inboxLoading, onlineIds, refreshSoon } = useChat();
  const summary = getConversation(conversationId);
  const searchParams = useSearchParams();
  const isGroup = summary?.kind === "group";

  const { messages, loading, loadingOlder, hasMore, error, reload, loadOlder, send, sendSticker, retry, discard, edit, remove, react } =
    useConversationMessages(conversationId);
  const { typingIds, notifyTyping, notifyStopped, clearUser } = useTyping(conversationId);

  const [allMembers, setAllMembers] = useState<ConversationMember[]>([]);
  const members = useMemo(() => allMembers.filter((m) => !m.left_at), [allMembers]);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [replyingTo, setReplyingTo] = useState<UiMessage | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [panel, setPanel] = useState<"list" | "dates" | "notes" | "look" | "daily" | "mood" | null>(null);
  const [moods, setMoods] = useState<MemberMood[]>([]);
  const [burstEmojis, setBurstEmojis] = useState<string[]>(["❤️", "💖"]);
  const today = localDateString();
  const { rows: dailyAnswers, reload: reloadDaily } = useLiveRows<DailyAnswer>("daily_answers", conversationId, () =>
    listDailyAnswers(supabase, conversationId, today),
  );
  const [appearance, setAppearance] = useState<ChatAppearance>({ wallpaper_path: null, bubble_color: null });
  const [burst, setBurst] = useState(0);
  const { url: wallpaperUrl } = useSignedUrl(AVATARS_BUCKET, appearance.wallpaper_path);
  const { rows: specialDates, reload: reloadDates } = useLiveRows<SpecialDate>("special_dates", conversationId, () =>
    listSpecialDates(supabase, conversationId),
  );
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [jumpTarget, setJumpTarget] = useState<string | null>(() => searchParams.get("m"));
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

  // Members (names for groups, "last seen" for direct chats). Reloaded when
  // a membership change (system message) arrives.
  const lastSystemId = useMemo(() => [...messages].reverse().find((m) => m.system_event)?.id ?? null, [messages]);
  const loadMembers = useCallback(() => {
    listConversationMembers(supabase, conversationId)
      .then(setAllMembers)
      .catch(() => undefined);
  }, [supabase, conversationId]);
  useEffect(() => {
    loadMembers();
  }, [loadMembers, lastSystemId]);

  // Moods come and go with system messages ("Sam is feeling …").
  const loadMoods = useCallback(() => {
    getMoods(supabase, conversationId)
      .then(setMoods)
      .catch(() => undefined);
  }, [supabase, conversationId]);
  useEffect(() => {
    loadMoods();
    reloadDaily();
  }, [loadMoods, reloadDaily, lastSystemId]);

  // Includes former members, so names in older messages stay right.
  const memberById = useMemo(() => new Map(allMembers.map((m) => [m.user_id, m])), [allMembers]);
  const nameOf = useCallback(
    (userId: string | null) => {
      if (!userId) return "Deleted user";
      if (userId === access.user_id) return "You";
      const m = memberById.get(userId);
      if (m) return displayNameOf(m.display_name, m.email);
      if (userId === summary?.other_user_id) return displayNameOf(summary.other_display_name, summary.other_email);
      return "Former member";
    },
    [memberById, access.user_id, summary],
  );

  useEffect(() => {
    getChatAppearance(supabase, conversationId)
      .then(setAppearance)
      .catch(() => undefined);
  }, [supabase, conversationId]);

  // A heart from the other person that arrives while the chat is open.
  const celebrated = useRef(new Set<string>());
  useEffect(() => {
    const last = messages[messages.length - 1];
    if (
      !last ||
      last.system_event?.type !== "nudge" ||
      last.sender_id === access.user_id ||
      celebrated.current.has(last.id) ||
      Date.now() - new Date(last.created_at).getTime() > 60_000
    ) {
      return;
    }
    celebrated.current.add(last.id);
    setBurstEmojis(tapFor(last.system_event.kind).burst);
    setBurst(Date.now());
    navigator.vibrate?.([120, 60, 120, 60, 240]);
  }, [messages, access.user_id]);

  const nudge = useCallback(async (kind: TapKind) => {
    try {
      const id = await sendNudge(supabase, conversationId, kind);
      celebrated.current.add(id);
      setBurstEmojis(tapFor(kind).burst);
      setBurst(Date.now());
      navigator.vibrate?.(30);
      requestPushForMessage(id);
      refreshSoon();
    } catch (err) {
      reportError(err, "Couldn't send that.");
    }
  }, [supabase, conversationId, refreshSoon, reportError]);

  // Someone who just sent a message has stopped typing.
  const lastMessage = messages[messages.length - 1];
  useEffect(() => {
    if (lastMessage?.sender_id) clearUser(lastMessage.sender_id);
  }, [lastMessage?.id, lastMessage?.sender_id, clearUser]);

  const title = isGroup ? (summary?.title ?? "Group") : displayNameOf(summary?.other_display_name, summary?.other_email);
  const editWindowMs = (settings?.edit_window_minutes ?? 15) * 60_000;
  const otherInactive = summary?.kind === "direct" ? !summary.other_is_active : false;

  const typingText = formatTyping(typingIds.map((id) => (isGroup ? nameOf(id) : "")).filter(Boolean));
  const subtitle = (() => {
    if (!summary) return "";
    if (typingIds.length > 0) return isGroup ? typingText : "typing…";
    if (isGroup) {
      const others = members.filter((m) => m.user_id !== access.user_id);
      const online = others.filter((m) => onlineIds.has(m.user_id)).length;
      return `${members.length} members${online ? ` · ${online} online` : ""}`;
    }
    if (otherInactive) return "No longer has access";
    const otherMood = moods.find((m) => m.user_id === summary.other_user_id);
    const feeling = otherMood ? ` · ${otherMood.mood} ${moodLabel(otherMood.mood).toLowerCase()}`.trimEnd() : "";
    if (summary.other_user_id && onlineIds.has(summary.other_user_id)) return `online${feeling}`;
    const seen = memberById.get(summary.other_user_id ?? "")?.last_seen_at ?? summary.other_last_seen_at;
    return `${formatLastSeen(seen) || summary.other_email || ""}${feeling}`;
  })();

  // "Sent / Delivered / Seen" under my latest message.
  const lastMineId = useMemo(
    () => [...messages].reverse().find((m) => m.sender_id === access.user_id && !m.system_event && !m.deleted_at)?.id ?? null,
    [messages, access.user_id],
  );

  // Every photo in the conversation, for the full-screen viewer.
  const photos: LightboxItem[] = useMemo(
    () =>
      messages.flatMap((m) =>
        m.deleted_at
          ? []
          : (m.attachments ?? [])
              .filter((a) => !a.view_once && isImage(a.mime_type) && a.mime_type !== "image/heic")
              .map((a) => ({ attachment: a, caption: nameOf(m.sender_id), createdAt: m.created_at })),
      ),
    [messages, nameOf],
  );

  // Keep scroll anchored: stick to bottom for new messages, preserve position
  // when older messages are prepended.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const firstId = messages[0]?.id;
    const prepended =
      prevFirstIdRef.current !== undefined &&
      firstId !== prevFirstIdRef.current &&
      messages.length > prevCountRef.current &&
      !atBottomRef.current;
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

  // Jump to a message (search result or reply quote), loading older pages until found.
  useEffect(() => {
    if (!jumpTarget || loading) return;
    if (messages.some((m) => m.id === jumpTarget)) {
      atBottomRef.current = false;
      const el = document.getElementById(`message-${jumpTarget}`);
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
      el?.setAttribute("data-highlighted", "true");
      const t = setTimeout(() => {
        el?.removeAttribute("data-highlighted");
        setJumpTarget(null);
      }, 2000);
      return () => clearTimeout(t);
    }
    if (hasMore && !loadingOlder) void loadOlder();
  }, [jumpTarget, loading, messages, hasMore, loadingOlder, loadOlder]);

  const handleSend = useCallback(
    (body: string, files: PendingFile[]) => {
      if (files.some((f) => f.viewOnce)) {
        // A view-once photo travels alone; any text follows as its own message.
        send("", files, null);
        if (body.trim()) send(body, [], replyingTo);
      } else {
        send(body, files, replyingTo);
      }
      setReplyingTo(null);
      notifyStopped();
    },
    [send, replyingTo, notifyStopped],
  );

  const replyState: ReplyingState | null = replyingTo
    ? { id: replyingTo.id, author: nameOf(replyingTo.sender_id), text: describeMessage(replyingTo) }
    : null;

  // Not in my inbox once it has loaded ⇒ not (or no longer) a member.
  if (!summary && !inboxLoading && (!loading || error)) {
    return (
      <div className="grid flex-1 place-items-center p-6 text-center">
        <div>
          <p className="font-medium">Conversation unavailable</p>
          <p className="mt-1 text-sm text-muted-foreground">
            It may have been deleted, you may have left it, or you don&apos;t have access.
          </p>
          <Button asChild variant="outline" className="mt-4">
            <Link href="/chat">Back to inbox</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <header className="flex items-center gap-3 border-b px-3 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-6">
        <Button asChild variant="ghost" size="icon-sm" className="split:hidden" aria-label="Back to conversations">
          <Link href="/chat">
            <ArrowLeft />
          </Link>
        </Button>
        {summary ? (
          <button
            type="button"
            onClick={() => setInfoOpen(true)}
            className="-my-1 flex min-w-0 flex-1 items-center gap-3 rounded-xl px-1 py-1 text-left hover:bg-accent/60"
            aria-label={`${title}: ${isGroup ? "group info" : "contact info"}`}
          >
            <span className="relative">
              {isGroup ? (
                <GroupAvatar path={summary.avatar_path} name={title} />
              ) : (
                <Avatar name={title} seed={summary.other_user_id} path={summary.other_avatar_path} />
              )}
              {!isGroup && moods.find((m) => m.user_id === summary.other_user_id) && (
                <span
                  className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-popover text-xs shadow ring-1 ring-border"
                  aria-hidden
                >
                  {moods.find((m) => m.user_id === summary.other_user_id)!.mood}
                </span>
              )}
              {!isGroup && summary.other_user_id && onlineIds.has(summary.other_user_id) && !otherInactive && (
                <span className="absolute bottom-0 right-0 size-3 rounded-full border-2 border-background bg-success" aria-hidden />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <h2 className="truncate font-semibold">{title}</h2>
              <p
                className={typingIds.length ? "truncate text-xs text-primary" : "truncate text-xs text-muted-foreground"}
                aria-live="polite"
              >
                {subtitle}
              </p>
            </span>
          </button>
        ) : (
          <div className="flex flex-1 items-center gap-3">
            <Skeleton className="size-10 rounded-full" />
            <Skeleton className="h-4 w-32" />
          </div>
        )}
        {summary && (
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-rose-500 hover:text-rose-500"
                  aria-label="Love taps: thinking of you, I miss you, hug, kiss"
                  title="Love taps"
                  disabled={otherInactive}
                >
                  <Heart className="fill-current" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-52">
                {TAPS.map((t) => (
                  <DropdownMenuItem key={t.kind} onSelect={() => void nudge(t.kind)}>
                    <span className="text-lg leading-none" aria-hidden>
                      {t.emoji}
                    </span>
                    {t.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="More">
                  <MoreVertical />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-52">
                <DropdownMenuItem onSelect={() => setPanel("mood")}>
                  <Smile /> My mood
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setPanel("daily")}>
                  <MessageCircleHeart /> Question of the day
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setPanel("list")}>
                  <ListChecks /> Our list
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setPanel("dates")}>
                  <CalendarHeart /> Special dates
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href={`/chat/${conversationId}/memories`}>
                    <Images /> Memories
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setPanel("notes")} disabled={otherInactive}>
                  <Clock /> Love note for later
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setPanel("look")}>
                  <Palette /> Chat look
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setInfoOpen(true)}>
                  <Info /> {isGroup ? "Group info" : "Contact info"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </header>
      {specialDates && specialDates.length > 0 && <TogetherChip dates={specialDates} onOpen={() => setPanel("dates")} />}
      {summary && !otherInactive && (
        <DailyQuestionBar answers={dailyAnswers} otherName={isGroup ? "the others" : title} onOpen={() => setPanel("daily")} />
      )}

      {settings?.admin_can_read_messages && (
        <div
          role="note"
          className="flex items-center gap-2 border-b bg-amber-500/10 px-4 py-2 text-xs text-amber-800 dark:text-amber-200 sm:px-6"
        >
          <Eye className="size-3.5 shrink-0" aria-hidden />
          The administrator has enabled audited access to message content in this app.
        </div>
      )}

      <div className={cn("relative flex min-h-0 flex-1 flex-col", appearance.bubble_color && `bubble-${appearance.bubble_color}`)}>
        {wallpaperUrl && (
          <div
            aria-hidden
            className="absolute inset-0 bg-cover bg-center"
            style={{
              backgroundImage: `linear-gradient(color-mix(in oklab, var(--background) 55%, transparent), color-mix(in oklab, var(--background) 55%, transparent)), url("${wallpaperUrl}")`,
            }}
          />
        )}
        <HeartBurst burst={burst} emojis={burstEmojis} />
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain py-4"
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          aria-label={`Messages in ${title}`}
        >
          {/* Readable line lengths on wide screens. */}
          <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col">
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
                {messages.length === 0 && error && (
              <div className="grid flex-1 place-items-center px-6 text-center">
                <div>
                  <p className="font-medium">Couldn&apos;t load messages</p>
                  <p className="mt-1 text-sm text-muted-foreground">Check your connection and try again.</p>
                  <Button variant="outline" className="mt-4" onClick={reload}>
                    Try again
                  </Button>
                </div>
              </div>
            )}
            {messages.length === 0 && !error && (
                  <div className="grid flex-1 place-items-center px-6 text-center">
                    <div>
                      <p className="font-medium">No messages yet</p>
                      <p className="mt-1 text-sm text-muted-foreground">Say hello{isGroup ? " to the group" : ` to ${title}`}.</p>
                    </div>
                  </div>
                )}
                {messages.map((m, i) => {
                  const prev = messages[i - 1];
                  const newDay =
                    !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString();
                  const divider = newDay && (
                    <div className="my-4 flex justify-center">
                      <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
                        {formatDayDivider(m.created_at)}
                      </span>
                    </div>
                  );
                  if (m.system_event) {
                    return (
                      <Fragment key={m.id}>
                        {divider}
                        <SystemMessage event={m.system_event} actorId={m.sender_id} nameOf={nameOf} />
                      </Fragment>
                    );
                  }
                  const mine = m.sender_id === access.user_id;
                  const grouped =
                    !newDay &&
                    !prev?.system_event &&
                    prev?.sender_id === m.sender_id &&
                    new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < GROUP_WINDOW_MS;
                  const canEdit = editWindowMs > 0 && now - new Date(m.created_at).getTime() < editWindowMs;
                  const receipt = mine
                    ? receiptFor(m, summary?.other_last_read_at ?? null, summary?.other_last_delivered_at ?? null)
                    : undefined;
                  return (
                    <Fragment key={m.id}>
                      {divider}
                      <MessageBubble
                        message={m}
                        mine={mine}
                        myId={access.user_id}
                        grouped={grouped}
                        senderName={isGroup ? nameOf(m.sender_id) : undefined}
                        nameOf={nameOf}
                        receipt={receipt}
                        canEdit={canEdit}
                        onEdit={() => {
                          setReplyingTo(null);
                          setEditing({ id: m.id, body: m.body });
                        }}
                        onDelete={() => setConfirmDelete(m.id)}
                        onRetry={() => retry(m.client_id)}
                        onDiscard={() => discard(m.client_id)}
                        onReply={() => {
                          setEditing(null);
                          setReplyingTo(m);
                        }}
                        onReact={(emoji) => void react(m.id, emoji)}
                        onOpenImage={(attachmentId) => {
                          const idx = photos.findIndex((p) => p.attachment.id === attachmentId);
                          if (idx >= 0) setLightboxIndex(idx);
                        }}
                        onJumpTo={setJumpTarget}
                      />
                      {m.id === lastMineId && receipt && receipt !== "sending" && receipt !== "failed" && (
                        <p
                          className="mt-1 flex items-center justify-end gap-1 px-4 text-[11px] text-muted-foreground sm:px-7"
                          aria-live="polite"
                        >
                          <ReceiptIcon receipt={receipt} className="size-3.5" />
                          {receipt === "read" ? (isGroup ? "Seen by everyone" : "Seen") : receipt === "delivered" ? "Delivered" : "Sent"}
                        </p>
                      )}
                    </Fragment>
                  );
                })}
              </>
            )}
          </div>
        </div>
      </div>

      <Composer
        disabled={loading || otherInactive}
        disabledReason={otherInactive ? `${title} no longer has access, so you can't send new messages.` : undefined}
        attachmentsEnabled={settings?.attachments_enabled ?? false}
        allowViewOnce={!isGroup}
        editing={editing}
        replyingTo={replyState}
        onSend={handleSend}
        onSendSticker={(payload) => void sendSticker(payload)}
        onSaveEdit={edit}
        onCancelEdit={() => setEditing(null)}
        onCancelReply={() => setReplyingTo(null)}
        onTyping={notifyTyping}
      />

      {summary && (
        <ConversationInfoDialog
          open={infoOpen}
          onOpenChange={setInfoOpen}
          summary={summary}
          members={members}
          onChanged={() => {
            loadMembers();
            refreshSoon();
          }}
        />
      )}

      <SharedListDialog conversationId={conversationId} open={panel === "list"} onOpenChange={(o) => setPanel(o ? "list" : null)} nameOf={nameOf} />
      <SpecialDatesDialog
        conversationId={conversationId}
        dates={specialDates}
        open={panel === "dates"}
        onOpenChange={(o) => setPanel(o ? "dates" : null)}
        onChanged={reloadDates}
      />
      <LoveNotesDialog
        conversationId={conversationId}
        recipientName={isGroup ? "the group" : title}
        open={panel === "notes"}
        onOpenChange={(o) => setPanel(o ? "notes" : null)}
      />
      <DailyQuestionDialog
        conversationId={conversationId}
        answers={dailyAnswers}
        otherName={isGroup ? "the others" : title}
        nameOf={nameOf}
        open={panel === "daily"}
        onOpenChange={(o) => setPanel(o ? "daily" : null)}
        onAnswered={reloadDaily}
      />
      <MoodDialog
        key={panel === "mood" ? "mood-open" : "mood-closed"}
        conversationId={conversationId}
        current={moods.find((m) => m.user_id === access.user_id)}
        otherName={isGroup ? "The group" : title}
        open={panel === "mood"}
        onOpenChange={(o) => setPanel(o ? "mood" : null)}
        onChanged={loadMoods}
      />
      <AppearanceDialog
        conversationId={conversationId}
        appearance={appearance}
        open={panel === "look"}
        onOpenChange={(o) => setPanel(o ? "look" : null)}
        onChanged={setAppearance}
      />

      <Lightbox items={photos} index={lightboxIndex} onIndexChange={setLightboxIndex} onClose={() => setLightboxIndex(null)} />

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
