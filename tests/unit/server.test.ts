import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppError, handleRouteError, isAccessRevokedError, toUserMessage } from "@/lib/errors";
import { assertSameOrigin, clientIp, readJson } from "@/lib/http";

function req(headers: Record<string, string>, body = "") {
  return new Request("http://localhost:3000/api/x", { method: "POST", headers, body: body || undefined });
}

describe("same-origin (CSRF) check", () => {
  it("accepts requests from the app's own origin", () => {
    expect(() => assertSameOrigin(req({ origin: "http://localhost:3000", host: "localhost:3000" }))).not.toThrow();
  });

  it("rejects cross-site and origin-less requests", () => {
    expect(() => assertSameOrigin(req({ origin: "https://evil.example", host: "localhost:3000" }))).toThrow(AppError);
    expect(() => assertSameOrigin(req({ host: "localhost:3000" }))).toThrow(AppError);
    expect(() => assertSameOrigin(req({ origin: "null", host: "localhost:3000" }))).toThrow(AppError);
  });
});

describe("request helpers", () => {
  it("reads the client IP from proxy headers", () => {
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" }))).toBe("203.0.113.5");
    expect(clientIp(req({}))).toBe("unknown");
  });

  it("rejects oversized and malformed JSON bodies", async () => {
    await expect(readJson(req({}, "x".repeat(5000)))).rejects.toThrow(/too large/);
    await expect(readJson(req({}, "{oops"))).rejects.toThrow(/Invalid JSON/);
    await expect(readJson(req({}, '{"a":1}'))).resolves.toEqual({ a: 1 });
  });
});

describe("error mapping", () => {
  it("shows messages raised by our database functions", () => {
    expect(toUserMessage({ code: "42501", message: "You are not a member of this conversation" })).toBe(
      "You are not a member of this conversation",
    );
    expect(toUserMessage({ code: "PT429", message: "You are sending messages too quickly" })).toMatch(/too quickly/);
  });

  it("hides internal errors", () => {
    expect(toUserMessage({ code: "XX000", message: "internal stack trace" })).toBe(
      "Something went wrong. Please try again.",
    );
    expect(toUserMessage({ code: "42501", message: "permission denied for table messages" })).toBe(
      "You do not have permission to do that.",
    );
  });

  it("detects revoked access", () => {
    expect(isAccessRevokedError({ code: "42501", message: "Access revoked or not authorized" })).toBe(true);
    expect(isAccessRevokedError({ code: "22023", message: "Message is empty" })).toBe(false);
  });

  it("returns generic 500s without leaking details", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = handleRouteError("test", new Error("db password is hunter2"));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("hunter2");
    spy.mockRestore();
  });
});

describe("rate-limit keys", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "x".repeat(40);
    process.env.APP_SECRET = "s".repeat(64);
    vi.resetModules();
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("never contains the raw phone number or IP", async () => {
    const { hashKey } = await import("@/lib/rate-limit");
    const key = hashKey("otp:phone", "+14155550123");
    expect(key).toMatch(/^otp:phone:[0-9a-f]{32}$/);
    expect(key).not.toContain("4155550123");
    expect(hashKey("otp:phone", "+14155550123")).toBe(key);
    expect(hashKey("otp:phone", "+14155550124")).not.toBe(key);
  });

  it("fails closed when the limiter cannot be reached", async () => {
    const { consumeLimits } = await import("@/lib/rate-limit");
    const failing = { rpc: async () => ({ data: null, error: { message: "down" } }) };
    const allowed = await consumeLimits(failing as never, [
      { scope: "otp:ip", value: "1.2.3.4", windowSeconds: 60, max: 5 },
    ]);
    expect(allowed).toBe(false);
  });
});
