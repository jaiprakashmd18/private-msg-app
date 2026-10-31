"use client";

/** A handful of hearts (or other emoji) floating up over the chat. Purely decorative. */
export function HeartBurst({ burst, emojis = ["❤️", "💖"] }: { burst: number; emojis?: string[] }) {
  if (!burst) return null;
  return (
    <div key={burst} className="pointer-events-none absolute inset-x-0 bottom-24 z-20 flex justify-center" aria-hidden>
      {Array.from({ length: 9 }).map((_, i) => (
        <span
          key={i}
          className="heart-float absolute text-3xl"
          style={
            {
              "--heart-dx": `${(i - 4) * 28}px`,
              animationDelay: `${(i % 5) * 120}ms`,
              fontSize: `${22 + ((i * 7) % 16)}px`,
            } as React.CSSProperties
          }
        >
          {emojis[i % emojis.length]}
        </span>
      ))}
    </div>
  );
}
