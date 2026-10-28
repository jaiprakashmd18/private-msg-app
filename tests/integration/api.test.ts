/**
 * HTTP-level tests for the Next.js route handlers. Requires the app running
 * against a LOCAL Supabase stack:
 *   npm run build && npm start        (with .env.local pointing at `supabase start`)
 *   APP_URL=http://localhost:3000 SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run test:integration
 */
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

const appUrl = process.env.APP_URL;
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(appUrl && supabaseUrl && serviceKey);

function post(path: string, body: unknown, origin = appUrl!) {
  return fetch(`${appUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

describe.skipIf(!enabled)("Next.js API routes", () => {
  it("gives an unapproved number the generic response and creates no account", async () => {
    const phone = `+1555${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
    const res = await post("/api/auth/otp", { phone });
    expect(res.status).toBe(200);
    expect((await res.json()).message).toMatch(/If this number is approved/);
    const service = createClient(supabaseUrl!, serviceKey!, { auth: { persistSession: false } });
    const { data } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
    expect(data.users.some((u) => u.phone === phone.slice(1))).toBe(false);
  });

  it("rejects malformed numbers and cross-site requests", async () => {
    expect((await post("/api/auth/otp", { phone: "12345" })).status).toBe(400);
    expect((await post("/api/auth/otp", { phone: "+14155550123" }, "https://evil.example")).status).toBe(403);
    expect((await post("/api/auth/verify", { phone: "+14155550123", token: "abc" })).status).toBe(400);
  });

  it("refuses verification with a wrong code", async () => {
    const res = await post("/api/auth/verify", { phone: "+15550000002", token: "000000" });
    expect([401, 429]).toContain(res.status);
  });

  it("protects admin and cron endpoints", async () => {
    const del = await fetch(`${appUrl}/api/admin/conversations/00000000-0000-0000-0000-000000000000`, {
      method: "DELETE",
      headers: { origin: appUrl! },
    });
    expect(del.status).toBe(401);
    const cron = await fetch(`${appUrl}/api/cron/retention`, { headers: { authorization: "Bearer wrong" } });
    expect(cron.status).toBe(401);
  });

  it("redirects signed-out visitors away from protected pages", async () => {
    for (const path of ["/chat", "/admin", "/settings"]) {
      const res = await fetch(`${appUrl}${path}`, { redirect: "manual" });
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toMatch(/\/login$/);
    }
  });

  it("sends security headers", async () => {
    const res = await fetch(`${appUrl}/login`);
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });
});
