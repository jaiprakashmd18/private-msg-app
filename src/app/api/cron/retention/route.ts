import { timingSafeEqual } from "node:crypto";
import { getServerEnv } from "@/lib/env.server";
import { handleRouteError, jsonError } from "@/lib/errors";
import { removeStorageObjects } from "@/lib/storage.server";
import { getSupabaseServiceClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function authorized(request: Request): boolean {
  const { CRON_SECRET } = getServerEnv();
  if (!CRON_SECRET) return false;
  const header = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${CRON_SECRET}`);
  const actual = Buffer.from(header);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Daily retention job, triggered by Vercel Cron (see vercel.json). */
export async function GET(request: Request) {
  try {
    if (!authorized(request)) return jsonError("Unauthorized", 401, "unauthorized");
    const service = getSupabaseServiceClient();
    const { data, error } = await service.rpc("server_run_retention_purge");
    if (error) throw error;
    const result = data as { messages_deleted: number; audit_deleted: number; storage_paths: string[] };
    const filesRemoved = await removeStorageObjects(service, result.storage_paths ?? []);
    return Response.json({
      ok: true,
      messagesDeleted: result.messages_deleted,
      auditDeleted: result.audit_deleted,
      filesRemoved,
    });
  } catch (error) {
    return handleRouteError("cron/retention", error);
  }
}
