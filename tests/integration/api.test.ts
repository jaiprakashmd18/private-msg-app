/**
 * HTTP-level tests for the Next.js route handlers. Requires the app running
 * against a LOCAL Supabase stack:
 *   npm run build && npm start        (with .env.local pointing at `supabase start`)
 *   APP_URL=http://localhost:3000 npm run test:integration
 */
import { describe, expect, it } from "vitest";

const appUrl = process.env.APP_URL;
const enabled = Boolean(appUrl);

function post(path: string, body: unknown, origin = appUrl!) {
  return fetch(`${appUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

describe.skipIf(!enabled)("Next.js API routes", () => {
  it("sends refused Google sign-ins back to the login page with a reason", async () => {
    const cases: [string, string][] = [
      ["error=access_denied&error_description=This+Google+account+is+not+authorized+to+use+this+app.", "not_authorized"],
      ["error=server_error&error_description=This+Google+account+does+not+currently+have+access", "no_access"],
      ["", "failed"],
      ["code=not-a-real-code", "failed"],
    ];
    for (const [query, reason] of cases) {
      const res = await fetch(`${appUrl}/auth/callback?${query}`, { redirect: "manual" });
      expect(res.status).toBe(307);
      expect(res.headers.get("location")).toMatch(new RegExp(`/login\\?error=${reason}$`));
    }
    const page = await (await fetch(`${appUrl}/login?error=not_authorized`)).text();
    expect(page).toContain("isn&#x27;t approved");
  });

  it("rejects cross-site sign-out requests", async () => {
    const res = await post("/api/auth/signout", {}, "https://evil.example");
    expect([401, 403]).toContain(res.status); // 401 when signed out, 403 (origin check) when signed in
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
