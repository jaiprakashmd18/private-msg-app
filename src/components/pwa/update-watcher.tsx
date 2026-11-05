"use client";

import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { BUILD_ID, storeUpdateNeeded, type VersionInfo, websiteUpdateAction } from "@/lib/app-version";
import { isNativeApp, nativePlatform } from "@/lib/native";

const CHECK_EVERY_MS = 5 * 60_000;
const TOAST_ID = "app-update";

/** Someone is typing, or has a dialog/menu open: don't reload under them. */
function isBusy(): boolean {
  const active = document.activeElement;
  if (
    (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) &&
    active.value.trim() !== "" &&
    active.type !== "checkbox"
  ) {
    return true;
  }
  if ([...document.querySelectorAll("textarea")].some((t) => t.value.trim() !== "")) return true;
  return Boolean(document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]'));
}

async function fetchVersion(): Promise<VersionInfo | null> {
  try {
    const res = await fetch("/api/version", { cache: "no-store", credentials: "same-origin" });
    if (!res.ok) return null;
    return (await res.json()) as VersionInfo;
  } catch {
    return null;
  }
}

/** The installed app's own build number (versionCode / CFBundleVersion). */
async function nativeBuild(): Promise<number> {
  try {
    const { App } = await import("@capacitor/app");
    return Number.parseInt((await App.getInfo()).build, 10);
  } catch {
    return 0;
  }
}

function openStore(url: string) {
  // In the app, the phone hands store links to Google Play / the App Store.
  if (isNativeApp()) window.location.href = url;
  else window.open(url, "_blank", "noopener,noreferrer");
}

/**
 * Keeps every open tab and app on the latest version:
 * - a new website build → reloads by itself when you come back to the app
 *   (or offers "Update" if you're in the middle of something);
 * - an Android / iOS app that is too old → asks to update from the store.
 */
export function UpdateWatcher() {
  const [storeRequired, setStoreRequired] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let pendingBuild: string | null = null;
    let storeChecked = false;

    const offerUpdate = () => {
      toast("A new version of Loveline is ready", {
        id: TOAST_ID,
        duration: Infinity,
        action: { label: "Update", onClick: () => window.location.reload() },
      });
    };

    const check = async (returningToApp: boolean) => {
      // New service worker (offline page, notifications) too.
      void navigator.serviceWorker?.getRegistration().then((r) => r?.update()).catch(() => undefined);
      const info = await fetchVersion();
      if (cancelled || !info) return;

      const action = websiteUpdateAction({
        serverBuild: info.build,
        clientBuild: BUILD_ID,
        returningToApp,
        busy: isBusy(),
      });
      if (action === "reload") {
        window.location.reload();
        return;
      }
      if (action === "prompt" && pendingBuild !== info.build) {
        pendingBuild = info.build;
        offerUpdate();
      }

      if (!isNativeApp() || storeChecked) return;
      storeChecked = true;
      const platform = nativePlatform();
      if (platform === "web") return;
      const store = info[platform];
      const need = storeUpdateNeeded(await nativeBuild(), store);
      if (cancelled) return;
      if (need === "required") {
        setStoreRequired(store.url);
      } else if (need === "available") {
        const key = `store-update-offered:${store.latest}`;
        let offered = false;
        try {
          offered = Boolean(localStorage.getItem(key));
          localStorage.setItem(key, "1");
        } catch {
          // Show it this time anyway.
        }
        if (!offered) {
          toast("A new version of the app is available", {
            description: platform === "ios" ? "Update it from the App Store." : "Update it from Google Play.",
            duration: 15_000,
            action: { label: "Update", onClick: () => openStore(store.url) },
          });
        }
      }
    };

    let hiddenSince = document.visibilityState === "hidden" ? Date.now() : 0;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenSince = Date.now();
        return;
      }
      const wasAway = hiddenSince > 0;
      hiddenSince = 0;
      void check(wasAway);
    };
    const onOnline = () => void check(false);

    void check(false);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void check(false);
    }, CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
    };
  }, []);

  if (!storeRequired) return null;
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="store-update-title"
      className="fixed inset-screen z-[80] flex flex-col items-center justify-center gap-5 bg-background px-8 text-center"
    >
      <div className="grid size-16 place-items-center rounded-[18px] bg-primary text-primary-foreground">
        <Download className="size-8" aria-hidden />
      </div>
      <div>
        <h1 id="store-update-title" className="text-2xl font-bold">
          Update Loveline
        </h1>
        <p className="mt-2 text-muted-foreground">
          This version of the app is out of date. Install the update to keep chatting — your messages are safe.
        </p>
      </div>
      <Button size="lg" onClick={() => openStore(storeRequired)}>
        <Download /> {nativePlatform() === "ios" ? "Open the App Store" : "Open Google Play"}
      </Button>
    </div>
  );
}
