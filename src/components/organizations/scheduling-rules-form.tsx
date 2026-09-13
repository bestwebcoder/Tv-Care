"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Field } from "@/components/form/field";
import { FormAlert } from "@/components/form/form-alert";
import { SubmitButton } from "@/components/form/submit-button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { updateSchedulingRulesAction } from "@/features/organizations/actions";
import type { Organization } from "@/features/organizations/queries";
import { idleState } from "@/lib/forms";

/**
 * The practice's booking policy.
 *
 * Doctor availability says *when* the practice works; these three say how
 * close to the moment a client may book it, how far ahead they may plan, and
 * how late they may change their mind. All three were previously fixed —
 * the first two by their absence, the third by a column no screen could reach.
 */
export function SchedulingRulesForm({ organization }: { organization: Organization }) {
  const [state, formAction] = useActionState(updateSchedulingRulesAction, idleState);
  const fieldErrors = state.status === "error" ? state.fieldErrors : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Scheduling rules</CardTitle>
        <CardDescription>
          How the practice takes bookings. Doctor working hours are set on the{" "}
          <Link href="/admin/appointments/availability" className="underline underline-offset-4">
            availability screen
          </Link>
          .
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="grid gap-4" noValidate>
          <FormAlert state={state} />

          <Field
            label="Minimum notice (minutes)"
            name="bookingLeadMinutes"
            type="number"
            inputMode="numeric"
            min={0}
            max={10080}
            required
            defaultValue={organization.bookingLeadMinutes}
            hint="A slot stops being offered this long before it starts, so the clinic is not booked into by someone already on their way. 0 accepts a booking up to the minute."
            errors={fieldErrors?.bookingLeadMinutes}
          />

          <Field
            label="Book up to (days ahead)"
            name="bookingHorizonDays"
            type="number"
            inputMode="numeric"
            min={1}
            max={730}
            required
            defaultValue={organization.bookingHorizonDays}
            hint="How far into the future a client may book. Keeps appointments out of a year the practice has not planned."
            errors={fieldErrors?.bookingHorizonDays}
          />

          <Field
            label="Cancellation notice (hours)"
            name="cancellationNoticeHours"
            type="number"
            inputMode="numeric"
            min={0}
            max={168}
            required
            defaultValue={organization.cancellationNoticeHours}
            hint="After this point a client is asked to telephone instead of rescheduling or cancelling themselves. Staff can always change an appointment."
            errors={fieldErrors?.cancellationNoticeHours}
          />

          <div>
            <SubmitButton pendingLabel="Saving…">Save scheduling rules</SubmitButton>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
