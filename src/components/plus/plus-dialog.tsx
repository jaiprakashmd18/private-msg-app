"use client";

import { Check, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/components/app-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { PLUS_FEATURES, PLUS_NAME, PLUS_PRICE, startSubscribe } from "@/lib/plus";

/**
 * The paywall. Shows what Loveline Plus unlocks and a Subscribe button.
 * Opened whenever someone without Plus taps a couple-pack feature.
 */
export function PlusDialog({
  open,
  onOpenChange,
  feature,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The feature they tapped, named in the subtitle. */
  feature?: string;
}) {
  const { access } = useApp();
  const [busy, setBusy] = useState(false);

  async function subscribe() {
    setBusy(true);
    const result = await startSubscribe();
    setBusy(false);
    if (!result.ok) toast(result.message);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col gap-4">
        <DialogHeader className="items-center text-center">
          <span className="mx-auto grid size-14 place-items-center rounded-[18px] bg-gradient-to-br from-rose-500 via-primary to-indigo-500 text-white shadow-lg">
            <Sparkles className="size-7" aria-hidden />
          </span>
          <DialogTitle className="text-2xl">{PLUS_NAME}</DialogTitle>
          <DialogDescription>
            {feature ? `${feature} is part of ${PLUS_NAME}.` : "Unlock the couple pack."} One subscription covers both of you.
          </DialogDescription>
        </DialogHeader>

        <ul className="grid gap-3">
          {PLUS_FEATURES.map((f) => (
            <li key={f.title} className="flex items-start gap-3">
              <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-primary/10 text-base" aria-hidden>
                {f.emoji}
              </span>
              <span className="min-w-0">
                <span className="block text-[15px] font-semibold">{f.title}</span>
                <span className="block text-sm text-muted-foreground">{f.detail}</span>
              </span>
            </li>
          ))}
        </ul>

        {access.is_plus ? (
          <p className="flex items-center justify-center gap-2 rounded-2xl bg-success/10 py-3 text-sm font-medium text-success">
            <Check className="size-4" /> You’re a Plus member — enjoy!
          </p>
        ) : (
          <div className="grid gap-2">
            <Button size="lg" onClick={() => void subscribe()} disabled={busy}>
              {busy ? <Spinner /> : <Sparkles />} Subscribe · {PLUS_PRICE}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Cancel anytime. If one of you subscribes, you both get the couple pack.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
