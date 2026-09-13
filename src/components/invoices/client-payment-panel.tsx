"use client";

import { format } from "date-fns";
import { useActionState } from "react";

import { Field } from "@/components/form/field";
import { FormAlert } from "@/components/form/form-alert";
import { SelectField } from "@/components/form/select-field";
import { SubmitButton } from "@/components/form/submit-button";
import { Badge } from "@/components/ui/badge";
import { startOnlinePaymentAction, submitClientPaymentAction } from "@/features/payments/actions";
import type { Payment } from "@/features/payments/queries";
import { formatCurrency } from "@/lib/currency";
import { idleState } from "@/lib/forms";
import {
  CLIENT_SUBMISSION_METHODS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_STATUS_LABELS,
} from "@/lib/validation/payment";

/**
 * How a client pays one invoice from their phone: the practice's own payment
 * instructions, a form to send the bKash/Nagad/bank transaction ID, and — when
 * the practice has connected SSLCommerz — a hosted online checkout.
 */
export function ClientPaymentPanel({
  invoiceId,
  balancePaisa,
  isOpen,
  payments,
  instructions,
  gatewayEnabled,
}: {
  invoiceId: string;
  balancePaisa: number;
  /** Issued or partially paid. */
  isOpen: boolean;
  payments: Payment[];
  instructions: string | null;
  gatewayEnabled: boolean;
}) {
  const [submitState, submitAction] = useActionState(submitClientPaymentAction, idleState);
  const [onlineState, onlineAction] = useActionState(startOnlinePaymentAction, idleState);
  const fieldErrors = submitState.status === "error" ? submitState.fieldErrors : undefined;

  const pendingPaisa = payments.filter((payment) => payment.status === "pending").reduce((total, p) => total + p.amountPaisa, 0);
  const remainingPaisa = balancePaisa - pendingPaisa;
  const visiblePayments = payments.filter((payment) => payment.source !== "staff" || payment.status !== "completed");

  return (
    <div className="grid gap-4 border-t pt-4">
      {visiblePayments.length > 0 ? (
        <ul className="grid gap-2">
          {visiblePayments.map((payment) => (
            <li key={payment.id} className="grid gap-0.5 rounded-lg border p-3 text-sm">
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium" data-numeric>
                  {payment.amount}
                </span>
                <Badge
                  variant={payment.status === "failed" ? "destructive" : payment.status === "pending" ? "secondary" : "default"}
                >
                  {PAYMENT_STATUS_LABELS[payment.status]}
                </Badge>
              </span>
              <span className="text-muted-foreground text-xs" data-numeric>
                {payment.gateway === "sslcommerz" ? "Online payment" : PAYMENT_METHOD_LABELS[payment.method]} ·{" "}
                {format(new Date(payment.paidAt), "d MMM yyyy")}
                {payment.referenceNumber && payment.gateway !== "sslcommerz" ? ` · ${payment.referenceNumber}` : ""}
              </span>
              {payment.status === "failed" && payment.rejectionReason ? (
                <span className="text-muted-foreground text-xs">{payment.rejectionReason}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {!isOpen ? null : remainingPaisa <= 0 ? (
        <p className="text-muted-foreground text-sm" role="status">
          Your payment is with the clinic for verification. This invoice will show as paid once it is confirmed.
        </p>
      ) : (
        <>
          {instructions ? (
            <div className="bg-muted/40 grid gap-1 rounded-lg p-3 text-sm">
              <span className="text-muted-foreground text-xs font-medium">How to pay</span>
              <p className="whitespace-pre-line">{instructions}</p>
            </div>
          ) : null}

          {gatewayEnabled ? (
            <form action={onlineAction} className="grid gap-2">
              <FormAlert state={onlineState} />
              <input type="hidden" name="invoiceId" value={invoiceId} />
              <SubmitButton pendingLabel="Opening secure checkout…">
                Pay {formatCurrency(remainingPaisa)} online
              </SubmitButton>
              <p className="text-muted-foreground text-xs">Card, bKash, Nagad or internet banking, through SSLCommerz.</p>
            </form>
          ) : null}

          <form action={submitAction} className="grid gap-4" noValidate>
            <FormAlert state={submitState} />
            <input type="hidden" name="invoiceId" value={invoiceId} />
            <p className="text-sm font-medium">{gatewayEnabled ? "Already paid another way?" : "Already paid?"}</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field
                label="Amount (৳)"
                name="amountPaisa"
                inputMode="decimal"
                defaultValue={(remainingPaisa / 100).toFixed(2)}
                errors={fieldErrors?.amountPaisa}
              />
              <SelectField
                label="Paid by"
                name="method"
                options={CLIENT_SUBMISSION_METHODS.map((value) => ({ value, label: PAYMENT_METHOD_LABELS[value] }))}
                defaultValue="bkash"
              />
              <Field
                label="Transaction ID"
                name="referenceNumber"
                autoComplete="off"
                hint="From your SMS or bank receipt"
                errors={fieldErrors?.referenceNumber}
              />
            </div>
            <div>
              <SubmitButton variant="outline" pendingLabel="Sending…" className="sm:w-auto">
                Send for verification
              </SubmitButton>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
