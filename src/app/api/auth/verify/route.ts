import { getSupabaseServiceClient } from "@/lib/supabase/admin";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { handleRouteError, jsonError, logServerError } from "@/lib/errors";
import { assertSameOrigin, clientIp, readJson } from "@/lib/http";
import { consumeLimits } from "@/lib/rate-limit";
import { otpVerifySchema } from "@/lib/validation";
import type { Access } from "@/types/app";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const parsed = otpVerifySchema.safeParse(await readJson(request));
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message ?? "Invalid code", 400, "invalid_input");
    }
    const { phone, token } = parsed.data;
    const service = getSupabaseServiceClient();
    const { data: masked } = await service.rpc("server_mask_phone", { p_phone: phone });

    // Brute-force protection on the 6-digit code (in addition to Supabase's
    // own per-IP verification limits and OTP expiry).
    const allowed = await consumeLimits(service, [
      { scope: "verify:ip", value: clientIp(request), windowSeconds: 900, max: 30 },
      { scope: "verify:phone", value: phone, windowSeconds: 900, max: 8 },
    ]);
    if (!allowed) {
      await service.rpc("server_log_event", { p_action: "auth.verify_rate_limited", p_metadata: { phone: masked } });
      return jsonError("Too many attempts. Please request a new code later.", 429, "rate_limited");
    }

    const supabase = await getSupabaseServerClient();
    const { error } = await supabase.auth.verifyOtp({ phone, token, type: "sms" });
    if (error) {
      await service.rpc("server_log_event", { p_action: "auth.verify_failed", p_metadata: { phone: masked } });
      // Supabase uses 403 both for a wrong/expired code (code "otp_expired") and
      // for a refusal by the custom access token hook (correct code, but the
      // number's access has been disabled or removed).
      if (error.status === 403 && error.code !== "otp_expired") {
        return jsonError(
          "This number does not currently have access. Contact the administrator.",
          403,
          "access_revoked",
        );
      }
      if (error.status && error.status >= 500) logServerError("auth/verify", error);
      return jsonError("That code is invalid or has expired.", 401, "invalid_code");
    }

    await supabase.rpc("log_auth_event", { p_action: "auth.sign_in" });
    const { data: access } = await supabase.rpc("my_access").maybeSingle<Access>();
    if (!access?.is_active) {
      return Response.json({ ok: true, redirectTo: "/unauthorized" });
    }
    return Response.json({ ok: true, redirectTo: "/chat" });
  } catch (error) {
    return handleRouteError("auth/verify", error);
  }
}
