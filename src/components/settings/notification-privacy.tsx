"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/components/app-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function NotificationPrivacy() {
  const { supabase, access, reportError } = useApp();
  const [mode, setMode] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void supabase.from("notification_privacy").select("mode").eq("user_id", access.user_id).maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) reportError(error, "Could not load notification privacy.");
        else {
          setMode(data?.mode ?? "");
          setReady(true);
        }
      });
    return () => { active = false; };
  }, [access.user_id, reportError, supabase]);

  return (
    <Card>
      <CardHeader><CardTitle>Notification privacy</CardTitle></CardHeader>
      <CardContent>
        <form className="grid gap-3" onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          try {
            const { error } = await supabase.from("notification_privacy").upsert({ user_id: access.user_id, mode });
            if (error) throw error;
            toast.success("Notification privacy saved");
          } catch (error) {
            reportError(error, "Could not save notification privacy.");
          } finally {
            setBusy(false);
          }
        }}>
          <label className="grid gap-1 text-sm">Lock-screen message notifications
            <select value={mode} onChange={(e) => setMode(e.target.value)} disabled={!ready || busy} className="rounded-xl border bg-background p-2">
              <option value="" disabled>Choose a preview setting</option>
              <option value="full">Full preview</option>
              <option value="sender">Sender only</option>
              <option value="private">New message only</option>
            </select>
          </label>
          <Button className="w-fit" disabled={!mode || !ready || busy}>Save notification privacy</Button>
        </form>
      </CardContent>
    </Card>
  );
}
