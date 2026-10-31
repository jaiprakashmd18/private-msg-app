"use client";

import { useEffect, useState } from "react";
import { findLinks, type LinkPreview } from "@/lib/link-preview";
import { cn } from "@/lib/utils";

/** Message text with clickable links (opened in a new tab, no referrer). */
export function LinkifiedText({ text, mine }: { text: string; mine: boolean }) {
  const links = findLinks(text);
  if (links.length === 0) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let at = 0;
  links.forEach((l, i) => {
    if (l.index > at) parts.push(text.slice(at, l.index));
    parts.push(
      <a
        key={i}
        href={l.url}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className={cn("underline underline-offset-2", mine ? "decoration-white/60" : "text-primary decoration-primary/50")}
      >
        {l.url}
      </a>,
    );
    at = l.index + l.url.length;
  });
  if (at < text.length) parts.push(text.slice(at));
  return <>{parts}</>;
}

const cache = new Map<string, Promise<LinkPreview | null>>();

function loadPreview(url: string): Promise<LinkPreview | null> {
  let p = cache.get(url);
  if (!p) {
    p = fetch(`/api/link-preview?url=${encodeURIComponent(url)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { preview?: LinkPreview } | null) => j?.preview ?? null)
      .catch(() => null);
    cache.set(url, p);
  }
  return p;
}

/** A card for the first link in a message: picture, site, title, description. */
export function LinkPreviewCard({ text, mine }: { text: string; mine: boolean }) {
  const url = findLinks(text)[0]?.url ?? null;
  const [preview, setPreview] = useState<{ url: string; data: LinkPreview | null } | null>(null);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    void loadPreview(url).then((data) => !cancelled && setPreview({ url, data }));
    return () => {
      cancelled = true;
    };
  }, [url]);

  const data = preview && preview.url === url ? preview.data : null;
  if (!url || !data) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className={cn(
        "mt-1.5 block max-w-72 overflow-hidden rounded-xl border text-left transition-colors",
        mine ? "border-white/20 bg-black/15 hover:bg-black/25" : "bg-foreground/5 hover:bg-foreground/10",
      )}
    >
      {data.image && (
        // eslint-disable-next-line @next/next/no-img-element -- fetched through our own image proxy
        <img src={data.image} alt="" loading="lazy" className="aspect-[1.91/1] w-full bg-black/20 object-cover" />
      )}
      <span className="block px-3 py-2">
        {data.siteName && <span className="block truncate text-[11px] uppercase tracking-wide opacity-70">{data.siteName}</span>}
        <span className="line-clamp-2 text-sm font-semibold">{data.title}</span>
        {data.description && <span className="mt-0.5 line-clamp-2 text-xs opacity-80">{data.description}</span>}
      </span>
    </a>
  );
}
