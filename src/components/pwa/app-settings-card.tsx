"use client";

import { Bell, BellOff, CheckCircle2, Download, Share } from "lucide-react";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { useApp } from "@/components/app-provider";
import { INSTALL_PROMPT_EVENT } from "@/components/pwa/service-worker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  currentPushSubscription,
  disablePush,
  enablePush,
  isIos,
  isStandalone,
  pushSupported,
  updatePushPreview,
} from "@/lib/pwa-client";

const PREVIEW_KEY = "push-show-preview";

interface Env {
  standalone: boolean;
  ios: boolean;
  canPrompt: boolean;
  supported: boolean;
  permission: NotificationPermission | "unsupported";
}

let cachedEnv: Env | null = null;

function readEnv(): Env {
  const next: Env = {
    standalone: isStandalone(),
    ios: isIos(),
    canPrompt: Boolean(window.__installPrompt),
    supported: pushSupported(),
    permission: "Notification" in window ? Notification.permission : "unsupported",
  };
  // Stable object identity unless something changed (required by useSyncExternalStore).
  if (cachedEnv && JSON.stringify(cachedEnv) === JSON.stringify(next)) return cachedEnv;
  cachedEnv = next;
  return next;
}

function subscribeEnv(onChange: () => void) {
  window.addEventListener(INSTALL_PROMPT_EVENT, onChange);
  window.addEventListener("focus", onChange);
  const mq = window.matchMedia("(display-mode: standalone)");
  mq.addEventListener("change", onChange);
  return () => {
    window.removeEventListener(INSTALL_PROMPT_EVENT, onChange);
    window.removeEventListener("focus", onChange);
    mq.removeEventListener("change", onChange);
  };
}

function readPreviewPref(): boolean {
  try {
    return localStorage.getItem(PREVIEW_KEY) !== "false";
  } catch {
    return true;
  }
}

export function AppSettingsCard() {
  const { supabase, reportError } = useApp();
  const env = useSyncExternalStore(subscribeEnv, readEnv, () => null);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPreview, setShowPreview] = useState(true);

  const refresh = useCallback(() => {
    currentPushSubscription()
      .then((sub) => {
        setEnabled(Boolean(sub) && Notification.permission === "granted");
        setShowPreview(readPreviewPref());
      })
      .catch(() => setEnabled(false));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (!env) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>App &amp; notifications</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    );
  }

  async function install() {
    const prompt = window.__installPrompt;
    if (!prompt) return;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    window.__installPrompt = null;
    window.dispatchEvent(new Event(INSTALL_PROMPT_EVENT));
    if (outcome === "accepted") toast.success("Installing… look for the app icon on your device.");
  }

  async function toggleNotifications() {
    setBusy(true);
    try {
      if (enabled) {
        await disablePush(supabase);
        toast.success("Notifications turned off on this device");
      } else {
        await enablePush(supabase, showPreview);
        toast.success("Notifications are on for this device");
      }
    } catch (err) {
      reportError(err, err instanceof Error ? err.message : "Could not change notifications.");
    } finally {
      setBusy(false);
      refresh();
      window.dispatchEvent(new Event(INSTALL_PROMPT_EVENT));
    }
  }

  async function changePreview(value: boolean) {
    setShowPreview(value);
    try {
      localStorage.setItem(PREVIEW_KEY, String(value));
    } catch {
      // Preference still applies to this device's subscription below.
    }
    try {
      await updatePushPreview(supabase, value);
    } catch (err) {
      reportError(err, "Could not save the preview setting.");
    }
  }

  const needsInstallForPush = env.ios && !env.standalone;

  return (
    <Card>
      <CardHeader>
        <CardTitle>App &amp; notifications</CardTitle>
        <CardDescription>Install the app on this device and get notified about new messages.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-5 text-sm">
        <section aria-labelledby="install-heading" className="grid gap-2">
          <h3 id="install-heading" className="font-medium">
            Install app
          </h3>
          {env.standalone ? (
            <p className="flex items-center gap-2 text-success">
              <CheckCircle2 className="size-4" aria-hidden /> Installed — you&apos;re using the app.
            </p>
          ) : env.canPrompt ? (
            <div>
              <Button onClick={() => void install()}>
                <Download /> Install app
              </Button>
            </div>
          ) : env.ios ? (
            <p className="text-muted-foreground">
              In <strong className="text-foreground">Safari</strong>, tap the Share button{" "}
              <Share className="inline size-4 align-text-bottom" aria-label="Share" /> and choose{" "}
              <strong className="text-foreground">Add to Home Screen</strong>. Then open the app from its new icon.
            </p>
          ) : (
            <p className="text-muted-foreground">
              Open your browser menu (⋮) and choose <strong className="text-foreground">Install app</strong> or{" "}
              <strong className="text-foreground">Add to Home screen</strong>.
            </p>
          )}
        </section>

        <section aria-labelledby="notif-heading" className="grid gap-3">
          <h3 id="notif-heading" className="font-medium">
            Notifications on this device
          </h3>
          {needsInstallForPush ? (
            <p className="text-muted-foreground">
              On iPhone and iPad, notifications work only in the installed app. Add it to your Home Screen (above),
              open it from there, and come back to this page.
            </p>
          ) : !env.supported ? (
            <p className="text-muted-foreground">This browser doesn&apos;t support notifications.</p>
          ) : env.permission === "denied" ? (
            <p className="text-muted-foreground">
              Notifications are blocked for this app. Allow them in your browser or phone settings (site settings →
              Notifications), then reload this page.
            </p>
          ) : enabled === null ? (
            <Skeleton className="h-10 w-48" />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant={enabled ? "outline" : "default"} onClick={() => void toggleNotifications()} disabled={busy}>
                  {busy ? <Spinner /> : enabled ? <BellOff /> : <Bell />}
                  {enabled ? "Turn off notifications" : "Turn on notifications"}
                </Button>
                <span className="text-muted-foreground" aria-live="polite">
                  {enabled ? "On" : "Off"}
                </span>
              </div>
              {enabled && (
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor="show-preview" className="font-normal">
                    Show message text in notifications
                    <span className="block text-xs text-muted-foreground">
                      When off, notifications only say who wrote — handy if others can see your lock screen.
                    </span>
                  </Label>
                  <Switch id="show-preview" checked={showPreview} onCheckedChange={(v) => void changePreview(v)} />
                </div>
              )}
            </>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
