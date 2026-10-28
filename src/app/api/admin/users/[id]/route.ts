import { authorizeAdminRequest } from "@/lib/admin-route";
import { AppError, handleRouteError, toUserMessage } from "@/lib/errors";
import { removeStorageObjects } from "@/lib/storage.server";
import { getSupabaseServiceClient } from "@/lib/supabase/admin";
import { uuidSchema } from "@/lib/validation";

export const runtime = "nodejs";

/**
 * Permanently deletes a user account and all messages and files they sent.
 * Step 1 (DB, as the admin): admin_prepare_user_deletion — authorization,
 *   audit entry, deletes messages, returns file paths.
 * Step 2 (service role): delete files and the auth user (profile and
 *   memberships cascade).
 */
export async function DELETE(request: Request, ctx: RouteContext<"/api/admin/users/[id]">) {
  try {
    const { supabase } = await authorizeAdminRequest(request);
    const { id } = await ctx.params;
    const userId = uuidSchema.parse(id);

    const { data: paths, error } = await supabase.rpc("admin_prepare_user_deletion", { p_user_id: userId });
    if (error) throw new AppError(toUserMessage(error), 400, "rejected");

    const service = getSupabaseServiceClient();
    const filesRemoved = await removeStorageObjects(service, (paths as string[] | null) ?? []);
    const { error: deleteError } = await service.auth.admin.deleteUser(userId);
    if (deleteError) throw deleteError;

    return Response.json({ ok: true, filesRemoved });
  } catch (error) {
    return handleRouteError("admin/users/delete", error);
  }
}
