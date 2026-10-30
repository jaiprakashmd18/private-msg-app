"use client";

import { Check, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/components/app-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Spinner } from "@/components/ui/spinner";
import { formatDateTime, initials } from "@/lib/format";
import type { AccessRequest } from "@/types/app";

function RequestPhoto({ request }: { request: AccessRequest }) {
  const [failed, setFailed] = useState(false);
  const name = request.display_name || request.email;
  return (
    <span className="relative grid size-11 shrink-0 place-items-center overflow-hidden rounded-full bg-muted text-sm font-semibold">
      {initials(name)}
      {request.picture_url && !failed && (
        // eslint-disable-next-line @next/next/no-img-element -- Google profile picture provided at sign-in
        <img
          src={request.picture_url}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="absolute inset-0 size-full object-cover"
        />
      )}
    </span>
  );
}

export function RequestsManager({ requests }: { requests: AccessRequest[] }) {
  const { supabase, reportError } = useApp();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const pending = requests.filter((r) => r.status === "pending");
  const decided = requests.filter((r) => r.status !== "pending");

  async function decide(r: AccessRequest, accept: boolean) {
    setBusy(r.id);
    const { error } = accept
      ? await supabase.rpc("admin_accept_request", { p_request_id: r.id })
      : await supabase.rpc("admin_decline_request", { p_request_id: r.id });
    setBusy(null);
    if (error) {
      reportError(error);
      return;
    }
    toast.success(accept ? `${r.display_name || r.email} can now sign in` : "Request declined");
    router.refresh();
  }

  const row = (r: AccessRequest, actions: React.ReactNode) => (
    <li key={r.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <RequestPhoto request={r} />
        <div className="min-w-0">
          <p className="truncate font-medium">{r.display_name || "Unknown name"}</p>
          <p className="truncate text-sm text-muted-foreground">{r.email}</p>
          <p className="text-xs text-muted-foreground">
            Requested {formatDateTime(r.last_requested_at)}
            {r.attempts > 1 && ` · tried ${r.attempts} times`}
            {r.decided_at && ` · ${r.status} ${formatDateTime(r.decided_at)}`}
          </p>
        </div>
      </div>
      {actions}
    </li>
  );

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Access requests</h1>
        <p className="text-sm text-muted-foreground">
          People who tried to sign in with a Google account that isn&apos;t approved. Google has verified each email
          address. Accepting adds it to the allowlist so they can sign in right away.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Waiting for you</CardTitle>
          <CardDescription>
            {pending.length === 0 ? "No pending requests." : `${pending.length} pending`}
          </CardDescription>
        </CardHeader>
        {pending.length > 0 && (
          <CardContent className="p-0">
            <ul className="divide-y">
              {pending.map((r) =>
                row(
                  r,
                  <div className="flex gap-2">
                    {busy === r.id && <Spinner />}
                    <Button size="sm" disabled={busy !== null} onClick={() => void decide(r, true)}>
                      <Check /> Accept
                    </Button>
                    <ConfirmButton
                      size="sm"
                      variant="outline"
                      disabled={busy !== null}
                      title={`Decline ${r.display_name || r.email}?`}
                      description="They won't be able to sign in. You can still accept them later from the history below."
                      confirmLabel="Decline"
                      onConfirm={() => decide(r, false)}
                    >
                      <X /> Decline
                    </ConfirmButton>
                  </div>,
                ),
              )}
            </ul>
          </CardContent>
        )}
      </Card>

      {decided.length > 0 && (
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-4">
            <div>
              <CardTitle>History</CardTitle>
              <CardDescription>Accepted and declined requests (kept for 90 days).</CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setShowHistory((v) => !v)} aria-expanded={showHistory}>
              {showHistory ? "Hide" : `Show ${decided.length}`}
            </Button>
          </CardHeader>
          {showHistory && (
            <CardContent className="p-0">
              <ul className="divide-y">
                {decided.map((r) =>
                  row(
                    r,
                    r.status === "declined" ? (
                      <div className="flex items-center gap-2">
                        <Badge variant="destructive">Declined</Badge>
                        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void decide(r, true)}>
                          <Check /> Accept now
                        </Button>
                      </div>
                    ) : (
                      <Badge variant="success">Accepted</Badge>
                    ),
                  ),
                )}
              </ul>
            </CardContent>
          )}
        </Card>
      )}
    </div>
  );
}
