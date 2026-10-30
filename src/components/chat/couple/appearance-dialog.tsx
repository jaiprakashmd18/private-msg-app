"use client";

import { Check, ImagePlus, Palette, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/components/app-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { useSignedUrl } from "@/hooks/use-signed-url";
import { AVATARS_BUCKET } from "@/lib/constants";
import { removeAvatarFile, uploadAvatarFile } from "@/lib/data/chat";
import { setChatAppearance } from "@/lib/data/couple";
import { prepareWallpaper } from "@/lib/media";
import { cn } from "@/lib/utils";
import { BUBBLE_COLORS, type BubbleColor, type ChatAppearance } from "@/types/app";

const COLOR_NAMES: Record<BubbleColor, string> = {
  blue: "Blue",
  rose: "Rose",
  purple: "Purple",
  green: "Green",
  orange: "Orange",
  teal: "Teal",
  graphite: "Graphite",
};

/** Your own wallpaper and bubble colour for this chat (only you see them). */
export function AppearanceDialog({
  conversationId,
  appearance,
  open,
  onOpenChange,
  onChanged,
}: {
  conversationId: string;
  appearance: ChatAppearance;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: (next: ChatAppearance) => void;
}) {
  const { supabase, access, reportError } = useApp();
  const [busy, setBusy] = useState<"wallpaper" | "color" | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { url: preview } = useSignedUrl(AVATARS_BUCKET, appearance.wallpaper_path);
  // Saves always start from the latest look, so a quick colour change and
  // wallpaper change can't undo each other.
  const latest = useRef(appearance);
  useEffect(() => {
    latest.current = appearance;
  }, [appearance]);

  async function apply(change: Partial<ChatAppearance>, kind: "wallpaper" | "color") {
    setBusy(kind);
    const before = latest.current;
    const next = { ...before, ...change };
    try {
      await setChatAppearance(supabase, conversationId, next.wallpaper_path, next.bubble_color);
      latest.current = next;
      if (before.wallpaper_path && before.wallpaper_path !== next.wallpaper_path) {
        await removeAvatarFile(supabase, before.wallpaper_path).catch(() => undefined);
      }
      onChanged(next);
    } catch (err) {
      reportError(err, "Could not change the look of this chat.");
    } finally {
      setBusy(null);
    }
  }

  async function pickWallpaper(file: File | undefined) {
    if (fileRef.current) fileRef.current.value = "";
    if (!file) return;
    setBusy("wallpaper");
    try {
      const blob = await prepareWallpaper(file);
      const path = await uploadAvatarFile(supabase, `users/${access.user_id}`, blob);
      await apply({ wallpaper_path: path }, "wallpaper");
      toast.success("Wallpaper set");
    } catch (err) {
      setBusy(null);
      reportError(err, err instanceof Error && err.message.startsWith("Please") ? err.message : "Could not set the wallpaper.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Palette className="size-5" aria-hidden /> Chat look
          </DialogTitle>
          <DialogDescription>Your wallpaper and bubble colour for this chat, on all your devices.</DialogDescription>
        </DialogHeader>

        <section className="grid gap-2">
          <h3 className="text-sm font-medium">Wallpaper</h3>
          <div className="flex items-center gap-3">
            <div className="relative h-24 w-16 shrink-0 overflow-hidden rounded-lg border bg-muted">
              {preview && (
                // eslint-disable-next-line @next/next/no-img-element -- signed URL of a private file
                <img src={preview} alt="Current wallpaper" className="size-full object-cover" />
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                aria-label="Choose a wallpaper photo"
                onChange={(e) => void pickWallpaper(e.target.files?.[0])}
              />
              <Button variant="outline" size="sm" disabled={busy !== null} onClick={() => fileRef.current?.click()}>
                {busy === "wallpaper" ? <Spinner /> : <ImagePlus />} Choose photo
              </Button>
              {appearance.wallpaper_path && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => void apply({ wallpaper_path: null }, "wallpaper")}
                >
                  <Trash2 /> Remove
                </Button>
              )}
            </div>
          </div>
        </section>

        <section className="grid gap-2">
          <h3 className="text-sm font-medium">Your bubble colour</h3>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Bubble colour">
            {BUBBLE_COLORS.map((c) => {
              const selected = (appearance.bubble_color ?? "blue") === c;
              return (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={COLOR_NAMES[c]}
                  title={COLOR_NAMES[c]}
                  disabled={busy !== null}
                  onClick={() => void apply({ bubble_color: c === "blue" ? null : c }, "color")}
                  className={cn(
                    `bubble-${c} grid size-10 place-items-center rounded-full bg-bubble-mine text-bubble-mine-foreground ring-offset-2 ring-offset-popover transition`,
                    selected && "ring-2 ring-primary",
                  )}
                >
                  {selected && <Check className="size-4" />}
                </button>
              );
            })}
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}
