import { cn } from "@/lib/utils";

/**
 * Soft, blurred colour fields behind full-screen glass (sign-in, lock
 * screen). Glass only looks like glass when there's colour behind it.
 */
export function GlassBackdrop({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)}>
      <div className="absolute -left-24 -top-24 size-[26rem] rounded-full bg-[#0a84ff]/45 blur-[90px] dark:bg-[#0a84ff]/35" />
      <div className="absolute -right-28 top-1/4 size-[22rem] rounded-full bg-[#bf5af2]/40 blur-[90px] dark:bg-[#bf5af2]/30" />
      <div className="absolute -bottom-32 left-1/4 size-[24rem] rounded-full bg-[#ff375f]/35 blur-[100px] dark:bg-[#ff375f]/25" />
    </div>
  );
}
