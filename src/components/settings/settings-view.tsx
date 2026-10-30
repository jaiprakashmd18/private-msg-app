"use client";

import { ArrowLeft, Lock, Moon, ShieldCheck, Sun } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { useApp } from "@/components/app-provider";
import { AppLockCard } from "@/components/app-lock/app-lock-card";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { PhotoEditor } from "@/components/photo-editor";
import { AppSettingsCard } from "@/components/pwa/app-settings-card";
import { PasswordCard } from "@/components/settings/password-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { removeAvatarFile, setAvatar, uploadAvatarFile } from "@/lib/data/chat";
import { profileSchema } from "@/lib/validation";

function subscribeTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}

function useTheme() {
  const dark = useSyncExternalStore(
    subscribeTheme,
    () => document.documentElement.classList.contains("dark"),
    () => true,
  );
  function toggle() {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      // Storage unavailable (private mode); the choice lasts for this page only.
    }
  }
  return { dark, toggle };
}

export function SettingsView() {
  const { access, settings, supabase, reportError } = useApp();
  const router = useRouter();
  const [displayName, setDisplayName] = useState(access.display_name);
  const [bio, setBio] = useState(access.bio);
  const [saving, setSaving] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const { dark, toggle } = useTheme();

  async function changePhoto(photo: Blob | null) {
    try {
      const old = access.avatar_path;
      const path = photo ? await uploadAvatarFile(supabase, `users/${access.user_id}`, photo) : null;
      await setAvatar(supabase, path);
      await removeAvatarFile(supabase, old).catch(() => undefined);
      toast.success(photo ? "Photo updated" : "Photo removed");
      router.refresh();
    } catch (err) {
      reportError(err, "Could not update your photo.");
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const parsed = profileSchema.safeParse({ display_name: displayName, bio });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setFieldError(null);
    setSaving(true);
    const { error } = await supabase.from("profiles").update(parsed.data).eq("id", access.user_id);
    setSaving(false);
    if (error) {
      reportError(error, "Could not save your profile.");
      return;
    }
    toast.success("Profile saved");
    router.refresh();
  }

  return (
    <main
      id="main"
      className="mx-auto w-full max-w-2xl px-4 pb-[max(4rem,calc(env(safe-area-inset-bottom)+2rem))] pt-[max(1.5rem,env(safe-area-inset-top))]"
    >
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link href="/chat">
          <ArrowLeft /> Messages
        </Link>
      </Button>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Settings</h1>

      <div className="mt-6 grid gap-5">
        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
            <CardDescription>Visible to other members of this app.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            <PhotoEditor
              name={displayName || access.email}
              seed={access.user_id}
              path={access.avatar_path}
              onChange={changePhoto}
            />
            <form onSubmit={save} className="grid gap-4" noValidate>
              <div className="grid gap-2">
                <Label htmlFor="email">Account email</Label>
                <Input id="email" value={access.email} disabled readOnly />
                <p className="text-xs text-muted-foreground">Your approved email is your identity and can&apos;t be changed here.</p>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="display_name">Display name</Label>
                <Input
                  id="display_name"
                  value={displayName}
                  maxLength={60}
                  onChange={(e) => setDisplayName(e.target.value)}
                  aria-invalid={Boolean(fieldError)}
                  required
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="bio">About</Label>
                <Textarea id="bio" value={bio} maxLength={280} onChange={(e) => setBio(e.target.value)} rows={3} />
              </div>
              {fieldError && (
                <p role="alert" className="text-sm text-destructive">
                  {fieldError}
                </p>
              )}
              <div>
                <Button type="submit" disabled={saving}>
                  {saving && <Spinner />} Save profile
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <PasswordCard />

        <AppLockCard />

        <Card>
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={toggle} aria-pressed={!dark}>
              {dark ? <Sun /> : <Moon />} Switch to {dark ? "light" : "dark"} mode
            </Button>
          </CardContent>
        </Card>

        <AppSettingsCard />

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="size-4" aria-hidden /> Privacy &amp; security
            </CardTitle>
            <CardDescription>How your messages are protected in this app.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <dl className="grid gap-3">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Encryption in transit</dt>
                <dd>HTTPS / TLS</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Encryption at rest</dt>
                <dd>Provided by hosting (Supabase)</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">End-to-end encryption</dt>
                <dd className="font-medium">Not enabled</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Administrator can read messages</dt>
                <dd className="font-medium">{settings?.admin_can_read_messages ? "Yes — every access is audited" : "No"}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Message retention</dt>
                <dd>
                  {settings?.message_retention_days
                    ? `Deleted after ${settings.message_retention_days} days`
                    : "Kept until deleted"}
                </dd>
              </div>
            </dl>
            <p className="flex items-start gap-2 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
              <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              Only the members of a conversation can read it. Messages you delete are removed for everyone. To delete
              your account and data, contact the administrator.
            </p>
            <Link href="/privacy" className="text-sm underline underline-offset-4">
              Read the full privacy notice
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sessions</CardTitle>
            <CardDescription>Sign out of this device, or of every device where you are signed in.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <SignOutButton variant="outline" />
            <SignOutButton variant="destructive" everywhere>
              Sign out everywhere
            </SignOutButton>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
