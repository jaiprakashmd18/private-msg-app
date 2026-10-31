"use client";

import { Smile } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/components/app-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { setMood } from "@/lib/data/couple";
import { MOODS } from "@/lib/love";
import { cn } from "@/lib/utils";
import type { MemberMood } from "@/types/app";

/** How are you feeling today? Shown to the other person for 24 hours. */
export function MoodDialog({
  conversationId,
  current,
  otherName,
  open,
  onOpenChange,
  onChanged,
}: {
  conversationId: string;
  current: MemberMood | undefined;
  otherName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const { supabase, reportError } = useApp();
  const [mood, setMoodChoice] = useState<string | null>(current?.mood ?? null);
  const [note, setNote] = useState(current?.mood_note ?? "");
  const [busy, setBusy] = useState(false);

  async function save(next: string | null) {
    setBusy(true);
    try {
      await setMood(supabase, conversationId, next, note);
      toast.success(next ? `${otherName} can see how you feel` : "Mood cleared");
      onChanged();
      onOpenChange(false);
    } catch (err) {
      reportError(err, "Couldn't update your mood.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Smile className="size-5" aria-hidden /> How are you feeling?
          </DialogTitle>
          <DialogDescription>{otherName} sees it at the top of your chat for 24 hours.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Mood">
          {MOODS.map((m) => (
            <button
              key={m.emoji}
              type="button"
              role="radio"
              aria-checked={mood === m.emoji}
              onClick={() => setMoodChoice(m.emoji)}
              className={cn(
                "flex flex-col items-center gap-1 rounded-xl border px-1 py-2 text-xs transition-colors hover:bg-accent",
                mood === m.emoji && "border-primary bg-primary/10",
              )}
            >
              <span className="text-2xl" aria-hidden>
                {m.emoji}
              </span>
              {m.label}
            </button>
          ))}
        </div>
        <Input
          aria-label="Add a note (optional)"
          placeholder="Add a note (optional)"
          maxLength={80}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy || !mood} onClick={() => void save(mood)}>
            {busy && <Spinner />} Share my mood
          </Button>
          {current && (
            <Button variant="ghost" disabled={busy} onClick={() => void save(null)}>
              Clear
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
