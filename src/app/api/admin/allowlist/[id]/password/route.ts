import { authorizeAdminRequest } from "@/lib/admin-route";
import { AppError, handleRouteError, toUserMessage } from "@/lib/errors";
import { generateTemporaryPassword } from "@/lib/password";
import { getSupabaseServiceClient } from "@/lib/supabase/admin";
import { uuidSchema } from "@/lib/validation";

export const runtime = "nodejs";

/**
 * Sets a temporary password for an approved member so they can sign in with
 * email + password. The member must choose their own password on first use.
 * Step 1 (DB, as the admin): admin_prepare_password — authorization, checks,
 *   one-time permission to create the account if it doesn't exist yet.
 * Step 2 (service role): Supabase Auth creates the account or sets the password.
 * Step 3 (service role): server_record_admin_password — marks it temporary,
 *   ends the member's other sessions, audit entry.
 * The password is returned once and never stored in plain text.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/admin/allowlist/[id]/password">) {
  try {
    const { supabase, access } = await authorizeAdminRequest(request);
    const { id } = await ctx.params;
    const entryId = uuidSchema.parse(id);

    const { data: target, error } = await supabase
      .rpc("admin_prepare_password", { p_entry_id: entryId })
      .single<{ user_id: string | null; email: string }>();
    if (error || !target) throw new AppError(toUserMessage(error), 400, "rejected");

    const password = generateTemporaryPassword();
    const service = getSupabaseServiceClient();
    let userId = target.user_id;
    const created = !userId;
    if (userId) {
      const { error: updateError } = await service.auth.admin.updateUserById(userId, { password });
      if (updateError) throw updateError;
    } else {
      const { data, error: createError } = await service.auth.admin.createUser({
        email: target.email,
        password,
        email_confirm: true,
      });
      if (createError || !data.user) throw createError ?? new Error("No user returned");
      userId = data.user.id;
    }

    const { error: recordError } = await service.rpc("server_record_admin_password", {
      p_user_id: userId,
      p_admin_id: access.user_id,
      p_created: created,
    });
    if (recordError) throw recordError;

    return Response.json(
      { ok: true, email: target.email, password, created },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    return handleRouteError("admin/allowlist/password", error);
  }
}
