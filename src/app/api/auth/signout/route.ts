import { getSupabaseServerClient } from "@/lib/supabase/server";
import { handleRouteError } from "@/lib/errors";
import { assertSameOrigin } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const supabase = await getSupabaseServerClient();
    const { data } = await supabase.auth.getClaims();
    if (data?.claims?.sub) {
      await supabase.rpc("log_auth_event", { p_action: "auth.sign_out" });
    }
    // scope "local" ends this device's session; Settings offers "everywhere".
    const body = (await request.json().catch(() => ({}))) as { everywhere?: boolean };
    await supabase.auth.signOut({ scope: body.everywhere ? "global" : "local" });
    return Response.json({ ok: true });
  } catch (error) {
    return handleRouteError("auth/signout", error);
  }
}
