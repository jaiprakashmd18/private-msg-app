import type { Metadata } from "next";
import { AllowlistManager } from "@/components/admin/allowlist-manager";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { AllowlistEntry } from "@/types/app";

export const metadata: Metadata = { title: "Members & access" };

export default async function AdminUsersPage() {
  const supabase = await getSupabaseServerClient();
  const [{ data, error }, grants] = await Promise.all([
    supabase.rpc("admin_list_allowlist"),
    supabase.rpc("admin_list_plus_grants"),
  ]);
  if (error) return <p className="text-sm text-destructive">Could not load the allowlist.</p>;
  return <AllowlistManager entries={(data ?? []) as AllowlistEntry[]} plusGrants={grants.error ? null : (grants.data ?? []) as string[]} />;
}
