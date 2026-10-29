"use client";

import type { RealtimeChannel } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/components/app-provider";

const SHOW_FOR_MS = 5000;
const SEND_EVERY_MS = 2500;

/**
 * "Typing…" indicators over a private Realtime channel ("conv:<id>"). Only
 * current members can join (RLS on realtime.messages). Receivers map the
 * user id to a name themselves, so a sender can't impersonate someone.
 */
export function useTyping(conversationId: string) {
  const { supabase, access } = useApp();
  const [typing, setTyping] = useState<Record<string, number>>({});
  const channel = useRef<RealtimeChannel | null>(null);
  const lastSent = useRef(0);

  useEffect(() => {
    const ch = supabase.channel(`conv:${conversationId}`, {
      config: { private: true, broadcast: { self: false } },
    });
    ch.on("broadcast", { event: "typing" }, ({ payload }) => {
      const uid = (payload as { user_id?: string }).user_id;
      if (uid && uid !== access.user_id) setTyping((prev) => ({ ...prev, [uid]: Date.now() + SHOW_FOR_MS }));
    })
      .on("broadcast", { event: "stop" }, ({ payload }) => {
        const uid = (payload as { user_id?: string }).user_id;
        if (uid) {
          setTyping((prev) => {
            const next = { ...prev };
            delete next[uid];
            return next;
          });
        }
      })
      .subscribe();
    channel.current = ch;

    const prune = setInterval(() => {
      setTyping((prev) => {
        const now = Date.now();
        const live = Object.entries(prev).filter(([, until]) => until > now);
        return live.length === Object.keys(prev).length ? prev : Object.fromEntries(live);
      });
    }, 1000);

    return () => {
      clearInterval(prune);
      channel.current = null;
      void supabase.removeChannel(ch);
    };
  }, [supabase, conversationId, access.user_id]);

  /** Call on each keystroke; throttled. */
  const notifyTyping = useCallback(() => {
    const now = Date.now();
    if (now - lastSent.current < SEND_EVERY_MS) return;
    lastSent.current = now;
    void channel.current?.send({ type: "broadcast", event: "typing", payload: { user_id: access.user_id } });
  }, [access.user_id]);

  /** Call when a message is sent. */
  const notifyStopped = useCallback(() => {
    lastSent.current = 0;
    void channel.current?.send({ type: "broadcast", event: "stop", payload: { user_id: access.user_id } });
  }, [access.user_id]);

  /** Someone was "typing" for a moment after a message they sent arrives — clear them. */
  const clearUser = useCallback((userId: string) => {
    setTyping((prev) => {
      if (!(userId in prev)) return prev;
      const next = { ...prev };
      delete next[userId];
      return next;
    });
  }, []);

  return { typingIds: Object.keys(typing), notifyTyping, notifyStopped, clearUser };
}
