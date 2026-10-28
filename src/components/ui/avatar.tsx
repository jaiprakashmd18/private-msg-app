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

export function Avatar({ name, seed, className }: { name: string; seed?: string | null; className?: string }) {
  const color = PALETTE[hash(seed ?? name) % PALETTE.length];
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-10 shrink-0 select-none items-center justify-center rounded-full text-sm font-semibold",
        color,
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
