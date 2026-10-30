"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/components/app-provider";

/**
 * Rows of a table for one conversation, kept up to date with Realtime
 * (filtered by RLS per subscriber; deletions are soft, so they arrive as
 * UPDATEs). Reloads through the API on every change.
 */
export function useLiveRows<T>(
  table: string,
  conversationId: string,
  load: () => Promise<T[]>,
  enabled = true,
): { rows: T[] | null; reload: () => void } {
  const { supabase } = useApp();
  const [rows, setRows] = useState<T[] | null>(null);
  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  });

  const reload = useCallback(() => {
    loadRef.current()
      .then(setRows)
      .catch(() => setRows((prev) => prev ?? []));
  }, []);

  useEffect(() => {
    if (!enabled) return;
    reload();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const channel = supabase
      .channel(`${table}:${conversationId}:${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: `conversation_id=eq.${conversationId}` },
        () => {
          if (timer) clearTimeout(timer);
          timer = setTimeout(reload, 150);
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") reload();
      });
    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [supabase, table, conversationId, enabled, reload]);

  return { rows, reload };
}
