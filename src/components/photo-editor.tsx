"use client";

import { Camera } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Avatar, GroupAvatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { prepareAvatar } from "@/lib/media";

/** Big avatar with "change / remove photo" controls. */
export function PhotoEditor({
  name,
  seed,
  path,
  group = false,
  onChange,
}: {
  name: string;
  seed?: string | null;
  path: string | null;
  group?: boolean;
  /** Receives the cropped JPEG, or null to remove the photo. */
  onChange: (photo: Blob | null) => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function apply(photo: Blob | null) {
    setBusy(true);
    try {
      await onChange(photo);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy}
        className="group relative rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        aria-label={path ? "Change photo" : "Add photo"}
      >
        {group ? (
          <GroupAvatar path={path} name={name} className="size-20 [&_svg]:size-8" />
        ) : (
          <Avatar name={name} seed={seed} path={path} className="size-20 text-2xl" />
        )}
        <span className="absolute inset-0 grid place-items-center rounded-full bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          {busy ? <Spinner className="size-5" /> : <Camera className="size-6" />}
        </span>
        <span className="absolute -bottom-0.5 -right-0.5 grid size-7 place-items-center rounded-full border-2 border-card bg-primary text-primary-foreground">
          <Camera className="size-3.5" aria-hidden />
        </span>
      </button>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          try {
            await apply(await prepareAvatar(file));
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Could not use that photo.");
          }
        }}
      />
      <div className="flex flex-col items-start gap-1">
        <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
          {path ? "Change photo" : "Add photo"}
        </Button>
        {path && (
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => void apply(null)} className="text-muted-foreground">
            Remove photo
          </Button>
        )}
      </div>
    </div>
  );
}
