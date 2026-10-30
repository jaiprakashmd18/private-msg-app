"use client";

import { createClient } from "@supabase/supabase-js";
import { KeyRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/components/app-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Spinner } from "@/components/ui/spinner";
import { getPublicEnv } from "@/lib/env";
import { checkNewPassword, MIN_PASSWORD_LENGTH, passwordChangeError } from "@/lib/password";

/**
 * Confirms the current password without touching this device's session: a
 * throwaway client signs in, then that extra session is ended right away.
 */
async function verifyPassword(email: string, password: string): Promise<boolean> {
  const env = getPublicEnv();
  const probe = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "password-check" },
  });
  const { error } = await probe.auth.signInWithPassword({ email, password });
  if (error) {
    if (error.code === "invalid_credentials") return false;
    throw error;
  }
  await probe.auth.signOut({ scope: "local" }).catch(() => undefined);
  return true;
}

export function PasswordCard() {
  const { access, supabase } = useApp();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setOpen(false);
    setCurrent("");
    setPassword("");
    setConfirm("");
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (access.has_password && !current) {
      setError("Enter your current password");
      return;
    }
    const problem = checkNewPassword(password, confirm);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (access.has_password && !(await verifyPassword(access.email, current))) {
        setError("Your current password is not correct.");
        return;
      }
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(passwordChangeError(updateError));
        return;
      }
      toast.success(access.has_password ? "Password changed" : "Password added — you can now sign in with your email too");
      reset();
      router.refresh();
    } catch (err) {
      setError(passwordChangeError(err as { message?: string }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="size-4" aria-hidden /> Sign-in
        </CardTitle>
        <CardDescription>How you can sign in to this app.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap gap-2">
          <Badge variant={access.has_google ? "success" : "outline"}>Google {access.has_google ? "· on" : "· not used"}</Badge>
          <Badge variant={access.has_password ? "success" : "outline"}>
            Email &amp; password {access.has_password ? "· on" : "· not set"}
          </Badge>
        </div>

        {!open ? (
          <div>
            <Button variant="outline" onClick={() => setOpen(true)}>
              <KeyRound /> {access.has_password ? "Change password" : "Add a password"}
            </Button>
            {!access.has_password && (
              <p className="mt-2 text-xs text-muted-foreground">
                Lets you sign in with {access.email} and a password, without Google.
              </p>
            )}
          </div>
        ) : (
          <form onSubmit={submit} className="grid gap-4" noValidate>
            <input type="email" name="username" autoComplete="username" value={access.email} readOnly hidden />
            {access.has_password && (
              <div className="grid gap-2">
                <Label htmlFor="current-password">Current password</Label>
                <PasswordInput
                  id="current-password"
                  autoComplete="current-password"
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  autoFocus
                />
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="settings-new-password">New password</Label>
              <PasswordInput
                id="settings-new-password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-describedby="settings-new-password-hint"
                autoFocus={!access.has_password}
              />
              <p id="settings-new-password-hint" className="text-xs text-muted-foreground">
                At least {MIN_PASSWORD_LENGTH} characters.
              </p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="settings-confirm-password">Repeat new password</Label>
              <PasswordInput
                id="settings-confirm-password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={busy}>
                {busy && <Spinner />} {access.has_password ? "Change password" : "Save password"}
              </Button>
              <Button type="button" variant="ghost" onClick={reset} disabled={busy}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
