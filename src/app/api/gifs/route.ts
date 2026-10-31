import { getServerEnv } from "@/lib/env.server";
import { AppError, handleRouteError, jsonError } from "@/lib/errors";
import { parseGiphyResponse } from "@/lib/giphy";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * GIF search for the sticker panel. Goes through the server so the GIPHY key
 * stays secret and searches don't reveal who's asking. Signed-in users only.
 * Without GIPHY_API_KEY the panel explains how to switch GIFs on.
 */
export async function GET(request: Request) {
  try {
    const supabase = await getSupabaseServerClient();
    const { data } = await supabase.auth.getClaims();
    if (!data?.claims?.sub) throw new AppError("Not signed in", 401, "unauthenticated");

    const key = getServerEnv().GIPHY_API_KEY;
    if (!key) return jsonError("GIF search isn't set up", 503, "gifs_off");

    const url = new URL(request.url);
    const q = (url.searchParams.get("q") ?? "").trim().slice(0, 50);
    const offset = Math.min(Math.max(Number(url.searchParams.get("offset")) || 0, 0), 500);
    const giphy = new URL(q ? "https://api.giphy.com/v1/gifs/search" : "https://api.giphy.com/v1/gifs/trending");
    giphy.searchParams.set("api_key", key);
    giphy.searchParams.set("limit", "24");
    giphy.searchParams.set("offset", String(offset));
    giphy.searchParams.set("rating", "pg-13");
    if (q) giphy.searchParams.set("q", q);

    const res = await fetch(giphy, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`GIPHY ${res.status}`);
    const gifs = parseGiphyResponse(await res.json());
    return Response.json({ ok: true, gifs }, { headers: { "cache-control": "private, max-age=300" } });
  } catch (error) {
    return handleRouteError("gifs", error);
  }
}
