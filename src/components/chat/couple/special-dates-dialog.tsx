"use client";

import { CalendarHeart, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/components/app-provider";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { deleteSpecialDate, saveSpecialDate } from "@/lib/data/couple";
import { daysTogether, describeCountdown, localDateString, nextOccurrence } from "@/lib/dates";
import type { SpecialDate, SpecialDateKind } from "@/types/app";

const KINDS: { value: SpecialDateKind; label: string; emoji: string }[] = [
  { value: "together", label: "Together since", emoji: "❤️" },
  { value: "meet", label: "Next meet", emoji: "💞" },
  { value: "anniversary", label: "Anniversary", emoji: "💍" },
  { value: "birthday", label: "Birthday", emoji: "🎂" },
  { value: "other", label: "Other", emoji: "⭐" },
];

export const kindEmoji = (kind: SpecialDateKind) => KINDS.find((k) => k.value === kind)?.emoji ?? "⭐";

function formatDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y!, m! - 1, d!).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

interface Draft {
  id: string | null;
  kind: SpecialDateKind;
  title: string;
  onDate: string;
  yearly: boolean;
  remind: boolean;
}

/** Anniversary, birthdays and other dates, with countdowns and reminders. */
export function SpecialDatesDialog({
  conversationId,
  dates,
  open,
  onOpenChange,
  onChanged,
}: {
  conversationId: string;
  dates: SpecialDate[] | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const { supabase, reportError } = useApp();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const hasTogether = (dates ?? []).some((d) => d.kind === "together");

  function startNew() {
    setDraft({ id: null, kind: hasTogether ? "birthday" : "together", title: "", onDate: localDateString(), yearly: true, remind: true });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    setSaving(true);
    try {
      await saveSpecialDate(supabase, { ...draft, conversationId });
      toast.success("Saved");
      setDraft(null);
      onChanged();
    } catch (err) {
      reportError(err, "Could not save the date.");
    } finally {
      setSaving(false);
    }
  }

  const sorted = [...(dates ?? [])]
    .map((d) => ({ d, next: nextOccurrence(d) }))
    .sort((a, b) => (a.d.kind === "together" ? -1 : b.d.kind === "together" ? 1 : (a.next?.daysUntil ?? 1e9) - (b.next?.daysUntil ?? 1e9)));

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setDraft(null);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarHeart className="size-5" aria-hidden /> Special dates
          </DialogTitle>
          <DialogDescription>
            Countdowns for you both, and a little celebration in the chat on the day (from 8 am).
          </DialogDescription>
        </DialogHeader>

        {draft ? (
          <form onSubmit={save} className="grid gap-4" noValidate>
            <fieldset className="grid gap-2">
              <legend className="mb-2 text-sm font-medium">What is it?</legend>
              <div className="grid grid-cols-2 gap-2">
                {KINDS.map((k) => {
                  const taken = k.value === "together" && hasTogether && draft.kind !== "together";
                  return (
                    <label
                      key={k.value}
                      className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/10 ${taken ? "pointer-events-none opacity-40" : ""}`}
                    >
                      <input
                        type="radio"
                        name="kind"
                        value={k.value}
                        checked={draft.kind === k.value}
                        disabled={taken}
                        onChange={() => setDraft({ ...draft, kind: k.value })}
                        className="sr-only"
                      />
                      <span aria-hidden>{k.emoji}</span> {k.label}
                    </label>
                  );
                })}
              </div>
            </fieldset>
            {draft.kind !== "together" && (
              <div className="grid gap-2">
                <Label htmlFor="date-title">Name</Label>
                <Input
                  id="date-title"
                  value={draft.title}
                  maxLength={60}
                  placeholder={
                    draft.kind === "birthday"
                      ? "e.g. Priya's birthday"
                      : draft.kind === "anniversary"
                        ? "e.g. Wedding anniversary"
                        : draft.kind === "meet"
                          ? "Optional, e.g. Chennai trip"
                          : "e.g. Trip to Goa"
                  }
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                />
              </div>
            )}
            <div className="grid gap-2">
              <Label htmlFor="date-on">
                {draft.kind === "together" ? "The day you got together" : draft.kind === "meet" ? "The day you meet" : "Date"}
              </Label>
              <Input
                id="date-on"
                type="date"
                required
                value={draft.onDate}
                onChange={(e) => setDraft({ ...draft, onDate: e.target.value })}
              />
            </div>
            {draft.kind === "other" && (
              <label className="flex items-center justify-between gap-4 text-sm">
                Every year
                <Switch checked={draft.yearly} onCheckedChange={(v) => setDraft({ ...draft, yearly: v })} />
              </label>
            )}
            <label className="flex items-center justify-between gap-4 text-sm">
              Celebrate in the chat on the day
              <Switch checked={draft.remind} onCheckedChange={(v) => setDraft({ ...draft, remind: v })} />
            </label>
            <div className="flex gap-2">
              <Button type="submit" disabled={saving || !draft.onDate}>
                {saving && <Spinner />} Save
              </Button>
              <Button type="button" variant="ghost" onClick={() => setDraft(null)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <>
            {dates === null ? (
              <Skeleton className="h-16 w-full" />
            ) : sorted.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">
                Add the day you got together to see your day counter.
              </p>
            ) : (
              <ul className="-mx-2 divide-y">
                {sorted.map(({ d, next }) => (
                  <li key={d.id} className="flex items-center gap-3 px-2 py-2.5">
                    <span className="text-2xl" aria-hidden>
                      {kindEmoji(d.kind)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{d.kind === "together" ? "Together since" : d.title}</span>
                      <span className="block text-xs text-muted-foreground">
                        {formatDate(d.on_date)}
                        {d.kind === "together"
                          ? ` · Day ${daysTogether(d.on_date).toLocaleString()}`
                          : next
                            ? ` · ${describeCountdown(next.daysUntil)}${d.kind !== "other" && d.kind !== "meet" && next.years > 0 ? ` · ${next.years} year${next.years === 1 ? "" : "s"}` : ""}`
                            : " · passed"}
                      </span>
                    </span>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Edit ${d.title}`}
                      onClick={() =>
                        setDraft({ id: d.id, kind: d.kind, title: d.title, onDate: d.on_date, yearly: d.yearly, remind: d.remind })
                      }
                    >
                      <Pencil />
                    </Button>
                    <ConfirmButton
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Delete ${d.title}`}
                      title={`Delete "${d.kind === "together" ? "Together since" : d.title}"?`}
                      description="It's removed for both of you."
                      confirmLabel="Delete"
                      onConfirm={async () => {
                        try {
                          await deleteSpecialDate(supabase, d.id);
                          onChanged();
                        } catch (err) {
                          reportError(err);
                        }
                      }}
                    >
                      <Trash2 />
                    </ConfirmButton>
                  </li>
                ))}
              </ul>
            )}
            <Button variant="outline" onClick={startNew}>
              <Plus /> Add a date
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
