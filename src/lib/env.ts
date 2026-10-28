import { z } from "zod";

/**
 * Public environment (inlined into the browser bundle at build time).
 * Each variable is referenced explicitly so Next.js can inline it.
 */
const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url({ message: "NEXT_PUBLIC_SUPABASE_URL must be a URL" }),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20, "NEXT_PUBLIC_SUPABASE_ANON_KEY is missing"),
  NEXT_PUBLIC_SITE_URL: z.url().optional(),
  NEXT_PUBLIC_APP_NAME: z.string().min(1).max(40).default("Ghostline"),
});

export type PublicEnv = z.infer<typeof publicSchema>;

let cached: PublicEnv | undefined;

export function getPublicEnv(): PublicEnv {
  if (cached) return cached;
  const parsed = publicSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL || undefined,
    NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME || undefined,
  });
  if (!parsed.success) {
    throw new Error(
      `Invalid public environment configuration:\n${z.prettifyError(parsed.error)}\nSee .env.example.`,
    );
  }
  cached = parsed.data;
  return cached;
}

export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || "Ghostline";
