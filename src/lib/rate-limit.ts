import "server-only";
import { createHmac } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerEnv } from "@/lib/env.server";

/** HMAC so the rate_limits table never contains raw phone numbers or IPs. */
export function hashKey(scope: string, value: string): string {
  const { APP_SECRET } = getServerEnv();
  return `${scope}:${createHmac("sha256", APP_SECRET).update(value).digest("hex").slice(0, 32)}`;
}

export interface Limit {
  scope: string;
  value: string;
  windowSeconds: number;
  max: number;
}

/**
 * Consumes one hit for every limit; returns false if any is exceeded.
 * Backed by Postgres so it works across serverless instances.
 * Fails closed: if the limiter cannot be reached, the request is refused.
 */
export async function consumeLimits(service: SupabaseClient, limits: Limit[]): Promise<boolean> {
  const results = await Promise.all(
    limits.map((l) =>
      service.rpc("server_consume_rate_limit", {
        p_key: hashKey(l.scope, l.value),
        p_window_seconds: l.windowSeconds,
        p_max: l.max,
      }),
    ),
  );
  return results.every((r) => !r.error && r.data === true);
}
