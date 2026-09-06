import { describe, expect, it } from "vitest";

import {
  loginSchema,
  normalizePhone,
  passwordSchema,
  registerSchema,
  resetPasswordSchema,
} from "@/lib/validation/auth";

const validRegistration = {
  fullName: "Rehana Khatun",
  email: "Rehana@Example.com",
  phone: "01712345678",
  password: "Test-Password-123",
  confirmPassword: "Test-Password-123",
};

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

describe("registerSchema", () => {
  it("accepts a valid registration and normalises it", () => {
    const result = registerSchema.parse(validRegistration);

    expect(result.phone).toBe("+8801712345678");
    // Stored lowercase so one person cannot hold two accounts differing by case.
    expect(result.email).toBe("rehana@example.com");
  });

  it.each([
    ["0171234567", "too short"],
    ["01112345678", "invalid operator prefix"],
    ["+15551234567", "not a Bangladesh number"],
  ])("rejects %s (%s)", (phone) => {
    const result = registerSchema.safeParse({ ...validRegistration, phone });
    expect(result.success).toBe(false);
  });

  it("rejects mismatched passwords against the confirm field", () => {
    const result = registerSchema.safeParse({
      ...validRegistration,
      confirmPassword: "Test-Password-124",
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(["confirmPassword"]);
  });
});

describe("registration holds the same password policy as every other role", () => {
  // The 6-digit PIN registration used to accept is gone. These are the exact
  // values that rule allowed, kept as tests so it cannot quietly come back.
  it.each([
    ["482913", "a 6-digit PIN"],
    ["12345", "shorter still"],
    ["alllowercase123", "no uppercase letter"],
  ])("rejects %s (%s)", (password) => {
    const result = registerSchema.safeParse({
      ...validRegistration,
      password,
      confirmPassword: password,
    });

    expect(result.success).toBe(false);
  });
});

describe("passwordSchema mirrors the Supabase auth policy", () => {
  it.each([
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
});

describe("loginSchema", () => {
  it("does not impose the password policy on existing accounts", () => {
    // A password set before the policy tightened must still be able to sign in.
    expect(loginSchema.safeParse({ email: "a@b.com", password: "old" }).success).toBe(true);
  });

  it("still requires a password", () => {
    expect(loginSchema.safeParse({ email: "a@b.com", password: "" }).success).toBe(false);
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
});
