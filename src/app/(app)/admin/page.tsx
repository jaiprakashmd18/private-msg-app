import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getSettings } from "@/lib/access";
import { formatBytes, formatDateTime } from "@/lib/format";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { AdminStats } from "@/types/app";

export const metadata: Metadata = { title: "Admin" };

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

export default async function AdminOverviewPage() {
  const supabase = await getSupabaseServerClient();
  const [{ data, error }, settings] = await Promise.all([supabase.rpc("admin_stats"), getSettings()]);
  if (error || !data) {
    return <p className="text-sm text-destructive">Could not load statistics.</p>;
  }
  const stats = data as AdminStats;

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-sm text-muted-foreground">Usage and access at a glance. No message content is shown here.</p>
      </div>
      <section aria-label="Access" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Approved numbers" value={stats.numbers_total} />
        <Stat label="Active" value={stats.numbers_active} />
        <Stat label="Disabled" value={stats.numbers_disabled} />
        <Stat label="Registered accounts" value={stats.users_registered} hint={`${stats.users_without_access} without access`} />
      </section>
      <section aria-label="Usage" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Conversations" value={stats.conversations} />
        <Stat label="Messages" value={stats.messages} hint={`${stats.messages_24h} in the last 24 h`} />
        <Stat label="Attachments" value={stats.attachments} />
        <Stat label="Storage used" value={formatBytes(Number(stats.storage_bytes))} hint="Attachments bucket" />
      </section>
      <Card>
        <CardHeader>
          <CardTitle>Current policies</CardTitle>
          <CardDescription>
            Change these under{" "}
            <Link className="underline underline-offset-4" href="/admin/settings">
              Privacy &amp; retention
            </Link>
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm">
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Administrator access to message content</span>
            {settings?.admin_can_read_messages ? (
              <Badge variant="destructive">Enabled (audited)</Badge>
            ) : (
              <Badge variant="success">Disabled</Badge>
            )}
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Message retention</span>
            <span>{settings?.message_retention_days ? `${settings.message_retention_days} days` : "Keep forever"}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Attachments</span>
            <span>{settings?.attachments_enabled ? "Enabled" : "Disabled"}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Oldest stored message</span>
            <span>{formatDateTime(stats.oldest_message_at)}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
