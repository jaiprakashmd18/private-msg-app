"use client";

import { Check, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/components/app-provider";
import { PlusDialog } from "@/components/plus/plus-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { formatDateTime } from "@/lib/format";
import { PLUS_NAME, startSubscribe } from "@/lib/plus";
import type { SubscriptionState } from "@/types/app";

const SOURCE_LABEL: Record<string, string> = {
  stripe: "the website",
  apple: "the App Store",
  google: "Google Play",
  admin: "the administrator",
};

/** Settings card: your Loveline Plus status, and a Subscribe / Manage button. */
export function PlusCard() {
  const { supabase, access } = useApp();
  const router = useRouter();
  const [sub, setSub] = useState<SubscriptionState | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // True while finishing a just-completed checkout (confirming the payment).
  const [activating, setActivating] = useState(false);
  // The return-from-checkout handler must run exactly once, even though it
  // reads and then clears the URL (React would otherwise re-run it after the
  // URL is already clean, or in StrictMode double-invoke the first run).
  const returnHandled = useRef(false);

  const fetchSub = useCallback(async (): Promise<SubscriptionState | null> => {
    try {
      const { data } = await supabase.rpc("my_subscription").single<SubscriptionState>();
      return data ?? null;
    } catch {
      return null;
    }
  }, [supabase]);

  const load = useCallback(() => {
    const fallback: SubscriptionState = {
      is_plus: access.is_plus,
      status: "inactive",
      current_period_end: null,
      cancel_at_period_end: false,
      source: null,
    };
    void (async () => setSub((await fetchSub()) ?? fallback))();
  }, [fetchSub, access.is_plus]);

  useEffect(() => {
    load();
  }, [load]);

  // Coming back from Stripe Checkout (?plus=success|cancel). Confirm the payment
  // and unlock right away, so the person doesn't have to reload and wait for
  // the webhook. The couple pack unlocks everywhere once router.refresh() picks
  // up the new is_plus from the server.
  useEffect(() => {
    if (typeof window === "undefined" || returnHandled.current) return;
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("plus");
    if (!outcome) return;
    // From here this runs exactly once; clearing the URL must not let it re-run.
    returnHandled.current = true;
    const sessionId = params.get("session_id");
    // Clean the address bar through the Next router (so a later router.refresh()
    // keeps it clean), dropping the session id from the URL/history.
    router.replace(window.location.pathname, { scroll: false });

    if (outcome !== "success") {
      if (outcome === "cancel") toast("Checkout canceled — no charge was made.");
      return;
    }

    const finishUnlock = (s?: SubscriptionState) => {
      setActivating(false);
      if (s) setSub(s);
      else load();
      toast.success("You’re a Plus member — enjoy! 🎉");
      router.refresh();
    };

    void (async () => {
      setActivating(true);
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      // Fast path: ask the server to confirm this exact paid session.
      if (sessionId) {
        try {
          const res = await fetch("/api/billing/confirm", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sessionId }),
          });
          const json = (await res.json()) as { is_plus?: boolean };
          if (json.is_plus) {
            finishUnlock();
            return;
          }
        } catch {
          /* fall through to polling the webhook result */
        }
      }
      // Fallback: the webhook may still be in flight — poll a little.
      for (let i = 0; i < 12; i++) {
        await wait(2500);
        const s = await fetchSub();
        if (s?.is_plus) {
          finishUnlock(s);
          return;
        }
      }
      setActivating(false);
      load();
      toast("Payment received. It can take a moment to unlock — reload the page if Plus doesn’t appear.");
    })();
    // Run once on mount; the URL is read directly from window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function subscribe() {
    setBusy(true);
    const result = await startSubscribe();
    setBusy(false);
    if (!result.ok) toast(result.message);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-5 text-primary" aria-hidden /> {PLUS_NAME}
        </CardTitle>
        <CardDescription>Unlocks the couple pack: journal, bucket list, date planner, special dates and love notes.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        {activating ? (
          <p className="flex items-center gap-2 font-medium text-primary">
            <Spinner /> Finishing your subscription…
          </p>
        ) : sub === null ? (
          <Skeleton className="h-10 w-full" />
        ) : sub.is_plus ? (
          <>
            <p className="flex items-center gap-2 font-medium text-success">
              <Check className="size-4" /> You&apos;re a Plus member
              {sub.source ? ` (via ${SOURCE_LABEL[sub.source] ?? sub.source})` : ""}.
            </p>
            <p className="text-muted-foreground">
              {sub.cancel_at_period_end && sub.current_period_end
                ? `Ends on ${formatDateTime(sub.current_period_end)}.`
                : sub.current_period_end
                  ? `Renews on ${formatDateTime(sub.current_period_end)}.`
                  : "No end date."}
            </p>
            <p className="text-xs text-muted-foreground">
              To change or cancel, use the store you subscribed through (App Store / Google Play), the Stripe email receipt,
              or ask the administrator.
            </p>
          </>
        ) : (
          <>
            <p className="text-muted-foreground">You&apos;re on the free plan. Subscribe to unlock the couple pack for both of you.</p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setOpen(true)}>
                <Sparkles /> See what&apos;s included
              </Button>
              <Button variant="outline" onClick={() => void subscribe()} disabled={busy}>
                Subscribe
              </Button>
            </div>
          </>
        )}
      </CardContent>
      <PlusDialog open={open} onOpenChange={setOpen} />
    </Card>
  );
}
