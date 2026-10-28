"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useApp } from "@/components/app-provider";
import { useChat } from "@/components/chat/chat-provider";
import { Avatar } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { getOrCreateConversation, listDirectory } from "@/lib/data/chat";
import { displayNameOf } from "@/lib/format";
import type { DirectoryEntry } from "@/types/app";

export function NewConversationDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col">
        <DialogHeader>
          <DialogTitle>New conversation</DialogTitle>
          <DialogDescription>Choose a member. Only approved members are listed.</DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so each opening starts with fresh state. */}
        {open && <PeoplePicker onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function PeoplePicker({ onDone }: { onDone: () => void }) {
  const { supabase, reportError } = useApp();
  const { refresh } = useChat();
  const router = useRouter();
  const [people, setPeople] = useState<DirectoryEntry[] | null>(null);
  const [filter, setFilter] = useState("");
  const [pending, setPending] = useState<string | null>(null);

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

  async function start(person: DirectoryEntry) {
    setPending(person.id);
    try {
      const id = await getOrCreateConversation(supabase, person.id);
      await refresh();
      onDone();
      router.push(`/chat/${id}`);
    } catch (err) {
      reportError(err, "Could not start the conversation.");
    } finally {
      setPending(null);
    }
  }

  const needle = filter.trim().toLowerCase();
  const visible = (people ?? []).filter(
    (p) => !needle || `${p.display_name} ${p.phone_e164}`.toLowerCase().includes(needle),
  );

  return (
    <>
      <Input
        aria-label="Filter members"
        placeholder="Search by name or number"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        autoFocus
      />
      <div className="-mx-2 min-h-24 overflow-y-auto">
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
          <ul className="space-y-0.5">
            {visible.map((p) => {
              const name = displayNameOf(p.display_name, p.phone_e164);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    disabled={pending !== null}
                    onClick={() => void start(p)}
                    className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-accent disabled:opacity-60"
                  >
                    <Avatar name={name} seed={p.id} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{p.phone_e164}</span>
                    </span>
                    {pending === p.id && <Spinner />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
