"use client";

import { ArrowLeft, BookHeart, ImagePlus, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/components/app-provider";
import { useChat } from "@/components/chat/chat-provider";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useLiveRows } from "@/hooks/use-live-rows";
import { useSignedUrl } from "@/hooks/use-signed-url";
import { AVATARS_BUCKET } from "@/lib/constants";
import { removeAvatarFile, uploadAvatarFile } from "@/lib/data/chat";
import { listJournal, saveJournalEntry } from "@/lib/data/couple";
import { localDateString } from "@/lib/dates";
import { displayNameOf } from "@/lib/format";
import { prepareWallpaper } from "@/lib/media";
import type { JournalEntry } from "@/types/app";

function formatDay(day: string, today: string): string {
  if (day === today) return "Today";
  const d = new Date(`${day}T12:00:00`);
  const y = new Date(`${today}T12:00:00`);
  y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

function Photo({ path }: { path: string }) {
  const { url } = useSignedUrl(AVATARS_BUCKET, path);
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element -- signed URL of a private file
    <img src={url} alt="Journal photo" loading="lazy" className="mt-2 max-h-80 w-full rounded-xl object-cover" />
  ) : (
    <Skeleton className="mt-2 h-48 w-full rounded-xl" />
  );
}

function Entry({ who, entry }: { who: string; entry: JournalEntry }) {
  return (
    <article className="rounded-2xl border bg-card p-4">
      <p className="text-xs font-semibold text-primary">{who}</p>
      {entry.body && <p className="mt-1 whitespace-pre-wrap leading-relaxed [overflow-wrap:anywhere]">{entry.body}</p>}
      {entry.photo_path && <Photo path={entry.photo_path} />}
    </article>
  );
}

/** One page per day: what each of you wrote (and a photo), newest first. */
export function JournalView({ conversationId }: { conversationId: string }) {
  const { supabase, access, reportError } = useApp();
  const { getConversation } = useChat();
  const summary = getConversation(conversationId);
  const today = localDateString();
  const { rows, reload } = useLiveRows<JournalEntry>("journal_entries", conversationId, () => listJournal(supabase, conversationId));
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<{ blob: Blob; url: string } | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const otherName =
    summary?.kind === "group" ? "the others" : displayNameOf(summary?.other_display_name, summary?.other_email);
  const nameOf = (userId: string) => (userId === access.user_id ? "You" : summary?.kind === "direct" ? otherName : "Them");

  const days = useMemo(() => {
    const map = new Map<string, JournalEntry[]>();
    for (const e of rows ?? []) map.set(e.day, [...(map.get(e.day) ?? []), e]);
    if (!map.has(today)) map.set(today, []);
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [rows, today]);
  const mineToday = (rows ?? []).find((e) => e.day === today && e.user_id === access.user_id);

  function startEditing() {
    setText(mineToday?.body ?? "");
    setPhoto(null);
    setRemovePhoto(false);
    setEditing(true);
  }

  async function pick(file: File | undefined) {
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    try {
      const blob = await prepareWallpaper(file);
      setPhoto({ blob, url: URL.createObjectURL(blob) });
      setRemovePhoto(false);
    } catch (err) {
      reportError(err, err instanceof Error && err.message.startsWith("Please") ? err.message : "Couldn't use that photo.");
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const keepOld = !photo && !removePhoto ? (mineToday?.photo_path ?? null) : null;
    if (!text.trim() && !photo && !keepOld) return toast.error("Write something or add a photo");
    setBusy(true);
    try {
      const path = photo ? await uploadAvatarFile(supabase, `users/${access.user_id}`, photo.blob) : keepOld;
      await saveJournalEntry(supabase, conversationId, today, text, path);
      if (mineToday?.photo_path && mineToday.photo_path !== path) {
        await removeAvatarFile(supabase, mineToday.photo_path).catch(() => undefined);
      }
      toast.success(mineToday ? "Entry updated" : `Saved — ${otherName} can read it 📔`);
      setEditing(false);
      reload();
    } catch (err) {
      reportError(err, "Couldn't save your entry.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="flex items-center gap-3 border-b px-3 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-6">
        <Button asChild variant="ghost" size="icon-sm" aria-label="Back to the chat">
          <Link href={`/chat/${conversationId}`}>
            <ArrowLeft />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 font-semibold">
            <BookHeart className="size-4" aria-hidden /> Our journal
          </h2>
          <p className="truncate text-xs text-muted-foreground">A few lines a day, with {otherName}</p>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto grid w-full max-w-2xl gap-6 p-4">
          {rows === null ? (
            <Skeleton className="h-40 w-full rounded-2xl" />
          ) : (
            days.map(([day, entries]) => {
              const mine = entries.find((e) => e.user_id === access.user_id);
              const others = entries.filter((e) => e.user_id !== access.user_id);
              const isToday = day === today;
              return (
                <section key={day} aria-label={formatDay(day, today)}>
                  <h3 className="mb-2 text-sm font-semibold">{formatDay(day, today)}</h3>
                  <div className="grid gap-3">
                    {isToday && editing ? (
                      <form onSubmit={save} className="grid gap-3 rounded-2xl border bg-card p-4">
                        <Textarea
                          aria-label="Today's entry"
                          placeholder="How was your day? Something you want to remember…"
                          rows={4}
                          maxLength={2000}
                          value={text}
                          onChange={(e) => setText(e.target.value)}
                          autoFocus
                        />
                        {(photo || (mine?.photo_path && !removePhoto)) && (
                          <div className="relative">
                            {photo ? (
                              // eslint-disable-next-line @next/next/no-img-element -- local preview (blob URL)
                              <img src={photo.url} alt="Selected photo" className="max-h-60 w-full rounded-xl object-cover" />
                            ) : (
                              <Photo path={mine!.photo_path!} />
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setPhoto(null);
                                setRemovePhoto(true);
                              }}
                              aria-label="Remove photo"
                              className="absolute right-2 top-4 grid size-7 place-items-center rounded-full bg-black/60 text-white"
                            >
                              <X className="size-4" />
                            </button>
                          </div>
                        )}
                        <input
                          ref={fileRef}
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          className="sr-only"
                          aria-label="Add a photo to today's entry"
                          onChange={(e) => void pick(e.target.files?.[0])}
                        />
                        <div className="flex flex-wrap gap-2">
                          <Button type="submit" disabled={busy}>
                            {busy && <Spinner />} Save
                          </Button>
                          <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
                            <ImagePlus /> Photo
                          </Button>
                          <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
                            Cancel
                          </Button>
                        </div>
                      </form>
                    ) : mine ? (
                      <div className="grid gap-1">
                        <Entry who="You" entry={mine} />
                        {isToday && (
                          <Button variant="ghost" size="sm" className="justify-self-start" onClick={startEditing}>
                            Edit today&apos;s entry
                          </Button>
                        )}
                      </div>
                    ) : isToday ? (
                      <button
                        type="button"
                        onClick={startEditing}
                        className="rounded-2xl border border-dashed p-4 text-left text-sm text-muted-foreground hover:bg-accent/40"
                      >
                        ✍️ Write today&apos;s entry…
                      </button>
                    ) : null}
                    {others.map((e) => (
                      <Entry key={e.id} who={nameOf(e.user_id)} entry={e} />
                    ))}
                    {isToday && others.length === 0 && (
                      <p className="text-xs text-muted-foreground">{otherName} hasn&apos;t written today yet.</p>
                    )}
                  </div>
                </section>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
