"use client";

import { Delete, Fingerprint, Lock } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/components/app-provider";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import {
  clearLock,
  type LockConfig,
  readFailures,
  recordFailure,
  resetFailures,
  verifyBiometrics,
  verifyPin,
} from "@/lib/app-lock";
import { signOut } from "@/lib/auth-client";
import { APP_NAME } from "@/lib/env";
import { cn } from "@/lib/utils";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

export function LockScreen({ config, onUnlock }: { config: LockConfig | null; onUnlock: () => void }) {
  const { access } = useApp();
  const [pin, setPin] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [waitUntil, setWaitUntil] = useState(() => readFailures(access.user_id).until);
  const [now, setNow] = useState(() => Date.now());
  const waiting = waitUntil > now;

  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [waiting]);

  const submit = useCallback(
    async (candidate: string) => {
      if (!config) return;
      setChecking(true);
      const ok = await verifyPin(config, candidate);
      setChecking(false);
      if (ok) {
        resetFailures(access.user_id);
        onUnlock();
        return;
      }
      const fails = recordFailure(access.user_id);
      setWaitUntil(fails.until);
      setNow(Date.now());
      setPin("");
      setShake((s) => s + 1);
      setError(fails.count >= 5 ? "Too many wrong PINs." : "Wrong PIN, try again.");
      navigator.vibrate?.(80);
    },
    [config, access.user_id, onUnlock],
  );

  const press = useCallback(
    (digit: string) => {
      if (!config || checking || waiting || pin.length >= config.pinLength) return;
      setError(null);
      const next = pin + digit;
      setPin(next);
      if (next.length === config.pinLength) void submit(next);
    },
    [config, checking, waiting, pin, submit],
  );

  const biometric = useCallback(async () => {
    if (!config?.credentialId) return;
    if (await verifyBiometrics(config.credentialId)) {
      resetFailures(access.user_id);
      onUnlock();
    } else {
      setError("Couldn't verify — enter your PIN instead.");
    }
  }, [config, access.user_id, onUnlock]);

  // Typing on a keyboard works too.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") setPin((p) => p.slice(0, -1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [press]);

  if (!config) {
    return (
      <div className="grid min-h-dvh place-items-center bg-background">
        <Spinner label="Loading" />
      </div>
    );
  }

  const seconds = Math.ceil((waitUntil - now) / 1000);

  return (
    <main
      id="main"
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-8 bg-background px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))]"
    >
      <div className="text-center">
        <div className="mx-auto mb-4 grid size-14 place-items-center rounded-2xl bg-primary/15 text-primary">
          <Lock className="size-6" aria-hidden />
        </div>
        <h1 className="text-xl font-semibold">{APP_NAME} is locked</h1>
        <p className="mt-1 text-sm text-muted-foreground" aria-live="polite">
          {waiting ? `Too many wrong PINs. Try again in ${seconds} s.` : (error ?? "Enter your PIN")}
        </p>
      </div>

      <div key={shake} className={cn("flex gap-4", shake > 0 && "animate-[shake_0.35s_ease-in-out]")} aria-hidden>
        {Array.from({ length: config.pinLength }).map((_, i) => (
          <span
            key={i}
            className={cn("size-3.5 rounded-full border-2 border-foreground/60", i < pin.length && "border-primary bg-primary")}
          />
        ))}
      </div>
      <span className="sr-only" aria-live="polite">
        {pin.length} of {config.pinLength} digits entered
      </span>

      <div className="grid w-full max-w-[17rem] grid-cols-3 gap-4" role="group" aria-label="PIN keypad">
        {KEYS.map((k) => (
          <KeypadButton key={k} label={k} onPress={() => press(k)} disabled={checking || waiting} />
        ))}
        {config.credentialId ? (
          <button
            type="button"
            onClick={() => void biometric()}
            disabled={waiting}
            aria-label="Unlock with Face ID or fingerprint"
            className="grid aspect-square place-items-center rounded-full text-primary transition-colors hover:bg-accent disabled:opacity-40"
          >
            <Fingerprint className="size-8" />
          </button>
        ) : (
          <span />
        )}
        <KeypadButton label="0" onPress={() => press("0")} disabled={checking || waiting} />
        <button
          type="button"
          onClick={() => setPin((p) => p.slice(0, -1))}
          aria-label="Delete last digit"
          className="grid aspect-square place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent"
        >
          <Delete className="size-6" />
        </button>
      </div>

      <Button
        variant="link"
        size="sm"
        className="text-muted-foreground"
        onClick={() => {
          // Signing in again proves who you are; the lock is reset on this device.
          clearLock(access.user_id);
          void signOut();
        }}
      >
        Forgot PIN? Sign out
      </Button>
    </main>
  );
}

function KeypadButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled: boolean }) {
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled}
      className="grid aspect-square place-items-center rounded-full bg-muted text-2xl font-medium tabular-nums transition-colors hover:bg-accent active:bg-primary/25 disabled:opacity-40"
    >
      {label}
    </button>
  );
}
