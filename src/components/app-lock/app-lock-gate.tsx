"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useApp } from "@/components/app-provider";
import { LockScreen } from "@/components/app-lock/lock-screen";
import { loadLock, type LockConfig } from "@/lib/app-lock";

interface AppLockContextValue {
  config: LockConfig | null;
  lockNow: () => void;
  /** Stay unlocked (e.g. right after turning the lock on in Settings). */
  stayUnlocked: () => void;
}

const AppLockContext = createContext<AppLockContextValue>({
  config: null,
  lockNow: () => undefined,
  stayUnlocked: () => undefined,
});
export const useAppLock = () => useContext(AppLockContext);

/**
 * Hides the whole app behind the lock screen when app lock is on for this
 * user on this device: on start, and after the app was in the background for
 * the chosen time. While locked the app isn't rendered at all (no messages in
 * the page). `initiallyLocked` comes from a cookie, so a locked app never
 * flashes its content while loading.
 */
function subscribe(onChange: () => void) {
  window.addEventListener("app-lock-changed", onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener("app-lock-changed", onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function AppLockGate({ initiallyLocked, children }: { initiallyLocked: boolean; children: React.ReactNode }) {
  const { access } = useApp();
  // This user's settings on this device; undefined while rendering on the server.
  const raw = useSyncExternalStore(
    subscribe,
    () => JSON.stringify(loadLock(access.user_id)),
    () => undefined,
  );
  const config = useMemo(() => (raw ? (JSON.parse(raw) as LockConfig | null) : null), [raw]);
  // null = not decided yet: a device with app lock starts locked.
  const [locked, setLocked] = useState<boolean | null>(initiallyLocked ? true : null);
  const isLocked = raw === undefined ? initiallyLocked : config ? (locked ?? true) : false;
  const hiddenAt = useRef<number | null>(null);

  useEffect(() => {
    if (!config) return;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt.current = Date.now();
        if (config.timeoutMs === 0) setLocked(true);
      } else if (hiddenAt.current !== null && Date.now() - hiddenAt.current >= config.timeoutMs) {
        setLocked(true);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [config]);

  const lockNow = useCallback(() => {
    if (config) setLocked(true);
  }, [config]);

  const stayUnlocked = useCallback(() => setLocked(false), []);

  return (
    <AppLockContext.Provider value={{ config, lockNow, stayUnlocked }}>
      {isLocked ? <LockScreen config={config} onUnlock={() => setLocked(false)} /> : children}
    </AppLockContext.Provider>
  );
}
