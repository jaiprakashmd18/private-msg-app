"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/components/app-provider";

/** Number of pending access requests (admins only; 0 for everyone else). */
export function usePendingRequests(refreshKey?: string): number {
  const { supabase, access } = useApp();
  const [count, setCount] = useState(0);
  const isAdmin = access.role === "admin";

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    const load = () =>
      supabase
        .rpc("admin_pending_request_count")
        .then(({ data }) => !cancelled && setCount(typeof data === "number" ? data : 0));
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [supabase, isAdmin, refreshKey]);

  return isAdmin ? count : 0;
}
