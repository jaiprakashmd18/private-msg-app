"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/components/app-provider";
import { listConversations, markAllDelivered } from "@/lib/data/chat";
import type { ConversationSummary, Message } from "@/types/app";

export type ConnectionState = "connecting" | "online" | "reconnecting";

type MessageEvent =
  | { type: "insert"; message: Message }
  | { type: "update"; message: Message }
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
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, (payload) => {
        emit({ type: "update", message: payload.new as Message });
        scheduleRefresh();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "conversation_members" }, () => {
        scheduleRefresh();
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

  useEffect(
    () => () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      if (deliveredTimer.current) clearTimeout(deliveredTimer.current);
    },
    [],
  );

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
    () => ({ conversations, loading, connection, refresh, refreshSoon: scheduleRefresh, subscribe, getConversation }),
    [conversations, loading, connection, refresh, scheduleRefresh, subscribe, getConversation],
  );
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used inside <ChatProvider>");
  return ctx;
}
