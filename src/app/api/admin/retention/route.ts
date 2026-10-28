import { authorizeAdminRequest } from "@/lib/admin-route";
import { AppError, handleRouteError, toUserMessage } from "@/lib/errors";
import { removeStorageObjects } from "@/lib/storage.server";
import { getSupabaseServiceClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

interface PurgeResult {
  messages_deleted: number;
  audit_deleted: number;
  storage_paths: string[];
}

/** "Run retention now" button in the admin dashboard. */
export async function POST(request: Request) {
  try {
    const { supabase } = await authorizeAdminRequest(request);
    const { data, error } = await supabase.rpc("admin_run_retention_purge");
    if (error) throw new AppError(toUserMessage(error), 400, "rejected");
    const result = data as PurgeResult;
    const filesRemoved = await removeStorageObjects(getSupabaseServiceClient(), result.storage_paths ?? []);
    return Response.json({
      ok: true,
      messagesDeleted: result.messages_deleted,
      auditDeleted: result.audit_deleted,
      filesRemoved,
    });
  } catch (error) {
    return handleRouteError("admin/retention", error);
  }
}
