"use client";

import { Ban, CheckCircle2, Copy, KeyRound, LogOut, Plus, Trash2, UserX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/components/app-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { adminRequest } from "@/lib/admin-client";
import { formatDateTime } from "@/lib/format";
import { addEmailSchema } from "@/lib/validation";
import type { AllowlistEntry } from "@/types/app";

export function AllowlistManager({ entries }: { entries: AllowlistEntry[] }) {
  const { supabase, access, reportError } = useApp();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [label, setLabel] = useState("");
  const [adding, setAdding] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [issued, setIssued] = useState<{ email: string; password: string; created: boolean } | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const parsed = addEmailSchema.safeParse({ email, label: label || undefined });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setFormError(null);
    setAdding(true);
    const { error } = await supabase.rpc("admin_add_email", {
      p_email: parsed.data.email,
      p_label: parsed.data.label ?? null,
    });
    setAdding(false);
    if (error) {
      reportError(error, "Could not add the email.");
      return;
    }
    toast.success(`${parsed.data.email} can now sign in with Google`, {
      description: "To let them use a password instead, choose “Set password” on their entry.",
    });
    setEmail("");
    setLabel("");
    router.refresh();
  }

  async function run(id: string, action: () => Promise<{ error: unknown } | void>, success: string) {
    setBusyId(id);
    try {
      const result = await action();
      if (result && result.error) throw result.error;
      toast.success(success);
      router.refresh();
    } catch (err) {
      reportError(err);
    } finally {
      setBusyId(null);
    }
  }

  const needle = filter.trim().toLowerCase();
  const visible = entries.filter(
    (n) => !needle || `${n.email} ${n.label ?? ""} ${n.display_name ?? ""}`.toLowerCase().includes(needle),
  );

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Members &amp; access</h1>
        <p className="text-sm text-muted-foreground">
          Only emails on this list can sign in — with Google, or with a password you set for them. Disabling or removing
          an email signs the person out everywhere and blocks access immediately.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Approve an email</CardTitle>
          <CardDescription>
            Gmail / Google accounts can click “Continue with Google” right away. For any other email, approve it and then
            choose “Set password”.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={add} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" noValidate>
            <div className="grid gap-2">
              <Label htmlFor="new-email">Email</Label>
              <Input
                id="new-email"
                type="email"
                autoComplete="off"
                placeholder="name@gmail.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={Boolean(formError)}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="new-label">Label (optional)</Label>
              <Input
                id="new-label"
                placeholder="e.g. Alex (work)"
                maxLength={80}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            <Button type="submit" disabled={adding || !email.trim()}>
              {adding ? <Spinner /> : <Plus />} Approve
            </Button>
          </form>
          {formError && (
            <p role="alert" className="mt-2 text-sm text-destructive">
              {formError}
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between gap-4">
          <div>
            <CardTitle>Allowlist</CardTitle>
            <CardDescription>{entries.length} accounts</CardDescription>
          </div>
          <Input
            aria-label="Filter accounts"
            placeholder="Filter"
            className="max-w-48"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </CardHeader>
        <CardContent className="p-0">
          {visible.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-muted-foreground">No accounts found.</p>
          ) : (
            <ul className="divide-y">
              {visible.map((n) => {
                const isAdminEntry = n.role === "admin";
                const isSelf = n.user_id === access.user_id;
                const busy = busyId === n.id;
                return (
                  <li key={n.id} className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="break-all font-medium">{n.email}</span>
                        {n.status === "active" ? (
                          <Badge variant="success">Active</Badge>
                        ) : (
                          <Badge variant="destructive">Disabled</Badge>
                        )}
                        {isAdminEntry && <Badge>Admin</Badge>}
                        {isSelf && <Badge variant="outline">You</Badge>}
                        {!n.user_id && <Badge variant="outline">Not registered yet</Badge>}
                        {n.password_pending ? (
                          <Badge variant="outline">Temporary password</Badge>
                        ) : (
                          n.has_password && <Badge variant="secondary">Password</Badge>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-sm text-muted-foreground">
                        {[n.label, n.display_name && n.display_name !== n.label ? `“${n.display_name}”` : null]
                          .filter(Boolean)
                          .join(" · ") || "No label"}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Added {formatDateTime(n.created_at)}
                        {n.user_id && <> · Last active {formatDateTime(n.last_seen_at)}</>}
                      </p>
                    </div>
                    {isAdminEntry ? (
                      <p className="max-w-60 text-xs text-muted-foreground">
                        Administrator entries can only be changed by the database owner (SQL).
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {busy && <Spinner />}
                        {n.status === "active" ? (
                          <ConfirmButton
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            title={`Disable ${n.email}?`}
                            description="They will be signed out on all devices and lose access to all conversations immediately. Their messages are kept and access can be restored later."
                            confirmLabel="Disable access"
                            onConfirm={() =>
                              run(
                                n.id,
                                async () => await supabase.rpc("admin_set_access_status", { p_id: n.id, p_status: "disabled" }),
                                "Access disabled",
                              )
                            }
                          >
                            <Ban /> Disable
                          </ConfirmButton>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() =>
                              run(
                                n.id,
                                async () => await supabase.rpc("admin_set_access_status", { p_id: n.id, p_status: "active" }),
                                "Access restored",
                              )
                            }
                          >
                            <CheckCircle2 /> Re-enable
                          </Button>
                        )}
                        {n.status === "active" && (
                          <ConfirmButton
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            destructive={false}
                            title={n.has_password ? `Reset the password for ${n.email}?` : `Set a password for ${n.email}?`}
                            description={
                              <>
                                You&apos;ll get a temporary password to send them. They sign in with their email and that
                                password, then must choose their own.
                                {n.user_id && " They're signed out on all devices now."}
                                {n.has_password && " Their current password stops working."} This is recorded in the
                                audit log.
                              </>
                            }
                            confirmLabel={n.has_password ? "Reset password" : "Set password"}
                            onConfirm={() =>
                              run(
                                n.id,
                                async () => {
                                  const res = await adminRequest<{ email: string; password: string; created: boolean }>(
                                    `/api/admin/allowlist/${n.id}/password`,
                                    "POST",
                                  );
                                  setIssued({ email: res.email, password: res.password, created: res.created });
                                },
                                "Temporary password created",
                              )
                            }
                          >
                            <KeyRound /> {n.has_password ? "Reset password" : "Set password"}
                          </ConfirmButton>
                        )}
                        {n.user_id && (
                          <ConfirmButton
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            destructive={false}
                            title="Sign out all sessions?"
                            description="Ends every active session for this person. They can sign in again while their email is approved."
                            confirmLabel="Sign out everywhere"
                            onConfirm={() =>
                              run(
                                n.id,
                                async () => await supabase.rpc("admin_revoke_sessions", { p_user_id: n.user_id }),
                                "Sessions revoked",
                              )
                            }
                          >
                            <LogOut /> Sign out
                          </ConfirmButton>
                        )}
                        <ConfirmButton
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          title={`Remove ${n.email} from the allowlist?`}
                          description="They lose access immediately and cannot sign in. Their account and messages are kept; adding the email again restores access."
                          confirmLabel="Remove"
                          onConfirm={() =>
                            run(n.id, async () => await supabase.rpc("admin_remove_email", { p_id: n.id }), "Email removed")
                          }
                        >
                          <Trash2 /> Remove
                        </ConfirmButton>
                        {n.user_id && (
                          <ConfirmButton
                            size="sm"
                            variant="destructive"
                            disabled={busy}
                            title="Permanently delete this account?"
                            description={
                              <>
                                This deletes the account, every message and file this person sent, and their sign-in
                                record. <strong>This cannot be undone.</strong> The email stays on the allowlist unless
                                you remove it too.
                              </>
                            }
                            confirmLabel="Delete account and data"
                            onConfirm={() =>
                              run(
                                n.id,
                                async () => {
                                  await adminRequest(`/api/admin/users/${n.user_id}`, "DELETE");
                                },
                                "Account deleted",
                              )
                            }
                          >
                            <UserX /> Delete account
                          </ConfirmButton>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
      <TemporaryPasswordDialog issued={issued} onClose={() => setIssued(null)} />
    </div>
  );
}

function TemporaryPasswordDialog({
  issued,
  onClose,
}: {
  issued: { email: string; password: string; created: boolean } | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const loginUrl = typeof window === "undefined" ? "" : `${window.location.origin}/login`;
  const message = issued
    ? `Sign in at ${loginUrl}\nEmail: ${issued.email}\nTemporary password: ${issued.password}\nYou'll be asked to choose your own password.`
    : "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      toast.success("Copied");
    } catch {
      toast.error("Couldn't copy — select the text and copy it by hand.");
    }
  }

  return (
    <Dialog
      open={issued !== null}
      onOpenChange={(open) => {
        if (!open) {
          setCopied(false);
          onClose();
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Temporary password</DialogTitle>
          <DialogDescription>
            Send this to {issued?.email} privately (for example in person or by text message). It is shown only once.
          </DialogDescription>
        </DialogHeader>
        {issued && (
          <div className="grid gap-3">
            <p
              className="select-all break-all rounded-xl border bg-muted px-4 py-3 text-center font-mono text-xl tracking-wider"
              aria-label="Temporary password"
            >
              {issued.password}
            </p>
            <pre className="whitespace-pre-wrap break-words rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground">
              {message}
            </pre>
            <Button onClick={() => void copy()}>
              <Copy /> {copied ? "Copied" : "Copy message"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
