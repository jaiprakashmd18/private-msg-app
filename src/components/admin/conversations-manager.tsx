"use client";

import { Eye, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/components/app-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { adminRequest } from "@/lib/admin-client";
import { displayNameOf, formatDateTime } from "@/lib/format";
import type { AdminConversation, Message } from "@/types/app";

export function ConversationsManager({
  conversations,
  canReadMessages,
}: {
  conversations: AdminConversation[];
  canReadMessages: boolean;
}) {
  const { supabase, reportError } = useApp();
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [viewing, setViewing] = useState<AdminConversation | null>(null);
  const [viewMessages, setViewMessages] = useState<Message[] | null>(null);

  async function remove(id: string) {
    setBusyId(id);
    try {
      await adminRequest(`/api/admin/conversations/${id}`, "DELETE");
      toast.success("Conversation deleted");
      router.refresh();
    } catch (err) {
      reportError(err);
    } finally {
      setBusyId(null);
    }
  }

  async function view(c: AdminConversation) {
    setViewing(c);
    setViewMessages(null);
    const { data, error } = await supabase.rpc("admin_read_conversation_messages", {
      p_conversation_id: c.id,
      p_limit: 200,
    });
    if (error) {
      setViewing(null);
      reportError(error);
      return;
    }
    setViewMessages(((data ?? []) as Message[]).reverse());
  }

  const names = (c: AdminConversation) =>
    c.members.map((m) => displayNameOf(m.display_name, m.email)).join(" ↔ ") || "Deleted users";

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Conversations</h1>
        <p className="text-sm text-muted-foreground">
          Metadata only.{" "}
          {canReadMessages
            ? "Message access is ENABLED by policy — every view is recorded in the audit log."
            : "Administrator access to message content is disabled by policy."}
        </p>
      </div>
      <Card>
        <CardContent className="p-0">
          {conversations.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">No conversations yet.</p>
          ) : (
            <ul className="divide-y">
              {conversations.map((c) => (
                <li key={c.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{names(c)}</p>
                    <p className="text-xs text-muted-foreground">
                      {c.message_count} messages · {c.attachment_count} attachments · last activity{" "}
                      {formatDateTime(c.last_message_at ?? c.created_at)}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    {busyId === c.id && <Spinner />}
                    {canReadMessages && (
                      <ConfirmButton
                        size="sm"
                        variant="outline"
                        destructive={false}
                        title="View message content?"
                        description="This access will be recorded in the audit log with your identity and the conversation."
                        confirmLabel="View (audited)"
                        onConfirm={() => view(c)}
                      >
                        <Eye /> View
                      </ConfirmButton>
                    )}
                    <ConfirmButton
                      size="sm"
                      variant="destructive"
                      disabled={busyId === c.id}
                      title="Delete this conversation?"
                      description="All messages and files in it are permanently deleted for both members. This cannot be undone."
                      confirmLabel="Delete conversation"
                      onConfirm={() => remove(c.id)}
                    >
                      <Trash2 /> Delete
                    </ConfirmButton>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={viewing !== null} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="flex max-w-2xl flex-col">
          <DialogHeader>
            <DialogTitle>{viewing ? names(viewing) : ""}</DialogTitle>
            <DialogDescription>Most recent 200 messages. This view has been logged.</DialogDescription>
          </DialogHeader>
          <div className="min-h-24 overflow-y-auto">
            {viewMessages === null ? (
              <div className="flex justify-center py-6">
                <Spinner />
              </div>
            ) : viewMessages.length === 0 ? (
              <p className="text-sm text-muted-foreground">No messages.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {viewMessages.map((m) => {
                  const sender = viewing?.members.find((x) => x.user_id === m.sender_id);
                  return (
                    <li key={m.id} className="rounded-lg bg-muted p-2.5">
                      <p className="text-xs text-muted-foreground">
                        {displayNameOf(sender?.display_name, sender?.email)} · {formatDateTime(m.created_at)}
                      </p>
                      <p className="whitespace-pre-wrap break-words">
                        {m.deleted_at ? <em className="text-muted-foreground">Deleted</em> : m.body || <em>Attachment</em>}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <Button variant="outline" onClick={() => setViewing(null)}>
            Close
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
