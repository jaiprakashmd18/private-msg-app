import { AppError, handleRouteError } from "@/lib/errors";
import { assertSameOrigin } from "@/lib/http";
import { getSupabaseServiceClient } from "@/lib/supabase/admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { ATTACHMENTS_BUCKET } from "@/lib/constants";
import { uuidSchema } from "@/lib/validation";

export const runtime = "nodejs";

/**
 * Called when the recipient closes a view-once photo: deletes the file for
 * good. The database only gives the path to the person who opened it. (The
 * daily retention job removes any file this call missed.)
 */
export async function POST(request: Request, ctx: RouteContext<"/api/view-once/[id]">) {
  try {
    assertSameOrigin(request);
    const { id } = await ctx.params;
    const attachmentId = uuidSchema.parse(id);
    const supabase = await getSupabaseServerClient();
    const { data: claims } = await supabase.auth.getClaims();
    const userId = claims?.claims?.sub;
    if (!userId) throw new AppError("Not signed in", 401, "unauthenticated");

    const service = getSupabaseServiceClient();
    const { data: path, error } = await service.rpc("server_view_once_opened_path", {
      p_attachment_id: attachmentId,
      p_user_id: userId,
    });
    if (error) throw error;
    if (typeof path !== "string" || !path) throw new AppError("Photo not found", 404, "not_found");
    const { error: removeError } = await service.storage.from(ATTACHMENTS_BUCKET).remove([path]);
    if (removeError) throw removeError;
    return Response.json({ ok: true });
  } catch (error) {
    return handleRouteError("view-once/done", error);
  }
}
