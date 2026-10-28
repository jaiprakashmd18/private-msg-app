import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ATTACHMENTS_BUCKET } from "@/lib/constants";
import { logServerError } from "@/lib/errors";

/** Removes files through the Storage API (direct SQL deletes are not allowed). */
export async function removeStorageObjects(service: SupabaseClient, paths: string[]): Promise<number> {
  const unique = [...new Set(paths.filter(Boolean))];
  let removed = 0;
  for (let i = 0; i < unique.length; i += 100) {
    const batch = unique.slice(i, i + 100);
    const { data, error } = await service.storage.from(ATTACHMENTS_BUCKET).remove(batch);
    if (error) {
      logServerError("storage.remove", error);
      continue;
    }
    removed += data?.length ?? 0;
  }
  return removed;
}
