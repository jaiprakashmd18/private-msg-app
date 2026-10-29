"use client";

import { useEffect } from "react";
import type { BeforeInstallPromptEvent } from "@/lib/pwa-client";

export const INSTALL_PROMPT_EVENT = "app:install-prompt";

/** Registers the service worker and keeps the browser's install prompt for later. */
export function ServiceWorker() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      window.__installPrompt = e as BeforeInstallPromptEvent;
      window.dispatchEvent(new Event(INSTALL_PROMPT_EVENT));
    };
    const onInstalled = () => {
      window.__installPrompt = null;
      window.dispatchEvent(new Event(INSTALL_PROMPT_EVENT));
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  return null;
}
