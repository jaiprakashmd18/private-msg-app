"use client";

import { Clock, Send, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/components/app-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cancelScheduledMessage, listScheduledMessages, scheduleMessage } from "@/lib/data/couple";
import { MAX_MESSAGE_LENGTH } from "@/lib/constants";
import type { ScheduledMessage } from "@/types/app";

const pad = (n: number) => String(n).padStart(2, "0");
/** Value for <input type="datetime-local"> in local time. */
const toLocalInput = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Next time the clock shows hh:mm (today if still ahead, else tomorrow). */
function nextAt(hour: number, minute = 0, now = new Date()): Date {
  const d = new Date(now);
  d.setHours(hour, minute, 0, 0);
  if (d.getTime() <= now.getTime() + 60_000) d.setDate(d.getDate() + 1);
  return d;
}

function describeWhen(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === today.toDateString()) return `Today, ${time}`;
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow, ${time}`;
  return d.toLocaleString(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

/** Write now, arrive later — e.g. "Good morning ☀️" at 7 am. */
export function LoveNotesDialog({
  conversationId,
  recipientName,
  open,
  onOpenChange,
}: {
  conversationId: string;
  recipientName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { supabase, reportError } = useApp();
  const [body, setBody] = useState("");
  const [when, setWhen] = useState(() => toLocalInput(nextAt(7)));
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<ScheduledMessage[] | null>(null);

  const load = useCallback(() => {
    listScheduledMessages(supabase, conversationId)
      .then(setPending)
      .catch(() => setPending([]));
  }, [supabase, conversationId]);
  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const presets = [
    { label: "Tomorrow 7 am", at: () => nextAt(7) },
    { label: "Tonight 9 pm", at: () => nextAt(21) },
    { label: "In 1 hour", at: () => new Date(Date.now() + 3_600_000) },
  ];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const at = new Date(when);
    if (!body.trim()) return toast.error("Write your note first");
    if (Number.isNaN(at.getTime()) || at.getTime() < Date.now() + 30_000) return toast.error("Pick a time in the future");
    setBusy(true);
    try {
      await scheduleMessage(supabase, conversationId, body, at);
      toast.success(`Scheduled for ${describeWhen(at.toISOString())}`);
      setBody("");
      load();
    } catch (err) {
      reportError(err, "Could not schedule the note.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="size-5" aria-hidden /> Love note for later
          </DialogTitle>
          <DialogDescription>
            Write it now; {recipientName} gets it at the time you choose. Only you can see it until then.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-3" noValidate>
          <Textarea
            aria-label="Note"
            placeholder="Good morning, sunshine ☀️"
            rows={3}
            maxLength={MAX_MESSAGE_LENGTH}
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <Button key={p.label} type="button" variant="outline" size="sm" onClick={() => setWhen(toLocalInput(p.at()))}>
                {p.label}
              </Button>
            ))}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="note-when">Send at</Label>
            <Input
              id="note-when"
              type="datetime-local"
              value={when}
              min={toLocalInput(new Date())}
              onChange={(e) => setWhen(e.target.value)}
            />
          </div>
          <Button type="submit" disabled={busy || !body.trim()}>
            {busy ? <Spinner /> : <Send />} Schedule
          </Button>
        </form>

        {pending && pending.length > 0 && (
          <div>
            <h3 className="mb-1 text-sm font-medium">Waiting to be sent</h3>
            <ul className="-mx-2 divide-y">
              {pending.map((n) => (
                <li key={n.id} className="flex items-start gap-3 px-2 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-medium text-primary">{describeWhen(n.send_at)}</span>
                    <span className="line-clamp-2 text-sm [overflow-wrap:anywhere]">{n.body}</span>
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Cancel this note"
                    onClick={async () => {
                      try {
                        await cancelScheduledMessage(supabase, n.id);
                        toast.success("Note cancelled");
                      } catch (err) {
                        reportError(err);
                      }
                      load();
                    }}
                  >
                    <X />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
