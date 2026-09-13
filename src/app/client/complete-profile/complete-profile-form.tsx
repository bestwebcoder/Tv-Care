"use client";

import { useActionState } from "react";

import { Field } from "@/components/form/field";
import { FormAlert } from "@/components/form/form-alert";
import { SubmitButton } from "@/components/form/submit-button";
import { Card, CardContent } from "@/components/ui/card";
import { completeOwnProfileAction } from "@/features/profile/actions";
import { idleState } from "@/lib/forms";

export function CompleteProfileForm({ phone, alternatePhone }: { phone: string | null; alternatePhone: string | null }) {
  const [state, formAction] = useActionState(completeOwnProfileAction, idleState);
  const fieldErrors = state.status === "error" ? state.fieldErrors : undefined;

  return (
    <Card>
      <CardContent>
        <form action={formAction} className="grid gap-5" noValidate>
          <FormAlert state={state} />

          <Field label="Full name" name="fullName" autoComplete="name" required errors={fieldErrors?.fullName} />

          <Field
            label="Mobile number"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            defaultValue={phone ?? ""}
            required
            hint="For example 01712345678"
            errors={fieldErrors?.phone}
          />

          <Field
            label="Alternate mobile number (optional)"
            name="alternatePhone"
            type="tel"
            inputMode="tel"
            defaultValue={alternatePhone ?? ""}
            hint="Someone else we can reach about your pet if you are unavailable."
            errors={fieldErrors?.alternatePhone}
          />

          <SubmitButton pendingLabel="Saving…">Continue</SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
