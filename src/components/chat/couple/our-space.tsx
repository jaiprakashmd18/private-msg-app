"use client";

import { ArrowLeft, CalendarHeart, Heart } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useApp } from "@/components/app-provider";
import { useChat } from "@/components/chat/chat-provider";
import { conversationName } from "@/components/chat/conversation-list";
import { SongCard } from "@/components/chat/song-card";
import { VoicePlayer } from "@/components/chat/voice-player";
import { parseSongLink } from "@/lib/chat-experience";
import { SharedListDialog, type ListTab } from "@/components/chat/couple/shared-list-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSignedUrl } from "@/hooks/use-signed-url";
import { ATTACHMENTS_BUCKET } from "@/lib/constants";
import { listMemories, listPlans, listSpecialDates } from "@/lib/data/couple";
import { daysTogether, nextOccurrence } from "@/lib/dates";
import { formatDateTime } from "@/lib/format";
import type { Attachment, DatePlan, SpecialDate } from "@/types/app";

type Letter = { id: string; title: string; body: string | null; mine: boolean; opened_at: string | null };
type Memory = { id: string; body: string; caption: string; pinned: boolean; saved_at: string };

function MemoryMedia({ file }: { file?: Attachment }) {
  const audio = file?.mime_type.startsWith("audio/");
  const { url } = useSignedUrl(ATTACHMENTS_BUCKET, audio ? file?.storage_path : file?.thumb_path ?? file?.storage_path);
  if (!file) return null;
  if (audio) return <VoicePlayer src={url} durationMs={file.duration_ms} mine={false} />;
  if (!url) return null;
  // eslint-disable-next-line @next/next/no-img-element -- private signed media
  return <img src={url} alt={file.file_name} loading="lazy" className="aspect-[4/3] w-full rounded-xl object-cover" />;
}

export function OurSpace({ conversationId }: { conversationId: string }) {
  const { supabase, reportError, access: member } = useApp();
  const { getConversation, loading } = useChat();
  const conversation = getConversation(conversationId);
  const allowed = conversation?.kind === "direct";
  const chatHref = `/chat/${conversationId}`;
  const [dates, setDates] = useState<SpecialDate[]>([]);
  const [plans, setPlans] = useState<DatePlan[]>([]);
  const [photos, setPhotos] = useState<Attachment[]>([]);
  const [coverId, setCoverId] = useState<string | null>(null);
  const [month, setMonth] = useState("");
  const [now] = useState(() => new Date());
  const [plus, setPlus] = useState<boolean | null>(null);
  const [letters, setLetters] = useState<Letter[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [memoryMedia, setMemoryMedia] = useState<Record<string, Attachment>>({});
  const [letterDraft, setLetterDraft] = useState({ id: "", title: "", body: "" });
  const [listOpen, setListOpen] = useState(false);
  const [listTab, setListTab] = useState<ListTab>("bucket");
  const [busy, setBusy] = useState(false);
  const photo = photos.find((item) => item.id === coverId) ?? photos[0];
  const { url: coverUrl } = useSignedUrl(ATTACHMENTS_BUCKET, photo?.thumb_path ?? photo?.storage_path ?? null);

  const load = useCallback(async () => {
    const access = await supabase.rpc("conversation_is_plus", { p_conversation_id: conversationId });
    if (access.error) throw access.error;
    setPlus(access.data === true);
    const [photoResult, cover] = await Promise.all([
      listMemories(supabase, conversationId),
      supabase.rpc("couple_cover", { p_chat: conversationId }),
    ]);
    const selected = cover.data as string | null;
    let photoOptions = photoResult.photos;
    if (selected && !photoOptions.some((item) => item.id === selected)) {
      const { data } = await supabase.from("attachments").select("*").eq("id", selected)
        .eq("conversation_id", conversationId).eq("view_once", false).maybeSingle<Attachment>();
      if (data) photoOptions = [data, ...photoOptions];
    }
    setPhotos(photoOptions);
    setCoverId(selected);
    if (!access.data) return;
    const [nextDates, nextPlans, letterRows, memoryRows] = await Promise.all([
      listSpecialDates(supabase, conversationId), listPlans(supabase, conversationId),
      supabase.rpc("open_when_letters", { p_chat: conversationId }),
      supabase.rpc("couple_memories", { p_chat: conversationId }),
    ]);
    setDates(nextDates);
    setPlans(nextPlans);
    if (letterRows.error || memoryRows.error) throw letterRows.error ?? memoryRows.error;
    setLetters((letterRows.data ?? []) as Letter[]);
    const saved = (memoryRows.data ?? []) as Memory[];
    const files: Attachment[] = [];
    for (let i = 0; i < saved.length; i += 80) {
      const { data } = await supabase.from("attachments").select("*").eq("conversation_id", conversationId)
        .eq("view_once", false).in("message_id", saved.slice(i, i + 80).map((item) => item.id))
        .order("created_at");
      files.push(...((data ?? []) as Attachment[]));
    }
    const byMessage: Record<string, Attachment> = {};
    for (const file of files) {
      if ((file.mime_type.startsWith("image/") || file.mime_type.startsWith("audio/")) && !byMessage[file.message_id]) {
        byMessage[file.message_id] = file;
      }
    }
    setMemoryMedia(byMessage);
    setMemories(saved);
  }, [conversationId, supabase]);

  useEffect(() => {
    if (!allowed) return;
    const refresh = () => {
      void load().catch((error) => reportError(error, "Could not load all of Our Space."));
    };
    const timer = window.setTimeout(refresh, 0);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [allowed, load, reportError]);

  async function run(name: string, args: Record<string, unknown>) {
    setBusy(true);
    try {
      const { error } = await supabase.rpc(name, { ...args, p_chat: conversationId });
      if (error) throw error;
      await load();
      return true;
    } catch (error) {
      reportError(error, "Could not save this change.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function saveLetter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await run("save_open_when_letter", {
      p_title: letterDraft.title, p_body: letterDraft.body, p_id: letterDraft.id || null,
    })) setLetterDraft({ id: "", title: "", body: "" });
  }

  const together = dates.find((date) => date.kind === "together");
  const anniversary = together && nextOccurrence({ on_date: together.on_date, yearly: true }, now);
  const nextPlan = plans.find((plan) => Date.parse(plan.starts_at) >= now.getTime());

  const timeline = [...memories].sort((a, b) => b.saved_at.localeCompare(a.saved_at));
  const pinned = memories.filter((memory) => memory.pinned);
  const songs = timeline.flatMap((memory) => {
    const song = parseSongLink(memory.body);
    return song ? [{ id: memory.id, song }] : [];
  });

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-grouped px-4 pb-safe pt-[max(1rem,env(safe-area-inset-top))] sm:px-8">
      <div className="mx-auto grid max-w-3xl gap-5">
        <Button asChild variant="ghost" className="w-fit"><Link href={chatHref}><ArrowLeft /> Back to chat</Link></Button>
        {!allowed ? <p>{loading ? "Loading conversation…" : "Our Space is available in one-to-one chats."}</p> : (
          <>
            <header className="relative isolate -mx-4 flex min-h-64 flex-col justify-end overflow-hidden bg-[#351222] p-6 text-white sm:mx-0 sm:min-h-80 sm:rounded-3xl sm:p-10">
              {/* eslint-disable-next-line @next/next/no-img-element -- private signed media */}
              {coverUrl && <img src={coverUrl} alt="" className="absolute inset-0 -z-20 size-full object-cover" />}
              <div className="absolute inset-0 -z-10 bg-linear-to-t from-[#170811] via-[#170811]/75 to-[#170811]/15" aria-hidden />
              <Heart className="mb-4 size-7 fill-rose-300 text-rose-300" aria-hidden />
              <h1 className="text-4xl font-semibold tracking-tight">Our Space</h1>
              <p className="mt-2">{conversationName(conversation)}</p>
              {together && <p className="mt-2 text-rose-200">{daysTogether(together.on_date, now)} days together</p>}
              {anniversary && <p className="text-rose-200">Anniversary in {anniversary.daysUntil} days</p>}

            </header>
            {nextPlan && (
              <section className="flex items-start gap-3 rounded-2xl border bg-card p-4">
                <CalendarHeart className="mt-1 size-5 shrink-0 text-primary" aria-hidden />
                <div className="min-w-0">
                  <h2 className="text-sm text-muted-foreground">Next date</h2>
                  <p className="break-words text-xl font-semibold">{nextPlan.title}</p>
                  <p className="text-sm">{formatDateTime(nextPlan.starts_at)}</p>
                </div>
              </section>
            )}
            {pinned.length > 0 && (
              <section className="grid gap-3">
                <h2 className="text-xl font-semibold">Pinned memories</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {pinned.map((memory) => (
                    <article key={memory.id} className="grid min-w-0 gap-2 rounded-2xl border bg-card p-3">
                      <MemoryMedia file={memoryMedia[memory.id]} />
                      <Link className="line-clamp-2 break-words font-medium text-primary" href={`${chatHref}?m=${memory.id}`}>
                        {memory.caption || memory.body || "Open pinned memory"}
                      </Link>
                    </article>
                  ))}
                </div>
              </section>
            )}
            {photos.length > 1 && <label className="grid gap-1 text-sm">
              Cover photo
              <select className="rounded-xl border bg-card p-2" value={photo?.id ?? ""} disabled={busy} onChange={(event) =>
                void run("couple_cover", { p_attachment: event.target.value })}>
                {photos.map((item, index) => <option key={item.id} value={item.id}>{index + 1}. {item.file_name}</option>)}
              </select>
            </label>}
            <nav className="flex flex-wrap gap-2" aria-label="Couple tools">
              <Button asChild variant="outline"><Link href={`${chatHref}/memories`}>Shared photos</Link></Button>
              {plus && <><Button asChild variant="outline"><Link href={`${chatHref}/journal`}>Journal</Link></Button>
              <Button variant="outline" onClick={() => setListOpen(true)}>Bucket list</Button></>}
            </nav>
            {plus === false && <p className="text-sm text-muted-foreground">Open When letters and saved memories are included with <Link className="underline" href="/settings">Loveline Plus</Link>.</p>}
            {plus && <>
              <section className="grid gap-3 rounded-3xl border bg-card p-5">
                <h2 className="text-xl font-semibold">Open When letters</h2>
                <form onSubmit={saveLetter} className="grid gap-2">
                  <Input required aria-label="Letter title" maxLength={120} value={letterDraft.title} onChange={(e) => setLetterDraft({ ...letterDraft, title: e.target.value })} placeholder="Open when you miss me" />
                  <textarea required aria-label="Letter text" maxLength={4000} rows={3} value={letterDraft.body} onChange={(e) => setLetterDraft({ ...letterDraft, body: e.target.value })} className="rounded-xl border bg-background p-3" />
                  <div className="flex gap-2">
                    <Button disabled={busy}>{letterDraft.id ? "Save changes" : "Seal letter"}</Button>
                    {letterDraft.id && <Button type="button" variant="ghost" onClick={() => setLetterDraft({ id: "", title: "", body: "" })}>Cancel edit</Button>}
                  </div>
                </form>
                {letters.map((letter) => (
                  <article key={letter.id} className="grid gap-2 rounded-2xl border p-3">
                    <h3 className="break-words font-medium">{letter.title}</h3>
                    {letter.body !== null && <p className="whitespace-pre-wrap break-words text-sm">{letter.body}</p>}
                    {letter.opened_at ? <p className="text-xs text-muted-foreground">Opened {formatDateTime(letter.opened_at)}</p> :
                      <div className="flex flex-wrap gap-2">
                        {letter.mine ? <>
                          <Button size="sm" variant="outline" onClick={() => setLetterDraft({ id: letter.id, title: letter.title, body: letter.body ?? "" })}>Edit</Button>
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run("act_on_open_when_letter", { p_id: letter.id, p_action: "withdraw" })}>Withdraw</Button>
                        </> : <Button size="sm" disabled={busy} onClick={() => void run("act_on_open_when_letter", { p_id: letter.id, p_action: "open" })}>Open letter</Button>}
                      </div>}
                  </article>
                ))}
              </section>
              {songs.length > 0 && (
                <section className="grid gap-3 rounded-3xl border bg-card p-5">
                  <h2 className="text-xl font-semibold">Our songs</h2>
                  {songs.map(({ id, song }) => <SongCard key={id} song={song} />)}
                </section>
              )}
              <section className="grid gap-3 rounded-3xl border bg-card p-5">
                <h2 className="text-xl font-semibold">Memory timeline</h2>
                {memories.length === 0 && <p className="text-sm text-muted-foreground">Open a message’s menu and choose Save to Memories.</p>}
                {memories.length > 0 && <label className="grid gap-1 text-sm">Browse by month
                  <select className="rounded-xl border bg-background p-2" value={month} onChange={(event) => setMonth(event.target.value)}>
                    <option value="">All months</option>
                    {[...new Set(memories.map((memory) => memory.saved_at.slice(0, 7)))].sort().reverse().map((value) =>
                      <option key={value} value={value}>{value}</option>)}
                  </select>
                </label>}
                {timeline.filter((memory) => !month || memory.saved_at.startsWith(month)).map((memory) => <article key={memory.id} className="grid gap-2 rounded-2xl border p-3">
                  <p className="text-xs text-muted-foreground">{new Date(memory.saved_at).toLocaleDateString(undefined, { month: "long", year: "numeric" })}{memory.pinned ? " · Pinned" : ""}</p>
                  <MemoryMedia file={memoryMedia[memory.id]} />
                  <Link className="line-clamp-3 break-words text-primary underline" href={`${chatHref}?m=${memory.id}`}>{memory.body || "Open media in chat"}</Link>
                  <form key={memory.caption + memory.pinned} className="grid gap-2" onSubmit={(e) => {
                    e.preventDefault();
                    const form = new FormData(e.currentTarget);
                    void run("set_couple_memory", { p_message: memory.id, p_action: "edit", p_caption: form.get("caption"), p_pinned: form.has("pinned") });
                  }}>
                    <Input name="caption" aria-label="Memory caption" placeholder="Add a caption" defaultValue={memory.caption} maxLength={200} />
                    <label className="flex items-center gap-2 text-sm"><input name="pinned" type="checkbox" defaultChecked={memory.pinned} /> Pin memory</label>
                    <div className="flex gap-2"><Button size="sm" variant="outline" disabled={busy}>Save details</Button>
                    <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => void run("set_couple_memory", { p_message: memory.id, p_action: "remove" })}>Remove</Button></div>
                  </form>
                </article>)}
              </section>
            </>}
          </>
        )}
        {listOpen && <SharedListDialog conversationId={conversationId} open={listOpen} onOpenChange={setListOpen} tab={listTab} onTabChange={setListTab} nameOf={(id) => id === member.user_id ? "You" : conversation ? conversationName(conversation) : "Partner"} />}
      </div>
    </div>
  );
}
