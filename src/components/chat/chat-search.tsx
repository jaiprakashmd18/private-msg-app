"use client";

import { Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useApp } from "@/components/app-provider";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { type ChatSearchHit, searchInConversation } from "@/lib/data/couple";
import { formatListTime } from "@/lib/format";

/** Highlights each case-insensitive occurrence of `query`. */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase();
  const lower = text.toLowerCase();
  // Start the snippet a little before the first match.
  const first = lower.indexOf(q);
  const start = Math.max(0, first - 30);
  const snippet = (start > 0 ? "…" : "") + text.slice(start, start + 160);
  const parts: React.ReactNode[] = [];
  const sl = snippet.toLowerCase();
  let at = 0;
  let i = sl.indexOf(q);
  while (q && i !== -1) {
    parts.push(snippet.slice(at, i));
    parts.push(
      <mark key={i} className="rounded bg-primary/30 px-0.5 text-foreground">
        {snippet.slice(i, i + q.length)}
      </mark>,
    );
    at = i + q.length;
    i = sl.indexOf(q, at);
  }
  parts.push(snippet.slice(at));
  return <>{parts}</>;
}

/** Search bar under the chat header; picking a result jumps to the message. */
export function ChatSearch({
  conversationId,
  nameOf,
  onJump,
  onClose,
}: {
  conversationId: string;
  nameOf: (userId: string | null) => string;
  onJump: (messageId: string) => void;
  onClose: () => void;
}) {
  const { supabase } = useApp();
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{ q: string; hits: ChatSearchHit[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const q = query.trim();

  useEffect(() => {
    if (!q) return;
    let cancelled = false;
    const t = setTimeout(() => {
      searchInConversation(supabase, conversationId, q)
        .then((hits) => {
          if (cancelled) return;
          setResult({ q, hits });
          setFailed(false);
        })
        .catch(() => !cancelled && setFailed(true));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, supabase, conversationId]);

  const hits = result && result.q === q ? result.hits : null;

  return (
    <div className="relative z-20 border-b bg-background px-3 py-2 sm:px-6">
      <div className="relative mx-auto max-w-4xl">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          aria-label="Search in this chat"
          placeholder="Search in this chat"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && onClose()}
          className="h-9 rounded-full pl-9 pr-9"
          autoFocus
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close search"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
      {q && (
        <div className="absolute inset-x-0 top-full max-h-[min(60dvh,26rem)] overflow-y-auto overscroll-contain border-b bg-popover shadow-xl">
          <div className="mx-auto max-w-4xl">
            {failed ? (
              <p className="p-4 text-center text-sm text-muted-foreground">Search failed. Try again.</p>
            ) : hits === null ? (
              <div className="flex justify-center p-4">
                <Spinner label="Searching" />
              </div>
            ) : hits.length === 0 ? (
              <p className="p-4 text-center text-sm text-muted-foreground">No messages found.</p>
            ) : (
              <ul aria-label="Search results">
                <li className="px-4 pb-1 pt-2 text-xs text-muted-foreground">
                  {hits.length === 50 ? "50+ results (newest first)" : `${hits.length} result${hits.length === 1 ? "" : "s"}`}
                </li>
                {hits.map((h) => (
                  <li key={h.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onJump(h.id);
                        onClose();
                      }}
                      className="block w-full px-4 py-2 text-left hover:bg-accent"
                    >
                      <span className="flex justify-between gap-3 text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{nameOf(h.sender_id)}</span>
                        <time dateTime={h.created_at}>{formatListTime(h.created_at)}</time>
                      </span>
                      <span className="line-clamp-2 text-sm [overflow-wrap:anywhere]">
                        <Highlight text={h.body} query={q} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
