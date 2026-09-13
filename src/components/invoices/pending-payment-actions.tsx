"use client";

import { useActionState, useState } from "react";

import { FormAlert } from "@/components/form/form-alert";
import { SubmitButton } from "@/components/form/submit-button";
import { TextAreaField } from "@/components/form/textarea-field";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { rejectPaymentAction, verifyPaymentAction } from "@/features/payments/actions";
import type { Payment } from "@/features/payments/queries";
import { idleState } from "@/lib/forms";
import { PAYMENT_METHOD_LABELS } from "@/lib/validation/payment";

/**
 * Verify or reject a payment a client submitted. Verifying is one click —
 * the staff member has just found the transaction on the statement. Rejecting
 * asks why, because the client reads the answer.
 */
export function PendingPaymentActions({ payment }: { payment: Payment }) {
  const [verifyState, verifyAction] = useActionState(verifyPaymentAction, idleState);
  const [rejectState, rejectAction] = useActionState(rejectPaymentAction, idleState);
  const [open, setOpen] = useState(false);
  const fieldErrors = rejectState.status === "error" ? rejectState.fieldErrors : undefined;

  const [handledState, setHandledState] = useState(rejectState);
  if (rejectState !== handledState) {
    setHandledState(rejectState);
    if (rejectState.status === "success") setOpen(false);
  }

  return (
    <div className="grid justify-items-end gap-1">
      <div className="flex flex-wrap justify-end gap-2">
        <form action={verifyAction}>
          <input type="hidden" name="paymentId" value={payment.id} />
          <SubmitButton pendingLabel="Verifying…" className="sm:w-auto">
            Verify
          </SubmitButton>
        </form>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger render={<Button type="button" variant="outline" size="sm" />}>Reject</DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Mark {payment.amount} as not received?</DialogTitle>
              <DialogDescription>
                {PAYMENT_METHOD_LABELS[payment.method]}
                {payment.referenceNumber ? `, transaction ${payment.referenceNumber}` : ""}. The client sees the reason
                you give, and can submit the payment again.
              </DialogDescription>
            </DialogHeader>
            <form action={rejectAction} className="grid gap-4" noValidate>
              <FormAlert state={rejectState} />
              <input type="hidden" name="paymentId" value={payment.id} />
              <TextAreaField
                label="Reason"
                name="reason"
                rows={2}
                required
                hint="For example: no transaction with this ID reached our bKash account."
                errors={fieldErrors?.reason}
              />
              <DialogFooter>
                <Button type="button" variant="outline" size="touch" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <SubmitButton variant="destructive" pendingLabel="Saving…" className="sm:w-auto">
                  Mark not received
                </SubmitButton>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      {verifyState.status === "error" ? (
        <p className="text-destructive max-w-xs text-right text-xs" role="alert">
          {verifyState.message}
        </p>
      ) : null}
    </div>
  );
}
