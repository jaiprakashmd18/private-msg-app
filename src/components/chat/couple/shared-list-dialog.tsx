"use client";

import { Camera, ListChecks, Mountain, Plus, Trash2, X } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/components/app-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useLiveRows } from "@/hooks/use-live-rows";
import { useSignedUrl } from "@/hooks/use-signed-url";
import { AVATARS_BUCKET } from "@/lib/constants";
import { uploadAvatarFile } from "@/lib/data/chat";
import { addListItem, clearDoneItems, deleteListItem, listItems, setListItemDone, setListItemPhoto } from "@/lib/data/couple";
import { prepareWallpaper } from "@/lib/media";
import { cn } from "@/lib/utils";
import type { ListItem } from "@/types/app";

export type ListTab = "todo" | "bucket";

/**
 * Our list (to-dos, shopping) and our bucket list (things to do together,
 * ticked off with a photo). Both people can edit; updates live.
 */
export function SharedListDialog({
  conversationId,
  open,
  onOpenChange,
  nameOf,
  tab,
  onTabChange,
}: {
  conversationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nameOf: (userId: string | null) => string;
  tab: ListTab;
  onTabChange: (tab: ListTab) => void;
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
    await act(() => addListItem(supabase, conversationId, value, tab), "Could not add it.");
    setBusy(false);
  }

  const items = (rows ?? [])
    .filter((r) => (r.list_kind ?? "todo") === tab)
    .map((r) => (r.id in pendingDone ? { ...r, done: pendingDone[r.id]! } : r));
  const todo = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);
  const bucket = tab === "bucket";

  const row = (item: ListItem) => (
    <li key={item.id} className="group rounded-xl px-2 py-1.5 hover:bg-accent/50">
      <div className="flex items-center gap-3">
        <input
          type="checkbox"
          className="size-5 shrink-0 accent-primary"
          checked={item.done}
          aria-label={item.text}
          onChange={(e) => {
            const next = e.target.checked;
            setPendingDone((p) => ({ ...p, [item.id]: next }));
            if (next && bucket) toast.success("Ticked off! Add a photo of it 📸");
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
          <span className={cn("block [overflow-wrap:anywhere]", item.done && !bucket && "text-muted-foreground line-through")}>
            {item.text}
          </span>
          <span className="block text-[11px] text-muted-foreground">
            {item.done && item.done_by
              ? `${bucket ? "Done! ✨" : "Done by"} ${bucket ? "" : nameOf(item.done_by)}`.trim()
              : `Added by ${nameOf(item.created_by)}`}
          </span>
        </span>
        {bucket && item.done && <BucketPhotoButton item={item} onSaved={reload} />}
        <button
          type="button"
          onClick={() => void act(() => deleteListItem(supabase, item.id), "Could not remove it.")}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:opacity-100 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100"
          aria-label={`Remove ${item.text}`}
        >
          <X className="size-4" />
        </button>
      </div>
      {bucket && item.photo_path && <BucketPhoto path={item.photo_path} alt={item.text} />}
    </li>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {bucket ? <Mountain className="size-5" aria-hidden /> : <ListChecks className="size-5" aria-hidden />}
            {bucket ? "Our bucket list" : "Our list"}
          </DialogTitle>
          <DialogDescription>
            {bucket
              ? "Places to go and things to try together — tick them off with a photo."
              : "Shopping, plans, to-dos — you both see changes straight away."}
          </DialogDescription>
        </DialogHeader>

        <div role="tablist" aria-label="Lists" className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">
          {(["todo", "bucket"] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => onTabChange(t)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                tab === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t === "todo" ? "To-do" : "Bucket list"}
            </button>
          ))}
        </div>

        <form onSubmit={add} className="flex gap-2">
          <Input
            aria-label="New item"
            placeholder={bucket ? "e.g. See the northern lights" : "Add something…"}
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
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">
              {bucket ? "Your bucket list is empty — dream big!" : "Nothing on the list yet."}
            </p>
          ) : (
            <>
              <ul aria-label={bucket ? "Still to do" : "To do"}>{todo.map(row)}</ul>
              {done.length > 0 && (
                <div className="mt-3">
                  <div className="flex items-center justify-between px-2 pb-1">
                    <span className="text-xs font-medium text-muted-foreground">
                      {bucket ? `Done together (${done.length})` : `Done (${done.length})`}
                    </span>
                    {!bucket && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void act(() => clearDoneItems(supabase, conversationId), "Could not clear the list.")}
                      >
                        <Trash2 /> Clear done
                      </Button>
                    )}
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

function BucketPhoto({ path, alt }: { path: string; alt: string }) {
  const { url } = useSignedUrl(AVATARS_BUCKET, path);
  return (
    <div className="ml-8 mt-2 overflow-hidden rounded-xl bg-muted">
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed URL of a private file
        <img src={url} alt={`Photo: ${alt}`} className="max-h-56 w-full object-cover" />
      ) : (
        <Skeleton className="h-32 w-full rounded-none" />
      )}
    </div>
  );
}

function BucketPhotoButton({ item, onSaved }: { item: ListItem; onSaved: () => void }) {
  const { supabase, access, reportError } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function pick(file: File | undefined) {
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    setBusy(true);
    try {
      const blob = await prepareWallpaper(file);
      const path = await uploadAvatarFile(supabase, `users/${access.user_id}`, blob);
      await setListItemPhoto(supabase, item.id, path);
      onSaved();
    } catch (err) {
      reportError(err, "Couldn't add the photo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        aria-label={`Photo for ${item.text}`}
        onChange={(e) => void pick(e.target.files?.[0])}
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={busy}
        className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label={item.photo_path ? `Change photo of ${item.text}` : `Add a photo of ${item.text}`}
        title={item.photo_path ? "Change photo" : "Add a photo"}
      >
        {busy ? <Spinner /> : <Camera className="size-4" />}
      </button>
    </>
  );
}
