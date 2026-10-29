import { handleRouteError } from "@/lib/errors";
import { getVapidKeys } from "@/lib/push.server";
import { getSupabaseServiceClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** Public VAPID key the browser needs to subscribe (signed-in users only, via the proxy). */
export async function GET() {
  try {
    const { publicKey } = await getVapidKeys(getSupabaseServiceClient());
    return Response.json({ ok: true, publicKey });
  } catch (error) {
    return handleRouteError("push/key", error);
  }
}
