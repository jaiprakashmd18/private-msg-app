import "server-only";
import { AppError } from "@/lib/errors";
import { assertSameOrigin } from "@/lib/http";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Access } from "@/types/app";

/**
 * Authorizes an admin API request: same-origin, signed in, and an ACTIVE
 * administrator according to the database. Returns the user-scoped client so
 * admin RPCs run with the admin's own identity (and are audited as such).
 */
export async function authorizeAdminRequest(request: Request) {
  assertSameOrigin(request);
  const supabase = await getSupabaseServerClient();
  const { data: access, error } = await supabase.rpc("my_access").maybeSingle<Access>();
  if (error || !access) throw new AppError("Not signed in", 401, "unauthenticated");
  if (!access.is_active || access.role !== "admin") {
    throw new AppError("Administrator privileges required", 403, "forbidden");
  }
  return { supabase, access };
}
