"use client";

import { Camera, Mic, Paperclip, Reply, SendHorizontal, Smile, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { StickerPanel } from "@/components/chat/sticker-panel";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useVoiceRecorder } from "@/hooks/use-voice-recorder";
import { ALLOWED_ATTACHMENT_TYPES, MAX_ATTACHMENTS_PER_MESSAGE, MAX_MESSAGE_LENGTH, MAX_VOICE_NOTE_MS } from "@/lib/constants";
import { formatBytes } from "@/lib/format";
import { formatDuration, isImage, isVideo, prepareImage, prepareVideo } from "@/lib/media";
import type { StickerPayload } from "@/lib/data/couple";
import { validateAttachment } from "@/lib/validation";
import { cn } from "@/lib/utils";
import type { PendingFile } from "@/types/app";

export interface EditingState {
  id: string;
  body: string;
}

export interface ReplyingState {
  id: string;
  author: string;
  text: string;
}

export function Composer({
  disabled,
  disabledReason,
  attachmentsEnabled,
  allowViewOnce = false,
  editing,
  replyingTo,
  onSend,
  onSendSticker,
  onSaveEdit,
  onCancelEdit,
  onCancelReply,
  onTyping,
}: {
  disabled: boolean;
  disabledReason?: string;
  attachmentsEnabled: boolean;
  /** One-to-one chats: a single photo can be sent as view-once. */
  allowViewOnce?: boolean;
  editing: EditingState | null;
  replyingTo: ReplyingState | null;
  onSend: (body: string, files: PendingFile[]) => void;
  onSendSticker?: (payload: StickerPayload) => void;
  onSaveEdit: (id: string, body: string) => Promise<boolean>;
  onCancelEdit: () => void;
  onCancelReply: () => void;
  onTyping: () => void;
}) {
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [saving, setSaving] = useState(false);
  const [preparing, setPreparing] = useState(0);
  const [stickersOpen, setStickersOpen] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const sendVoiceRef = useRef<() => void>(() => undefined);
  const recorder = useVoiceRecorder(useCallback(() => sendVoiceRef.current(), []));

  // Load the message into the input when editing starts (state adjusted
  // during render, as recommended over an effect).
  const [prevEditing, setPrevEditing] = useState(editing);
  if (editing !== prevEditing) {
    setPrevEditing(editing);
    if (editing) setBody(editing.body);
  }

  useEffect(() => {
    if (editing || replyingTo) {
      requestAnimationFrame(() => {
        const el = textRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      });
    }
  }, [editing, replyingTo]);

  // Auto-grow up to ~8 lines.
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [body]);

  const trimmed = body.trim();
  const tooLong = body.length > MAX_MESSAGE_LENGTH;
  const canSubmit =
    !disabled && !saving && preparing === 0 && !tooLong && (trimmed.length > 0 || (!editing && files.length > 0));
  const showMic = attachmentsEnabled && !editing && trimmed.length === 0 && files.length === 0;

  async function submit() {
    if (!canSubmit) return;
    if (editing) {
      setSaving(true);
      const ok = await onSaveEdit(editing.id, body);
      setSaving(false);
      if (ok) {
        setBody("");
        onCancelEdit();
      }
      return;
    }
    onSend(body, files);
    setBody("");
    setFiles([]);
    textRef.current?.focus();
  }

  async function addFiles(list: FileList | null) {
    if (!list) return;
    const incoming = Array.from(list);
    const room = MAX_ATTACHMENTS_PER_MESSAGE - files.length;
    if (incoming.length > room) toast.error(`At most ${MAX_ATTACHMENTS_PER_MESSAGE} files per message`);
    const accepted: File[] = [];
    for (const file of incoming.slice(0, Math.max(room, 0))) {
      const problem = validateAttachment(file);
      if (problem) toast.error(`${file.name}: ${problem}`);
      else accepted.push(file);
    }
    if (fileRef.current) fileRef.current.value = "";
    if (cameraRef.current) cameraRef.current.value = "";
    setPreparing((n) => n + accepted.length);
    for (const file of accepted) {
      const pending = isImage(file.type)
        ? await prepareImage(file).catch(() => ({ file }))
        : isVideo(file.type)
          ? await prepareVideo(file)
          : { file };
      setFiles((prev) => [...prev, pending]);
      setPreparing((n) => n - 1);
    }
  }

  function removeFile(i: number) {
    setFiles((prev) => {
      const f = prev[i];
      if (f?.previewUrl) URL.revokeObjectURL(f.previewUrl);
      return prev.filter((_, j) => j !== i);
    });
  }

  async function startRecording() {
    try {
      await recorder.start();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not start recording.");
    }
  }

  async function sendVoice() {
    const voice = await recorder.stop();
    if (!voice) return;
    if (voice.durationMs !== undefined && voice.durationMs < 700) {
      toast.message("Hold on a little longer — that recording was too short.");
      return;
    }
    onSend("", [voice]);
  }
  useEffect(() => {
    sendVoiceRef.current = () => void sendVoice();
  });

  if (disabled && disabledReason) {
    return (
      <div className="pb-safe border-t px-4 pt-4 text-center text-sm text-muted-foreground">
        {disabledReason}
      </div>
    );
  }

  if (recorder.state === "recording") {
    const nearLimit = recorder.elapsed > MAX_VOICE_NOTE_MS - 15_000;
    return (
      <div className="pb-safe flex items-center gap-3 border-t bg-background/80 px-3 pt-3 backdrop-blur sm:px-6">
        <Button variant="ghost" size="icon" aria-label="Cancel recording" onClick={recorder.cancel}>
          <Trash2 className="text-destructive" />
        </Button>
        <div className="flex flex-1 items-center gap-2" role="status" aria-live="polite">
          <span className="size-2.5 animate-pulse rounded-full bg-destructive" aria-hidden />
          <span className={cn("tabular-nums", nearLimit && "text-destructive")}>{formatDuration(recorder.elapsed)}</span>
          <span className="text-sm text-muted-foreground">Recording…</span>
        </div>
        <Button size="icon" className="rounded-full" aria-label="Send voice message" onClick={() => void sendVoice()}>
          <SendHorizontal />
        </Button>
      </div>
    );
  }

  return (
    <div className="pb-safe border-t bg-background/80 px-3 pt-3 backdrop-blur sm:px-6">
      <div className="mx-auto w-full max-w-4xl">
        {editing && (
          <div className="mb-2 flex items-center gap-2 rounded-lg bg-accent px-3 py-1.5 text-xs">
            <span className="flex-1">Editing message — Enter to save, Esc to cancel</span>
            <button type="button" onClick={onCancelEdit} aria-label="Cancel editing" className="rounded p-0.5 hover:bg-background/40">
              <X className="size-3.5" />
            </button>
          </div>
        )}
        {replyingTo && !editing && (
          <div className="mb-2 flex items-center gap-2 rounded-lg border-l-4 border-primary bg-accent px-3 py-1.5 text-xs">
            <Reply className="size-3.5 shrink-0 text-primary" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">Replying to {replyingTo.author}</span>
              <span className="block truncate text-muted-foreground">{replyingTo.text}</span>
            </span>
            <button type="button" onClick={onCancelReply} aria-label="Cancel reply" className="rounded p-0.5 hover:bg-background/40">
              <X className="size-3.5" />
            </button>
          </div>
        )}
        {stickersOpen && onSendSticker && !editing && (
          <StickerPanel
            onPick={(payload) => {
              onSendSticker(payload);
              setStickersOpen(false);
            }}
          />
        )}
        {(files.length > 0 || preparing > 0) && (
          <ul className="mb-2 flex flex-wrap gap-2" aria-label="Files to send">
            {files.map((f, i) => (
              <li key={`${f.file.name}-${i}`} className="relative">
                {f.previewUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- local preview (blob URL)
                  <img src={f.previewUrl} alt={f.file.name} className="size-16 rounded-lg object-cover" />
                ) : (
                  <span className="flex h-16 max-w-44 items-center gap-2 rounded-lg bg-muted px-2.5 text-xs">
                    <span className="truncate">{f.file.name}</span>
                    <span className="shrink-0 text-muted-foreground">{formatBytes(f.file.size)}</span>
                  </span>
                )}
                {isVideo(f.file.type) && f.previewUrl && (
                  <span className="pointer-events-none absolute inset-0 grid place-items-center text-white drop-shadow" aria-hidden>
                    ▶
                  </span>
                )}
                {allowViewOnce && files.length === 1 && f.previewUrl && isImage(f.file.type) && (
                  <button
                    type="button"
                    onClick={() => setFiles((prev) => prev.map((p, j) => (j === i ? { ...p, viewOnce: !p.viewOnce } : p)))}
                    aria-pressed={Boolean(f.viewOnce)}
                    aria-label="View once"
                    title={f.viewOnce ? "View once: on" : "Send as view once"}
                    className={cn(
                      "absolute bottom-1 left-1 grid size-6 place-items-center rounded-full border-2 text-[11px] font-bold shadow",
                      f.viewOnce
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-white bg-black/50 text-white",
                    )}
                  >
                    1
                  </button>
                )}
                <button
                  type="button"
                  aria-label={`Remove ${f.file.name}`}
                  onClick={() => removeFile(i)}
                  className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-foreground text-background"
                >
                  <X className="size-3" />
                </button>
              </li>
            ))}
            {preparing > 0 && (
              <li className="grid size-16 place-items-center rounded-lg bg-muted">
                <Spinner label="Preparing photo" />
              </li>
            )}
          </ul>
        )}
        {files.length === 1 && files[0]!.viewOnce && (
          <p className="mb-2 text-xs text-muted-foreground">
            View once: they can open this photo one time, then it&apos;s deleted. Any text is sent as a separate message.
          </p>
        )}
        <form
          className="flex items-end gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          {attachmentsEnabled && !editing && (
            <>
              <input
                ref={fileRef}
                type="file"
                multiple
                hidden
                accept={ALLOWED_ATTACHMENT_TYPES.join(",")}
                onChange={(e) => void addFiles(e.target.files)}
              />
              <input
                ref={cameraRef}
                type="file"
                hidden
                accept="image/*,video/*"
                capture="environment"
                onChange={(e) => void addFiles(e.target.files)}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Attach photos or files"
                title="Photos & files (max 10 MB each)"
                disabled={disabled}
                onClick={() => fileRef.current?.click()}
              >
                <Paperclip />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Take a photo"
                title="Camera"
                disabled={disabled}
                className="pointer-fine:hidden"
                onClick={() => cameraRef.current?.click()}
              >
                <Camera />
              </Button>
            </>
          )}
          <div className="relative flex-1">
            <label htmlFor="composer" className="sr-only">
              {editing ? "Edit message" : "Message"}
            </label>
            <textarea
              id="composer"
              ref={textRef}
              rows={1}
              value={body}
              disabled={disabled}
              placeholder="Message"
              onChange={(e) => {
                setBody(e.target.value);
                if (e.target.value) onTyping();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void submit();
                } else if (e.key === "Escape") {
                  if (editing) {
                    e.preventDefault();
                    setBody("");
                    onCancelEdit();
                  } else if (replyingTo) {
                    e.preventDefault();
                    onCancelReply();
                  }
                }
              }}
              aria-describedby="composer-hint"
              className={cn(
                "block max-h-[200px] min-h-10 w-full resize-none rounded-2xl border border-input bg-muted/60 py-2.5 pl-4 text-base leading-snug pointer-fine:text-[15px] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
                onSendSticker && !editing ? "pr-11" : "pr-4",
                tooLong && "border-destructive",
              )}
            />
            {onSendSticker && !editing && (
              <button
                type="button"
                onClick={() => setStickersOpen((o) => !o)}
                disabled={disabled}
                aria-label="Stickers and GIFs"
                aria-expanded={stickersOpen}
                className={cn(
                  "absolute bottom-1 right-1 grid size-8 place-items-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                  stickersOpen && "bg-accent text-primary",
                )}
              >
                <Smile className="size-5" />
              </button>
            )}
            <span id="composer-hint" className="sr-only">
              Press Enter to send, Shift+Enter for a new line.
            </span>
            {body.length > MAX_MESSAGE_LENGTH - 500 && (
              <span
                className={cn("absolute -top-5 right-2 text-[11px]", tooLong ? "text-destructive" : "text-muted-foreground")}
                aria-live="polite"
              >
                {body.length}/{MAX_MESSAGE_LENGTH}
              </span>
            )}
          </div>
          {showMic ? (
            <Button
              type="button"
              size="icon"
              className="rounded-full"
              aria-label="Record voice message"
              title="Voice message"
              disabled={disabled}
              onClick={() => void startRecording()}
            >
              <Mic />
            </Button>
          ) : (
            <Button type="submit" size="icon" className="rounded-full" disabled={!canSubmit} aria-label={editing ? "Save edit" : "Send message"}>
              <SendHorizontal />
            </Button>
          )}
        </form>
      </div>
    </div>
  );
}
