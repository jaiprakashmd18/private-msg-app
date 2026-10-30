import { describe, expect, it } from "vitest";
import {
  checkNewPassword,
  generateTemporaryPassword,
  passwordChangeError,
  passwordSignInError,
} from "@/lib/password";

describe("passwords", () => {
  it("generates readable, random temporary passwords that pass the rules", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const p = generateTemporaryPassword();
      expect(p).toMatch(/^[a-km-zA-HJ-NP-Z2-9]{4}-[a-km-zA-HJ-NP-Z2-9]{4}-[a-km-zA-HJ-NP-Z2-9]{4}$/);
      expect(checkNewPassword(p, p)).toBeNull();
      seen.add(p);
    }
    expect(seen.size).toBe(200);
  });

  it("checks new passwords", () => {
    expect(checkNewPassword("short", "short")).toMatch(/at least 10/);
    expect(checkNewPassword("aaaaaaaaaaaa", "aaaaaaaaaaaa")).toMatch(/repetitive/);
    expect(checkNewPassword("x".repeat(40) + "abcd".repeat(9), "x")).toMatch(/too long/);
    expect(checkNewPassword("correct horse battery", "correct horse batterie")).toMatch(/don't match/);
    expect(checkNewPassword("correct horse battery", "correct horse battery")).toBeNull();
  });

  it("explains sign-in failures without revealing whether an account exists", () => {
    expect(passwordSignInError({ code: "invalid_credentials", message: "Invalid login credentials" })).toMatch(
      /don't match/,
    );
    expect(passwordSignInError({ message: "This account does not currently have access to this app." })).toMatch(
      /disabled/,
    );
    expect(passwordSignInError({ code: "email_provider_disabled", message: "Email logins are disabled" })).toMatch(
      /isn't switched on/,
    );
    expect(passwordSignInError({ status: 429, message: "Too many" })).toMatch(/Too many attempts/);
    expect(passwordSignInError({ message: "boom" })).toMatch(/didn't complete/);
    expect(passwordChangeError({ code: "same_password" })).toMatch(/different/);
  });
});
