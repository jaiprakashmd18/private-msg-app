import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getPublicEnv } from "@/lib/env";
import { getServerEnv } from "@/lib/env.server";

/**
 * Service-role client. BYPASSES Row Level Security — use only in route
 * handlers, only after the caller has been authorized, and only for the few
 * operations that require it (OTP pre-checks, deleting auth users and storage
 * files, scheduled retention). Never import from client components.
 */
export function getSupabaseServiceClient(): SupabaseClient {
  const { NEXT_PUBLIC_SUPABASE_URL } = getPublicEnv();
  const { SUPABASE_SERVICE_ROLE_KEY } = getServerEnv();
  return createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
