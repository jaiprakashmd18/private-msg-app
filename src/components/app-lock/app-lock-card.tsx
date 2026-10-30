"use client";

import { Fingerprint, Lock, LockOpen } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAppLock } from "@/components/app-lock/app-lock-gate";
import { useApp } from "@/components/app-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  biometricsAvailable,
  clearLock,
  createLockConfig,
  isValidPin,
  LOCK_TIMEOUTS,
  registerBiometrics,
  saveLock,
  verifyPin,
} from "@/lib/app-lock";
import { APP_NAME } from "@/lib/env";

type Mode = "idle" | "setup" | "change" | "off";

function PinField({ id, label, value, onChange, autoFocus }: { id: string; label: string; value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="password"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        maxLength={6}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
        className="max-w-40 tracking-[0.4em]"
      />
    </div>
  );
}

/** Settings → App lock (this device only). */
export function AppLockCard() {
  const { access } = useApp();
  const { config, lockNow, stayUnlocked } = useAppLock();
  const [mode, setMode] = useState<Mode>("idle");
  const [current, setCurrent] = useState("");
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canBiometric, setCanBiometric] = useState(false);

  useEffect(() => {
    void biometricsAvailable().then(setCanBiometric);
  }, []);

  function reset(next: Mode = "idle") {
    setMode(next);
    setCurrent("");
    setPin("");
    setConfirm("");
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode !== "setup" && config && !(await verifyPin(config, current))) {
      setError("That's not your current PIN.");
      return;
    }
    if (mode === "off") {
      clearLock(access.user_id);
      toast.success("App lock turned off on this device");
      reset();
      return;
    }
    if (!isValidPin(pin)) return setError("Use 4 to 6 digits.");
    if (pin !== confirm) return setError("The two PINs don't match.");
    setBusy(true);
    try {
      const next = await createLockConfig(pin, config?.timeoutMs ?? 60_000);
      stayUnlocked();
      saveLock(access.user_id, { ...next, credentialId: config?.credentialId });
      toast.success(mode === "setup" ? "App lock is on" : "PIN changed");
      reset();
    } finally {
      setBusy(false);
    }
  }

  async function toggleBiometric(on: boolean) {
    if (!config) return;
    if (!on) {
      saveLock(access.user_id, { ...config, credentialId: undefined });
      return;
    }
    try {
      const credentialId = await registerBiometrics({ email: access.email, name: access.display_name }, APP_NAME);
      saveLock(access.user_id, { ...config, credentialId });
      toast.success("Face ID / fingerprint unlock is on");
    } catch {
      toast.error("Face ID / fingerprint wasn't set up.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lock className="size-4" aria-hidden /> App lock
        </CardTitle>
        <CardDescription>
          Ask for a PIN{canBiometric ? " or Face ID / fingerprint" : ""} when the app opens, so nobody who picks up this
          device can read your chats. This device only.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {mode !== "idle" ? (
          <form onSubmit={submit} className="grid gap-4" noValidate>
            {mode !== "setup" && <PinField id="lock-current" label="Current PIN" value={current} onChange={setCurrent} autoFocus />}
            {mode !== "off" && (
              <>
                <PinField id="lock-new" label="New PIN (4–6 digits)" value={pin} onChange={setPin} autoFocus={mode === "setup"} />
                <PinField id="lock-confirm" label="Repeat PIN" value={confirm} onChange={setConfirm} />
              </>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant={mode === "off" ? "destructive" : "default"} disabled={busy}>
                {busy && <Spinner />} {mode === "setup" ? "Turn on" : mode === "change" ? "Change PIN" : "Turn off"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => reset()}>
                Cancel
              </Button>
            </div>
          </form>
        ) : config ? (
          <>
            <div className="grid gap-2">
              <Label htmlFor="lock-timeout">When to lock</Label>
              <select
                id="lock-timeout"
                value={config.timeoutMs}
                onChange={(e) => saveLock(access.user_id, { ...config, timeoutMs: Number(e.target.value) })}
                className="h-10 max-w-60 rounded-lg border border-input bg-background/40 px-3 text-base pointer-fine:text-sm"
              >
                {LOCK_TIMEOUTS.map((t) => (
                  <option key={t.ms} value={t.ms}>
                    {t.label} {t.ms === 0 ? "when I leave the app" : "away from the app"}
                  </option>
                ))}
              </select>
            </div>
            {canBiometric && (
              <label className="flex items-center justify-between gap-4 text-sm">
                <span className="flex items-center gap-2">
                  <Fingerprint className="size-4" aria-hidden /> Unlock with Face ID / fingerprint
                </span>
                <Switch checked={Boolean(config.credentialId)} onCheckedChange={(v) => void toggleBiometric(v)} />
              </label>
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={lockNow}>
                <Lock /> Lock now
              </Button>
              <Button variant="outline" onClick={() => reset("change")}>
                Change PIN
              </Button>
              <Button variant="ghost" className="text-destructive" onClick={() => reset("off")}>
                <LockOpen /> Turn off
              </Button>
            </div>
          </>
        ) : (
          <div>
            <Button variant="outline" onClick={() => reset("setup")}>
              <Lock /> Turn on app lock
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
