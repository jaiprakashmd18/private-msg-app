"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Spinner } from "@/components/ui/spinner";
import { checkNewPassword, MIN_PASSWORD_LENGTH, passwordChangeError } from "@/lib/password";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/** Replaces the administrator's temporary password with the member's own. */
export function SetPasswordForm({ email }: { email: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const problem = checkNewPassword(password, confirm);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    const { error: updateError } = await getSupabaseBrowserClient().auth.updateUser({ password });
    if (updateError) {
      setBusy(false);
      setError(passwordChangeError(updateError));
      return;
    }
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full reload picks up the new session
    window.location.assign("/chat");
  }

  return (
    <form onSubmit={submit} className="mt-6 grid gap-4 rounded-2xl border bg-card p-5" noValidate>
      {/* Lets password managers save the new password for the right account. */}
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
      <div className="grid gap-2">
        <Label htmlFor="new-password">New password</Label>
        <PasswordInput
          id="new-password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-describedby="new-password-hint"
          className="h-11"
          autoFocus
        />
        <p id="new-password-hint" className="text-xs text-muted-foreground">
          At least {MIN_PASSWORD_LENGTH} characters. A few random words work well.
        </p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="confirm-password">Repeat new password</Label>
        <PasswordInput
          id="confirm-password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="h-11"
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" className="h-11" disabled={busy}>
        {busy && <Spinner />} Save password
      </Button>
    </form>
  );
}
