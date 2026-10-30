"use client";

import { Check, LogOut, Pencil, Shield, ShieldOff, UserMinus, UserPlus, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/components/app-provider";
import { useChat } from "@/components/chat/chat-provider";
import { PhotoEditor } from "@/components/photo-editor";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  addGroupMembers,
  listDirectory,
  removeAvatarFile,
  removeGroupMember,
  renameGroup,
  setGroupAdmin,
  setGroupAvatar,
  uploadAvatarFile,
} from "@/lib/data/chat";
import { displayNameOf, formatLastSeen } from "@/lib/format";
import type { ConversationMember, ConversationSummary, DirectoryEntry } from "@/types/app";

export function ConversationInfoDialog({
  open,
  onOpenChange,
  summary,
  members,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  summary: ConversationSummary;
  members: ConversationMember[];
  onChanged: () => void;
}) {
  const { supabase, access, reportError } = useApp();
  const { onlineIds, refresh } = useChat();
  const router = useRouter();
  const isGroup = summary.kind === "group";
  const amAdmin = isGroup && summary.is_group_admin;
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(summary.title ?? "");
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  async function run(key: string, action: () => Promise<void>, success?: string) {
    setBusy(key);
    try {
      await action();
      if (success) toast.success(success);
      onChanged();
      await refresh();
    } catch (err) {
      reportError(err);
    } finally {
      setBusy(null);
    }
  }

  const status = (m: ConversationMember) =>
    !m.is_active ? "No longer has access" : onlineIds.has(m.user_id) ? "online" : formatLastSeen(m.last_seen_at);

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) {
          setRenaming(false);
          setAdding(false);
        }
      }}
    >
      <DialogContent className="flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isGroup ? <Users className="size-5" aria-hidden /> : null}
            {isGroup ? summary.title : displayNameOf(summary.other_display_name, summary.other_email)}
          </DialogTitle>
          <DialogDescription>
            {isGroup ? `Group · ${members.length} member${members.length === 1 ? "" : "s"}` : summary.other_email}
          </DialogDescription>
        </DialogHeader>

        {amAdmin && (
          <PhotoEditor
            group
            name={summary.title ?? "Group"}
            path={summary.avatar_path}
            onChange={async (photo) => {
              await run(
                "photo",
                async () => {
                  const old = summary.avatar_path;
                  const path = photo ? await uploadAvatarFile(supabase, `groups/${summary.id}`, photo) : null;
                  await setGroupAvatar(supabase, summary.id, path);
                  await removeAvatarFile(supabase, old).catch(() => undefined);
                },
                photo ? "Group photo updated" : "Group photo removed",
              );
            }}
          />
        )}

        {amAdmin && (
          <div>
            {renaming ? (
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void run("rename", () => renameGroup(supabase, summary.id, title), "Group renamed").then(() =>
                    setRenaming(false),
                  );
                }}
              >
                <Input aria-label="Group name" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} autoFocus />
                <Button type="submit" size="icon" aria-label="Save group name" disabled={busy === "rename" || !title.trim()}>
                  {busy === "rename" ? <Spinner /> : <Check />}
                </Button>
              </form>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => setRenaming(true)}>
                  <Pencil /> Rename
                </Button>
                <Button variant="outline" size="sm" onClick={() => setAdding((a) => !a)} aria-expanded={adding}>
                  <UserPlus /> Add people
                </Button>
              </div>
            )}
          </div>
        )}

        {adding && (
          <AddPeople
            exclude={new Set(members.map((m) => m.user_id))}
            onAdd={(ids) => run("add", () => addGroupMembers(supabase, summary.id, ids), "Added").then(() => setAdding(false))}
            busy={busy === "add"}
          />
        )}

        <ul className="-mx-2 max-h-[45vh] overflow-y-auto" aria-label="Members">
          {members.map((m) => {
            const name = displayNameOf(m.display_name, m.email);
            const me = m.user_id === access.user_id;
            return (
              <li key={m.user_id} className="flex items-center gap-3 rounded-xl px-2 py-2">
                <span className="relative">
                  <Avatar name={name} seed={m.user_id} path={m.avatar_path} />
                  {onlineIds.has(m.user_id) && m.is_active && (
                    <span className="absolute bottom-0 right-0 size-3 rounded-full border-2 border-popover bg-success" aria-hidden />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-medium">{me ? "You" : name}</span>
                    {isGroup && m.is_admin && <Badge variant="secondary">Admin</Badge>}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{me ? m.email : status(m) || m.email}</span>
                </span>
                {amAdmin && !me && (
                  <span className="flex gap-1">
                    {busy === m.user_id ? <Spinner /> : null}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={m.is_admin ? `Remove admin rights from ${name}` : `Make ${name} an admin`}
                      title={m.is_admin ? "Remove admin" : "Make admin"}
                      onClick={() => void run(m.user_id, () => setGroupAdmin(supabase, summary.id, m.user_id, !m.is_admin))}
                    >
                      {m.is_admin ? <ShieldOff /> : <Shield />}
                    </Button>
                    <ConfirmButton
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove ${name} from the group`}
                      title={`Remove ${name}?`}
                      confirmLabel="Remove"
                      description={`${name} will be removed from "${summary.title}" and won't see its messages any more.`}
                      onConfirm={() => run(m.user_id, () => removeGroupMember(supabase, summary.id, m.user_id), `${name} removed`)}
                    >
                      <UserMinus />
                    </ConfirmButton>
                  </span>
                )}
              </li>
            );
          })}
        </ul>

        {isGroup && (
          <ConfirmButton
            variant="outline"
            className="text-destructive"
            title="Leave this group?"
            description="You'll stop receiving its messages and won't be able to see its history unless someone adds you again."
            confirmLabel="Leave group"
            onConfirm={async () => {
              setBusy("leave");
              try {
                await removeGroupMember(supabase, summary.id, access.user_id);
                onOpenChange(false);
                await refresh();
                router.push("/chat");
                toast.success("You left the group");
              } catch (err) {
                reportError(err);
              } finally {
                setBusy(null);
              }
            }}
          >
            <LogOut /> Leave group
          </ConfirmButton>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AddPeople({ exclude, onAdd, busy }: { exclude: Set<string>; onAdd: (ids: string[]) => void; busy: boolean }) {
  const { supabase, reportError } = useApp();
  const [people, setPeople] = useState<DirectoryEntry[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    listDirectory(supabase)
      .then((rows) => !cancelled && setPeople(rows))
      .catch((err) => {
        if (!cancelled) setPeople([]);
        reportError(err);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, reportError]);

  const candidates = (people ?? []).filter((p) => !exclude.has(p.id));
  return (
    <div className="rounded-xl border p-2">
      {people === null ? (
        <div className="flex justify-center p-3">
          <Spinner />
        </div>
      ) : candidates.length === 0 ? (
        <p className="p-2 text-sm text-muted-foreground">Everyone is already in this group.</p>
      ) : (
        <>
          <ul className="max-h-48 overflow-y-auto">
            {candidates.map((p) => {
              const name = displayNameOf(p.display_name, p.email);
              const checked = selected.has(p.id);
              return (
                <li key={p.id}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-accent">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={checked}
                      onChange={() =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (checked) next.delete(p.id);
                          else next.add(p.id);
                          return next;
                        })
                      }
                    />
                    <span className="truncate text-sm">{name}</span>
                  </label>
                </li>
              );
            })}
          </ul>
          <Button className="mt-2 w-full" size="sm" disabled={selected.size === 0 || busy} onClick={() => onAdd([...selected])}>
            {busy ? <Spinner /> : <UserPlus />} Add {selected.size || ""}
          </Button>
        </>
      )}
    </div>
  );
}
