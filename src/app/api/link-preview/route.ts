import { AppError, handleRouteError, jsonError } from "@/lib/errors";
import { parsePreview } from "@/lib/link-preview";
import { safeFetch } from "@/lib/safe-fetch.server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** Title, description and picture of a link in a message (signed-in users only). */
export async function GET(request: Request) {
  try {
    const supabase = await getSupabaseServerClient();
    const { data } = await supabase.auth.getClaims();
    if (!data?.claims?.sub) throw new AppError("Not signed in", 401, "unauthenticated");
    const target = new URL(request.url).searchParams.get("url") ?? "";
    if (!/^https?:\/\//i.test(target) || target.length > 2000) throw new AppError("Invalid link", 400, "bad_request");

    let preview = null;
    try {
      const page = await safeFetch(target, { maxBytes: 512 * 1024, accept: "text/html,application/xhtml+xml" });
      if (page.status < 400 && page.contentType.includes("html")) {
        preview = parsePreview(page.body.toString("utf8"), page.url);
      }
    } catch {
      preview = null; // unreachable, blocked or not a page: no card
    }
    if (!preview) return jsonError("No preview", 404, "no_preview");
    return Response.json(
      { ok: true, preview: { ...preview, image: preview.image ? `/api/link-preview/image?url=${encodeURIComponent(preview.image)}` : null } },
      { headers: { "cache-control": "private, max-age=86400" } },
    );
  } catch (error) {
    return handleRouteError("link-preview", error);
  }
}
