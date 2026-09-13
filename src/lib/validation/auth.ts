import { z } from "zod";

import type { RoleSlug } from "@/features/auth/session";
import { emailSchema, fullNameSchema, normalizePhone, phoneSchema } from "@/lib/validation/common";

// Re-exported so existing imports of these primitives keep working.
export { emailSchema, fullNameSchema, normalizePhone, phoneSchema };

/**
 * One schema per concern, used by the form on the client and by the server
 * action on the server. Server-side validation is the one that counts; the
 * client copy exists so the user sees the problem before a round trip.
 */

/**
 * The staff password policy: doctors, staff and administrators.
 *
 * The auth server's own floor (config.toml, minimum_password_length = 6, no
 * character requirements) is set for the client rule below, because Supabase
 * applies one policy to every account and cannot tell roles apart. So for staff
 * this schema IS the policy, not a mirror of one: every path that sets a staff
 * password must run it — reset-password, change-password, invitations, and an
 * administrator setting a password.
 */
export const passwordSchema = z
  .string()
  .min(10, "Password must be at least 10 characters")
  .max(72, "Password must be 72 characters or fewer")
  .regex(/[a-z]/, "Password must contain a lowercase letter")
  .regex(/[A-Z]/, "Password must contain an uppercase letter")
  .regex(/\d/, "Password must contain a number");

/**
 * The client rule: a 6-digit PIN, or a password of at least 8 characters.
 *
 * The practice decided registration must be frictionless for pet owners, and
 * reversed d42eede to get there. What still holds: a PIN is exactly six digits
 * (not "123" or "abcdef"), anything that is not a PIN is at least eight
 * characters, and repeated guessing is bounded by the auth server's sign-in
 * rate limit (config.toml, auth.rate_limit.sign_in_sign_ups).
 */
export const clientPasswordSchema = z
  .string()
  .max(72, "Password must be 72 characters or fewer")
  .refine((value) => /^\d{6}$/.test(value) || (value.length >= 8 && !/^\d+$/.test(value)), {
    message: "Use a 6-digit PIN, or a password of at least 8 characters",
  });

/** Whether this person is only a pet owner — the one case the client rule applies to. */
export function isClientOnly(roles: readonly RoleSlug[]): boolean {
  return roles.length > 0 && roles.every((role) => role === "client");
}

/** The password rule for someone holding these roles. Anyone holding a staff role gets the staff rule. */
export function passwordSchemaFor(roles: readonly RoleSlug[]) {
  return isClientOnly(roles) ? clientPasswordSchema : passwordSchema;
}

/**
 * Email or Bangladesh mobile number, in one field. Anything with an @ is judged
 * as an email and nothing else, so a mistyped address gets an email error
 * rather than a baffling phone one.
 */
export const identifierSchema = z
  .string()
  .trim()
  .min(1, "Enter your email or mobile number")
  .transform((value, ctx) => {
    if (value.includes("@")) {
      const email = emailSchema.safeParse(value);
      if (email.success && email.data.endsWith(`@${PHONE_LOGIN_DOMAIN}`)) {
        ctx.addIssue({ code: "custom", message: "Enter your own email address" });
        return z.NEVER;
      }
      if (email.success) return { kind: "email" as const, email: email.data };
      ctx.addIssue({ code: "custom", message: "Enter a valid email address" });
      return z.NEVER;
    }

    const phone = phoneSchema.safeParse(value);
    if (phone.success) return { kind: "phone" as const, phone: phone.data };
    ctx.addIssue({
      code: "custom",
      message: "Enter a valid email, or a Bangladesh mobile number such as 01712345678",
    });
    return z.NEVER;
  });

export type Identifier = z.output<typeof identifierSchema>;

/**
 * How a client who registered with a mobile number signs in.
 *
 * Supabase only accepts phone + password accounts when an SMS provider is
 * configured, even with phone confirmation off — and the practice has none. So a
 * phone-registered account's sign-in identity is an address on a reserved,
 * undeliverable domain (RFC 2606 .invalid) derived from the number. The person
 * only ever types their phone number; this address never reaches a screen, the
 * signup trigger stores no email for it, and nothing is ever sent to it.
 */
export const PHONE_LOGIN_DOMAIN = "phone.tvcare.invalid";

export function phoneLoginEmail(phone: string): string {
  return `${normalizePhone(phone).replace(/^\+/, "")}@${PHONE_LOGIN_DOMAIN}`;
}

/** The credentials supabase.auth.signUp/signInWithPassword take for either identifier. */
export function credentialsFor(identifier: Identifier, password: string) {
  return {
    email: identifier.kind === "email" ? identifier.email : phoneLoginEmail(identifier.phone),
    password,
  };
}

export const registerSchema = z
  .object({
    identifier: identifierSchema,
    password: clientPasswordSchema,
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "PINs or passwords do not match",
    path: ["confirmPassword"],
  });

export type RegisterInput = z.input<typeof registerSchema>;

export const loginSchema = z.object({
  identifier: identifierSchema,
  // Deliberately not any password policy: an existing password that predates
  // a policy change must still be able to sign in.
  password: z.string().min(1, "Enter your password or PIN"),
});

export type LoginInput = z.input<typeof loginSchema>;

/**
 * The first screen after a new client signs in. Name and mobile number are what
 * reception needs to reach them; the alternate number is optional.
 */
export const completeProfileSchema = z
  .object({
    fullName: fullNameSchema,
    phone: phoneSchema,
    alternatePhone: z
      .string()
      .trim()
      .transform((value) => (value === "" ? null : value))
      .nullish()
      .transform((value) => value ?? null)
      .pipe(phoneSchema.nullable()),
  })
  .refine((values) => values.alternatePhone === null || values.alternatePhone !== values.phone, {
    message: "Enter a different number, or leave this blank",
    path: ["alternatePhone"],
  });

export type CompleteProfileValues = z.output<typeof completeProfileSchema>;

export const forgotPasswordSchema = z.object({ email: emailSchema });

export type ForgotPasswordInput = z.input<typeof forgotPasswordSchema>;

/**
 * Reset-password is reached by clients and staff alike, and the form cannot
 * know which before the server looks at the session. So the shape check here
 * uses the looser client rule, and resetPasswordAction re-checks the password
 * against passwordSchemaFor(the signed-in person's roles).
 */
export const resetPasswordSchema = z
  .object({
    password: clientPasswordSchema,
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

export type ResetPasswordInput = z.input<typeof resetPasswordSchema>;
