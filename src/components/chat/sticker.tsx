import { stickerById } from "@/lib/stickers";
import { cn } from "@/lib/utils";

/** A sticker from the built-in pack (emoji + colours). */
export function Sticker({ id, size = "lg", className }: { id: string; size?: "sm" | "lg"; className?: string }) {
  const s = stickerById(id);
  if (!s) return <span className="text-sm opacity-70">Sticker</span>;
  return (
    <span
      role="img"
      aria-label={`Sticker: ${s.label}`}
      className={cn(
        "relative inline-flex flex-col items-center justify-center rounded-[28%] text-white shadow-lg ring-4 ring-white/90",
        size === "lg" ? "size-32 animate-[sticker-pop_0.35s_ease-out] gap-1" : "size-[4.5rem] gap-0.5",
        className,
      )}
      style={{ backgroundImage: `linear-gradient(140deg, ${s.from}, ${s.to})` }}
    >
      <span aria-hidden className={cn("leading-none drop-shadow", size === "lg" ? "text-5xl" : "text-3xl")}>
        {s.emoji}
      </span>
      <span
        aria-hidden
        className={cn(
          "max-w-[92%] text-center font-extrabold leading-tight tracking-tight [text-shadow:0_1px_2px_rgb(0_0_0/0.35)]",
          size === "lg" ? "text-sm" : "text-[10px]",
        )}
      >
        {s.label}
      </span>
    </span>
  );
}
