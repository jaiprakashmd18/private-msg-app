"use client";

import { ListChecks, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { useApp } from "@/components/app-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useLiveRows } from "@/hooks/use-live-rows";
import { addListItem, clearDoneItems, deleteListItem, listItems, setListItemDone } from "@/lib/data/couple";
import { cn } from "@/lib/utils";
import type { ListItem } from "@/types/app";

/** A to-do / shopping list both people can edit; updates live. */
export function SharedListDialog({
  conversationId,
  open,
  onOpenChange,
  nameOf,
}: {
  conversationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nameOf: (userId: string | null) => string;
}) {
  const { supabase, reportError } = useApp();
  const { rows, reload } = useLiveRows<ListItem>("shared_list_items", conversationId, () => listItems(supabase, conversationId), open);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  // Optimistic ticks so the checkbox reacts instantly.
  const [pendingDone, setPendingDone] = useState<Record<string, boolean>>({});

  async function act(action: () => Promise<unknown>, fallback: string) {
    try {
      await action();
      reload();
    } catch (err) {
      reportError(err, fallback);
      reload();
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    setBusy(true);
    setText("");
    await act(() => addListItem(supabase, conversationId, value), "Could not add it.");
    setBusy(false);
  }

  const items = (rows ?? []).map((r) => (r.id in pendingDone ? { ...r, done: pendingDone[r.id]! } : r));
  const todo = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);

  const row = (item: ListItem) => (
    <li key={item.id} className="group flex items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-accent/50">
      <input
        type="checkbox"
        className="size-5 shrink-0 accent-primary"
        checked={item.done}
        aria-label={item.text}
        onChange={(e) => {
          const next = e.target.checked;
          setPendingDone((p) => ({ ...p, [item.id]: next }));
          void act(() => setListItemDone(supabase, item.id, next), "Could not update it.").then(() =>
            setPendingDone((p) => {
              const rest = { ...p };
              delete rest[item.id];
              return rest;
            }),
          );
        }}
      />
      <span className="min-w-0 flex-1">
        <span className={cn("block [overflow-wrap:anywhere]", item.done && "text-muted-foreground line-through")}>
          {item.text}
        </span>
        <span className="block text-[11px] text-muted-foreground">
          {item.done && item.done_by ? `Done by ${nameOf(item.done_by)}` : `Added by ${nameOf(item.created_by)}`}
        </span>
      </span>
      <button
        type="button"
        onClick={() => void act(() => deleteListItem(supabase, item.id), "Could not remove it.")}
        className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 focus-visible:opacity-100"
        aria-label={`Remove ${item.text}`}
      >
        <X className="size-4" />
      </button>
    </li>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ListChecks className="size-5" aria-hidden /> Our list
          </DialogTitle>
          <DialogDescription>Shopping, plans, to-dos — you both see changes straight away.</DialogDescription>
        </DialogHeader>

        <form onSubmit={add} className="flex gap-2">
          <Input
            aria-label="New item"
            placeholder="Add something…"
            value={text}
            maxLength={200}
            onChange={(e) => setText(e.target.value)}
            autoComplete="off"
          />
          <Button type="submit" size="icon" aria-label="Add" disabled={busy || !text.trim()}>
            <Plus />
          </Button>
        </form>

        <div className="-mx-2 min-h-24">
          {rows === null ? (
            <div className="space-y-2 px-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : items.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">Nothing on the list yet.</p>
          ) : (
            <>
              <ul aria-label="To do">{todo.map(row)}</ul>
              {done.length > 0 && (
                <div className="mt-3">
                  <div className="flex items-center justify-between px-2 pb-1">
                    <span className="text-xs font-medium text-muted-foreground">Done ({done.length})</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void act(() => clearDoneItems(supabase, conversationId), "Could not clear the list.")}
                    >
                      <Trash2 /> Clear done
                    </Button>
                  </div>
                  <ul aria-label="Done">{done.map(row)}</ul>
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
