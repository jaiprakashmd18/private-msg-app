import "server-only";
import { AppError } from "@/lib/errors";

/**
 * CSRF defence for cookie-authenticated POST/DELETE route handlers: the
 * request must come from this site's own origin.
 */
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!origin || !host) throw new AppError("Invalid request origin", 403, "forbidden");
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new AppError("Invalid request origin", 403, "forbidden");
  }
  if (originHost !== host) throw new AppError("Invalid request origin", 403, "forbidden");
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
}

export async function readJson(request: Request, maxBytes = 4096): Promise<unknown> {
  const text = await request.text();
  if (text.length > maxBytes) throw new AppError("Request too large", 413, "too_large");
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("Invalid JSON body", 400, "bad_request");
  }
}
