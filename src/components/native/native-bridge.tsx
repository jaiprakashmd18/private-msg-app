"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";
import {
  enableNativePush,
  isNativeApp,
  nativePlatform,
  nativePushAvailable,
  nativePushEnabled,
  nativePushPermission,
  openExternal,
  pathForAppUrl,
  refreshNativePush,
} from "@/lib/native";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/** Pages where Android's back button leaves the app instead of going back. */
const ROOT_PATHS = new Set(["/", "/chat", "/login", "/unauthorized", "/set-password"]);

const ASKED_KEY = "native-push-offered";

/** Shows a one-time "Turn on notifications" message when someone first opens their chats in the app. */
async function offerNotificationsOnce(showPreview: boolean) {
  try {
    if (!window.location.pathname.startsWith("/chat")) return;
    if (localStorage.getItem(ASKED_KEY)) return;
    if (!(await nativePushAvailable()) || (await nativePushEnabled())) return;
    if ((await nativePushPermission()) === "denied") return;
    localStorage.setItem(ASKED_KEY, "1");
  } catch {
    return;
  }
  toast("Get notified about new messages?", {
    description: "You can change this any time in Settings.",
    duration: 15_000,
    action: {
      label: "Turn on",
      onClick: () => {
        void enableNativePush(getSupabaseBrowserClient(), showPreview)
          .then(() => toast.success("Notifications are on"))
          .catch((err: unknown) => toast.error(err instanceof Error ? err.message : "Couldn't turn on notifications."));
      },
    },
  });
}

/** Closes the top-most dialog, menu, sheet or photo viewer, like pressing Esc. Returns false if none is open. */
function closeTopLayer(): boolean {
  const open = document.querySelector(
    '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"], [role="listbox"][data-state="open"]',
  );
  if (!open) return false;
  const target = document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true, cancelable: true }));
  return true;
}

/**
 * Native glue for the Loveline Android / iOS app. Renders nothing and does
 * nothing in a normal browser.
 *
 * - Android back button: closes dialogs/menus, goes back, or leaves the app
 *   from the chat list.
 * - App links: Google sign-in returning to the app, notification taps and
 *   links to the website open the right page.
 * - Links to other websites open in the system browser.
 * - Status bar text follows the light/dark theme.
 */
export function NativeBridge() {
  const router = useRouter();

  useEffect(() => {
    if (!isNativeApp()) return;
    document.documentElement.dataset.native = nativePlatform();
    const cleanups: Array<() => void> = [];
    let cancelled = false;
    // Listeners are added asynchronously; if the effect was already cleaned up, remove them straight away.
    const keep = (fn: () => void) => (cancelled ? fn() : cleanups.push(fn));

    const go = (path: string) => {
      // Sign-in must hit the server route (it sets the session cookies).
      if (path.startsWith("/auth/")) window.location.assign(path);
      else router.push(path);
    };

    void (async () => {
      const [{ App }, { Browser }, { SystemBars, SystemBarsStyle }] = await Promise.all([
        import("@capacitor/app"),
        import("@capacitor/browser"),
        import("@capacitor/core"),
      ]);
      if (cancelled) return;

      // --- Status bar follows the theme ---------------------------------------
      const syncBars = () => {
        const dark = document.documentElement.classList.contains("dark");
        void SystemBars.setStyle({ style: dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(() => undefined);
      };
      syncBars();
      const observer = new MutationObserver(syncBars);
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
      keep(() => observer.disconnect());

      // --- Links into the app (sign-in return, deep links) --------------------
      const urlOpen = await App.addListener("appUrlOpen", ({ url }) => {
        const path = pathForAppUrl(url, window.location.origin);
        if (!path) return;
        if (path.startsWith("/auth/callback")) void Browser.close().catch(() => undefined);
        go(path);
      });
      keep(() => void urlOpen.remove());

      // --- Android back button --------------------------------------------------
      const back = await App.addListener("backButton", ({ canGoBack }) => {
        if (closeTopLayer()) return;
        const path = window.location.pathname;
        if (ROOT_PATHS.has(path)) {
          void App.minimizeApp();
        } else if (canGoBack) {
          window.history.back();
        } else {
          router.replace("/chat");
        }
      });
      keep(() => void back.remove());

      // --- Notification taps ------------------------------------------------------
      try {
        const { PushNotifications } = await import("@capacitor/push-notifications");
        const tap = await PushNotifications.addListener("pushNotificationActionPerformed", ({ notification }) => {
          const url = (notification.data as { url?: unknown } | undefined)?.url;
          if (typeof url === "string" && url.startsWith("/") && !url.startsWith("//")) go(url);
        });
        keep(() => void tap.remove());
      } catch {
        // Push plugin unavailable: nothing to listen for.
      }

      // Phones rotate notification tokens now and then: keep ours current.
      let showPreview = true;
      try {
        showPreview = localStorage.getItem("push-show-preview") !== "false";
      } catch {
        // Default: show previews.
      }
      void refreshNativePush(getSupabaseBrowserClient(), showPreview).catch(() => undefined);

      // First time in the chats: offer notifications once (the phone asks for permission).
      void offerNotificationsOnce(showPreview);
    })();

    // --- Links to other websites open in the system browser -----------------------
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      const anchor = (e.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") return; // mailto:, tel: → the phone handles them
      if (url.origin === window.location.origin) return;
      e.preventDefault();
      if (anchor.dataset.open === "system") {
        // Map links: let the phone hand them to Google Maps / Apple Maps.
        window.location.href = url.href;
        return;
      }
      void openExternal(url.href);
    };
    document.addEventListener("click", onClick, true);
    cleanups.push(() => document.removeEventListener("click", onClick, true));

    return () => {
      cancelled = true;
      cleanups.forEach((fn) => fn());
    };
  }, [router]);

  return null;
}
