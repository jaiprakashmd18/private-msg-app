"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/components/app-provider";
import { useChat } from "@/components/chat/chat-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type IncomingRequest = { id: string; sender_name: string };

export function MessageRequests({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { access, supabase, reportError } = useApp();
  const { refresh } = useChat();
  const router = useRouter();
  const [rows, setRows] = useState<IncomingRequest[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc("incoming_direct_requests");
    setFailed(Boolean(error));
    setRows((data ?? []) as IncomingRequest[]);
  }, [supabase]);

  useEffect(() => {
    if (!open) return;
    const reload = () => { void load(); };
    const channel = supabase.channel(`incoming-dm:${access.user_id}`).on("postgres_changes", {
      event: "*", schema: "public", table: "direct_message_requests", filter: `recipient_id=eq.${access.user_id}`,
    }, reload).subscribe();
    reload();
    window.addEventListener("focus", reload);
    return () => {
      window.removeEventListener("focus", reload);
      void supabase.removeChannel(channel);
    };
  }, [access.user_id, load, open, supabase]);

  async function respond(id: string, accepted: boolean) {
    setBusy(id);
    try {
      const { data, error } = await supabase.rpc("respond_to_direct_request", { p_request: id, p_accept: accepted });
      if (error) throw error;
      await load();
      if (accepted && data) {
        await refresh();
        onOpenChange(false);
        router.push(`/chat/${data}`);
      }
    } catch (error) {
      reportError(error, "Could not update this message request.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Message requests</DialogTitle>
          <DialogDescription>Accept a request to start a private chat with that person.</DialogDescription>
        </DialogHeader>
        {failed ? <Button variant="outline" onClick={() => void load()}>Could not load requests. Try again</Button> :
          rows === null ? <p role="status">Loading requests…</p> :
          rows.length === 0 ? <p className="text-sm text-muted-foreground">No pending requests.</p> :
          <ul className="grid gap-2">
            {rows.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center gap-2 rounded-xl border p-3">
                <span className="min-w-0 flex-1 break-words font-medium">{row.sender_name}</span>
                <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void respond(row.id, false)}>Decline</Button>
                <Button size="sm" disabled={busy !== null} onClick={() => void respond(row.id, true)}>Accept</Button>
              </li>
            ))}
          </ul>}
      </DialogContent>
    </Dialog>
  );
}
