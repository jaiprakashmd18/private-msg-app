import { versionInfo } from "@/lib/app-version";

/**
 * The current website build, and which Android / iOS app builds still work.
 * Public (the login page updates too) and never cached.
 */
export function GET() {
  return Response.json(versionInfo(), { headers: { "cache-control": "no-store, max-age=0" } });
}
