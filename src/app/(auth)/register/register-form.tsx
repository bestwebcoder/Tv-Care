"use client";

import { useActionState } from "react";
import Link from "next/link";
import { MailCheck } from "lucide-react";

import { Field } from "@/components/form/field";
import { PasswordField } from "@/components/form/password-field";
import { FormAlert } from "@/components/form/form-alert";
import { SubmitButton } from "@/components/form/submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { registerAction, type FormState } from "@/features/auth/actions";

const initialState: FormState = { status: "idle" };

export function RegisterForm() {
  const [state, formAction] = useActionState(registerAction, initialState);
  const fieldErrors = state.status === "error" ? state.fieldErrors : undefined;

  // Registration no longer ends in a session — the account cannot sign in
  // until the emailed link is clicked — so there is nothing to redirect into.
  // The form is replaced rather than left on screen with a message above it:
  // every field is filled in and submitting again would only resend.
  if (state.status === "success") {
    return (
      <Card>
        <CardHeader>
          <div
            className="bg-primary/10 text-primary mb-2 flex size-11 items-center justify-center rounded-full"
            aria-hidden
          >
            <MailCheck className="size-5" />
          </div>
          <CardTitle>Confirm your email</CardTitle>
          <CardDescription>One step left before you can sign in.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <p className="text-muted-foreground text-sm" role="status">
            {state.message}
          </p>
          <p className="text-muted-foreground text-sm">
            The link opens your dashboard and signs you in. If it has not arrived in a few
            minutes, check your spam folder.
          </p>
          <Link
            href="/login"
            className="text-foreground text-sm font-medium underline underline-offset-4"
          >
            Back to sign in
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create your account</CardTitle>
        <CardDescription>For pet owners of The Traveling Vet.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid gap-5" noValidate>
          <FormAlert state={state} />

          <Field
            label="Full name"
            name="fullName"
            autoComplete="name"
            required
            errors={fieldErrors?.fullName}
          />

          <Field
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            hint="We send a confirmation link here before your account can be used."
            errors={fieldErrors?.email}
          />

          <Field
            label="Mobile number"
            name="phone"
            type="tel"
            autoComplete="tel"
            inputMode="tel"
            required
            hint="For example 01712345678"
            errors={fieldErrors?.phone}
          />

          <PasswordField
            label="Password"
            name="password"
            autoComplete="new-password"
            required
            hint="At least 10 characters, with an uppercase letter, a lowercase letter and a number."
            errors={fieldErrors?.password}
          />

          <PasswordField
            label="Confirm password"
            name="confirmPassword"
            autoComplete="new-password"
            required
            errors={fieldErrors?.confirmPassword}
          />

          <SubmitButton pendingLabel="Creating your account…">Create account</SubmitButton>
        </form>

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
