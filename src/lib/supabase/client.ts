"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPublicEnv } from "@/lib/env";

let browserClient: SupabaseClient | undefined;

/**
 * Browser client. Uses only the public (anon/publishable) key; every query is
 * subject to Row Level Security under the signed-in user's JWT.
 */
export function getSupabaseBrowserClient(): SupabaseClient {
  if (browserClient) return browserClient;
  const env = getPublicEnv();
  browserClient = createBrowserClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  return browserClient;
}
