import { describe, expect, it } from "vitest";

import {
  clientPasswordSchema,
  credentialsFor,
  identifierSchema,
  isClientOnly,
  loginSchema,
  normalizePhone,
  passwordSchema,
  passwordSchemaFor,
  registerSchema,
  resetPasswordSchema,
} from "@/lib/validation/auth";

describe("normalizePhone", () => {
  it.each([
    ["01712345678", "+8801712345678"],
    ["+8801712345678", "+8801712345678"],
    ["8801712345678", "+8801712345678"],
    ["017 1234-5678", "+8801712345678"],
  ])("normalises %s to %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });
});

describe("identifierSchema", () => {
  it("reads an email, lowercased", () => {
    expect(identifierSchema.parse("Rehana@Example.com")).toEqual({ kind: "email", email: "rehana@example.com" });
  });

  it("reads a Bangladesh mobile number, normalised", () => {
    expect(identifierSchema.parse("017 1234-5678")).toEqual({ kind: "phone", phone: "+8801712345678" });
  });

  it.each([
    ["rehana@", "a broken email"],
    ["0171234567", "a number one digit short"],
    ["01112345678", "an invalid operator prefix"],
    ["+15551234567", "a number from elsewhere"],
    ["", "nothing"],
  ])("rejects %s (%s)", (value) => {
    expect(identifierSchema.safeParse(value).success).toBe(false);
  });
});

describe("phone sign-in identity", () => {
  it("maps every spelling of one number to the same sign-in address", () => {
    const expected = { email: "8801712345678@phone.tvcare.invalid", password: "482913" };
    expect(credentialsFor({ kind: "phone", phone: "+8801712345678" }, "482913")).toEqual(expected);
    expect(credentialsFor({ kind: "phone", phone: "01712345678" }, "482913")).toEqual(expected);
  });

  it("refuses the reserved domain typed as an email", () => {
    expect(identifierSchema.safeParse("8801712345678@phone.tvcare.invalid").success).toBe(false);
  });
});

describe("registerSchema", () => {
  it("accepts an email and a 6-digit PIN", () => {
    const result = registerSchema.parse({ identifier: "a@b.com", password: "482913", confirmPassword: "482913" });
    expect(result.identifier).toEqual({ kind: "email", email: "a@b.com" });
  });

  it("accepts a mobile number and a 6-digit PIN", () => {
    expect(
      registerSchema.safeParse({ identifier: "01712345678", password: "000000", confirmPassword: "000000" }).success,
    ).toBe(true);
  });

  it.each([
    ["sunflower", "a password"],
    ["Test-Password-123", "a strong password"],
    ["12345", "5 digits"],
    ["1234567", "7 digits"],
    ["12345a", "a letter"],
  ])("rejects %s (%s) — registration takes a PIN only", (password) => {
    expect(registerSchema.safeParse({ identifier: "a@b.com", password, confirmPassword: password }).success).toBe(false);
  });

  it("rejects a mismatch against the confirm field", () => {
    const result = registerSchema.safeParse({ identifier: "a@b.com", password: "482913", confirmPassword: "482914" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(["confirmPassword"]);
  });
});

describe("clientPasswordSchema", () => {
  it.each([
    ["482913", "a 6-digit PIN"],
    ["000000", "any six digits"],
  ])("accepts %s (%s)", (password) => {
    expect(clientPasswordSchema.safeParse(password).success).toBe(true);
  });

  it.each([
    ["12345", "a 5-digit PIN"],
    ["1234567", "7 digits"],
    ["12345678", "8 digits"],
    ["abcdef", "6 letters"],
    ["sunflower", "a password"],
    ["Test-Password-123", "a strong password"],
    [" 482913", "a PIN with a space"],
  ])("rejects %s (%s)", (password) => {
    expect(clientPasswordSchema.safeParse(password).success).toBe(false);
  });
});

describe("staff keep the strong password rule", () => {
  it.each([
    ["482913", "a PIN"],
    ["Short-1a", "fewer than 10 characters"],
    ["alllowercase123", "no uppercase letter"],
    ["ALLUPPERCASE123", "no lowercase letter"],
    ["NoDigitsInHere", "no digit"],
  ])("rejects %s (%s)", (password) => {
    expect(passwordSchema.safeParse(password).success).toBe(false);
  });

  it("accepts a password meeting every requirement", () => {
    expect(passwordSchema.safeParse("Test-Password-123").success).toBe(true);
  });

  it("applies the client rule only to someone who is only a client", () => {
    expect(isClientOnly(["client"])).toBe(true);
    expect(isClientOnly(["client", "doctor"])).toBe(false);
    expect(isClientOnly([])).toBe(false);
    expect(passwordSchemaFor(["client"]).safeParse("482913").success).toBe(true);
    expect(passwordSchemaFor(["client"]).safeParse("Test-Password-123").success).toBe(false);
    expect(passwordSchemaFor(["doctor"]).safeParse("Test-Password-123").success).toBe(true);
    expect(passwordSchemaFor(["client", "doctor"]).safeParse("482913").success).toBe(false);
    expect(passwordSchemaFor(["admin"]).safeParse("482913").success).toBe(false);
  });
});

describe("loginSchema", () => {
  it("does not impose any password policy on existing accounts", () => {
    expect(loginSchema.safeParse({ identifier: "a@b.com", password: "old" }).success).toBe(true);
  });

  it("still requires a password", () => {
    expect(loginSchema.safeParse({ identifier: "01712345678", password: "" }).success).toBe(false);
  });
});

describe("resetPasswordSchema", () => {
  it("requires both fields to match", () => {
    const result = resetPasswordSchema.safeParse({
      password: "Test-Password-123",
      confirmPassword: "Test-Password-124",
    });

    expect(result.success).toBe(false);
  });

  it.each([
    ["482913", "a client's PIN"],
    ["Test-Password-123", "a staff password"],
  ])("lets %s (%s) through to the per-role check on the server", (password) => {
    expect(resetPasswordSchema.safeParse({ password, confirmPassword: password }).success).toBe(true);
  });
});
