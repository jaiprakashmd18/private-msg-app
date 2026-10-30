"use client";

import { FileText, ImageOff } from "lucide-react";
import { VoicePlayer } from "@/components/chat/voice-player";
import { Skeleton } from "@/components/ui/skeleton";
import { useSignedUrl as useSignedUrlFor } from "@/hooks/use-signed-url";
import { ATTACHMENTS_BUCKET } from "@/lib/constants";
import { formatBytes } from "@/lib/format";
import { isAudio, isImage } from "@/lib/media";
import { cn } from "@/lib/utils";
import type { Attachment } from "@/types/app";

/**
 * Attachments live in a private bucket. Short-lived signed URLs are requested
 * per file (Storage only issues them if the RLS policy allows this user) and
 * reused for a few minutes.
 */
function useSignedUrl(path: string | null, download?: string) {
  return useSignedUrlFor(ATTACHMENTS_BUCKET, path, download);
}

function Thumb({
  attachment,
  onOpen,
  className,
  overlay,
}: {
  attachment: Attachment;
  onOpen: () => void;
  className?: string;
  overlay?: string;
}) {
  const { url, failed } = useSignedUrl(attachment.thumb_path ?? attachment.storage_path);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn("relative block overflow-hidden rounded-lg bg-black/20", className)}
      aria-label={`Open photo ${attachment.file_name}`}
    >
      {failed ? (
        <span className="flex h-full min-h-24 items-center justify-center gap-2 p-3 text-xs">
          <ImageOff className="size-4" aria-hidden /> Unavailable
        </span>
      ) : url ? (
        // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL of a private file
        <img src={url} alt={attachment.file_name} loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <Skeleton className="h-full w-full rounded-none" />
      )}
      {overlay && (
        <span className="absolute inset-0 grid place-items-center bg-black/55 text-xl font-semibold text-white">{overlay}</span>
      )}
    </button>
  );
}

function SingleImage({ attachment, onOpen }: { attachment: Attachment; onOpen: () => void }) {
  const ratio = attachment.width && attachment.height ? attachment.width / attachment.height : 4 / 3;
  // Reserve the right space up front so the chat doesn't jump while loading.
  const style = { aspectRatio: String(Math.min(Math.max(ratio, 0.5), 2)) };
  return (
    <div style={style} className="w-64 max-w-full sm:w-72">
      <Thumb attachment={attachment} onOpen={onOpen} className="h-full w-full" />
    </div>
  );
}

function FileChip({ attachment, mine }: { attachment: Attachment; mine: boolean }) {
  const { url, failed } = useSignedUrl(attachment.storage_path, attachment.file_name);
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
        <span className="block text-xs opacity-75">{failed ? "Unavailable" : formatBytes(Number(attachment.size_bytes))}</span>
      </span>
    </a>
  );
}

function Voice({ attachment, mine }: { attachment: Attachment; mine: boolean }) {
  const { url } = useSignedUrl(attachment.storage_path);
  return <VoicePlayer src={url} durationMs={attachment.duration_ms} mine={mine} />;
}

/** All attachments of one message: photo grid, voice notes, then files. */
export function MessageAttachments({
  attachments,
  mine,
  onOpenImage,
}: {
  attachments: Attachment[];
  mine: boolean;
  onOpenImage: (attachmentId: string) => void;
}) {
  const images = attachments.filter((a) => isImage(a.mime_type) && a.mime_type !== "image/heic");
  const audio = attachments.filter((a) => isAudio(a.mime_type));
  const files = attachments.filter((a) => !images.includes(a) && !audio.includes(a));
  const shown = images.slice(0, 4);

  return (
    <div className="grid gap-1.5">
      {images.length === 1 && <SingleImage attachment={images[0]!} onOpen={() => onOpenImage(images[0]!.id)} />}
      {images.length > 1 && (
        <div className="grid w-64 max-w-full grid-cols-2 gap-1 sm:w-72">
          {shown.map((a, i) => (
            <Thumb
              key={a.id}
              attachment={a}
              onOpen={() => onOpenImage(a.id)}
              className="aspect-square"
              overlay={i === 3 && images.length > 4 ? `+${images.length - 4}` : undefined}
            />
          ))}
        </div>
      )}
      {audio.map((a) => (
        <Voice key={a.id} attachment={a} mine={mine} />
      ))}
      {files.map((a) => (
        <FileChip key={a.id} attachment={a} mine={mine} />
      ))}
    </div>
  );
}
