"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { isAccessRevokedError, toUserMessage } from "@/lib/errors";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { Access, AppSettings } from "@/types/app";

interface AppContextValue {
  access: Access;
  settings: AppSettings | null;
  supabase: SupabaseClient;
  /** Shows a toast, or routes to the unauthorized screen if access was revoked. */
  reportError: (error: unknown, fallback?: string) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({
  access,
  settings,
  children,
}: {
  access: Access;
  settings: AppSettings | null;
  children: React.ReactNode;
}) {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      // Full reload on purpose: drops all in-memory chat state and realtime sockets.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      if (event === "SIGNED_OUT") window.location.assign("/login");
    });
    return () => data.subscription.unsubscribe();
  }, [supabase]);

  const reportError = useCallback((error: unknown, fallback?: string) => {
    if (isAccessRevokedError(error)) {
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full reload drops cached data
      window.location.assign("/unauthorized");
      return;
    }
    toast.error(toUserMessage(error, fallback));
  }, []);

  const value = useMemo(
    () => ({ access, settings, supabase, reportError }),
    [access, settings, supabase, reportError],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside <AppProvider>");
  return ctx;
}
