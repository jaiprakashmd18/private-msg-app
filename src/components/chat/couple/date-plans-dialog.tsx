"use client";

import { CalendarClock, MapPin, Pencil, Plus, Trash2 } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { deletePlan, savePlan } from "@/lib/data/couple";
import { formatPlanTime } from "@/lib/love";
import { cn } from "@/lib/utils";
import type { DatePlan } from "@/types/app";

const REMINDERS = [
  { minutes: 0, label: "No reminder" },
  { minutes: 15, label: "15 minutes before" },
  { minutes: 30, label: "30 minutes before" },
  { minutes: 60, label: "1 hour before" },
  { minutes: 120, label: "2 hours before" },
  { minutes: 1440, label: "1 day before" },
];

const pad = (n: number) => String(n).padStart(2, "0");
const toLocalInput = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

interface Draft {
  id: string | null;
  title: string;
  when: string;
  place: string;
  notes: string;
  remind: number;
}

function newDraft(): Draft {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(19, 0, 0, 0);
  return { id: null, title: "", when: toLocalInput(d), place: "", notes: "", remind: 60 };
}

export const mapsLink = (place: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place)}`;

/** Plan dates together: when, where, and a reminder for both of you. */
export function DatePlansDialog({
  conversationId,
  plans,
  open,
  onOpenChange,
  onChanged,
}: {
  conversationId: string;
  plans: DatePlan[] | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const { supabase, reportError } = useApp();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [now] = useState(() => Date.now());

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    const at = new Date(draft.when);
    if (!draft.title.trim()) return toast.error("Give your plan a name");
    if (Number.isNaN(at.getTime())) return toast.error("Pick a date and time");
    setSaving(true);
    try {
      await savePlan(supabase, {
        id: draft.id,
        conversationId,
        title: draft.title,
        startsAt: at,
        place: draft.place,
        notes: draft.notes,
        remindMinutes: draft.remind,
      });
      toast.success(draft.id ? "Plan updated" : "Plan added — you'll both get a reminder");
      setDraft(null);
      onChanged();
    } catch (err) {
      reportError(err, "Couldn't save the plan.");
    } finally {
      setSaving(false);
    }
  }

  const upcoming = (plans ?? []).filter((p) => new Date(p.starts_at).getTime() >= now - 3 * 3_600_000);
  const past = (plans ?? []).filter((p) => !upcoming.includes(p)).reverse();

  const item = (p: DatePlan, isPast: boolean) => (
    <li key={p.id} className={cn("flex items-start gap-3 px-2 py-2.5", isPast && "opacity-60")}>
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/10 text-center leading-none text-primary">
        <span className="text-[10px] font-semibold uppercase">
          {new Date(p.starts_at).toLocaleDateString(undefined, { month: "short" })}
        </span>
        <span className="text-base font-bold">{new Date(p.starts_at).getDate()}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium [overflow-wrap:anywhere]">{p.title}</span>
        <span className="block text-xs text-muted-foreground">{formatPlanTime(p.starts_at)}</span>
        {p.place && (
          <a
            href={mapsLink(p.place)}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 inline-flex items-center gap-1 text-xs text-primary underline-offset-2 hover:underline"
          >
            <MapPin className="size-3" aria-hidden /> {p.place}
          </a>
        )}
        {p.notes && <span className="mt-0.5 block whitespace-pre-wrap text-xs [overflow-wrap:anywhere]">{p.notes}</span>}
      </span>
      {!isPast && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Edit ${p.title}`}
          onClick={() =>
            setDraft({
              id: p.id,
              title: p.title,
              when: toLocalInput(new Date(p.starts_at)),
              place: p.place ?? "",
              notes: p.notes ?? "",
              remind: p.remind_minutes,
            })
          }
        >
          <Pencil />
        </Button>
      )}
      <ConfirmButton
        variant="ghost"
        size="icon-sm"
        aria-label={`Delete ${p.title}`}
        title={`Delete "${p.title}"?`}
        description="It's removed for both of you."
        confirmLabel="Delete"
        onConfirm={async () => {
          try {
            await deletePlan(supabase, p.id);
            onChanged();
          } catch (err) {
            reportError(err);
          }
        }}
      >
        <Trash2 />
      </ConfirmButton>
    </li>
  );

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
            <CalendarClock className="size-5" aria-hidden /> Date plans
          </DialogTitle>
          <DialogDescription>Plan your dates — you&apos;ll both get a reminder before.</DialogDescription>
        </DialogHeader>

        {draft ? (
          <form onSubmit={save} className="grid gap-3" noValidate>
            <div className="grid gap-2">
              <Label htmlFor="plan-title">What</Label>
              <Input
                id="plan-title"
                placeholder="e.g. Dinner at our favourite place"
                maxLength={80}
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                autoFocus
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="plan-when">When</Label>
              <Input id="plan-when" type="datetime-local" value={draft.when} onChange={(e) => setDraft({ ...draft, when: e.target.value })} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="plan-place">Where (optional)</Label>
              <Input
                id="plan-place"
                placeholder="e.g. Marina Beach, Chennai"
                maxLength={120}
                value={draft.place}
                onChange={(e) => setDraft({ ...draft, place: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="plan-notes">Notes (optional)</Label>
              <Textarea
                id="plan-notes"
                rows={2}
                maxLength={500}
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="plan-remind">Reminder</Label>
              <select
                id="plan-remind"
                value={draft.remind}
                onChange={(e) => setDraft({ ...draft, remind: Number(e.target.value) })}
                className="h-10 rounded-lg border border-input bg-background/40 px-3 text-base pointer-fine:text-sm"
              >
                {REMINDERS.map((r) => (
                  <option key={r.minutes} value={r.minutes}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={saving}>
                {saving && <Spinner />} {draft.id ? "Save" : "Add plan"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setDraft(null)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <>
            {plans === null ? (
              <Skeleton className="h-16 w-full" />
            ) : upcoming.length === 0 && past.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No plans yet — plan your next date!</p>
            ) : (
              <>
                {upcoming.length > 0 && <ul className="-mx-2 divide-y">{upcoming.map((p) => item(p, false))}</ul>}
                {past.length > 0 && (
                  <section>
                    <h3 className="mb-1 text-xs font-medium text-muted-foreground">Recent</h3>
                    <ul className="-mx-2 divide-y">{past.map((p) => item(p, true))}</ul>
                  </section>
                )}
              </>
            )}
            <Button variant="outline" onClick={() => setDraft(newDraft())}>
              <Plus /> Plan a date
            </Button>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
