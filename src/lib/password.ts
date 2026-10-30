import { z } from "zod";

export const MIN_PASSWORD_LENGTH = 10;
/** bcrypt (used by Supabase Auth) only looks at the first 72 bytes. */
export const MAX_PASSWORD_LENGTH = 72;

export const newPasswordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters`)
  .refine((p) => new TextEncoder().encode(p).length <= MAX_PASSWORD_LENGTH, "That password is too long")
  .refine((p) => new Set(p).size >= 4, "Use a less repetitive password");

/** Checks a new password and its confirmation; returns an error message or null. */
export function checkNewPassword(password: string, confirm: string): string | null {
  const parsed = newPasswordSchema.safeParse(password);
  if (!parsed.success) return parsed.error.issues[0]?.message ?? "Invalid password";
  if (password !== confirm) return "The two passwords don't match";
  return null;
}

// No 0/O, 1/l/I: the admin may read the password out loud or retype it.
const ALPHABET = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Random temporary password like `k7Qm-x3Pd-W9ta` (~68 bits). */
export function generateTemporaryPassword(): string {
  const chars: string[] = [];
  const limit = 256 - (256 % ALPHABET.length);
  while (chars.length < 12) {
    for (const byte of crypto.getRandomValues(new Uint8Array(24))) {
      if (byte < limit && chars.length < 12) chars.push(ALPHABET[byte % ALPHABET.length]!);
    }
  }
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8)].map((g) => g.join("")).join("-");
}

/** Maps Supabase Auth password sign-in errors to a friendly message. */
export function passwordSignInError(error: { message?: string; code?: string; status?: number }): string {
  const message = (error.message ?? "").toLowerCase();
  if (error.code === "invalid_credentials" || message.includes("invalid login credentials")) {
    return "That email and password don't match. If you normally use Google, choose “Continue with Google”.";
  }
  if (message.includes("does not currently have access")) {
    return "Access for this account is currently disabled. Contact the administrator.";
  }
  if (error.code === "email_provider_disabled" || message.includes("logins are disabled")) {
    return "Password sign-in isn't switched on for this app yet. Ask the administrator, or use Google.";
  }
  if (error.status === 429 || error.code === "over_request_rate_limit") {
    return "Too many attempts. Wait a few minutes and try again.";
  }
  if (message.includes("failed to fetch")) return "Network error — check your connection.";
  return "Sign-in didn't complete. Please try again.";
}

/** Maps Supabase Auth errors when changing a password. */
export function passwordChangeError(error: { message?: string; code?: string }): string {
  const message = (error.message ?? "").toLowerCase();
  if (error.code === "same_password" || message.includes("different from the old")) {
    return "Choose a password that's different from your current one.";
  }
  if (error.code === "weak_password" || message.includes("password should")) {
    return `Choose a stronger password (at least ${MIN_PASSWORD_LENGTH} characters).`;
  }
  if (message.includes("failed to fetch")) return "Network error — check your connection.";
  return "Couldn't change the password. Please try again.";
}
