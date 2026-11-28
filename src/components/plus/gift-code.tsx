"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { useApp } from "@/components/app-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function GiftCode({ admin = false }: { admin?: boolean }) {
  const { supabase, reportError } = useApp();
  const router = useRouter();
  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    setBusy(true);
    try {
      const { data, error } = admin
        ? await supabase.rpc("admin_create_plus_gift", { p_days: Number(values.get("duration")), p_redeem_days: Number(values.get("deadline")) })
        : await supabase.rpc("redeem_plus_gift", { p_code: values.get("code") });
      if (error) throw error;
      if (admin) setResult(String(data));
      else {
        form.reset();
        toast.success("Plus gift redeemed");
        router.refresh();
      }
    } catch (error) {
      reportError(error, "Could not process this Plus gift.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3">
      {admin ? <>
        <label className="grid gap-1 text-sm">Plus duration in days<Input name="duration" type="number" min={1} max={365} defaultValue={30} required /></label>
        <label className="grid gap-1 text-sm">Redeem within this many days<Input name="deadline" type="number" min={1} max={90} defaultValue={7} required /></label>
      </> : <label className="grid gap-1 text-sm">Plus gift code<Input name="code" autoComplete="off" maxLength={32} required /></label>}
      <Button className="w-fit" disabled={busy}>{admin ? "Create gift code" : "Redeem gift"}</Button>
      {result && <output className="break-all rounded-xl border p-3 font-mono">{result}</output>}
    </form>
  );
}
