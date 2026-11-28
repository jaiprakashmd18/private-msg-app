"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/components/app-provider";
import { useChat } from "@/components/chat/chat-provider";
import type { SharedChatTheme } from "@/lib/chat-experience";

type StyleRow = { theme: SharedChatTheme | null; pinned_message_id: string | null };
type Pin = { id: string; body: string };

export function useSharedChatStyle(chatId: string) {
  const { supabase } = useApp();
  const { subscribe } = useChat();
  const readVersion = useRef(0);
  const activePin = useRef<string | null>(null);
  const [style, setStyle] = useState<StyleRow | null>(null);
  const [pin, setPin] = useState<Pin | null>(null);
  const refresh = useCallback(async () => {
    const version = ++readVersion.current;
    const { data, error } = await supabase.from("shared_chat_style").select("theme,pinned_message_id")
      .eq("conversation_id", chatId).maybeSingle<StyleRow>();
    if (error || version !== readVersion.current) return;
    activePin.current = data?.pinned_message_id ?? null;
    setStyle(data);
    if (!data?.pinned_message_id) {
      setPin(null);
      return;
    }
    const { data: message } = await supabase.from("messages").select("id,body")
      .eq("conversation_id", chatId).eq("id", data.pinned_message_id).is("deleted_at", null).maybeSingle<Pin>();
    if (version === readVersion.current) setPin(message);
  }, [chatId, supabase]);

  const invalidate = useCallback(() => { readVersion.current++; }, []);

  useEffect(() => {
    const update = () => { void refresh(); };
    const channel = supabase.channel(`style:${chatId}`).on("postgres_changes", {
      event: "*", schema: "public", table: "shared_chat_style", filter: `conversation_id=eq.${chatId}`,
    }, update).subscribe((status) => { if (status === "SUBSCRIBED") update(); });
    const unsubscribe = subscribe((event) => {
      if (event.type === "resync" || (event.type === "update" && event.message.id === activePin.current)) update();
    });
    update();
    window.addEventListener("focus", update);
    return () => {
      window.removeEventListener("focus", update);
      invalidate();
      unsubscribe();
      void supabase.removeChannel(channel);
    };
  }, [chatId, invalidate, refresh, subscribe, supabase]);

  return { theme: style?.theme ?? null, pin: pin?.id === style?.pinned_message_id ? pin : null, refresh };
}
