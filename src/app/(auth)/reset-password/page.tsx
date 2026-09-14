import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getSessionUser } from "@/features/auth/session";
import { isClientOnly } from "@/lib/validation/auth";

import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = { title: "Choose a new password · TV Care" };

export default async function ResetPasswordPage() {
  // Reaching this page means the recovery link was verified and a session
  // exists. Without one there is nothing to update, so send them back to ask
  // for a fresh link rather than showing a form that cannot work.
  const user = await getSessionUser();

  if (!user) {
    redirect("/auth/link-invalid");
  }

  // Only decides which fields to show; resetPasswordAction enforces the rule.
  return <ResetPasswordForm pinOnly={isClientOnly(user.roles)} />;
}
