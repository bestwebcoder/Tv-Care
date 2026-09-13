import { z } from "zod";

import { CurrencyFormatError, taakaToPaisa } from "@/lib/currency";
import { optionalText } from "@/lib/validation/common";

/** §7.6 — manual payment recording. */

export const PAYMENT_METHODS = ["cash", "bank_transfer", "bkash", "nagad", "card", "other"] as const;

export const PAYMENT_METHOD_LABELS: Record<(typeof PAYMENT_METHODS)[number], string> = {
  cash: "Cash",
  bank_transfer: "Bank transfer",
  bkash: "bKash",
  nagad: "Nagad",
  card: "Card",
  other: "Other",
};

export const paymentSchema = z.object({
  amountPaisa: z
    .string()
    .trim()
    .transform((value, ctx) => {
      try {
        return taakaToPaisa(value);
      } catch (error) {
        ctx.addIssue({
          code: "custom",
          message: error instanceof CurrencyFormatError ? error.message : "Enter an amount in taka, for example 500",
        });
        return z.NEVER;
      }
    })
    .refine((value) => value > 0, "Enter an amount greater than zero"),
  method: z.enum(PAYMENT_METHODS),
  referenceNumber: optionalText(100, "Reference number"),
  notes: optionalText(500, "Notes"),
});

export type PaymentInput = z.infer<typeof paymentSchema>;

/**
 * Recording a refund.
 *
 * Method is its own field rather than inherited from the payment: a bKash
 * payment may well be refunded in cash across the counter, and the record
 * should say how the money actually went back.
 *
 * Reason is required, unlike a payment's optional note — money leaving the
 * practice is the thing an auditor asks about first.
 */
export const refundSchema = z.object({
  amountPaisa: z
    .string()
    .trim()
    .transform((value, ctx) => {
      try {
        return taakaToPaisa(value);
      } catch (error) {
        ctx.addIssue({
          code: "custom",
          message: error instanceof CurrencyFormatError ? error.message : "Enter an amount in taka, for example 500",
        });
        return z.NEVER;
      }
    })
    .refine((value) => value > 0, "Enter an amount greater than zero"),
  method: z.enum(PAYMENT_METHODS),
  reason: z
    .string()
    .trim()
    .min(1, "Say why this is being refunded")
    .max(500, "Keep the reason under 500 characters"),
  referenceNumber: optionalText(100, "Reference number"),
});

export type RefundInput = z.infer<typeof refundSchema>;

// ---------------------------------------------------------------------------
// Payments that do not start at a billing desk (20261013000500).
// ---------------------------------------------------------------------------

export const PAYMENT_STATUSES = ["completed", "pending", "failed"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  completed: "Received",
  pending: "Awaiting verification",
  failed: "Not received",
};

export const PAYMENT_SOURCES = ["staff", "doctor_on_site", "client_submission", "online_gateway"] as const;
export type PaymentSource = (typeof PAYMENT_SOURCES)[number];

export const PAYMENT_SOURCE_LABELS: Record<PaymentSource, string> = {
  staff: "Recorded by the clinic",
  doctor_on_site: "Collected on site",
  client_submission: "Submitted by client",
  online_gateway: "Paid online",
};

/** What a client can say they paid by themselves — each leaves a transaction ID to check. */
export const CLIENT_SUBMISSION_METHODS = ["bkash", "nagad", "bank_transfer"] as const;

const amountPaisaSchema = z
  .string()
  .trim()
  .transform((value, ctx) => {
    try {
      return taakaToPaisa(value);
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        message: error instanceof CurrencyFormatError ? error.message : "Enter an amount in taka, for example 500",
      });
      return z.NEVER;
    }
  })
  .refine((value) => value > 0, "Enter an amount greater than zero");

/**
 * A client telling the practice they paid. The transaction ID is required — it
 * is the only thing staff can check a statement against.
 */
export const clientPaymentSubmissionSchema = z.object({
  amountPaisa: amountPaisaSchema,
  method: z.enum(CLIENT_SUBMISSION_METHODS, "Choose how you paid"),
  referenceNumber: z
    .string()
    .trim()
    .min(4, "Enter the transaction ID from your receipt")
    .max(100, "Keep the transaction ID under 100 characters"),
});

export type ClientPaymentSubmissionInput = z.infer<typeof clientPaymentSubmissionSchema>;

/** Rejecting a submitted payment always says why — the client reads it. */
export const rejectPaymentSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, "Say why this payment could not be verified")
    .max(500, "Keep the reason under 500 characters"),
});
