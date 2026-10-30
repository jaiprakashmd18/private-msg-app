"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/components/app-provider";
import { heartbeat, listConversations, markAllDelivered } from "@/lib/data/chat";
import { deliverDueItems } from "@/lib/data/couple";
import { displayNameOf } from "@/lib/format";
import { requestPushForMessage, setAppBadge } from "@/lib/pwa-client";
import type { ConversationSummary, Message, Reaction } from "@/types/app";

export type ConnectionState = "connecting" | "online" | "reconnecting";

type MessageEvent =
  | { type: "insert"; message: Message }
  | { type: "update"; message: Message }
  | { type: "reaction"; reaction: Reaction & { message_id: string; conversation_id: string } }
  | { type: "resync" };

type Listener = (event: MessageEvent) => void;

interface ChatContextValue {
  conversations: ConversationSummary[];
  loading: boolean;
  connection: ConnectionState;
  refresh: () => Promise<void>;
  /** Debounced refresh, for the user's own actions (independent of Realtime). */
  refreshSoon: () => void;
  subscribe: (listener: Listener) => () => void;
  getConversation: (id: string) => ConversationSummary | undefined;
  /** Members currently online (Realtime Presence on a private channel). */
  onlineIds: ReadonlySet<string>;
}

const ChatContext = createContext<ChatContextValue | null>(null);

/**
 * Owns the inbox state and ONE Realtime channel for the signed-in user.
 * Realtime applies the SELECT RLS policies of `messages` and
 * `conversation_members` per subscriber, so only events from the user's own
 * conversations arrive. Views register listeners via `subscribe`.
 */
export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { supabase, access, reportError } = useApp();
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [onlineIds, setOnlineIds] = useState<ReadonlySet<string>>(() => new Set());
  const listeners = useRef(new Set<Listener>());
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deliveredTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      setConversations(await listConversations(supabase));
    } catch (error) {
      reportError(error, "Could not load conversations.");
    } finally {
      setLoading(false);
    }
  }, [supabase, reportError]);

  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => void refresh(), 250);
  }, [refresh]);

  const scheduleDelivered = useCallback(() => {
    if (deliveredTimer.current) return;
    deliveredTimer.current = setTimeout(() => {
      deliveredTimer.current = null;
      markAllDelivered(supabase).catch(() => undefined);
    }, 1500);
  }, [supabase]);

  const conversationsRef = useRef(conversations);
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  const emit = useCallback((event: MessageEvent) => {
    for (const listener of listeners.current) listener(event);
  }, []);

  useEffect(() => {
    let cancelled = false;
    listConversations(supabase)
      .then((rows) => !cancelled && setConversations(rows))
      .catch((error) => reportError(error, "Could not load conversations."))
      .finally(() => !cancelled && setLoading(false));
    markAllDelivered(supabase).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [supabase, reportError]);

  useEffect(() => {
    const channel: RealtimeChannel = supabase
      .channel(`inbox:${access.user_id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
        const message = payload.new as Message;
        emit({ type: "insert", message });
        scheduleRefresh();
        if (message.sender_id !== access.user_id) scheduleDelivered();
        // A heart while you're elsewhere in the app (the open chat animates it).
        if (
          message.system_event?.type === "nudge" &&
          message.sender_id !== access.user_id &&
          !window.location.pathname.startsWith(`/chat/${message.conversation_id}`)
        ) {
          const c = conversationsRef.current.find((x) => x.id === message.conversation_id);
          const who = c?.kind === "direct" ? displayNameOf(c.other_display_name, c.other_email) : "Someone";
          toast(`❤️ ${who} is thinking of you`);
          navigator.vibrate?.([120, 60, 120, 60, 240]);
        }
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, (payload) => {
        emit({ type: "update", message: payload.new as Message });
        scheduleRefresh();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_members" }, () => {
        scheduleRefresh();
      })
      // "Subscribed to PostgreSQL" arrives a moment after SUBSCRIBED; changes made
      // in between are only caught by refreshing once the feed is really live.
      .on("system", {}, (payload: { extension?: string; status?: string }) => {
        if (payload.extension === "postgres_changes" && payload.status === "ok") {
          scheduleRefresh();
          emit({ type: "resync" });
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "message_reactions" }, (payload) => {
        const r = payload.new as Reaction & { message_id?: string; conversation_id?: string };
        if (r.message_id && r.conversation_id) {
          emit({ type: "reaction", reaction: r as Reaction & { message_id: string; conversation_id: string } });
        }
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setConnection("online");
          // Catch anything that happened between the initial load (or a
          // disconnect) and this subscription becoming active.
          scheduleRefresh();
          emit({ type: "resync" });
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setConnection("reconnecting");
        }
      });

    const onWake = () => {
      if (document.visibilityState === "visible") {
        emit({ type: "resync" });
        scheduleRefresh();
        scheduleDelivered();
      }
    };
    window.addEventListener("online", onWake);
    document.addEventListener("visibilitychange", onWake);

    return () => {
      window.removeEventListener("online", onWake);
      document.removeEventListener("visibilitychange", onWake);
      void supabase.removeChannel(channel);
    };
  }, [supabase, access.user_id, emit, scheduleRefresh, scheduleDelivered]);

  // Online presence. Private channel: only active members can join (RLS on
  // realtime.messages); each tab tracks itself under its user id.
  useEffect(() => {
    const channel = supabase.channel("online", {
      config: { private: true, presence: { key: access.user_id } },
    });
    channel
      .on("presence", { event: "sync" }, () => {
        setOnlineIds(new Set(Object.keys(channel.presenceState())));
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void channel.track({ online_at: new Date().toISOString() });
      });

    // "Last seen" for when the app is closed.
    const beat = () => {
      if (document.visibilityState === "visible") void heartbeat(supabase);
    };
    beat();
    const interval = setInterval(beat, 60_000);
    document.addEventListener("visibilitychange", beat);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", beat);
      void supabase.removeChannel(channel);
    };
  }, [supabase, access.user_id]);

  // Love notes and date reminders that are due get delivered by the
  // database every minute; while the app is open it also checks, so they
  // arrive even where the scheduler isn't available.
  useEffect(() => {
    const run = () => {
      if (document.visibilityState !== "visible") return;
      deliverDueItems(supabase)
        .then((ids) => ids.forEach(requestPushForMessage))
        .catch(() => undefined);
    };
    run();
    const interval = setInterval(run, 60_000);
    document.addEventListener("visibilitychange", run);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", run);
    };
  }, [supabase]);

  useEffect(
    () => () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      if (deliveredTimer.current) clearTimeout(deliveredTimer.current);
    },
    [],
  );

  // Unread total on the installed app's icon.
  useEffect(() => {
    setAppBadge(conversations.reduce((sum, c) => sum + c.unread_count, 0));
  }, [conversations]);

  const subscribe = useCallback((listener: Listener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  const getConversation = useCallback(
    (id: string) => conversations.find((c) => c.id === id),
    [conversations],
  );

  const value = useMemo(
    () => ({
      conversations,
      loading,
      connection,
      refresh,
      refreshSoon: scheduleRefresh,
      subscribe,
      getConversation,
      onlineIds,
    }),
    [conversations, loading, connection, refresh, scheduleRefresh, subscribe, getConversation, onlineIds],
  );
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used inside <ChatProvider>");
  return ctx;
}
