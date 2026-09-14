"use client";

import { useActionState } from "react";

import { PasswordField } from "@/components/form/password-field";
import { FormAlert } from "@/components/form/form-alert";
import { SubmitButton } from "@/components/form/submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { resetPasswordAction, type FormState } from "@/features/auth/actions";

const initialState: FormState = { status: "idle" };

/** A pet owner chooses a new 6-digit PIN; staff choose a new password. */
export function ResetPasswordForm({ pinOnly }: { pinOnly: boolean }) {
  const [state, formAction] = useActionState(resetPasswordAction, initialState);
  const fieldErrors = state.status === "error" ? state.fieldErrors : undefined;
  const pinProps = pinOnly ? { inputMode: "numeric" as const, pattern: "\\d{6}", maxLength: 6 } : {};
  const noun = pinOnly ? "PIN" : "password";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Choose a new {noun}</CardTitle>
        <CardDescription>This replaces your old {noun} immediately.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid gap-5" noValidate>
          <FormAlert state={state} />

          <PasswordField
            label={pinOnly ? "New 6-digit PIN" : "New password"}
            name="password"
            autoComplete="new-password"
            required
            hint={
              pinOnly
                ? "Choose any 6 numbers. You will use this PIN to sign in."
                : "At least 10 characters, with an uppercase letter, a lowercase letter and a number."
            }
            errors={fieldErrors?.password}
            {...pinProps}
          />

          <PasswordField
            label={pinOnly ? "Confirm new PIN" : "Confirm new password"}
            name="confirmPassword"
            autoComplete="new-password"
            required
            errors={fieldErrors?.confirmPassword}
            {...pinProps}
          />

          <SubmitButton pendingLabel="Saving…">Save new {noun}</SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
