"use client";

import { Check, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/components/app-provider";
import { PlusDialog } from "@/components/plus/plus-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/format";
import { PLUS_NAME, startSubscribe } from "@/lib/plus";
import type { SubscriptionState } from "@/types/app";

const SOURCE_LABEL: Record<string, string> = {
  stripe: "the website",
  apple: "the App Store",
  google: "Google Play",
  admin: "the administrator",
};

/** Settings card: your Ghostline Plus status, and a Subscribe / Manage button. */
export function PlusCard() {
  const { supabase, access } = useApp();
  const [sub, setSub] = useState<SubscriptionState | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    const fallback: SubscriptionState = {
      is_plus: access.is_plus,
      status: "inactive",
      current_period_end: null,
      cancel_at_period_end: false,
      source: null,
    };
    void (async () => {
      try {
        const { data } = await supabase.rpc("my_subscription").single<SubscriptionState>();
        setSub(data ?? fallback);
      } catch {
        setSub(fallback);
      }
    })();
  }, [supabase, access.is_plus]);

  useEffect(() => {
    load();
  }, [load]);

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
        {sub === null ? (
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
