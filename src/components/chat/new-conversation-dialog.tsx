"use client";

import { ArrowLeft, Check, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useApp } from "@/components/app-provider";
import { useChat } from "@/components/chat/chat-provider";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { createGroup, getOrCreateConversation, listDirectory } from "@/lib/data/chat";
import { displayNameOf } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DirectoryEntry } from "@/types/app";

type Mode = "chat" | "group";

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
            {mode === "group" && (
              <button type="button" onClick={() => setMode("chat")} aria-label="Back" className="-ml-1 rounded-md p-1 hover:bg-accent">
                <ArrowLeft className="size-4" />
              </button>
            )}
            {mode === "group" ? "New group" : "New conversation"}
          </DialogTitle>
          <DialogDescription>
            {mode === "group" ? "Name the group and choose who's in it." : "Choose a member. Only approved members are listed."}
          </DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so each opening starts with fresh state. */}
        {open && <PeoplePicker mode={mode} onGroupMode={() => setMode("group")} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function PeoplePicker({ mode, onGroupMode, onDone }: { mode: Mode; onGroupMode: () => void; onDone: () => void }) {
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
        reportError(err, "Could not load members.");
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
        aria-label="Filter members"
        placeholder="Search by name or email"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        autoFocus={mode === "chat"}
      />
      <div className="-mx-2 min-h-24 overflow-y-auto">
        {mode === "chat" && people !== null && people.length > 1 && !needle && (
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
            {people.length === 0 ? "No other members yet. Ask the administrator to invite someone." : "No matches."}
          </p>
        ) : (
          <ul className="space-y-0.5" aria-label={mode === "group" ? "Choose group members" : "Members"}>
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
