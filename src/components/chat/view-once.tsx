"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { EyeOff, Timer, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useApp } from "@/components/app-provider";
import { Spinner } from "@/components/ui/spinner";
import { finishViewOnce, openViewOnce } from "@/lib/data/couple";
import { toUserMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import type { Attachment } from "@/types/app";

/**
 * A view-once photo in the chat. The recipient can open it once; the sender
 * only sees whether it has been opened. Nothing of the photo (no thumbnail)
 * is shown in the chat.
 */
export function ViewOnceChip({ attachment, mine }: { attachment: Attachment; mine: boolean }) {
  const [openedHere, setOpenedHere] = useState(false);
  const [viewing, setViewing] = useState(false);
  const opened = Boolean(attachment.viewed_at) || openedHere;

  const label = mine
    ? opened
      ? "View-once photo · Opened"
      : "View-once photo · Not opened yet"
    : opened
      ? "Photo · Opened"
      : "Photo · Tap to view once";

  return (
    <>
      <button
        type="button"
        disabled={mine || opened}
        onClick={() => setViewing(true)}
        className={cn(
          "flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
          mine ? "bg-black/15" : "bg-foreground/5 hover:bg-foreground/10",
          (mine || opened) && "cursor-default",
          opened && "opacity-70",
        )}
      >
        <span
          className={cn(
            "grid size-7 place-items-center rounded-full border-2 text-xs font-bold",
            opened ? "border-dashed border-current" : "border-current",
          )}
          aria-hidden
        >
          1
        </span>
        {label}
      </button>
      {viewing && (
        <ViewOnceViewer
          attachmentId={attachment.id}
          onClose={() => {
            setViewing(false);
            setOpenedHere(true);
          }}
        />
      )}
    </>
  );
}

function ViewOnceViewer({ attachmentId, onClose }: { attachmentId: string; onClose: () => void }) {
  const { supabase } = useApp();
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Load it into memory once (a blob URL), so the short-lived link isn't reused.
  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    openViewOnce(supabase, attachmentId)
      .then((url) => fetch(url))
      .then((res) => {
        if (!res.ok) throw new Error("Could not load the photo");
        return res.blob();
      })
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setSrc(objectUrl);
      })
      .catch((err) => !cancelled && setError(toUserMessage(err, "Could not open the photo.")));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [supabase, attachmentId]);

  return (
    <DialogPrimitive.Root
      open
      onOpenChange={(open) => {
        if (!open) {
          finishViewOnce(attachmentId);
          onClose();
        }
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-screen z-50 bg-black" />
        <DialogPrimitive.Content
          className="fixed inset-screen z-50 flex flex-col pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] text-white outline-none"
          onContextMenu={(e) => e.preventDefault()}
        >
          <div className="flex items-center gap-2 px-3 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
            <DialogPrimitive.Title className="flex flex-1 items-center gap-2 text-sm font-medium">
              <Timer className="size-4" aria-hidden /> View once — closes for good
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">
              This photo can only be viewed once. When you close it, it is deleted.
            </DialogPrimitive.Description>
            <DialogPrimitive.Close className="rounded-full p-2 hover:bg-white/10" aria-label="Close">
              <X className="size-5" />
            </DialogPrimitive.Close>
          </div>
          <div className="grid min-h-0 flex-1 place-items-center p-2">
            {error ? (
              <p className="flex items-center gap-2 text-sm text-white/80">
                <EyeOff className="size-4" aria-hidden /> {error}
              </p>
            ) : src ? (
              // eslint-disable-next-line @next/next/no-img-element -- in-memory blob of a private, one-time photo
              <img
                src={src}
                alt="View-once photo"
                draggable={false}
                className="max-h-full max-w-full select-none object-contain [-webkit-touch-callout:none]"
              />
            ) : (
              <Spinner label="Opening photo" />
            )}
          </div>
          <p className="pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 text-center text-xs text-white/50">
            Screenshots can&apos;t be blocked — only send what you&apos;re comfortable with.
          </p>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
