import "server-only";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Access, AppSettings } from "@/types/app";

export type AccessState =
  | { status: "signed_out" }
  /** Valid session, but no app profile (e.g. signed in before the database was set up). */
  | { status: "no_profile"; email: string | null }
  | { status: "ok"; access: Access };

/**
 * Resolves the current user's access from the database (not from the JWT or
 * any client state). Cached per request.
 */
export const getAccessState = cache(async (): Promise<AccessState> => {
  const supabase = await getSupabaseServerClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) return { status: "signed_out" };
  const { data, error } = await supabase.rpc("my_access").maybeSingle<Access>();
  if (error || !data) {
    const email = typeof claims.claims.email === "string" ? claims.claims.email : null;
    return { status: "no_profile", email };
  }
  return { status: "ok", access: data };
});

export async function getAccess(): Promise<Access | null> {
  const state = await getAccessState();
  return state.status === "ok" ? state.access : null;
}

/**
 * Signed-in users without access always go to /unauthorized (never /login,
 * which would bounce a signed-in user back here and loop).
 */
export async function requireActiveUser(): Promise<Access> {
  const state = await getAccessState();
  if (state.status === "signed_out") redirect("/login");
  if (state.status === "no_profile" || !state.access.is_active) redirect("/unauthorized");
  return state.access;
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
