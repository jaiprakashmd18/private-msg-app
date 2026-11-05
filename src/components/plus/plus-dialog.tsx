"use client";

import { Check, CreditCard, Smartphone, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/components/app-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { isNativeApp } from "@/lib/native";
import { PLUS_FEATURES, PLUS_NAME, PLUS_PRICE, STRIPE_ENABLED, startSubscribe } from "@/lib/plus";
import { payWithRazorpay, RAZORPAY_ENABLED } from "@/lib/razorpay";

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
  const router = useRouter();
  const [busy, setBusy] = useState<"rz" | "stripe" | null>(null);
  const native = isNativeApp();
  const canPayHere = !native;

  async function payRazorpay() {
    setBusy("rz");
    const result = await payWithRazorpay();
    setBusy(null);
    if (result.ok) {
      toast.success("You’re a Plus member — enjoy! 🎉");
      onOpenChange(false);
      router.refresh();
    } else if (result.message) {
      toast(result.message);
    }
  }

  async function subscribe() {
    setBusy("stripe");
    const result = await startSubscribe();
    setBusy(null);
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
            {feature ? `${feature} is part of ${PLUS_NAME}.` : "Unlock the couple pack."} One payment covers both of you.
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
            {canPayHere && RAZORPAY_ENABLED && (
              <Button size="lg" onClick={() => void payRazorpay()} disabled={busy !== null}>
                {busy === "rz" ? <Spinner /> : <Smartphone />} Pay with UPI / Google Pay · {PLUS_PRICE}
              </Button>
            )}
            {canPayHere && STRIPE_ENABLED && (
              <Button
                size="lg"
                variant={RAZORPAY_ENABLED ? "outline" : "default"}
                onClick={() => void subscribe()}
                disabled={busy !== null}
              >
                {busy === "stripe" ? <Spinner /> : <CreditCard />} Pay by card · {PLUS_PRICE}
              </Button>
            )}
            {(!canPayHere || (!RAZORPAY_ENABLED && !STRIPE_ENABLED)) && (
              <p className="rounded-2xl bg-muted/60 p-3 text-center text-sm text-muted-foreground">
                {native
                  ? "Open Loveline in your web browser to unlock Plus, or ask the administrator to turn it on for you."
                  : "Payments aren’t set up yet. Ask the administrator to unlock Plus for you."}
              </p>
            )}
            <p className="text-center text-xs text-muted-foreground">
              One payment unlocks the couple pack for both of you — forever.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
