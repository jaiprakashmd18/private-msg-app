import { AppError, handleRouteError } from "@/lib/errors";
import { readJson } from "@/lib/http";
import { getSupabaseServiceClient } from "@/lib/supabase/admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/validation";

export const runtime = "nodejs";

/**
 * Called by the service worker when a notification reaches this device, so
 * the sender sees ✓✓ "Delivered" even though the app wasn't opened. Only moves
 * the signed-in user's own delivery mark in that conversation forward (it
 * never touches "seen" or "last seen"). No same-origin check: the service
 * worker's request may carry no Origin header, cookies are SameSite=Lax (not
 * sent on cross-site POSTs), and the worst a forged call could do is mark
 * your own messages as delivered.
 */
export async function POST(request: Request) {
  try {
    const body = (await readJson(request)) as { conversationId?: unknown };
    const conversationId = uuidSchema.parse(body.conversationId);
    const supabase = await getSupabaseServerClient();
    const { data } = await supabase.auth.getClaims();
    const userId = data?.claims?.sub;
    if (!userId) throw new AppError("Not signed in", 401, "unauthenticated");

    const { error } = await getSupabaseServiceClient()
      .from("conversation_members")
      .update({ last_delivered_at: new Date().toISOString() })
      .eq("conversation_id", conversationId)
      .eq("user_id", userId)
      .is("left_at", null);
    if (error) throw error;
    return Response.json({ ok: true });
  } catch (error) {
    return handleRouteError("push/delivered", error);
  }
}
