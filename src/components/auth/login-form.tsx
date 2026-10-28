"use client";

import { ArrowLeft } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { otpRequestSchema } from "@/lib/validation";

type Step = "phone" | "code";

interface ApiResult {
  ok: boolean;
  message?: string;
  redirectTo?: string;
  error?: { message: string; code: string };
}

async function post(url: string, body: unknown): Promise<ApiResult> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return (await res.json()) as ApiResult;
  } catch {
    return { ok: false, error: { message: "Network error — check your connection.", code: "network" } };
  }
}

const RESEND_SECONDS = 60;

export function LoginForm() {
  const [step, setStep] = useState<Step>("phone");
  const [phoneInput, setPhoneInput] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    if (step === "code") codeRef.current?.focus();
  }, [step]);

  async function requestCode(target: string) {
    setBusy(true);
    setError(null);
    const result = await post("/api/auth/otp", { phone: target });
    setBusy(false);
    if (!result.ok) {
      setError(result.error?.message ?? "Could not send a code.");
      return false;
    }
    setNotice(result.message ?? null);
    setCooldown(RESEND_SECONDS);
    return true;
  }

  async function onSubmitPhone(e: React.FormEvent) {
    e.preventDefault();
    const parsed = otpRequestSchema.safeParse({ phone: phoneInput });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid phone number");
      return;
    }
    if (await requestCode(parsed.data.phone)) {
      setPhone(parsed.data.phone);
      setCode("");
      setStep("code");
    }
  }

  async function onSubmitCode(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code)) {
      setError("Enter the 6-digit code.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await post("/api/auth/verify", { phone, token: code });
    if (!result.ok) {
      setBusy(false);
      setError(result.error?.message ?? "Verification failed.");
      setCode("");
      codeRef.current?.focus();
      return;
    }
    // Full navigation so the new session cookies are used everywhere.
    window.location.assign(result.redirectTo ?? "/chat");
  }

  return (
    <div className="rounded-2xl border bg-card/80 p-6 shadow-xl backdrop-blur">
      {step === "phone" ? (
        <form onSubmit={onSubmitPhone} noValidate className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="phone">Phone number</Label>
            <Input
              id="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+1 415 555 0123"
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
              aria-invalid={Boolean(error)}
              aria-describedby="phone-help phone-error"
              required
              autoFocus
            />
            <p id="phone-help" className="text-xs text-muted-foreground">
              Include your country code. We&apos;ll text you a one-time code.
            </p>
          </div>
          {error && (
            <p id="phone-error" role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" disabled={busy || !phoneInput.trim()}>
            {busy ? <Spinner label="Sending code" /> : "Send code"}
          </Button>
        </form>
      ) : (
        <form onSubmit={onSubmitCode} noValidate className="grid gap-4">
          <button
            type="button"
            onClick={() => {
              setStep("phone");
              setError(null);
            }}
            className="-ml-1 inline-flex w-fit items-center gap-1 rounded-md px-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden /> Change number
          </button>
          <div className="grid gap-2">
            <Label htmlFor="code">Verification code</Label>
            <Input
              ref={codeRef}
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              placeholder="••••••"
              className="text-center font-mono text-2xl tracking-[0.5em]"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              aria-invalid={Boolean(error)}
              aria-describedby="code-help code-error"
              required
            />
            <p id="code-help" className="text-xs text-muted-foreground" aria-live="polite">
              {notice ?? "Enter the code we sent."} Sent to <span className="font-medium text-foreground">{phone}</span>.
              If nothing arrives, check the number or ask the administrator to approve it.
            </p>
          </div>
          {error && (
            <p id="code-error" role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" disabled={busy || code.length !== 6}>
            {busy ? <Spinner label="Verifying" /> : "Verify and continue"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={busy || cooldown > 0}
            onClick={() => void requestCode(phone)}
          >
            {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
          </Button>
        </form>
      )}
    </div>
  );
}
