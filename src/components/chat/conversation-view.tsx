"use client";

import {
  ChevronLeft,
  ChevronRight,
  BookHeart,
  CalendarClock,
  CalendarHeart,
  Clock,
  Eye,
  Heart,
  Images,
  Info,
  ListChecks,
  MessageCircleHeart,
  MoreHorizontal,
  Mountain,
  Palette,
  Search,
  MapPin,
  Smile,
  Sparkles,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/components/app-provider";
import { useChat } from "@/components/chat/chat-provider";
import { Composer, type EditingState, type ReplyingState } from "@/components/chat/composer";
import { ChatSearch } from "@/components/chat/chat-search";
import { ConversationInfoDialog } from "@/components/chat/conversation-info-dialog";
import { AppearanceDialog } from "@/components/chat/couple/appearance-dialog";
import { DailyQuestionDialog, dailyQuestionStatus } from "@/components/chat/couple/daily-question";
import { DatePlansDialog } from "@/components/chat/couple/date-plans-dialog";
import { MoodDialog } from "@/components/chat/couple/mood-dialog";
import { HeartBurst } from "@/components/chat/couple/heart-burst";
import { LoveNotesDialog } from "@/components/chat/couple/love-notes-dialog";
import { type ListTab, SharedListDialog } from "@/components/chat/couple/shared-list-dialog";
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
import { deleteChatForMe, listConversationMembers } from "@/lib/data/chat";
import {
  getChatAppearance,
  getMoods,
  getStreak,
  listDailyAnswers,
  listPlans,
  listSpecialDates,
  sendNudge,
} from "@/lib/data/couple";
import { localDateString } from "@/lib/dates";
import { moodLabel, TAPS, tapFor, type TapKind } from "@/lib/love";
import { requestPushForMessage } from "@/lib/pwa-client";
import { displayNameOf, formatLastSeen, formatTimeHeader, formatTyping } from "@/lib/format";
import { isImage } from "@/lib/media";
import { PlusDialog } from "@/components/plus/plus-dialog";
import { getCurrentLocation, LocationError, locationMessage } from "@/lib/location";
import { cn } from "@/lib/utils";
import type {
  ChatAppearance,
  ConversationMember,
  DailyAnswer,
  DatePlan,
  MemberMood,
  PendingFile,
  SpecialDate,
  UiMessage,
} from "@/types/app";

const GROUP_WINDOW_MS = 5 * 60 * 1000;
/** A time heading ("Today 7:09 PM") appears after a pause this long. */
const TIME_HEADER_GAP_MS = 60 * 60 * 1000;

function needsTimeHeader(prev: UiMessage | undefined, m: UiMessage): boolean {
  if (!prev) return true;
  const a = new Date(prev.created_at);
  const b = new Date(m.created_at);
  return a.toDateString() !== b.toDateString() || b.getTime() - a.getTime() >= TIME_HEADER_GAP_MS;
}

/** "…" in a grey bubble while the other person is typing. */
function TypingBubble({ name }: { name?: string }) {
  return (
    <div className="mt-2.5 flex flex-col items-start px-3 sm:px-5" aria-hidden>
      {name && <span className="mb-0.5 px-3 text-xs text-muted-foreground">{name}</span>}
      <div className="relative flex h-[38px] items-center gap-1 rounded-[19px] bg-bubble-theirs px-3.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-2 animate-bounce rounded-full bg-muted-foreground/70"
            style={{ animationDelay: `${i * 150}ms`, animationDuration: "1s" }}
          />
        ))}
        <svg viewBox="0 0 17 21" className="pointer-events-none absolute -left-[5px] bottom-0 h-[21px] w-[17px] -scale-x-100 fill-bubble-theirs">
          <path d="M0 0v13.5C0 17.6 6.2 20.4 16.6 20.8c.3 0 .4-.3.2-.5C12.9 17.9 11 14.7 11 10V0z" />
        </svg>
      </div>
    </div>
  );
}

function receiptFor(m: UiMessage, othersRead: string | null, othersDelivered: string | null): Receipt {
  if (m.local_status) return m.local_status;
  if (othersRead && othersRead >= m.created_at) return "read";
  if (othersDelivered && othersDelivered >= m.created_at) return "delivered";
  return "sent";
}

export function ConversationView({ conversationId }: { conversationId: string }) {
  const { access, settings, supabase, reportError } = useApp();
  const { conversations, getConversation, loading: inboxLoading, onlineIds, refreshSoon } = useChat();
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
  const [confirmDeleteChat, setConfirmDeleteChat] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const router = useRouter();
  const [infoOpen, setInfoOpen] = useState(false);
  const [panel, setPanel] = useState<"list" | "dates" | "notes" | "look" | "daily" | "mood" | "plans" | null>(null);
  // Ghostline Plus: the couple pack is unlocked if either partner subscribes.
  const [otherPlus, setOtherPlus] = useState(false);
  const [plus, setPlus] = useState<{ open: boolean; feature?: string }>({ open: false });
  const coupleUnlocked = access.is_plus || otherPlus;
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data } = await supabase.rpc("conversation_is_plus", { p_conversation_id: conversationId });
      if (!cancelled) setOtherPlus(data === true);
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [supabase, conversationId]);
  /** Runs the couple-pack action, or shows the paywall when it's locked. */
  const requirePlus = useCallback(
    (feature: string, run: () => void) => {
      if (coupleUnlocked) run();
      else setPlus({ open: true, feature });
    },
    [coupleUnlocked],
  );
  const { rows: plans, reload: reloadPlans } = useLiveRows<DatePlan>("date_plans", conversationId, () =>
    listPlans(supabase, conversationId),
  );
  const [moods, setMoods] = useState<MemberMood[]>([]);
  const [searching, setSearching] = useState(false);
  const [listTab, setListTab] = useState<ListTab>("todo");
  // The header and message box float over the messages; the list is padded
  // by their (changing) heights.
  const headerRef = useRef<HTMLElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(64);
  const [composerHeight, setComposerHeight] = useState(64);
  useEffect(() => {
    const header = headerRef.current;
    const composer = composerRef.current;
    if (!header || !composer || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      setHeaderHeight(header.offsetHeight);
      setComposerHeight(composer.offsetHeight);
    });
    observer.observe(header);
    observer.observe(composer);
    return () => observer.disconnect();
  }, []);
  // Unread messages in other chats, shown on the back button like iMessage.
  const otherUnread = useMemo(
    () => conversations.reduce((sum, c) => (c.id === conversationId ? sum : sum + c.unread_count), 0),
    [conversations, conversationId],
  );
  const [streak, setStreak] = useState<{ days: number; today_done: boolean } | null>(null);
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

  // Streak: refreshed when a message arrives (debounced).
  const lastMessageId = messages[messages.length - 1]?.id;
  useEffect(() => {
    const t = setTimeout(() => {
      getStreak(supabase, conversationId)
        .then(setStreak)
        .catch(() => undefined);
    }, 800);
    return () => clearTimeout(t);
  }, [supabase, conversationId, lastMessageId]);

  // Someone who just sent a message has stopped typing.
  async function shareLocation() {
    setLocating(true);
    try {
      const here = await getCurrentLocation();
      handleSend(locationMessage(here), []);
      setLocationOpen(false);
    } catch (err) {
      toast.error(err instanceof LocationError ? err.message : "Couldn't share your location.");
    } finally {
      setLocating(false);
    }
  }

  async function deleteChat() {
    setConfirmDeleteChat(false);
    try {
      await deleteChatForMe(supabase, conversationId);
      refreshSoon();
      toast.success("Chat deleted");
      router.replace("/chat");
    } catch (err) {
      reportError(err, "Could not delete the chat.");
    }
  }

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
    return `${formatLastSeen(seen)}${feeling}`.replace(/^ · /, "");
  })();

  const daily = dailyQuestionStatus(dailyAnswers, access.user_id, isGroup ? "the others" : title);

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
          className="absolute inset-0 overflow-y-auto overflow-x-hidden overscroll-contain"
          style={{ paddingTop: headerHeight + 12, paddingBottom: composerHeight + 12 }}
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
                  const next = messages[i + 1];
                  const newDay = needsTimeHeader(prev, m);
                  const divider = newDay && (
                    <p className="mb-1 mt-5 text-center text-[11px] font-medium text-muted-foreground">
                      {formatTimeHeader(m.created_at)}
                    </p>
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
                  // The tail goes on the last bubble of a run from the same person.
                  const tail =
                    !next ||
                    Boolean(next.system_event) ||
                    next.sender_id !== m.sender_id ||
                    needsTimeHeader(m, next) ||
                    new Date(next.created_at).getTime() - new Date(m.created_at).getTime() >= GROUP_WINDOW_MS;
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
                        tail={tail}
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
                          className="mt-1 flex items-center justify-end gap-1 px-4 text-[11px] font-medium text-muted-foreground sm:px-6"
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
            {typingIds.length > 0 && (
              <TypingBubble name={isGroup ? typingIds.map((id) => nameOf(id)).join(", ") : undefined} />
            )}
          </div>
        </div>
              {/* Floating glass header: back, photo + name in the middle, actions. */}
        <header
          ref={headerRef}
          className="absolute inset-x-0 top-0 z-20 bg-gradient-to-b from-background via-background/80 to-transparent pt-[max(0.25rem,env(safe-area-inset-top))]"
        >
          <div className="mx-auto flex max-w-4xl items-start justify-between gap-2 px-3 pb-2">
            <Link
              href="/chat"
              aria-label="Back to conversations"
              className="glass mt-0.5 flex h-10 shrink-0 items-center gap-1 rounded-full pl-2 pr-2.5 text-primary shadow-md ring-1 ring-foreground/10 split:invisible"
            >
              <ChevronLeft className="size-6" strokeWidth={2.5} aria-hidden />
              {otherUnread > 0 && (
                <span className="grid min-w-[1.4rem] place-items-center rounded-full bg-white px-1 text-[13px] font-semibold leading-5 text-black">
                  {otherUnread > 99 ? "99+" : otherUnread}
                </span>
              )}
            </Link>
            {summary ? (
              <button
                type="button"
                onClick={() => setInfoOpen(true)}
                className="relative flex min-w-0 flex-1 flex-col items-center"
                aria-label={`${title}: ${isGroup ? "group info" : "contact info"}`}
              >
                <span className="relative">
                  {isGroup ? (
                    <GroupAvatar path={summary.avatar_path} name={title} className="size-14 shadow-sm" />
                  ) : (
                    <Avatar name={title} seed={summary.other_user_id} path={summary.other_avatar_path} className="size-14 shadow-sm" />
                  )}
                  {!isGroup && moods.find((m) => m.user_id === summary.other_user_id) && (
                    <span
                      className="absolute -right-1 -top-0.5 grid size-5 place-items-center rounded-full bg-popover text-xs shadow ring-1 ring-border"
                      aria-hidden
                    >
                      {moods.find((m) => m.user_id === summary.other_user_id)!.mood}
                    </span>
                  )}
                  {!isGroup && summary.other_user_id && onlineIds.has(summary.other_user_id) && !otherInactive && (
                    <span className="absolute bottom-1 right-1 size-3 rounded-full border-2 border-background bg-success" aria-hidden />
                  )}
                </span>
                {/* Name in a glass pill overlapping the avatar's lower edge. */}
                <span className="glass relative -mt-3 flex max-w-full items-center gap-0.5 rounded-full py-0.5 pl-3 pr-2 shadow-md ring-1 ring-foreground/10">
                  <h2 className="truncate text-[15px] font-semibold tracking-[-0.01em]">{title}</h2>
                  <ChevronRight className="size-3 shrink-0 text-muted-foreground/70" aria-hidden />
                </span>
                <p
                  className={cn(
                    "mt-1 flex max-w-full items-center justify-center gap-1 truncate text-[11px] leading-tight empty:hidden",
                    typingIds.length ? "text-primary" : "text-muted-foreground",
                  )}
                  aria-live="polite"
                >
                  {subtitle && <span className="truncate">{subtitle}</span>}
                  {!isGroup && !typingIds.length && streak && streak.days > 0 && (
                    <span className={cn("shrink-0", streak.today_done ? "" : "opacity-60")}>
                      {subtitle && <span className="mr-1" aria-hidden>·</span>}🔥 {streak.days}
                    </span>
                  )}
                </p>
              </button>
            ) : (
              <div className="flex flex-1 flex-col items-center gap-2 pt-1">
                <Skeleton className="size-14 rounded-full" />
                <Skeleton className="h-6 w-24 rounded-full" />
              </div>
            )}
            <div className="mt-0.5 shrink-0">
              {summary && (
                <div className="glass flex h-10 items-center gap-0.5 rounded-full px-1 shadow-md ring-1 ring-foreground/10">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="size-8 rounded-full text-rose-500 hover:bg-foreground/10 hover:text-rose-500"
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
                    <Button variant="ghost" size="icon-sm" aria-label="More" className="relative size-8 rounded-full text-primary hover:bg-foreground/10">
                      <MoreHorizontal className="!size-5" />
                      {daily?.needsMe && !otherInactive && (
                        <span className="absolute right-1 top-1 size-2 rounded-full bg-primary" aria-hidden />
                      )}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-52">
                    <DropdownMenuItem onSelect={() => setSearching(true)}>
                      <Search /> Search in chat
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setPanel("mood")}>
                      <Smile /> My mood
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setPanel("daily")} disabled={otherInactive}>
                      <MessageCircleHeart /> Question of the day
                      {daily && (
                        <span
                          className={cn(
                            "ml-auto pl-3 text-xs",
                            daily.needsMe ? "font-semibold text-primary" : "text-muted-foreground",
                          )}
                        >
                          {daily.label}
                        </span>
                      )}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => {
                        setListTab("todo");
                        setPanel("list");
                      }}
                    >
                      <ListChecks /> Our list
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() =>
                        requirePlus("The bucket list", () => {
                          setListTab("bucket");
                          setPanel("list");
                        })
                      }
                    >
                      <Mountain /> Bucket list {!coupleUnlocked && <Sparkles className="ml-auto size-3.5 text-primary" aria-label="Plus feature" />}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => requirePlus("The date planner", () => setPanel("plans"))}>
                      <CalendarClock /> Date plans {!coupleUnlocked && <Sparkles className="ml-auto size-3.5 text-primary" aria-label="Plus feature" />}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => requirePlus("Special dates", () => setPanel("dates"))}>
                      <CalendarHeart /> Special dates {!coupleUnlocked && <Sparkles className="ml-auto size-3.5 text-primary" aria-label="Plus feature" />}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => requirePlus("Our journal", () => router.push(`/chat/${conversationId}/journal`))}
                    >
                      <BookHeart /> Our journal {!coupleUnlocked && <Sparkles className="ml-auto size-3.5 text-primary" aria-label="Plus feature" />}
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link href={`/chat/${conversationId}/memories`}>
                        <Images /> Memories
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={() => requirePlus("Love notes for later", () => setPanel("notes"))}
                      disabled={otherInactive}
                    >
                      <Clock /> Love note for later {!coupleUnlocked && <Sparkles className="ml-auto size-3.5 text-primary" aria-label="Plus feature" />}
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setPanel("look")}>
                      <Palette /> Chat look
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => setInfoOpen(true)}>
                      <Info /> {isGroup ? "Group info" : "Contact info"}
                    </DropdownMenuItem>
                    <DropdownMenuItem destructive onSelect={() => setConfirmDeleteChat(true)}>
                      <Trash2 /> Delete chat
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                </div>
              )}
            </div>
          </div>
        {searching && (
          <ChatSearch
            conversationId={conversationId}
            nameOf={nameOf}
            onJump={(id) => setJumpTarget(id)}
            onClose={() => setSearching(false)}
          />
        )}
          <div className="flex flex-col gap-1 px-3 pb-2 empty:hidden">
            <TogetherChip
              dates={specialDates ?? []}
              streak={streak}
              plans={plans ?? []}
              onOpen={() => requirePlus("Special dates", () => setPanel("dates"))}
              onOpenPlans={() => requirePlus("The date planner", () => setPanel("plans"))}
              showStreak={false}
            />
            {settings?.admin_can_read_messages && (
              <div
                role="note"
                className="mx-auto flex w-full max-w-xl items-center gap-2 rounded-2xl bg-amber-500/15 px-3 py-1.5 text-xs text-amber-800 dark:text-amber-200"
              >
                <Eye className="size-3.5 shrink-0" aria-hidden />
                The administrator has enabled audited access to message content in this app.
              </div>
            )}
          </div>
        </header>
        <div ref={composerRef} className="absolute inset-x-0 bottom-0 z-20">
          <Composer
            disabled={loading || otherInactive}
            disabledReason={otherInactive ? `${title} no longer has access, so you can't send new messages.` : undefined}
            attachmentsEnabled={settings?.attachments_enabled ?? false}
            allowViewOnce={!isGroup}
            editing={editing}
            replyingTo={replyState}
            onSend={handleSend}
            onSendSticker={(payload) => void sendSticker(payload)}
            onShareLocation={() => setLocationOpen(true)}
            onSaveEdit={edit}
            onCancelEdit={() => setEditing(null)}
            onCancelReply={() => setReplyingTo(null)}
            onTyping={notifyTyping}
          />
        </div>
      </div>



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

      <PlusDialog open={plus.open} onOpenChange={(o) => setPlus((p) => ({ ...p, open: o }))} feature={plus.feature} />

      <SharedListDialog
        conversationId={conversationId}
        allowBucket={coupleUnlocked}
        open={panel === "list"}
        onOpenChange={(o) => setPanel(o ? "list" : null)}
        nameOf={nameOf}
        tab={listTab}
        onTabChange={setListTab}
      />
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
      <DatePlansDialog
        conversationId={conversationId}
        plans={plans}
        open={panel === "plans"}
        onOpenChange={(o) => setPanel(o ? "plans" : null)}
        onChanged={reloadPlans}
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

      <AlertDialog open={locationOpen} onOpenChange={(o) => !locating && setLocationOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send your current location?</AlertDialogTitle>
            <AlertDialogDescription>
              {isGroup ? "Everyone in this group" : title} will see where you are right now on a map. It&apos;s sent once — it
              doesn&apos;t follow you.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={locating}>Cancel</AlertDialogCancel>
            <Button
              onClick={() => void shareLocation()}
              disabled={locating}
            >
              {locating ? <Spinner /> : <MapPin />} {locating ? "Finding you…" : "Send location"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDeleteChat} onOpenChange={setConfirmDeleteChat}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
            <AlertDialogDescription>
              All messages, photos and voice notes in this chat are removed for you. {isGroup ? "The others keep" : `${title} keeps`}{" "}
              their copy. If a new message arrives, the chat comes back, starting empty.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction destructive onClick={() => void deleteChat()}>
              Delete chat
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
