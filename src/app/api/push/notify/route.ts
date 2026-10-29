import { AppError, handleRouteError } from "@/lib/errors";
import { assertSameOrigin, readJson } from "@/lib/http";
import { notifyNewMessage } from "@/lib/push.server";
import { getSupabaseServiceClient } from "@/lib/supabase/admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/validation";

export const runtime = "nodejs";

/**
 * Called by the sender's app right after a message is saved. The caller's
 * identity comes from their session; the database only returns recipients if
 * the caller really sent that message moments ago, and only once per message.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = (await readJson(request)) as { messageId?: unknown };
    const messageId = uuidSchema.parse(body.messageId);

    const supabase = await getSupabaseServerClient();
    const { data } = await supabase.auth.getClaims();
    const senderId = data?.claims?.sub;
    if (!senderId) throw new AppError("Not signed in", 401, "unauthenticated");

    const sent = await notifyNewMessage(getSupabaseServiceClient(), messageId, senderId, new URL(request.url).origin);
    return Response.json({ ok: true, sent });
  } catch (error) {
    return handleRouteError("push/notify", error);
  }
}
