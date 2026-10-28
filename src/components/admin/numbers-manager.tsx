"use client";

import { Ban, CheckCircle2, LogOut, Plus, Trash2, UserX } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/components/app-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { adminRequest } from "@/lib/admin-client";
import { formatDateTime } from "@/lib/format";
import { addNumberSchema } from "@/lib/validation";
import type { AdminNumber } from "@/types/app";

export function NumbersManager({ numbers }: { numbers: AdminNumber[] }) {
  const { supabase, access, reportError } = useApp();
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [label, setLabel] = useState("");
  const [adding, setAdding] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const parsed = addNumberSchema.safeParse({ phone, label: label || undefined });
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setFormError(null);
    setAdding(true);
    const { error } = await supabase.rpc("admin_add_number", {
      p_phone: parsed.data.phone,
      p_label: parsed.data.label ?? null,
    });
    setAdding(false);
    if (error) {
      reportError(error, "Could not add the number.");
      return;
    }
    toast.success(`${parsed.data.phone} can now sign in`);
    setPhone("");
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
  const visible = numbers.filter(
    (n) => !needle || `${n.phone_e164} ${n.label ?? ""} ${n.display_name ?? ""}`.toLowerCase().includes(needle),
  );

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Members &amp; access</h1>
        <p className="text-sm text-muted-foreground">
          Only numbers on this list can sign in. Disabling or removing a number signs the person out everywhere and
          blocks access immediately.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Approve a phone number</CardTitle>
          <CardDescription>The person can sign in with an SMS code right away.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={add} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" noValidate>
            <div className="grid gap-2">
              <Label htmlFor="new-phone">Phone number</Label>
              <Input
                id="new-phone"
                type="tel"
                placeholder="+14155550123"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
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
            <Button type="submit" disabled={adding || !phone.trim()}>
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
            <CardDescription>{numbers.length} numbers</CardDescription>
          </div>
          <Input
            aria-label="Filter numbers"
            placeholder="Filter"
            className="max-w-48"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </CardHeader>
        <CardContent className="p-0">
          {visible.length === 0 ? (
            <p className="px-5 pb-5 text-sm text-muted-foreground">No numbers found.</p>
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
                        <span className="font-medium tabular-nums">{n.phone_e164}</span>
                        {n.status === "active" ? (
                          <Badge variant="success">Active</Badge>
                        ) : (
                          <Badge variant="destructive">Disabled</Badge>
                        )}
                        {isAdminEntry && <Badge>Admin</Badge>}
                        {isSelf && <Badge variant="outline">You</Badge>}
                        {!n.user_id && <Badge variant="outline">Not registered yet</Badge>}
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
                            title={`Disable ${n.phone_e164}?`}
                            description="They will be signed out on all devices and lose access to all conversations immediately. Their messages are kept and access can be restored later."
                            confirmLabel="Disable access"
                            onConfirm={() =>
                              run(
                                n.id,
                                async () => await supabase.rpc("admin_set_number_status", { p_id: n.id, p_status: "disabled" }),
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
                                async () => await supabase.rpc("admin_set_number_status", { p_id: n.id, p_status: "active" }),
                                "Access restored",
                              )
                            }
                          >
                            <CheckCircle2 /> Re-enable
                          </Button>
                        )}
                        {n.user_id && (
                          <ConfirmButton
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            destructive={false}
                            title="Sign out all sessions?"
                            description="Ends every active session for this person. They can sign in again with a new code while their number is approved."
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
                          title={`Remove ${n.phone_e164} from the allowlist?`}
                          description="They lose access immediately and cannot sign in. Their account and messages are kept; adding the number again restores access."
                          confirmLabel="Remove"
                          onConfirm={() =>
                            run(n.id, async () => await supabase.rpc("admin_remove_number", { p_id: n.id }), "Number removed")
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
                                record. <strong>This cannot be undone.</strong> The number stays on the allowlist unless
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
    </div>
  );
}
