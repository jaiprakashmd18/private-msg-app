import { getSupabaseServiceClient } from "@/lib/supabase/admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError, logServerError } from "@/lib/errors";
import { assertSameOrigin, clientIp, readJson } from "@/lib/http";
import { consumeLimits } from "@/lib/rate-limit";
import { otpRequestSchema } from "@/lib/validation";

export const runtime = "nodejs";

// Same response whether or not the number is approved, so this endpoint cannot
// be used to discover which numbers are on the allowlist.
const GENERIC_OK = {
  ok: true,
  message: "If this number is approved, a 6-digit code is on its way.",
};

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const parsed = otpRequestSchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message ?? "Invalid phone number", 400, "invalid_phone");
    }
    const phone = parsed.data.phone;
    const service = getSupabaseServiceClient();
    const { data: masked } = await service.rpc("server_mask_phone", { p_phone: phone });

    const allowed = await consumeLimits(service, [
      { scope: "otp:ip", value: clientIp(request), windowSeconds: 3600, max: 20 },
      { scope: "otp:phone", value: phone, windowSeconds: 3600, max: 5 },
      { scope: "otp:phone:burst", value: phone, windowSeconds: 60, max: 1 },
    ]);
    if (!allowed) {
      await service.rpc("server_log_event", { p_action: "auth.otp_rate_limited", p_metadata: { phone: masked } });
      return jsonError("Too many attempts. Please wait a minute and try again.", 429, "rate_limited");
    }

    // Pre-check the allowlist so no SMS is ever sent to an unapproved number.
    // (The auth hook and the auth.users trigger enforce this again inside
    // Supabase Auth, so calling the Auth API directly does not bypass it.)
    const { data: authorized, error: checkError } = await service.rpc("server_phone_is_authorized", {
      p_phone: phone,
    });
    if (checkError) throw checkError;

    if (!authorized) {
      await service.rpc("server_log_event", { p_action: "auth.otp_denied", p_metadata: { phone: masked } });
      return Response.json(GENERIC_OK);
    }

    const supabase = await getSupabaseServerClient();
    const { error } = await supabase.auth.signInWithOtp({ phone, options: { shouldCreateUser: true } });
    if (error) {
      logServerError("auth/otp signInWithOtp", error);
      if (error.status === 429) {
        return jsonError("Too many codes requested. Please wait and try again.", 429, "rate_limited");
      }
      return jsonError("We couldn't send a code right now. Please try again later.", 502, "sms_failed");
    }

    await service.rpc("server_log_event", { p_action: "auth.otp_requested", p_metadata: { phone: masked } });
    return Response.json(GENERIC_OK);
  } catch (error) {
    return handleRouteError("auth/otp", error);
  }
}
