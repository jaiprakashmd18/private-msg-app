import { AppError, handleRouteError, jsonError } from "@/lib/errors";
import { safeFetch } from "@/lib/safe-fetch.server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/avif"];

/**
 * Link-preview pictures, fetched by our server: the other site never sees who
 * is looking, and our strict content-security rules stay in place. Raster
 * images only (no SVG), at most 2 MB.
 */
export async function GET(request: Request) {
  try {
    const supabase = await getSupabaseServerClient();
    const { data } = await supabase.auth.getClaims();
    if (!data?.claims?.sub) throw new AppError("Not signed in", 401, "unauthenticated");
    const target = new URL(request.url).searchParams.get("url") ?? "";
    if (!/^https?:\/\//i.test(target) || target.length > 2000) throw new AppError("Invalid link", 400, "bad_request");

    const res = await safeFetch(target, { maxBytes: 2 * 1024 * 1024 + 1, accept: IMAGE_TYPES.join(",") }).catch(() => null);
    const type = res?.contentType.split(";")[0]?.trim() ?? "";
    if (!res || res.status >= 400 || !IMAGE_TYPES.includes(type) || res.body.length > 2 * 1024 * 1024) {
      return jsonError("No image", 404, "no_image");
    }
    return new Response(new Uint8Array(res.body), {
      headers: {
        "content-type": type,
        "cache-control": "private, max-age=86400",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'",
      },
    });
  } catch (error) {
    return handleRouteError("link-preview/image", error);
  }
}
