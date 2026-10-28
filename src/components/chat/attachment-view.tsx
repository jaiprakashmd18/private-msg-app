"use client";

import { FileText, ImageOff } from "lucide-react";
import { useEffect, useState } from "react";
import { useApp } from "@/components/app-provider";
import { Skeleton } from "@/components/ui/skeleton";
import { signedAttachmentUrl } from "@/lib/data/chat";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Attachment } from "@/types/app";

/**
 * Attachments live in a private bucket. A short-lived signed URL is requested
 * per view; Storage only issues it if the RLS policy allows this user.
 */
export function AttachmentView({ attachment, mine }: { attachment: Attachment; mine: boolean }) {
  const { supabase } = useApp();
  const isImage = attachment.mime_type.startsWith("image/") && attachment.mime_type !== "image/heic";
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    signedAttachmentUrl(supabase, attachment.storage_path, isImage ? undefined : attachment.file_name)
      .then((u) => !cancelled && setUrl(u))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [supabase, attachment.storage_path, attachment.file_name, isImage]);

  if (isImage) {
    if (failed) {
      return (
        <div className="flex items-center gap-2 rounded-lg bg-black/10 p-3 text-xs">
          <ImageOff className="size-4" aria-hidden /> Image unavailable
        </div>
      );
    }
    if (!url) return <Skeleton className="h-48 w-64 max-w-full rounded-lg" />;
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-lg">
        {/* eslint-disable-next-line @next/next/no-img-element -- signed, short-lived private URL */}
        <img
          src={url}
          alt={attachment.file_name}
          className="max-h-80 w-auto max-w-full object-cover"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      </a>
    );
  }

  return (
    <a
      href={url ?? undefined}
      aria-disabled={!url}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 transition-colors",
        mine ? "bg-black/15 hover:bg-black/25" : "bg-foreground/5 hover:bg-foreground/10",
        !url && "pointer-events-none opacity-70",
      )}
    >
      <FileText className="size-5 shrink-0" aria-hidden />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{attachment.file_name}</span>
        <span className="block text-xs opacity-75">
          {failed ? "Unavailable" : formatBytes(Number(attachment.size_bytes))}
        </span>
      </span>
    </a>
  );
}
