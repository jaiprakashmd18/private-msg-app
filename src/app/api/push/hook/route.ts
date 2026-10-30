import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { handleRouteError, jsonError } from "@/lib/errors";
import { readJson } from "@/lib/http";
import { notifyNewMessage } from "@/lib/push.server";
import { getSupabaseServiceClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const bodySchema = z.object({ message_ids: z.array(z.uuid()).max(200) });

let cachedSecret: string | undefined;

async function hookSecret(): Promise<string | null> {
  if (cachedSecret) return cachedSecret;
  const { data, error } = await getSupabaseServiceClient().rpc("server_app_hook_secret");
  if (error || typeof data !== "string" || !data) return null;
  cachedSecret = data;
  return data;
}

function matches(header: string, secret: string): boolean {
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Called by the database (pg_net) after its every-minute job delivered love
 * notes or date reminders. Authenticated with the secret stored in the
 * database's private schema. Only sends notifications the database allows
 * (timed messages, once each).
 */
export async function POST(request: Request) {
  try {
    const secret = await hookSecret();
    if (!secret || !matches(request.headers.get("authorization") ?? "", secret)) {
      return jsonError("Unauthorized", 401, "unauthorized");
    }
    const { message_ids } = bodySchema.parse(await readJson(request, 16_384));
    const service = getSupabaseServiceClient();
    const origin = new URL(request.url).origin;
    let sent = 0;
    for (const id of message_ids) sent += await notifyNewMessage(service, id, null, origin);
    return Response.json({ ok: true, sent });
  } catch (error) {
    return handleRouteError("push/hook", error);
  }
}
