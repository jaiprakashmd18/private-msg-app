import { describe, expect, it } from "vitest";
import { storeUpdateNeeded, versionInfo, websiteUpdateAction } from "@/lib/app-version";

describe("website updates reach open tabs and apps", () => {
  const base = { clientBuild: "abc123", returningToApp: true, busy: false };

  it("does nothing while you're on the latest build", () => {
    expect(websiteUpdateAction({ ...base, serverBuild: "abc123" })).toBe("none");
    expect(websiteUpdateAction({ ...base, serverBuild: null })).toBe("none");
  });

  it("reloads by itself when you come back to the app and nothing would be lost", () => {
    expect(websiteUpdateAction({ ...base, serverBuild: "def456" })).toBe("reload");
  });

  it("asks instead while you're using the app, typing, or in a dialog", () => {
    expect(websiteUpdateAction({ ...base, serverBuild: "def456", returningToApp: false })).toBe("prompt");
    expect(websiteUpdateAction({ ...base, serverBuild: "def456", busy: true })).toBe("prompt");
  });
});

describe("store updates for the Android and iOS apps", () => {
  it("reads minimum / latest builds and store links from the environment", () => {
    const info = versionInfo({ MIN_ANDROID_BUILD: "3", LATEST_ANDROID_BUILD: "5", MIN_IOS_BUILD: "x", IOS_APP_STORE_ID: "id6740001234" });
    expect(info.android).toEqual({
      min: 3,
      latest: 5,
      url: "https://play.google.com/store/apps/details?id=com.jaiprakash.ghostline",
    });
    expect(info.ios).toEqual({ min: 0, latest: 0, url: "https://apps.apple.com/app/id6740001234" });
    expect(versionInfo({}).ios.url).toBe("https://apps.apple.com/search?term=Ghostline");
  });

  it("requires an update below the minimum and suggests one below the latest", () => {
    const store = { min: 3, latest: 5, url: "" };
    expect(storeUpdateNeeded(2, store)).toBe("required");
    expect(storeUpdateNeeded(4, store)).toBe("available");
    expect(storeUpdateNeeded(5, store)).toBeNull();
    expect(storeUpdateNeeded(1, { min: 0, latest: 0, url: "" })).toBeNull();
    expect(storeUpdateNeeded(Number.NaN, store)).toBeNull();
  });
});
