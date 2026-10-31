"use client";

import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Sticker } from "@/components/chat/sticker";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { searchGifs, type StickerPayload } from "@/lib/data/couple";
import type { Gif } from "@/lib/giphy";
import { STICKERS, stickerText } from "@/lib/stickers";
import { cn } from "@/lib/utils";

/** Stickers and GIFs, shown above the message box. Picking one sends it. */
export function StickerPanel({ onPick }: { onPick: (payload: StickerPayload) => void }) {
  const [tab, setTab] = useState<"stickers" | "gifs">("stickers");
  return (
    <div className="mb-2 overflow-hidden rounded-2xl border bg-popover shadow-lg">
      <div role="tablist" aria-label="Stickers and GIFs" className="flex gap-1 border-b p-1.5">
        {(["stickers", "gifs"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              "flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
              tab === t ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60",
            )}
          >
            {t === "stickers" ? "Stickers" : "GIFs"}
          </button>
        ))}
      </div>
      <div className="max-h-[min(18rem,40dvh)] overflow-y-auto overscroll-contain p-2">
        {tab === "stickers" ? (
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
            {STICKERS.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onPick({ sticker: s.id, text: stickerText(s) })}
                className="grid place-items-center rounded-xl p-1 transition-transform hover:scale-105 active:scale-95"
                aria-label={`Send sticker: ${s.label}`}
              >
                <Sticker id={s.id} size="sm" className="ring-2" />
              </button>
            ))}
          </div>
        ) : (
          <GifSearch onPick={(gif) => onPick({ gif })} />
        )}
      </div>
    </div>
  );
}

function GifSearch({ onPick }: { onPick: (gif: Gif) => void }) {
  const [query, setQuery] = useState("");
  const [gifs, setGifs] = useState<Gif[] | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      searchGifs(query)
        .then((g) => {
          if (cancelled) return;
          setGifs(g);
          setFailed(false);
        })
        .catch(() => !cancelled && setFailed(true));
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query]);

  if (gifs === null) {
    return (
      <p className="p-4 text-center text-sm text-muted-foreground">
        GIF search isn&apos;t switched on yet. The administrator can add a free GIPHY key (see DEPLOYMENT.md, step 7e).
      </p>
    );
  }
  return (
    <div className="grid gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          aria-label="Search GIFs"
          placeholder="Search GIFs"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-9 rounded-full pl-9"
        />
      </div>
      {failed ? (
        <p className="p-3 text-center text-sm text-muted-foreground">Couldn&apos;t load GIFs. Try again.</p>
      ) : gifs === undefined ? (
        <div className="flex justify-center p-4">
          <Spinner label="Loading GIFs" />
        </div>
      ) : gifs.length === 0 ? (
        <p className="p-3 text-center text-sm text-muted-foreground">No GIFs found.</p>
      ) : (
        <div className="columns-2 gap-2 sm:columns-3">
          {gifs.map((g) => (
            <button
              key={g.id || g.url}
              type="button"
              onClick={() => onPick(g)}
              className="mb-2 block w-full overflow-hidden rounded-lg bg-muted"
              style={{ aspectRatio: `${g.width} / ${g.height}` }}
              aria-label={`Send GIF${g.title ? `: ${g.title}` : ""}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- animated GIF from GIPHY's CDN */}
              <img src={g.url} alt="" loading="lazy" className="size-full object-cover" />
            </button>
          ))}
        </div>
      )}
      <p className="text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Powered by GIPHY</p>
    </div>
  );
}
