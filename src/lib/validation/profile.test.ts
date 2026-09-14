import { describe, expect, it } from "vitest";

import { changePasswordSchema, clientChangePasswordSchema } from "@/lib/validation/profile";

describe("clientChangePasswordSchema", () => {
  it("accepts a new 6-digit PIN", () => {
    expect(
      clientChangePasswordSchema.safeParse({ currentPassword: "482913", newPassword: "135790", confirmPassword: "135790" })
        .success,
    ).toBe(true);
  });

  it("lets a client with an older password move to a PIN", () => {
    expect(
      clientChangePasswordSchema.safeParse({ currentPassword: "sunflower", newPassword: "135790", confirmPassword: "135790" })
        .success,
    ).toBe(true);
  });

  it.each([
    ["sunflower", "a password"],
    ["12345", "5 digits"],
    ["1234567", "7 digits"],
  ])("rejects a new %s (%s)", (newPassword) => {
    expect(
      clientChangePasswordSchema.safeParse({ currentPassword: "482913", newPassword, confirmPassword: newPassword }).success,
    ).toBe(false);
  });

  it("rejects a mismatched confirmation", () => {
    const result = clientChangePasswordSchema.safeParse({
      currentPassword: "482913",
      newPassword: "135790",
      confirmPassword: "135791",
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(["confirmPassword"]);
  });
});

describe("changePasswordSchema (staff)", () => {
  it("still refuses a PIN", () => {
    expect(
      changePasswordSchema.safeParse({ currentPassword: "x", newPassword: "482913", confirmPassword: "482913" }).success,
    ).toBe(false);
  });
});
