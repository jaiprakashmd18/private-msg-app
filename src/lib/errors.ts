/**
 * Centralized error handling. Database functions raise exceptions with
 * user-safe messages and SQLSTATE codes; this module maps them to messages for
 * the UI and to HTTP responses in route handlers. Internal details are never
 * sent to the client.
 */

export class AppError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    public readonly code = "bad_request",
  ) {
    super(message);
    this.name = "AppError";
  }
}

type PgLikeError = { message?: string; code?: string; details?: string; hint?: string };

/** SQLSTATEs whose messages come from our own RAISE statements and are safe to show. */
const SAFE_CODES = new Set(["42501", "22023", "22001", "23505", "P0002", "PT429", "28000"]);

export function toUserMessage(error: unknown, fallback = "Something went wrong. Please try again."): string {
  if (!error) return fallback;
  if (error instanceof AppError) return error.message;
  if (typeof error === "object") {
    const e = error as PgLikeError;
    if (e.code === "42501" && e.message?.includes("permission denied")) {
      return "You do not have permission to do that.";
    }
    if (e.code && SAFE_CODES.has(e.code) && e.message) return e.message;
    if (e.message?.toLowerCase().includes("failed to fetch")) {
      return "Network error — check your connection.";
    }
    if (e.message?.toLowerCase().includes("jwt expired")) {
      return "Your session expired. Please sign in again.";
    }
  }
  return fallback;
}

export function isAccessRevokedError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as PgLikeError;
  return e.code === "42501" && /revoked|not authorized/i.test(e.message ?? "");
}

/** Logs server-side without leaking secrets or message bodies. */
export function logServerError(context: string, error: unknown) {
  const e = (error ?? {}) as PgLikeError & { name?: string; status?: number };
  console.error(`[${context}]`, {
    name: e.name,
    code: e.code,
    status: e.status,
    message: typeof e.message === "string" ? e.message.slice(0, 300) : undefined,
  });
}

export function jsonError(message: string, status = 400, code = "bad_request") {
  return Response.json({ ok: false, error: { message, code } }, { status });
}

export function handleRouteError(context: string, error: unknown) {
  if (error instanceof AppError) return jsonError(error.message, error.status, error.code);
  if (error instanceof Error && error.name === "ZodError") return jsonError("Invalid request", 400, "bad_request");
  logServerError(context, error);
  return jsonError("Something went wrong. Please try again.", 500, "internal");
}
