"use client";

import { ExternalLink, Music2 } from "lucide-react";
import type { parseSongLink } from "@/lib/chat-experience";

export function SongCard({ song }: { song: NonNullable<ReturnType<typeof parseSongLink>> }) {
  return (
    <a href={song.url} target="_blank" rel="noopener noreferrer" className="flex min-w-0 items-center gap-3 rounded-xl border border-current/25 px-3 py-2">
      <Music2 className="size-5 shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">Open song</span>
        <span className="block text-xs">{song.provider}</span>
      </span>
      <ExternalLink className="size-4 shrink-0" aria-hidden />
    </a>
  );
}
