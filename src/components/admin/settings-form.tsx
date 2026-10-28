"use client";

import { AlertTriangle, Eraser } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/components/app-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { adminRequest } from "@/lib/admin-client";
import { formatDateTime } from "@/lib/format";
import { settingsSchema } from "@/lib/validation";
import type { AppSettings } from "@/types/app";

export function SettingsForm({ settings }: { settings: AppSettings }) {
  const { supabase, reportError } = useApp();
  const router = useRouter();
  const [keepForever, setKeepForever] = useState(settings.message_retention_days === null);
  const [retentionDays, setRetentionDays] = useState(String(settings.message_retention_days ?? 365));
  const [auditDays, setAuditDays] = useState(String(settings.audit_retention_days));
  const [editWindow, setEditWindow] = useState(String(settings.edit_window_minutes));
  const [attachments, setAttachments] = useState(settings.attachments_enabled);
  const [adminRead, setAdminRead] = useState(settings.admin_can_read_messages);
  const [saving, setSaving] = useState(false);
  const [purging, setPurging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const candidate = {
    message_retention_days: keepForever ? null : Number(retentionDays),
    audit_retention_days: Number(auditDays),
    admin_can_read_messages: adminRead,
    attachments_enabled: attachments,
    edit_window_minutes: Number(editWindow),
  };
  const shortening =
    candidate.message_retention_days !== null &&
    (settings.message_retention_days === null || candidate.message_retention_days < settings.message_retention_days);
  const enablingAdminRead = adminRead && !settings.admin_can_read_messages;

  async function save() {
    const parsed = settingsSchema.safeParse(candidate);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid settings");
      return;
    }
    setError(null);
    setSaving(true);
    const { error: rpcError } = await supabase.rpc("admin_update_settings", {
      p_message_retention_days: parsed.data.message_retention_days,
      p_audit_retention_days: parsed.data.audit_retention_days,
      p_admin_can_read_messages: parsed.data.admin_can_read_messages,
      p_attachments_enabled: parsed.data.attachments_enabled,
      p_edit_window_minutes: parsed.data.edit_window_minutes,
    });
    setSaving(false);
    if (rpcError) {
      reportError(rpcError, "Could not save settings.");
      return;
    }
    toast.success("Settings saved");
    router.refresh();
  }

  async function purge() {
    setPurging(true);
    try {
      const r = await adminRequest<{ messagesDeleted: number; auditDeleted: number; filesRemoved: number }>(
        "/api/admin/retention",
        "POST",
      );
      toast.success(
        `Retention complete: ${r.messagesDeleted} messages, ${r.filesRemoved} files, ${r.auditDeleted} log entries removed`,
      );
      router.refresh();
    } catch (err) {
      reportError(err);
    } finally {
      setPurging(false);
    }
  }

  const needsConfirm = shortening || enablingAdminRead;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Privacy &amp; retention</h1>
        <p className="text-sm text-muted-foreground">Last changed {formatDateTime(settings.updated_at)}. Every change is audited.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Message retention</CardTitle>
          <CardDescription>
            By default messages are kept until a member deletes them. With a retention period, older messages and
            their files are permanently deleted by a daily job.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="keep-forever">Keep messages forever</Label>
            <Switch id="keep-forever" checked={keepForever} onCheckedChange={setKeepForever} />
          </div>
          {!keepForever && (
            <div className="grid max-w-xs gap-2">
              <Label htmlFor="retention-days">Delete messages older than (days)</Label>
              <Input
                id="retention-days"
                type="number"
                min={1}
                max={3650}
                value={retentionDays}
                onChange={(e) => setRetentionDays(e.target.value)}
              />
            </div>
          )}
          <div className="grid max-w-xs gap-2">
            <Label htmlFor="audit-days">Keep audit log entries for (days)</Label>
            <Input id="audit-days" type="number" min={30} max={3650} value={auditDays} onChange={(e) => setAuditDays(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Messaging</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="attachments">Allow image and file attachments</Label>
              <p className="text-xs text-muted-foreground">Max 10 MB per file, 5 files per message.</p>
            </div>
            <Switch id="attachments" checked={attachments} onCheckedChange={setAttachments} />
          </div>
          <div className="grid max-w-xs gap-2">
            <Label htmlFor="edit-window">Members can edit messages for (minutes, 0 = never)</Label>
            <Input
              id="edit-window"
              type="number"
              min={0}
              max={1440}
              value={editWindow}
              onChange={(e) => setEditWindow(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card className={adminRead ? "border-destructive/50" : undefined}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-amber-500" aria-hidden /> Administrator access to message content
          </CardTitle>
          <CardDescription>
            Off by default. When on, administrators can open conversations from the dashboard. Every member sees a
            notice that this policy is active, and every view is written to the audit log.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="admin-read">Allow administrators to read messages</Label>
            <Switch id="admin-read" checked={adminRead} onCheckedChange={setAdminRead} />
          </div>
        </CardContent>
      </Card>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {needsConfirm ? (
          <ConfirmButton
            disabled={saving}
            title="Confirm privacy-affecting change"
            description={
              <ul className="list-disc space-y-1 pl-5">
                {shortening && (
                  <li>
                    Messages older than {candidate.message_retention_days} days will be <strong>permanently deleted</strong>{" "}
                    at the next retention run.
                  </li>
                )}
                {enablingAdminRead && <li>Administrators will be able to read message content (audited, members notified).</li>}
              </ul>
            }
            confirmLabel="Save settings"
            onConfirm={save}
          >
            {saving && <Spinner />} Save settings
          </ConfirmButton>
        ) : (
          <Button onClick={() => void save()} disabled={saving}>
            {saving && <Spinner />} Save settings
          </Button>
        )}
        <ConfirmButton
          variant="outline"
          disabled={purging}
          title="Run retention now?"
          description="Applies the SAVED retention settings immediately: deletes expired messages and files, old audit entries, and orphaned uploads older than 24 hours."
          confirmLabel="Run now"
          onConfirm={purge}
        >
          {purging ? <Spinner /> : <Eraser />} Run retention now
        </ConfirmButton>
      </div>
    </div>
  );
}
