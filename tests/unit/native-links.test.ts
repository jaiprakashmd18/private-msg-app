import { describe, expect, it } from "vitest";
import { androidCertFingerprints, appleTeamId } from "@/lib/native-links.server";
import { isNativeApp, NATIVE_AUTH_CALLBACK, pathForAppUrl } from "@/lib/native";

const SITE = "https://private-msg-app-jai-prakash.vercel.app";

describe("links that open the app", () => {
  it("finishes Google sign-in on the website's own callback page", () => {
    expect(NATIVE_AUTH_CALLBACK).toBe("com.jaiprakash.ghostline://auth/callback");
    expect(pathForAppUrl("com.jaiprakash.ghostline://auth/callback?code=abc-123", SITE)).toBe("/auth/callback?code=abc-123");
    expect(pathForAppUrl("com.jaiprakash.ghostline://auth/callback?error=access_denied", SITE)).toBe(
      "/auth/callback?error=access_denied",
    );
  });

  it("opens chats and settings from app links and website links", () => {
    expect(pathForAppUrl("com.jaiprakash.ghostline://chat/7d1c", SITE)).toBe("/chat/7d1c");
    expect(pathForAppUrl(`${SITE}/chat/7d1c/journal`, SITE)).toBe("/chat/7d1c/journal");
    expect(pathForAppUrl(`${SITE}/settings`, SITE)).toBe("/settings");
  });

  it("ignores other websites, unknown pages and junk", () => {
    expect(pathForAppUrl("https://evil.example/chat/1", SITE)).toBeNull();
    expect(pathForAppUrl(`${SITE}/api/admin/users`, SITE)).toBeNull();
    expect(pathForAppUrl("com.jaiprakash.ghostline://admin", SITE)).toBeNull();
    expect(pathForAppUrl("com.jaiprakash.ghostline:////evil.example/chat", SITE)).toBeNull();
    expect(pathForAppUrl("not a url", SITE)).toBeNull();
  });

  it("is off in a normal browser", () => {
    expect(isNativeApp()).toBe(false);
  });
});

describe("app-link verification settings", () => {
  const fp = Array.from({ length: 32 }, (_, i) => (i + 16).toString(16).toUpperCase()).join(":");

  it("accepts SHA-256 certificate fingerprints, comma or space separated", () => {
    expect(androidCertFingerprints(undefined)).toEqual([]);
    expect(androidCertFingerprints(`${fp.toLowerCase()}, nonsense ${fp}`)).toEqual([fp, fp]);
  });

  it("accepts a 10-character Apple Team ID", () => {
    expect(appleTeamId("ab12cd34ef")).toBe("AB12CD34EF");
    expect(appleTeamId("short")).toBeNull();
    expect(appleTeamId(undefined)).toBeNull();
  });
});
