import { describe, expect, it } from "vitest";
import { backoffMs, createLockConfig, isValidPin, verifyPin } from "@/lib/app-lock";

describe("app lock", () => {
  it("accepts 4–6 digit PINs only", () => {
    expect(["1234", "123456"].every(isValidPin)).toBe(true);
    expect(["123", "1234567", "12a4", ""].some(isValidPin)).toBe(false);
  });

  it("stores a salted hash, never the PIN, and verifies it", async () => {
    const config = await createLockConfig("2580", 60_000);
    expect(JSON.stringify(config)).not.toContain("2580");
    expect(config.pinLength).toBe(4);
    expect(await verifyPin(config, "2580")).toBe(true);
    expect(await verifyPin(config, "2581")).toBe(false);
    const again = await createLockConfig("2580", 0);
    expect(again.hash).not.toBe(config.hash); // different salt
  });

  it("slows down guessing after 5 wrong PINs", () => {
    expect([1, 4].map(backoffMs)).toEqual([0, 0]);
    expect([5, 6, 7].map(backoffMs)).toEqual([30_000, 60_000, 120_000]);
    expect(backoffMs(20)).toBe(15 * 60_000);
  });
});
