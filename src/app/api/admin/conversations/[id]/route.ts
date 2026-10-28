import { authorizeAdminRequest } from "@/lib/admin-route";
import { AppError, handleRouteError, toUserMessage } from "@/lib/errors";
import { removeStorageObjects } from "@/lib/storage.server";
import { getSupabaseServiceClient } from "@/lib/supabase/admin";
import { uuidSchema } from "@/lib/validation";

export const runtime = "nodejs";

export async function DELETE(request: Request, ctx: RouteContext<"/api/admin/conversations/[id]">) {
  try {
    const { supabase } = await authorizeAdminRequest(request);
    const { id } = await ctx.params;
    const conversationId = uuidSchema.parse(id);

    const { data: paths, error } = await supabase.rpc("admin_delete_conversation", {
      p_conversation_id: conversationId,
    });
    if (error) throw new AppError(toUserMessage(error), 400, "rejected");

    const filesRemoved = await removeStorageObjects(getSupabaseServiceClient(), (paths as string[] | null) ?? []);
    return Response.json({ ok: true, filesRemoved });
  } catch (error) {
    return handleRouteError("admin/conversations/delete", error);
  }
}
