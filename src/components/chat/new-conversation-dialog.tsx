"use client";

import { ArrowLeft, Check, Copy, Mail, Share2, UserPlus, Users, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/components/app-provider";
import { useChat } from "@/components/chat/chat-provider";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  cancelInvitation,
  createGroup,
  getOrCreateConversation,
  type InviteResult,
  inviteContact,
  listDirectory,
  listMyInvitations,
} from "@/lib/data/chat";
import { displayNameOf } from "@/lib/format";
import { isNativeApp } from "@/lib/native";
import { cn } from "@/lib/utils";
import type { DirectoryEntry } from "@/types/app";

type Mode = "chat" | "group" | "invite";

export function NewConversationDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [mode, setMode] = useState<Mode>("chat");
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setMode("chat");
      }}
    >
      <DialogContent className="flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode !== "chat" && (
              <button type="button" onClick={() => setMode("chat")} aria-label="Back" className="-ml-1 rounded-md p-1 hover:bg-accent">
                <ArrowLeft className="size-4" />
              </button>
            )}
            {mode === "group" ? "New group" : mode === "invite" ? "Invite someone" : "New conversation"}
          </DialogTitle>
          <DialogDescription>
            {mode === "group"
              ? "Name the group and choose who's in it."
              : mode === "invite"
                ? "Add their email. They can sign in straight away and you'll see each other in your contacts."
                : "Choose one of your contacts, or invite someone new."}
          </DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so each opening starts with fresh state. */}
        {open && mode === "invite" && <InviteForm onDone={() => setMode("chat")} />}
        {open && mode !== "invite" && (
          <PeoplePicker
            mode={mode}
            onGroupMode={() => setMode("group")}
            onInviteMode={() => setMode("invite")}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PeoplePicker({
  mode,
  onGroupMode,
  onInviteMode,
  onDone,
}: {
  mode: Mode;
  onGroupMode: () => void;
  onInviteMode: () => void;
  onDone: () => void;
}) {
  const { supabase, reportError } = useApp();
  const { refresh } = useChat();
  const router = useRouter();
  const [people, setPeople] = useState<DirectoryEntry[] | null>(null);
  const [filter, setFilter] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [groupName, setGroupName] = useState("");

  useEffect(() => {
    let cancelled = false;
    listDirectory(supabase)
      .then((rows) => !cancelled && setPeople(rows))
      .catch((err) => {
        if (!cancelled) setPeople([]);
        reportError(err, "Could not load your contacts.");
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, reportError]);

  async function open(id: string) {
    await refresh();
    onDone();
    router.push(`/chat/${id}`);
  }

  async function start(person: DirectoryEntry) {
    setPending(person.id);
    try {
      await open(await getOrCreateConversation(supabase, person.id));
    } catch (err) {
      reportError(err, "Could not start the conversation.");
    } finally {
      setPending(null);
    }
  }

  async function startGroup() {
    setPending("group");
    try {
      await open(await createGroup(supabase, groupName.trim(), [...selected]));
    } catch (err) {
      reportError(err, "Could not create the group.");
    } finally {
      setPending(null);
    }
  }

  const needle = filter.trim().toLowerCase();
  const visible = (people ?? []).filter((p) => !needle || `${p.display_name} ${p.email}`.toLowerCase().includes(needle));

  return (
    <>
      {mode === "group" && (
        <div className="grid gap-2">
          <Label htmlFor="group-name">Group name</Label>
          <Input
            id="group-name"
            placeholder="e.g. Family, Weekend trip"
            maxLength={80}
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            autoFocus
          />
        </div>
      )}
      <Input
        aria-label="Filter contacts"
        placeholder="Search by name or email"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        autoFocus={mode === "chat"}
      />
      <div className="-mx-2 min-h-24 overflow-y-auto">
        {mode === "chat" && !needle && (
          <button
            type="button"
            onClick={onInviteMode}
            className="mb-1 flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-accent"
          >
            <span className="grid size-10 place-items-center rounded-full bg-primary/20 text-primary">
              <UserPlus className="size-5" aria-hidden />
            </span>
            <span className="font-medium">Invite someone</span>
          </button>
        )}
        {mode === "chat" && people !== null && people.length > 0 && !needle && (
          <button
            type="button"
            onClick={onGroupMode}
            className="mb-1 flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-accent"
          >
            <span className="grid size-10 place-items-center rounded-full bg-primary/20 text-primary">
              <Users className="size-5" aria-hidden />
            </span>
            <span className="font-medium">New group</span>
          </button>
        )}
        {people === null ? (
          <div className="space-y-2 px-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            {people.length === 0 ? "No contacts yet. Tap “Invite someone” to add people by email." : "No matches."}
          </p>
        ) : (
          <ul className="space-y-0.5" aria-label={mode === "group" ? "Choose group members" : "Contacts"}>
            {visible.map((p) => {
              const name = displayNameOf(p.display_name, p.email);
              const checked = selected.has(p.id);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    disabled={pending !== null}
                    role={mode === "group" ? "checkbox" : undefined}
                    aria-checked={mode === "group" ? checked : undefined}
                    onClick={() => {
                      if (mode === "chat") return void start(p);
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (checked) next.delete(p.id);
                        else next.add(p.id);
                        return next;
                      });
                    }}
                    className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-accent disabled:opacity-60"
                  >
                    <Avatar name={name} seed={p.id} path={p.avatar_path} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{p.email}</span>
                    </span>
                    {pending === p.id && <Spinner />}
                    {mode === "group" && (
                      <span
                        className={cn(
                          "grid size-5 place-items-center rounded-full border",
                          checked ? "border-primary bg-primary text-primary-foreground" : "border-input",
                        )}
                        aria-hidden
                      >
                        {checked && <Check className="size-3.5" />}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {mode === "group" && (
        <Button disabled={!groupName.trim() || selected.size === 0 || pending !== null} onClick={() => void startGroup()}>
          {pending === "group" ? <Spinner /> : <Users />}
          Create group{selected.size ? ` with ${selected.size} ${selected.size === 1 ? "person" : "people"}` : ""}
        </Button>
      )}
    </>
  );
}

/** The message to pass on to the person you invited (the app doesn't send emails). */
function inviteMessage(email: string) {
  const url = window.location.origin;
  return `I invited you to Ghostline, our private chat app. Open ${url} and sign in with Google using ${email}.`;
}

async function shareInvite(email: string) {
  const text = inviteMessage(email);
  try {
    if (isNativeApp()) {
      const { Share } = await import("@capacitor/share");
      await Share.share({ title: "Join me on Ghostline", text, dialogTitle: "Send the invite" });
      return;
    }
    if (navigator.share) {
      await navigator.share({ title: "Join me on Ghostline", text });
      return;
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return;
    if (err instanceof Error && /cancel/i.test(err.message)) return;
  }
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Invite message copied — paste it in WhatsApp, SMS or email.");
  } catch {
    toast.error("Couldn't copy. Tell them: sign in with Google using " + email);
  }
}

function InviteForm({ onDone }: { onDone: () => void }) {
  const { supabase, reportError } = useApp();
  const { refresh } = useChat();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<(InviteResult & { email: string }) | null>(null);
  const [pending, setPending] = useState<Array<{ email: string; created_at: string }> | null>(null);

  const loadPending = useCallback(() => {
    listMyInvitations(supabase)
      .then(setPending)
      .catch(() => setPending([]));
  }, [supabase]);

  useEffect(() => {
    loadPending();
  }, [loadPending]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = email.trim();
    if (!value) return;
    setBusy(true);
    try {
      const res = await inviteContact(supabase, value, name);
      setResult({ ...res, email: value.toLowerCase() });
      setEmail("");
      setName("");
      loadPending();
      void refresh();
    } catch (err) {
      reportError(err, "Could not invite them.");
    } finally {
      setBusy(false);
    }
  }

  async function withdraw(address: string) {
    try {
      await cancelInvitation(supabase, address);
      toast.success("Invite withdrawn");
      loadPending();
    } catch (err) {
      reportError(err, "Could not withdraw the invite.");
    }
  }

  return (
    <div className="grid gap-4">
      {result && (
        <div role="status" className="grid gap-3 rounded-2xl bg-primary/10 p-4 text-sm">
          {result.status === "connected" ? (
            <p>
              <strong>{result.display_name ?? result.email}</strong> is already on Ghostline — you&apos;re now contacts. Find
              them in your contacts list.
            </p>
          ) : (
            <>
              <p>
                <strong>{result.email}</strong> can sign in now. Send them the invite so they know:
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => void shareInvite(result.email)}>
                  <Share2 /> Share invite
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(inviteMessage(result.email))
                      .then(() => toast.success("Invite message copied"))
                      .catch(() => toast.error("Couldn't copy"))
                  }
                >
                  <Copy /> Copy message
                </Button>
              </div>
            </>
          )}
          <Button size="sm" variant="ghost" className="justify-self-start" onClick={onDone}>
            Back to contacts
          </Button>
        </div>
      )}

      <form onSubmit={(e) => void submit(e)} className="grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="invite-email">Their email (Gmail / Google account)</Label>
          <Input
            id="invite-email"
            type="email"
            inputMode="email"
            autoComplete="off"
            autoCapitalize="none"
            placeholder="name@gmail.com"
            value={email}
            maxLength={254}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="invite-name">Name (optional)</Label>
          <Input id="invite-name" placeholder="e.g. Meenu" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </div>
        <Button type="submit" disabled={busy || !email.trim()}>
          {busy ? <Spinner /> : <Mail />} Invite
        </Button>
      </form>

      {pending && pending.length > 0 && (
        <section aria-labelledby="pending-invites" className="grid gap-1">
          <h3 id="pending-invites" className="text-xs font-medium text-muted-foreground">
            Waiting to join
          </h3>
          <ul className="-mx-2">
            {pending.map((p) => (
              <li key={p.email} className="flex items-center gap-2 rounded-xl px-2 py-1.5">
                <span className="min-w-0 flex-1 truncate text-sm">{p.email}</span>
                <Button size="icon-sm" variant="ghost" aria-label={`Share invite with ${p.email}`} onClick={() => void shareInvite(p.email)}>
                  <Share2 />
                </Button>
                <Button size="icon-sm" variant="ghost" aria-label={`Withdraw invite for ${p.email}`} onClick={() => void withdraw(p.email)}>
                  <X />
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
