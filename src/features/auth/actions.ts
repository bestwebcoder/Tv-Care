"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { getSessionUser, homeHrefFor } from "@/features/auth/session";
import { failure, invalid, type FormState } from "@/lib/forms";
import {
  credentialsFor,
  forgotPasswordSchema,
  loginSchema,
  passwordSchemaFor,
  registerSchema,
  resetPasswordSchema,
} from "@/lib/validation/auth";

/**
 * "/" is the public front page for everyone now, signed in or not (see
 * app/page.tsx) — it no longer bounces a signed-in visitor to their
 * dashboard. So the moment that used to matter, landing on your own area
 * right after signing in, has to be handled here instead.
 */
async function redirectHome(): Promise<never> {
  const user = await getSessionUser();
  redirect((user && homeHrefFor(user)) || "/");
}

// Re-exported so screens can keep importing the form state alongside the
// actions they use it with.
export type { FormState };

async function siteOrigin(): Promise<string> {
  const headerList = await headers();
  const host = headerList.get("host") ?? "localhost:3000";
  const protocol = host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https";

  return `${protocol}://${host}`;
}

/**
 * Client self-registration: one identifier (email or mobile) and a 6-digit
 * PIN, signed in on the spot and taken straight to their dashboard. Name and
 * phone numbers are optional afterwards, added on /client/profile whenever the
 * client chooses.
 *
 * Email and phone confirmation are off (config.toml) by the practice's
 * decision, so signUp returns a session. That also means an address or number
 * already registered is reported as such — with confirmations off Supabase
 * returns a real error rather than a decoy user, so this form now tells a
 * visitor whether an account exists. That is the accepted cost of registering
 * without a confirmation step; sign-in keeps its single, non-committal answer.
 */
export async function registerAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = registerSchema.safeParse({
    identifier: formData.get("identifier"),
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return invalid(parsed.error);
  }

  const { identifier, password } = parsed.data;
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signUp({
    ...credentialsFor(identifier, password),
    options: {
      // signup_source is what tells the database trigger to provision a pet
      // owner. Accounts created any other way get a profile and nothing more.
      // A phone registration carries its number here: its sign-in address is a
      // placeholder (see phoneLoginEmail), so this is where the trigger reads it.
      data: {
        signup_source: "self_registration",
        ...(identifier.kind === "phone" ? { phone: identifier.phone } : {}),
      },
    },
  });

  if (error) {
    console.error("[auth] registration failed", error);

    const already =
      identifier.kind === "email"
        ? "An account with this email already exists. Sign in instead."
        : "An account with this mobile number already exists. Sign in instead.";

    if (error.code === "user_already_exists" || error.code === "email_exists") {
      return { status: "error", message: already, fieldErrors: { identifier: ["Already registered"] } };
    }

    // 23505 is the unique index on (organization_id, phone) raised by the
    // signup trigger — a walk-in client record already holds this number.
    if (error.message.includes("duplicate key") || error.message.includes("23505")) {
      return {
        status: "error",
        message: "This mobile number is already on file with the clinic. Contact The Traveling Vet to get a login for it.",
      };
    }

    if (error.code === "weak_password") {
      return {
        status: "error",
        message: "Please choose a different PIN.",
        fieldErrors: { password: ["Enter a 6-digit PIN (numbers only)"] },
      };
    }

    return {
      status: "error",
      message: "We could not create your account just now. Please try again.",
    };
  }

  // Confirmations are off, so this should always hold. If the hosted project
  // has not been given the same auth settings it will not — say so plainly
  // rather than dropping someone on the public front page signed out.
  if (!data.session) {
    return {
      status: "success",
      message: "Your account has been created. Please sign in to continue.",
    };
  }

  redirect("/client");
}

export async function loginAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const parsed = loginSchema.safeParse({
    identifier: formData.get("identifier"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return invalid(parsed.error);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(
    credentialsFor(parsed.data.identifier, parsed.data.password),
  );

  if (error) {
    console.error("[auth] sign in failed", error);

    // Accounts registered while confirmations were still on, and never
    // confirmed, remain unconfirmed.
    if (error.code === "email_not_confirmed") {
      return {
        status: "error",
        message: "This account was never confirmed. Check your inbox for the link, or contact the clinic.",
      };
    }

    // Deliberately identical for a wrong password and an unknown account, so
    // this form cannot be used to discover who holds an account here.
    return { status: "error", message: "Those sign-in details are incorrect." };
  }

  return redirectHome();
}

export async function logoutAction() {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();

  if (error) {
    console.error("[auth] sign out failed", error);
  }

  redirect("/login");
}

export async function requestPasswordResetAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = forgotPasswordSchema.safeParse({ email: formData.get("email") });

  if (!parsed.success) {
    return invalid(parsed.error);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${await siteOrigin()}/auth/confirm?next=/reset-password`,
  });

  if (error) {
    console.error("[auth] password reset request failed", error);
  }

  // Always the same answer, whether or not that address has an account.
  return {
    status: "success",
    message: "If an account exists for that address, we have sent a reset link.",
  };
}

export async function resetPasswordAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = resetPasswordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });

  if (!parsed.success) {
    return invalid(parsed.error);
  }

  const user = await getSessionUser();

  if (!user) {
    return {
      status: "error",
      message: "This reset link has expired. Request a new one to continue.",
    };
  }

  // The form only checked that something was typed. A client is held to the
  // PIN rule and anyone holding a staff role to the staff one, here, because
  // the auth server cannot tell them apart.
  const policy = passwordSchemaFor(user.roles).safeParse(parsed.data.password);
  if (!policy.success) {
    return {
      status: "error",
      message: "Please correct the highlighted fields.",
      fieldErrors: { password: policy.error.issues.map((issue) => issue.message) },
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });

  if (error) {
    return failure(
      "auth",
      error,
      "We could not update your password. Request a new reset link and try again.",
    );
  }

  return redirectHome();
}
