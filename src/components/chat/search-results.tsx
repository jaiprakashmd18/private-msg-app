"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp } from "@/components/app-provider";
import { useChat } from "@/components/chat/chat-provider";
import { conversationName } from "@/components/chat/conversation-list";
import { Spinner } from "@/components/ui/spinner";
import { searchMessages } from "@/lib/data/chat";
import { displayNameOf, formatListTime } from "@/lib/format";
import type { SearchResult } from "@/types/app";

function Highlight({ text, query }: { text: string; query: string }) {
  const terms = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  if (terms.length === 0) return <>{text}</>;
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const parts = text.split(new RegExp(`(${escaped.join("|")})`, "gi"));
  return (
    <>
      {parts.map((part, i) =>
        terms.some((t) => part.toLowerCase().startsWith(t)) && i % 2 === 1 ? (
          <mark key={i} className="rounded bg-primary/25 px-0.5 text-foreground">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

export function SearchResults({ query, onNavigate }: { query: string; onNavigate: () => void }) {
  const { supabase, access, reportError } = useApp();
  const { conversations } = useChat();
  const [state, setState] = useState<{ query: string; results: SearchResult[] } | null>(null);
  const results = state?.query === query ? state.results : null;

  useEffect(() => {
    let cancelled = false;
    const t = setTimeout(() => {
      searchMessages(supabase, query)
        .then((rows) => !cancelled && setState({ query, results: rows }))
        .catch((err) => {
          if (!cancelled) setState({ query, results: [] });
          reportError(err, "Search failed.");
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [supabase, query, reportError]);

  const needle = query.toLowerCase();
  const people = conversations.filter((c) =>
    `${c.title ?? ""} ${c.other_display_name ?? ""} ${c.other_email ?? ""}`.toLowerCase().includes(needle),
  );

  return (
    <div className="px-2 pb-4" aria-live="polite">
      {people.length > 0 && (
        <section className="mb-3">
          <h2 className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Conversations</h2>
          <ul>
            {people.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/chat/${c.id}`}
                  onClick={onNavigate}
                  className="block rounded-xl px-2 py-2 hover:bg-accent/60"
                >
                  {conversationName(c)}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h2 className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Messages</h2>
        {results === null ? (
          <div className="flex justify-center py-6">
            <Spinner label="Searching" />
          </div>
        ) : results.length === 0 ? (
          <p className="px-2 py-4 text-sm text-muted-foreground">No messages found.</p>
        ) : (
          <ul>
            {results.map((r) => {
              const conv = conversations.find((c) => c.id === r.conversation_id);
              const who =
                r.sender_id === access.user_id
                  ? "You: "
                  : conv?.kind === "direct"
                    ? `${displayNameOf(conv.other_display_name, conv.other_email)}: `
                    : "";
              return (
                <li key={r.message_id}>
                  <Link
                    href={`/chat/${r.conversation_id}?m=${r.message_id}`}
                    onClick={onNavigate}
                    className="block rounded-xl px-2 py-2 hover:bg-accent/60"
                  >
                    <span className="flex items-baseline gap-2">
                      <span className="flex-1 truncate text-sm font-medium">
                        {conv ? conversationName(conv) : "Conversation"}
                      </span>
                      <time dateTime={r.created_at} className="text-xs text-muted-foreground">
                        {formatListTime(r.created_at)}
                      </time>
                    </span>
                    <span className="line-clamp-2 text-sm text-muted-foreground">
                      {who}
                      <Highlight text={r.body} query={query} />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
