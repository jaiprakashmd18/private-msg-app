import "server-only";
import { AppError } from "@/lib/errors";
import { assertSameOrigin } from "@/lib/http";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Access } from "@/types/app";

export async function requireBillingMember(request: Request, startingCheckout = false) {
  assertSameOrigin(request);
  const supabase = await getSupabaseServerClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) throw new AppError("Not signed in", 401, "unauthenticated");

  const { data: access, error } = await supabase.rpc("my_access").maybeSingle<Access>();
  if (error) throw error;
  if (!access?.is_active || access.must_change_password) {
    throw new AppError("An active member account is required", 403, "forbidden");
  }
  if (startingCheckout && access.is_plus) {
    throw new AppError("Plus is already active", 409, "already_plus");
  }
  return access;
}
