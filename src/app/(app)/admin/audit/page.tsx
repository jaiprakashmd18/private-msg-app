import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { AuditLog } from "@/types/app";

export const metadata: Metadata = { title: "Audit log" };

const PAGE = 50;
const FILTERS = [
  { value: "", label: "All" },
  { value: "admin.", label: "Admin actions" },
  { value: "auth.", label: "Sign-in" },
  { value: "system.", label: "System" },
];

export default async function AuditPage({ searchParams }: PageProps<"/admin/audit">) {
  const sp = await searchParams;
  const before = typeof sp.before === "string" && /^\d+$/.test(sp.before) ? Number(sp.before) : null;
  const action = typeof sp.action === "string" && FILTERS.some((f) => f.value === sp.action) ? sp.action : "";

  const supabase = await getSupabaseServerClient();
  let query = supabase.from("audit_logs").select("*").order("id", { ascending: false }).limit(PAGE);
  if (before) query = query.lt("id", before);
  if (action) query = query.like("action", `${action}%`);
  const { data, error } = await query;
  if (error) return <p className="text-sm text-destructive">Could not load the audit log.</p>;
  const logs = (data ?? []) as AuditLog[];

  const { data: profiles } = await supabase.from("profiles").select("id, display_name, email");
  const who = new Map((profiles ?? []).map((p) => [p.id as string, (p.display_name as string) || (p.email as string)]));
  const last = logs[logs.length - 1];

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
        <p className="text-sm text-muted-foreground">
          Append-only record of security events. Email addresses are masked; message content is never logged.
        </p>
      </div>
      <nav aria-label="Filter audit log" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Button key={f.value} asChild size="sm" variant={f.value === action ? "secondary" : "ghost"}>
            <Link href={f.value ? `/admin/audit?action=${f.value}` : "/admin/audit"}>{f.label}</Link>
          </Button>
        ))}
      </nav>
      <Card>
        <CardContent className="overflow-x-auto p-0">
          {logs.length === 0 ? (
            <p className="p-5 text-sm text-muted-foreground">No entries.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="border-b text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium">Time</th>
                  <th scope="col" className="px-5 py-3 font-medium">Event</th>
                  <th scope="col" className="px-5 py-3 font-medium">Actor</th>
                  <th scope="col" className="px-5 py-3 font-medium">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {logs.map((l) => (
                  <tr key={l.id} className="align-top">
                    <td className="whitespace-nowrap px-5 py-3 text-muted-foreground">{formatDateTime(l.created_at)}</td>
                    <td className="whitespace-nowrap px-5 py-3 font-mono text-xs">{l.action}</td>
                    <td className="px-5 py-3">{l.actor_id ? (who.get(l.actor_id) ?? "Deleted user") : "—"}</td>
                    <td className="px-5 py-3">
                      <code className="block max-w-md break-all text-xs text-muted-foreground">
                        {[l.target_type && `${l.target_type}:${l.target_id ?? ""}`, Object.keys(l.metadata ?? {}).length ? JSON.stringify(l.metadata) : null]
                          .filter(Boolean)
                          .join(" ")}
                      </code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
      <div className="flex justify-between">
        {before ? (
          <Button asChild variant="outline" size="sm">
            <Link href={action ? `/admin/audit?action=${action}` : "/admin/audit"}>Newest</Link>
          </Button>
        ) : (
          <span />
        )}
        {logs.length === PAGE && last && (
          <Button asChild variant="outline" size="sm">
            <Link href={`/admin/audit?before=${last.id}${action ? `&action=${action}` : ""}`}>Older</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
