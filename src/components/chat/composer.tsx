"use client";

import { Paperclip, SendHorizontal, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ALLOWED_ATTACHMENT_TYPES, MAX_ATTACHMENTS_PER_MESSAGE, MAX_MESSAGE_LENGTH } from "@/lib/constants";
import { formatBytes } from "@/lib/format";
import { validateAttachment } from "@/lib/validation";
import { cn } from "@/lib/utils";

export interface EditingState {
  id: string;
  body: string;
}

export function Composer({
  disabled,
  disabledReason,
  attachmentsEnabled,
  editing,
  onSend,
  onSaveEdit,
  onCancelEdit,
}: {
  disabled: boolean;
  disabledReason?: string;
  attachmentsEnabled: boolean;
  editing: EditingState | null;
  onSend: (body: string, files: File[]) => void;
  onSaveEdit: (id: string, body: string) => Promise<boolean>;
  onCancelEdit: () => void;
}) {
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Load the message into the input when editing starts (state adjusted
  // during render, as recommended over an effect).
  const [prevEditing, setPrevEditing] = useState(editing);
  if (editing !== prevEditing) {
    setPrevEditing(editing);
    if (editing) setBody(editing.body);
  }

  useEffect(() => {
    if (editing) {
      requestAnimationFrame(() => {
        const el = textRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
        }
      });
    }
  }, [editing]);

  // Auto-grow up to ~8 lines.
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [body]);

  const trimmed = body.trim();
  const tooLong = body.length > MAX_MESSAGE_LENGTH;
  const canSubmit = !disabled && !saving && !tooLong && (trimmed.length > 0 || (!editing && files.length > 0));

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

  function addFiles(list: FileList | null) {
    if (!list) return;
    const next = [...files];
    for (const file of Array.from(list)) {
      const problem = validateAttachment(file);
      if (problem) {
        toast.error(`${file.name}: ${problem}`);
        continue;
      }
      if (next.length >= MAX_ATTACHMENTS_PER_MESSAGE) {
        toast.error(`At most ${MAX_ATTACHMENTS_PER_MESSAGE} files per message`);
        break;
      }
      next.push(file);
    }
    setFiles(next);
    if (fileRef.current) fileRef.current.value = "";
  }

  if (disabled && disabledReason) {
    return (
      <div className="border-t px-4 py-4 text-center text-sm text-muted-foreground pb-[max(1rem,env(safe-area-inset-bottom))]">
        {disabledReason}
      </div>
    );
  }

  return (
    <div className="border-t bg-background/80 px-3 pt-3 backdrop-blur pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">
      {editing && (
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-accent px-3 py-1.5 text-xs">
          <span className="flex-1">Editing message — Enter to save, Esc to cancel</span>
          <button type="button" onClick={onCancelEdit} aria-label="Cancel editing" className="rounded p-0.5 hover:bg-background/40">
            <X className="size-3.5" />
          </button>
        </div>
      )}
      {files.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-2" aria-label="Files to send">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-lg bg-muted px-2.5 py-1 text-xs">
              <span className="max-w-40 truncate">{f.name}</span>
              <span className="text-muted-foreground">{formatBytes(f.size)}</span>
              <button
                type="button"
                aria-label={`Remove ${f.name}`}
                onClick={() => setFiles(files.filter((_, j) => j !== i))}
                className="rounded p-0.5 hover:bg-background/40"
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex items-end gap-2"
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
              onChange={(e) => addFiles(e.target.files)}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Attach files"
              title="Attach files (max 10 MB each)"
              disabled={disabled}
              onClick={() => fileRef.current?.click()}
            >
              <Paperclip />
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
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void submit();
              } else if (e.key === "Escape" && editing) {
                e.preventDefault();
                setBody("");
                onCancelEdit();
              }
            }}
            aria-describedby="composer-hint"
            className={cn(
              "block max-h-[200px] min-h-10 w-full resize-none rounded-2xl border border-input bg-muted/60 px-4 py-2.5 text-[15px] leading-snug placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30",
              tooLong && "border-destructive",
            )}
          />
          <span id="composer-hint" className="sr-only">
            Press Enter to send, Shift+Enter for a new line.
          </span>
          {body.length > MAX_MESSAGE_LENGTH - 500 && (
            <span
              className={cn(
                "absolute -top-5 right-2 text-[11px]",
                tooLong ? "text-destructive" : "text-muted-foreground",
              )}
              aria-live="polite"
            >
              {body.length}/{MAX_MESSAGE_LENGTH}
            </span>
          )}
        </div>
        <Button type="submit" size="icon" className="rounded-full" disabled={!canSubmit} aria-label={editing ? "Save edit" : "Send message"}>
          <SendHorizontal />
        </Button>
      </form>
    </div>
  );
}
