import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Access, AppSettings } from "@/types/app";

/**
 * Resolves the current user's access from the database (not from the JWT or
 * any client state). Cached per request.
 */
export const getAccess = cache(async (): Promise<Access | null> => {
  const supabase = await getSupabaseServerClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return null;
  const { data, error } = await supabase.rpc("my_access").maybeSingle<Access>();
  if (error || !data) return null;
  return data;
});

export async function requireActiveUser(): Promise<Access> {
  const access = await getAccess();
  if (!access) redirect("/login");
  if (!access.is_active) redirect("/unauthorized");
  return access;
}

export async function requireAdmin(): Promise<Access> {
  const access = await requireActiveUser();
  if (access.role !== "admin") redirect("/chat");
  return access;
}

export async function getSettings(): Promise<AppSettings | null> {
  const supabase = await getSupabaseServerClient();
  const { data } = await supabase.from("app_settings").select("*").maybeSingle<AppSettings>();
  return data ?? null;
}
