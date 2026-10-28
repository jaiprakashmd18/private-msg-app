import { NextResponse, type NextRequest } from "next/server";
import { logServerError } from "@/lib/errors";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Access } from "@/types/app";

export const runtime = "nodejs";

/** Maps Supabase Auth refusals (from our auth hooks) to a login-page message key. */
function reasonFor(message: string | null | undefined): string {
  const m = (message ?? "").toLowerCase();
  if (m.includes("does not currently have access")) return "no_access";
  if (m.includes("not authorized")) return "not_authorized";
  return "failed";
}

/**
 * Google → Supabase Auth → here. Exchanges the one-time code for a session
 * (PKCE; the verifier is in a cookie set when sign-in started), then routes the
 * user by their access as recorded in the database.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const toLogin = (reason: string) => {
    const target = new URL("/login", url.origin);
    target.searchParams.set("error", reason);
    return NextResponse.redirect(target);
  };

  const providerError = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (providerError) return toLogin(reasonFor(providerError));

  const code = url.searchParams.get("code");
  if (!code) return toLogin("failed");

  const supabase = await getSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    if (error.status && error.status >= 500) logServerError("auth/callback", error);
    return toLogin(reasonFor(error.message));
  }

  await supabase.rpc("log_auth_event", { p_action: "auth.sign_in" });
  const { data: access } = await supabase.rpc("my_access").maybeSingle<Access>();
  return NextResponse.redirect(new URL(access?.is_active ? "/chat" : "/unauthorized", url.origin));
}
