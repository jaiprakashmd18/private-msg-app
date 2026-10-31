"use client";

import { MessageCircleHeart } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/components/app-provider";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { answerDailyQuestion, listDailyHistory } from "@/lib/data/couple";
import { localDateString } from "@/lib/dates";
import { questionIndexFor, questionText } from "@/lib/love";
import type { DailyAnswer } from "@/types/app";

/** Today's question under the chat header, with where you both are. */
export function DailyQuestionBar({
  answers,
  otherName,
  onOpen,
}: {
  answers: DailyAnswer[] | null;
  otherName: string;
  onOpen: () => void;
}) {
  const { access } = useApp();
  if (answers === null) return null;
  const mine = answers.some((a) => a.user_id === access.user_id);
  const theirs = answers.some((a) => a.user_id !== access.user_id);
  const status = !mine ? "Answer" : theirs ? "See answers ✨" : `Waiting for ${otherName}`;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-2 border-b bg-primary/5 px-4 py-1.5 text-left text-xs hover:bg-primary/10"
    >
      <MessageCircleHeart className="size-4 shrink-0 text-primary" aria-hidden />
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium">Today:</span> {questionText(questionIndexFor(localDateString()))}
      </span>
      <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">
        {status}
      </span>
    </button>
  );
}

export function DailyQuestionDialog({
  conversationId,
  answers,
  otherName,
  nameOf,
  open,
  onOpenChange,
  onAnswered,
}: {
  conversationId: string;
  answers: DailyAnswer[] | null;
  otherName: string;
  nameOf: (userId: string | null) => string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAnswered: () => void;
}) {
  const { supabase, access, reportError } = useApp();
  const today = localDateString();
  const index = questionIndexFor(today);
  const mine = answers?.find((a) => a.user_id === access.user_id);
  const others = (answers ?? []).filter((a) => a.user_id !== access.user_id);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<DailyAnswer[] | null>(null);

  useEffect(() => {
    if (!open) return;
    listDailyHistory(supabase, conversationId, today)
      .then(setHistory)
      .catch(() => setHistory([]));
  }, [open, supabase, conversationId, today]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      await answerDailyQuestion(supabase, conversationId, today, index, text);
      if (!mine) toast.success(others.length ? "Answered — here's theirs ✨" : `Answered! ${otherName} will be told.`);
      setEditing(false);
      setText("");
      onAnswered();
    } catch (err) {
      reportError(err, "Couldn't save your answer.");
    } finally {
      setBusy(false);
    }
  }

  // Past days where both answered, grouped by day.
  const past = new Map<string, DailyAnswer[]>();
  for (const a of history ?? []) past.set(a.day, [...(past.get(a.day) ?? []), a]);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setEditing(false);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircleHeart className="size-5" aria-hidden /> Question of the day
          </DialogTitle>
          <DialogDescription>You&apos;ll see each other&apos;s answer once you&apos;ve both answered.</DialogDescription>
        </DialogHeader>

        <p className="rounded-2xl bg-primary/10 p-4 text-center text-lg font-semibold leading-snug">{questionText(index)}</p>

        {!mine || editing ? (
          <form onSubmit={submit} className="grid gap-2">
            <Textarea
              aria-label="Your answer"
              placeholder="Your answer…"
              rows={3}
              maxLength={500}
              value={text}
              onChange={(e) => setText(e.target.value)}
              autoFocus
            />
            <Button type="submit" disabled={busy || !text.trim()}>
              {busy && <Spinner />} {mine ? "Save" : "Share my answer"}
            </Button>
          </form>
        ) : (
          <div className="grid gap-3">
            <AnswerCard who="You" text={mine.answer} />
            {others.length ? (
              others.map((o) => <AnswerCard key={o.id} who={nameOf(o.user_id)} text={o.answer} />)
            ) : (
              <p className="rounded-xl border border-dashed p-3 text-center text-sm text-muted-foreground">
                Waiting for {otherName}… we&apos;ve let them know 💌
              </p>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="justify-self-start"
              onClick={() => {
                setText(mine.answer);
                setEditing(true);
              }}
            >
              Edit my answer
            </Button>
          </div>
        )}

        {past.size > 0 && (
          <section>
            <h3 className="mb-2 text-sm font-medium">Earlier days</h3>
            <ul className="grid gap-3">
              {[...past.entries()].map(([day, list]) => (
                <li key={day} className="rounded-xl border p-3">
                  <p className="text-xs text-muted-foreground">
                    {new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                  </p>
                  <p className="mb-2 text-sm font-medium">{questionText(list[0]!.question_index)}</p>
                  {list.map((a) => (
                    <p key={a.id} className="text-sm [overflow-wrap:anywhere]">
                      <span className="font-semibold">{a.user_id === access.user_id ? "You" : nameOf(a.user_id)}:</span> {a.answer}
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          </section>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AnswerCard({ who, text }: { who: string; text: string }) {
  return (
    <div className="rounded-xl bg-muted p-3">
      <p className="text-xs font-semibold text-primary">{who}</p>
      <p className="mt-0.5 whitespace-pre-wrap [overflow-wrap:anywhere]">{text}</p>
    </div>
  );
}
