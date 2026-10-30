import type { Metadata } from "next";
import { RequestsManager } from "@/components/admin/requests-manager";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { AccessRequest } from "@/types/app";

export const metadata: Metadata = { title: "Access requests" };

export default async function AccessRequestsPage() {
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase
    .from("access_requests")
    .select("*")
    .order("last_requested_at", { ascending: false })
    .limit(300);
  if (error) return <p className="text-sm text-destructive">Could not load access requests.</p>;
  return <RequestsManager requests={(data ?? []) as AccessRequest[]} />;
}
