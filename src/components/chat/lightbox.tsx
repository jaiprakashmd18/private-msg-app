"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronLeft, ChevronRight, Download, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useApp } from "@/components/app-provider";
import { Spinner } from "@/components/ui/spinner";
import { signedAttachmentUrl } from "@/lib/data/chat";
import { formatDateTime } from "@/lib/format";
import type { Attachment } from "@/types/app";

export interface LightboxItem {
  attachment: Attachment;
  caption: string;
  createdAt: string;
}

/**
 * Full-screen photo viewer: swipe or arrow keys to move between photos,
 * double-tap / click to zoom, download button, Esc to close.
 */
export function Lightbox({
  items,
  index,
  onIndexChange,
  onClose,
}: {
  items: LightboxItem[];
  index: number | null;
  onIndexChange: (i: number) => void;
  onClose: () => void;
}) {
  const { supabase } = useApp();
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [zoomed, setZoomed] = useState(false);
  const [origin, setOrigin] = useState("50% 50%");
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const current = index !== null ? items[index] : undefined;

  // Load the current photo and its neighbours.
  useEffect(() => {
    if (index === null) return;
    for (const i of [index, index - 1, index + 1]) {
      const item = items[i];
      if (!item || urls[item.attachment.id]) continue;
      signedAttachmentUrl(supabase, item.attachment.storage_path)
        .then((u) => setUrls((prev) => ({ ...prev, [item.attachment.id]: u })))
        .catch(() => undefined);
    }
  }, [index, items, supabase, urls]);

  const go = (delta: number) => {
    if (index === null) return;
    const next = index + delta;
    if (next >= 0 && next < items.length) {
      setZoomed(false);
      onIndexChange(next);
    }
  };

  async function download() {
    if (!current) return;
    const url = await signedAttachmentUrl(supabase, current.attachment.storage_path, current.attachment.file_name);
    window.location.href = url;
  }

  const url = current ? urls[current.attachment.id] : undefined;

  return (
    <DialogPrimitive.Root open={index !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-screen z-50 bg-black/95" />
        <DialogPrimitive.Content
          className="fixed inset-screen z-50 flex flex-col pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] text-white outline-none"
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") go(-1);
            if (e.key === "ArrowRight") go(1);
          }}
          aria-describedby={undefined}
        >
          <div className="flex items-center gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2">
            <DialogPrimitive.Close className="rounded-full p-2 hover:bg-white/10" aria-label="Close">
              <X className="size-5" />
            </DialogPrimitive.Close>
            <DialogPrimitive.Title className="min-w-0 flex-1 truncate text-sm">
              {current?.caption}
              {current && <span className="block text-xs text-white/60">{formatDateTime(current.createdAt)}</span>}
            </DialogPrimitive.Title>
            {items.length > 1 && index !== null && (
              <span className="text-xs text-white/70">
                {index + 1} / {items.length}
              </span>
            )}
            <button type="button" onClick={() => void download()} className="rounded-full p-2 hover:bg-white/10" aria-label="Download photo">
              <Download className="size-5" />
            </button>
          </div>

          <div
            className="relative flex min-h-0 flex-1 touch-none items-center justify-center overflow-hidden"
            onTouchStart={(e) => {
              const t = e.touches[0];
              if (t) touchStart.current = { x: t.clientX, y: t.clientY };
            }}
            onTouchEnd={(e) => {
              const start = touchStart.current;
              const t = e.changedTouches[0];
              touchStart.current = null;
              if (!start || !t || zoomed) return;
              const dx = t.clientX - start.x;
              const dy = t.clientY - start.y;
              if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
              else if (dy > 90) onClose();
            }}
          >
            {url ? (
              // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL of a private file
              <img
                src={url}
                alt={current?.attachment.file_name ?? "Photo"}
                draggable={false}
                onDoubleClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  setOrigin(`${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`);
                  setZoomed((z) => !z);
                }}
                onClick={(e) => {
                  // Single tap zooms too on touch devices without double-click.
                  if (e.detail === 1 && window.matchMedia("(pointer: coarse)").matches) {
                    const r = e.currentTarget.getBoundingClientRect();
                    setOrigin(`${((e.clientX - r.left) / r.width) * 100}% ${((e.clientY - r.top) / r.height) * 100}%`);
                    setZoomed((z) => !z);
                  }
                }}
                className="max-h-full max-w-full select-none object-contain transition-transform duration-200"
                style={{ transform: zoomed ? "scale(2.5)" : "none", transformOrigin: origin, cursor: zoomed ? "zoom-out" : "zoom-in" }}
              />
            ) : (
              <Spinner className="size-6" label="Loading photo" />
            )}
            {index !== null && index > 0 && (
              <button type="button" onClick={() => go(-1)} aria-label="Previous photo" className="absolute left-2 rounded-full bg-black/40 p-2 hover:bg-black/60">
                <ChevronLeft className="size-6" />
              </button>
            )}
            {index !== null && index < items.length - 1 && (
              <button type="button" onClick={() => go(1)} aria-label="Next photo" className="absolute right-2 rounded-full bg-black/40 p-2 hover:bg-black/60">
                <ChevronRight className="size-6" />
              </button>
            )}
          </div>
          <p className="pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 text-center text-xs text-white/50">
            Double-tap to zoom · swipe to browse
          </p>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
