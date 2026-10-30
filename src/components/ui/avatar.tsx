"use client";

import { Users } from "lucide-react";
import { useSignedUrl } from "@/hooks/use-signed-url";
import { AVATARS_BUCKET } from "@/lib/constants";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

const PALETTE = [
  "bg-indigo-500/25 text-indigo-800 dark:text-indigo-200",
  "bg-sky-500/25 text-sky-800 dark:text-sky-200",
  "bg-emerald-500/25 text-emerald-800 dark:text-emerald-200",
  "bg-amber-500/25 text-amber-800 dark:text-amber-200",
  "bg-rose-500/25 text-rose-800 dark:text-rose-200",
  "bg-violet-500/25 text-violet-800 dark:text-violet-200",
];

function hash(value: string) {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) h = (h * 31 + value.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Profile photo (private `avatars` bucket) with an initials fallback. */
export function Avatar({
  name,
  seed,
  path,
  className,
}: {
  name: string;
  seed?: string | null;
  path?: string | null;
  className?: string;
}) {
  const { url } = useSignedUrl(AVATARS_BUCKET, path);
  const color = PALETTE[hash(seed ?? name) % PALETTE.length];
  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex size-10 shrink-0 select-none items-center justify-center overflow-hidden rounded-full text-sm font-semibold",
        color,
        className,
      )}
    >
      {initials(name)}
      {url && (
        // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL of a private file
        <img src={url} alt="" className="absolute inset-0 size-full object-cover" />
      )}
    </span>
  );
}

/** Group photo, or a group icon when there is none. */
export function GroupAvatar({ path, name, className }: { path?: string | null; name: string; className?: string }) {
  const { url } = useSignedUrl(AVATARS_BUCKET, path);
  return (
    <span
      aria-hidden
      className={cn(
        "relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-full bg-primary/20 text-primary",
        className,
      )}
      title={name}
    >
      <Users className="size-5" />
      {url && (
        // eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL of a private file
        <img src={url} alt="" className="absolute inset-0 size-full object-cover" />
      )}
    </span>
  );
}
