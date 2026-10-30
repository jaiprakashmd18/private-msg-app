"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Spinner } from "@/components/ui/spinner";
import { passwordSignInError } from "@/lib/password";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import { emailSchema } from "@/lib/validation";

const ERRORS: Record<string, string> = {
  not_authorized:
    "This Google account isn't approved yet. We've sent an access request to the administrator — you can sign in once they accept it.",
  no_access: "Access for this account is currently disabled. Contact the administrator.",
  failed: "Sign-in didn't complete. Please try again.",
};

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden className="size-5">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export function LoginForm({ errorKey }: { errorKey?: string }) {
  const [busy, setBusy] = useState<"google" | "password" | null>(null);
  const [error, setError] = useState<string | null>(errorKey ? (ERRORS[errorKey] ?? ERRORS.failed!) : null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function signIn() {
    setBusy("google");
    setError(null);
    const { error: oauthError } = await getSupabaseBrowserClient().auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: { prompt: "select_account" },
      },
    });
    // On success the browser is already on its way to Google.
    if (oauthError) {
      setBusy(null);
      setError(ERRORS.failed!);
    }
  }

  async function signInWithPassword(e: React.FormEvent) {
    e.preventDefault();
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter a valid email address");
      return;
    }
    if (!password) {
      setError("Enter your password");
      return;
    }
    setBusy("password");
    setError(null);
    const supabase = getSupabaseBrowserClient();
    // Straight from the browser to Supabase Auth, so its per-IP rate limits
    // apply to each person rather than to our server.
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: parsed.data, password });
    if (signInError) {
      setBusy(null);
      setError(passwordSignInError(signInError));
      return;
    }
    await supabase.rpc("log_auth_event", { p_action: "auth.sign_in" });
    // A full navigation so the server sees the new session cookies. The app
    // sends people with a temporary password to /set-password first.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full reload picks up the new session
    window.location.assign("/chat");
  }

  return (
    <div className="grid gap-5 rounded-2xl border bg-card/80 p-5 shadow-xl backdrop-blur sm:p-6">
      <Button
        size="lg"
        variant="outline"
        className="h-12 bg-background/60 text-base"
        onClick={() => void signIn()}
        disabled={busy !== null}
      >
        {busy === "google" ? <Spinner label="Redirecting to Google" /> : <GoogleIcon />}
        Continue with Google
      </Button>

      <div className="flex items-center gap-3 text-xs uppercase tracking-wider text-muted-foreground" aria-hidden>
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>

      <form onSubmit={signInWithPassword} className="grid gap-3" noValidate aria-label="Sign in with email and password">
        <div className="grid gap-2">
          <Label htmlFor="login-email">Email</Label>
          <Input
            id="login-email"
            type="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="h-11"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="login-password">Password</Label>
          <PasswordInput
            id="login-password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="h-11"
          />
        </div>
        <Button type="submit" size="lg" className="mt-1 h-11" disabled={busy !== null}>
          {busy === "password" && <Spinner />} Sign in
        </Button>
      </form>

      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : (
        <p className="text-center text-xs text-muted-foreground">
          Only accounts approved by the administrator can sign in. Forgot your password? Ask the administrator to
          reset it.
        </p>
      )}
    </div>
  );
}
