import "server-only";
import { z } from "zod";

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20, "SUPABASE_SERVICE_ROLE_KEY is missing"),
  CRON_SECRET: z.string().min(16).optional(),
  /** Optional: turns on GIF search (free key from developers.giphy.com). */
  GIPHY_API_KEY: z.string().min(10).optional(),
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | undefined;

/** Server-only secrets. Importing this file from a client component fails the build. */
export function getServerEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = serverSchema.safeParse({
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    CRON_SECRET: process.env.CRON_SECRET || undefined,
    GIPHY_API_KEY: process.env.GIPHY_API_KEY || undefined,
  });
  if (!parsed.success) {
    throw new Error(
      `Invalid server environment configuration:\n${z.prettifyError(parsed.error)}\nSee .env.example.`,
    );
  }
  cached = parsed.data;
  return cached;
}
