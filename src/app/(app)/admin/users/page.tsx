import type { Metadata } from "next";
import { NumbersManager } from "@/components/admin/numbers-manager";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { AdminNumber } from "@/types/app";

export const metadata: Metadata = { title: "Members & access" };

export default async function AdminUsersPage() {
  const supabase = await getSupabaseServerClient();
  const { data, error } = await supabase.rpc("admin_list_numbers");
  if (error) return <p className="text-sm text-destructive">Could not load the allowlist.</p>;
  return <NumbersManager numbers={(data ?? []) as AdminNumber[]} />;
}
