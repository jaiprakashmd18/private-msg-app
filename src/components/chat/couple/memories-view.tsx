"use client";

import { ArrowLeft, ImageOff, Images } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "@/components/app-provider";
import { useChat } from "@/components/chat/chat-provider";
import { Lightbox, type LightboxItem } from "@/components/chat/lightbox";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useSignedUrl } from "@/hooks/use-signed-url";
import { ATTACHMENTS_BUCKET } from "@/lib/constants";
import { listMemories, MEMORIES_PAGE_SIZE } from "@/lib/data/couple";
import { displayNameOf } from "@/lib/format";
import type { Attachment } from "@/types/app";

function Tile({ attachment, onOpen }: { attachment: Attachment; onOpen: () => void }) {
  const { url, failed } = useSignedUrl(ATTACHMENTS_BUCKET, attachment.thumb_path ?? attachment.storage_path);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="relative aspect-square overflow-hidden bg-muted focus-visible:z-10"
      aria-label={`Open photo from ${new Date(attachment.created_at).toLocaleDateString()}`}
    >
      {failed ? (
        <ImageOff className="m-auto size-5 text-muted-foreground" aria-hidden />
      ) : url ? (
        // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL of a private file
        <img src={url} alt="" loading="lazy" className="size-full object-cover transition-transform hover:scale-105" />
      ) : (
        <Skeleton className="size-full rounded-none" />
      )}
    </button>
  );
}

/** Every photo the two of you shared in this chat, by month. */
export function MemoriesView({ conversationId }: { conversationId: string }) {
  const { supabase, access, reportError } = useApp();
  const { getConversation } = useChat();
  const summary = getConversation(conversationId);
  const [photos, setPhotos] = useState<Attachment[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [index, setIndex] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    listMemories(supabase, conversationId)
      .then((rows) => {
        if (cancelled) return;
        setPhotos(rows);
        setHasMore(rows.length === MEMORIES_PAGE_SIZE);
      })
      .catch((err) => {
        if (cancelled) return;
        setPhotos([]);
        reportError(err, "Could not load your photos.");
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, conversationId, reportError]);

  const loadMore = useCallback(async () => {
    const last = photos?.[photos.length - 1];
    if (!last) return;
    setLoadingMore(true);
    try {
      const rows = await listMemories(supabase, conversationId, last.created_at);
      setPhotos((prev) => [...(prev ?? []), ...rows]);
      setHasMore(rows.length === MEMORIES_PAGE_SIZE);
    } catch (err) {
      reportError(err, "Could not load more photos.");
    } finally {
      setLoadingMore(false);
    }
  }, [photos, supabase, conversationId, reportError]);

  const months = useMemo(() => {
    const groups: { label: string; items: { a: Attachment; i: number }[] }[] = [];
    (photos ?? []).forEach((a, i) => {
      const label = new Date(a.created_at).toLocaleDateString(undefined, { month: "long", year: "numeric" });
      const last = groups[groups.length - 1];
      if (last?.label === label) last.items.push({ a, i });
      else groups.push({ label, items: [{ a, i }] });
    });
    return groups;
  }, [photos]);

  const title =
    summary?.kind === "group" ? (summary.title ?? "Group") : displayNameOf(summary?.other_display_name, summary?.other_email);
  const items: LightboxItem[] = useMemo(
    () =>
      (photos ?? []).map((a) => ({
        attachment: a,
        caption: a.uploader_id === access.user_id ? "You" : title,
        createdAt: a.created_at,
      })),
    [photos, access.user_id, title],
  );

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
            <Images className="size-4" aria-hidden /> Memories
          </h2>
          <p className="truncate text-xs text-muted-foreground">Photos with {title}</p>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto w-full max-w-4xl">
          {photos === null ? (
            <div className="grid grid-cols-3 gap-0.5 p-0.5 sm:grid-cols-4">
              {Array.from({ length: 12 }).map((_, i) => (
                <Skeleton key={i} className="aspect-square rounded-none" />
              ))}
            </div>
          ) : photos.length === 0 ? (
            <div className="grid place-items-center px-6 py-16 text-center">
              <div>
                <p className="font-medium">No photos yet</p>
                <p className="mt-1 text-sm text-muted-foreground">Photos you send each other will collect here.</p>
              </div>
            </div>
          ) : (
            <>
              {months.map((m) => (
                <section key={m.label}>
                  <h3 className="sticky top-0 z-10 bg-background/90 px-4 py-2 text-sm font-semibold backdrop-blur">{m.label}</h3>
                  <div className="grid grid-cols-3 gap-0.5 sm:grid-cols-4 lg:grid-cols-5">
                    {m.items.map(({ a, i }) => (
                      <Tile key={a.id} attachment={a} onOpen={() => setIndex(i)} />
                    ))}
                  </div>
                </section>
              ))}
              {hasMore && (
                <div className="flex justify-center py-4">
                  <Button variant="outline" onClick={() => void loadMore()} disabled={loadingMore}>
                    {loadingMore && <Spinner />} Show older photos
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      <Lightbox items={items} index={index} onIndexChange={setIndex} onClose={() => setIndex(null)} />
    </>
  );
}
