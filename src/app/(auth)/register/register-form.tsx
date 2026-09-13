"use client";

import { useActionState } from "react";
import Link from "next/link";

import { Field } from "@/components/form/field";
import { PasswordField } from "@/components/form/password-field";
import { FormAlert } from "@/components/form/form-alert";
import { SubmitButton } from "@/components/form/submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { registerAction, type FormState } from "@/features/auth/actions";

const initialState: FormState = { status: "idle" };

/**
 * Two things to type and a PIN to repeat. A successful registration signs the
 * client in and redirects to /client/complete-profile, so the only success
 * state rendered here is the fallback for an auth server that still requires
 * confirmation (see registerAction).
 */
export function RegisterForm() {
  const [state, formAction] = useActionState(registerAction, initialState);
  const fieldErrors = state.status === "error" ? state.fieldErrors : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create your account</CardTitle>
        <CardDescription>For pet owners of The Traveling Vet. It takes under a minute.</CardDescription>
      </CardHeader>
      <CardContent>
        {state.status === "success" ? (
          <div className="grid gap-4">
            <p className="text-muted-foreground text-sm" role="status">
              {state.message}
            </p>
            <Link href="/login" className="text-foreground text-sm font-medium underline underline-offset-4">
              Go to sign in
            </Link>
          </div>
        ) : (
          <form action={formAction} className="grid gap-5" noValidate>
            <FormAlert state={state} />

            <Field
              label="Email or mobile number"
              name="identifier"
              autoComplete="username"
              required
              hint="For example you@example.com or 01712345678"
              errors={fieldErrors?.identifier}
            />

            <PasswordField
              label="PIN or password"
              name="password"
              autoComplete="new-password"
              required
              hint="A 6-digit PIN, or a password of at least 8 characters."
              errors={fieldErrors?.password}
            />

            <PasswordField
              label="Confirm PIN or password"
              name="confirmPassword"
              autoComplete="new-password"
              required
              errors={fieldErrors?.confirmPassword}
            />

            <SubmitButton pendingLabel="Creating your account…">Create account</SubmitButton>
          </form>
        )}

        <p className="text-muted-foreground mt-6 text-center text-sm">
          Already have an account?{" "}
          <Link href="/login" className="text-foreground font-medium underline underline-offset-4">
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
