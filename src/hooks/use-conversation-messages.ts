"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/components/app-provider";
import { useChat } from "@/components/chat/chat-provider";
import {
  deleteMessage as deleteMessageApi,
  editMessage as editMessageApi,
  fetchMessage,
  fetchMessages,
  fetchMessagesSince,
  markConversationRead,
  sendMessage as sendMessageApi,
  toggleReaction,
  uploadAttachment,
  type UploadedAttachment,
} from "@/lib/data/chat";
import { requestPushForMessage } from "@/lib/pwa-client";
import { MESSAGES_PAGE_SIZE } from "@/lib/constants";
import type { Message, PendingFile, Reaction, UiMessage } from "@/types/app";

function sortMessages(list: UiMessage[]): UiMessage[] {
  return [...list].sort((a, b) => {
    const t = a.created_at.localeCompare(b.created_at);
    return t !== 0 ? t : a.id.localeCompare(b.id);
  });
}

/** Inserts or replaces by id, and replaces an optimistic copy with the same client_id. */
function upsert(list: UiMessage[], incoming: Message): UiMessage[] {
  const filtered = list.filter(
    (m) => m.id !== incoming.id && !(m.local_status && m.client_id === incoming.client_id),
  );
  const existing = list.find((m) => m.id === incoming.id);
  const merged: UiMessage = {
    ...existing,
    ...incoming,
    // Realtime rows carry no embedded relations; keep what we already have.
    attachments: incoming.attachments ?? existing?.attachments ?? [],
    message_reactions: incoming.message_reactions ?? existing?.message_reactions ?? [],
    reply_to: incoming.reply_to !== undefined ? incoming.reply_to : existing?.reply_to,
    local_status: undefined,
    local_files: undefined,
  };
  if (merged.deleted_at) {
    merged.attachments = [];
    merged.message_reactions = [];
  }
  return sortMessages([...filtered, merged]);
}

/** Replaces one person's reaction in a list (null emoji = no reaction). */
function withReaction(list: Reaction[] | undefined, r: Reaction): Reaction[] {
  return [...(list ?? []).filter((x) => x.user_id !== r.user_id), { user_id: r.user_id, emoji: r.emoji }];
}

export function useConversationMessages(conversationId: string) {
  const { supabase, access, reportError } = useApp();
  const { subscribe, refreshSoon } = useChat();
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesRef = useRef<UiMessage[]>([]);
  const uploadedRef = useRef(new Map<string, UploadedAttachment[]>());
  const readTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const markRead = useCallback(() => {
    if (document.visibilityState !== "visible") return;
    if (readTimer.current) clearTimeout(readTimer.current);
    readTimer.current = setTimeout(() => {
      markConversationRead(supabase, conversationId).catch(() => undefined);
    }, 400);
  }, [supabase, conversationId]);

  // Initial load.
  useEffect(() => {
    // The view is keyed by conversation id, so state starts fresh per conversation.
    let cancelled = false;
    fetchMessages(supabase, conversationId)
      .then((page) => {
        if (cancelled) return;
        setMessages(sortMessages(page));
        setHasMore(page.length === MESSAGES_PAGE_SIZE);
        markRead();
      })
      .catch((err) => {
        if (cancelled) return;
        setError("Could not load messages.");
        reportError(err, "Could not load messages.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      if (readTimer.current) clearTimeout(readTimer.current);
    };
  }, [supabase, conversationId, reportError, markRead]);

  // Realtime + resync.
  useEffect(() => {
    return subscribe((event) => {
      if (event.type === "resync") {
        const confirmed = messagesRef.current.filter((m) => !m.local_status);
        const last = confirmed[confirmed.length - 1];
        const loader = last
          ? fetchMessagesSince(supabase, conversationId, last.created_at)
          : fetchMessages(supabase, conversationId);
        loader
          .then((rows) => setMessages((prev) => rows.reduce(upsert, prev)))
          .catch(() => undefined);
        return;
      }
      if (event.type === "reaction") {
        const r = event.reaction;
        if (r.conversation_id !== conversationId) return;
        setMessages((prev) =>
          prev.map((m) => (m.id === r.message_id ? { ...m, message_reactions: withReaction(m.message_reactions, r) } : m)),
        );
        return;
      }
      if (event.message.conversation_id !== conversationId) return;
      if (event.type === "insert") {
        // Re-read through the API to include attachments (and RLS re-check).
        fetchMessage(supabase, event.message.id)
          .then((full) => {
            if (full) setMessages((prev) => upsert(prev, full));
          })
          .catch(() => undefined);
        if (event.message.sender_id !== access.user_id) markRead();
      } else {
        setMessages((prev) => {
          const existing = prev.find((m) => m.id === event.message.id);
          if (!existing) return prev;
          const { attachments, message_reactions, reply_to, ...row } = event.message;
          void attachments;
          void message_reactions;
          void reply_to;
          return upsert(prev, row);
        });
      }
    });
  }, [subscribe, supabase, conversationId, access.user_id, markRead]);

  const loadOlder = useCallback(async () => {
    const oldest = messagesRef.current.find((m) => !m.local_status);
    if (!oldest || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const page = await fetchMessages(supabase, conversationId, oldest.created_at);
      setMessages((prev) => page.reduce(upsert, prev));
      setHasMore(page.length === MESSAGES_PAGE_SIZE);
    } catch (err) {
      reportError(err, "Could not load earlier messages.");
    } finally {
      setLoadingOlder(false);
    }
  }, [supabase, conversationId, loadingOlder, reportError]);

  const deliver = useCallback(
    async (clientId: string, body: string, files: PendingFile[], replyTo: string | null) => {
      try {
        let uploaded = uploadedRef.current.get(clientId);
        if (!uploaded) {
          uploaded = [];
          for (const pending of files) {
            uploaded.push(await uploadAttachment(supabase, conversationId, access.user_id, pending));
          }
          uploadedRef.current.set(clientId, uploaded);
        }
        // Same client_id on retry → the server returns the existing message
        // instead of creating a duplicate.
        const saved = await sendMessageApi(supabase, {
          conversationId,
          clientId,
          body,
          attachments: uploaded,
          replyTo,
        });
        uploadedRef.current.delete(clientId);
        requestPushForMessage(saved.id);
        const full = (await fetchMessage(supabase, saved.id).catch(() => null)) ?? saved;
        setMessages((prev) => upsert(prev, full));
        refreshSoon();
      } catch (err) {
        setMessages((prev) =>
          prev.map((m) => (m.client_id === clientId && m.local_status ? { ...m, local_status: "failed" } : m)),
        );
        reportError(err, "Message not sent. Tap retry.");
      }
    },
    [supabase, conversationId, access.user_id, reportError, refreshSoon],
  );

  const send = useCallback(
    (body: string, files: PendingFile[] = [], replyTo: UiMessage | null = null) => {
      const clientId = crypto.randomUUID();
      const optimistic: UiMessage = {
        id: `local-${clientId}`,
        client_id: clientId,
        conversation_id: conversationId,
        sender_id: access.user_id,
        body: body.trim(),
        created_at: new Date().toISOString(),
        edited_at: null,
        deleted_at: null,
        reply_to_id: replyTo?.id ?? null,
        reply_to: replyTo
          ? {
              id: replyTo.id,
              body: replyTo.body,
              sender_id: replyTo.sender_id,
              deleted_at: replyTo.deleted_at,
              attachments: replyTo.attachments?.map((a) => ({ mime_type: a.mime_type })),
            }
          : null,
        system_event: null,
        attachments: [],
        message_reactions: [],
        local_status: "sending",
        local_files: files,
      };
      setMessages((prev) => sortMessages([...prev, optimistic]));
      void deliver(clientId, body, files, replyTo?.id ?? null);
    },
    [conversationId, access.user_id, deliver],
  );

  const retry = useCallback(
    (clientId: string) => {
      const msg = messagesRef.current.find((m) => m.client_id === clientId && m.local_status === "failed");
      if (!msg) return;
      setMessages((prev) => prev.map((m) => (m.client_id === clientId ? { ...m, local_status: "sending" } : m)));
      void deliver(clientId, msg.body, msg.local_files ?? [], msg.reply_to_id);
    },
    [deliver],
  );

  const discard = useCallback((clientId: string) => {
    uploadedRef.current.delete(clientId);
    setMessages((prev) => prev.filter((m) => !(m.client_id === clientId && m.local_status)));
  }, []);

  const edit = useCallback(
    async (id: string, body: string) => {
      try {
        const updated = await editMessageApi(supabase, id, body);
        setMessages((prev) => {
          const existing = prev.find((m) => m.id === id);
          return upsert(prev, { ...updated, attachments: existing?.attachments });
        });
        refreshSoon();
        return true;
      } catch (err) {
        reportError(err, "Could not edit message.");
        return false;
      }
    },
    [supabase, reportError, refreshSoon],
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        await deleteMessageApi(supabase, id);
        setMessages((prev) =>
          prev.map((m) => (m.id === id ? { ...m, body: "", deleted_at: new Date().toISOString(), attachments: [] } : m)),
        );
        refreshSoon();
      } catch (err) {
        reportError(err, "Could not delete message.");
      }
    },
    [supabase, reportError, refreshSoon],
  );

  const react = useCallback(
    async (messageId: string, emoji: string) => {
      const before = messagesRef.current.find((m) => m.id === messageId)?.message_reactions ?? [];
      const mine = before.find((r) => r.user_id === access.user_id)?.emoji ?? null;
      const next = mine === emoji ? null : emoji;
      const apply = (list: Reaction[] | undefined) => withReaction(list, { user_id: access.user_id, emoji: next });
      setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, message_reactions: apply(m.message_reactions) } : m)));
      try {
        await toggleReaction(supabase, messageId, emoji);
      } catch (err) {
        setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, message_reactions: before } : m)));
        reportError(err, "Could not react to the message.");
      }
    },
    [supabase, access.user_id, reportError],
  );

  return {
    messages,
    loading,
    loadingOlder,
    hasMore,
    error,
    loadOlder,
    send,
    retry,
    discard,
    edit,
    remove,
    react,
    markRead,
  };
}
