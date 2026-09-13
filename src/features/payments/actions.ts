"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getSessionUser, requireRole, requireUser } from "@/features/auth/session";
import { getOwnDoctorRecord } from "@/features/doctors/queries";
import { startCheckout } from "@/features/payments/gateway";
import { isOnlineGatewayConfigured } from "@/lib/payments/sslcommerz";
import { formatCurrency } from "@/lib/currency";
import { failure, invalid, text, type FormState } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";
import {
  clientPaymentSubmissionSchema,
  paymentSchema,
  refundSchema,
  rejectPaymentSchema,
} from "@/lib/validation/payment";

/**
 * Payment recording. `is_billing_manager` is enforced by row level
 * security. A payment that would overpay the invoice is refused here —
 * this is the DoD's "failed payment" state: a plain sentence, not a raw
 * database error, and nothing is written.
 */

export async function recordPaymentAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const invoiceId = text(formData, "invoiceId");
  if (!invoiceId) return { status: "error", message: "We could not tell which invoice this payment is for." };

  const parsed = paymentSchema.safeParse({
    amountPaisa: text(formData, "amountPaisa") ?? "",
    method: text(formData, "method") ?? "",
    referenceNumber: text(formData, "referenceNumber") ?? "",
    notes: text(formData, "notes") ?? "",
  });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();

  const { data: invoice, error: invoiceError } = await supabase
    .from("invoices")
    .select("organization_id, status, balance_paisa")
    .eq("id", invoiceId)
    .maybeSingle();

  if (invoiceError || !invoice) {
    return { status: "error", message: "That invoice could not be found." };
  }

  if (invoice.status === "draft" || invoice.status === "cancelled") {
    return {
      status: "error",
      message: "Payment failed: this invoice has not been issued, so there is nothing to pay.",
    };
  }

  if (parsed.data.amountPaisa > invoice.balance_paisa) {
    return {
      status: "error",
      message: "Payment failed: that amount is more than the remaining balance on this invoice.",
    };
  }

  const user = await getSessionUser();

  const { error } = await supabase.from("payments").insert({
    invoice_id: invoiceId,
    organization_id: invoice.organization_id,
    amount_paisa: parsed.data.amountPaisa,
    method: parsed.data.method,
    reference_number: parsed.data.referenceNumber,
    notes: parsed.data.notes,
    recorded_by: user?.id,
  });

  if (error) {
    return failure("payments", error, "Payment failed: we could not record this payment just now. Please try again.");
  }

  revalidatePath(`/admin/invoices/${invoiceId}`);
  revalidatePath(`/doctor/invoices/${invoiceId}`);
  revalidatePath("/admin/payments");
  revalidatePath("/admin/billing");
  revalidatePath("/client/invoices");

  return { status: "success", message: "Payment recorded." };
}

/**
 * Records a refund against one payment.
 *
 * Never edits the payment. What was taken and what was given back are separate
 * rows, so an invoice that was paid and then refunded still shows both, with
 * who did each and why (CLAUDE.md §6).
 *
 * The over-refund check here is for the message, not the guarantee: the
 * refunds_guard_amount trigger refuses it regardless, and would do so even if
 * this ran against stale numbers between the read and the insert.
 */
export async function recordRefundAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const paymentId = text(formData, "paymentId");
  if (!paymentId) return { status: "error", message: "We could not tell which payment to refund." };

  const parsed = refundSchema.safeParse({
    amountPaisa: text(formData, "amountPaisa") ?? "",
    method: text(formData, "method") ?? "",
    reason: text(formData, "reason") ?? "",
    referenceNumber: text(formData, "referenceNumber") ?? "",
  });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();

  const { data: payment, error: paymentError } = await supabase
    .from("payments")
    .select("id, invoice_id, organization_id, amount_paisa, status")
    .eq("id", paymentId)
    .maybeSingle();

  if (paymentError || !payment) {
    return { status: "error", message: "That payment could not be found." };
  }

  if (payment.status !== "completed") {
    return { status: "error", message: "Only a completed payment can be refunded." };
  }

  const { data: existing } = await supabase.from("refunds").select("amount_paisa").eq("payment_id", paymentId);
  const alreadyRefunded = (existing ?? []).reduce((total, row) => total + row.amount_paisa, 0);
  const refundable = payment.amount_paisa - alreadyRefunded;

  if (parsed.data.amountPaisa > refundable) {
    return {
      status: "error",
      message:
        refundable > 0
          ? `Refund failed: only ${formatCurrency(refundable)} of this payment is left to refund.`
          : "Refund failed: this payment has already been refunded in full.",
      fieldErrors: { amountPaisa: ["More than is left"] },
    };
  }

  const user = await getSessionUser();

  const { error } = await supabase.from("refunds").insert({
    payment_id: paymentId,
    invoice_id: payment.invoice_id,
    organization_id: payment.organization_id,
    amount_paisa: parsed.data.amountPaisa,
    method: parsed.data.method,
    reason: parsed.data.reason,
    reference_number: parsed.data.referenceNumber,
    recorded_by: user?.id ?? null,
  });

  if (error) {
    return failure("payments", error, "We could not record that refund just now. Please try again.");
  }

  revalidatePath(`/admin/invoices/${payment.invoice_id}`);
  revalidatePath(`/doctor/invoices/${payment.invoice_id}`);
  revalidatePath("/admin/billing");
  revalidatePath("/admin/payments");
  return { status: "success", message: "Refund recorded." };
}

type One<T> = T | T[] | null;
function one<T>(value: One<T>): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function revalidateInvoice(invoiceId: string, appointmentId?: string | null) {
  revalidatePath(`/admin/invoices/${invoiceId}`);
  revalidatePath(`/doctor/invoices/${invoiceId}`);
  if (appointmentId) revalidatePath(`/doctor/appointments/${appointmentId}/invoice`);
  revalidatePath("/admin/payments");
  revalidatePath("/admin/billing");
  revalidatePath("/admin");
  revalidatePath("/client/invoices");
}

const OVER_BALANCE = "Payment failed: that amount is more than the remaining balance on this invoice.";

/**
 * A traveling vet recording money they took in person, against an invoice for
 * a visit they attended. Not billing access — see payments_insert_attending_doctor,
 * which is the real boundary; this checks the same things first so the vet
 * reads a sentence rather than a refusal.
 */
export async function recordOnSitePaymentAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const invoiceId = text(formData, "invoiceId");
  if (!invoiceId) return { status: "error", message: "We could not tell which invoice this payment is for." };

  const parsed = paymentSchema.safeParse({
    amountPaisa: text(formData, "amountPaisa") ?? "",
    method: text(formData, "method") ?? "",
    referenceNumber: text(formData, "referenceNumber") ?? "",
    notes: text(formData, "notes") ?? "",
  });
  if (!parsed.success) return invalid(parsed.error);

  const doctor = await getOwnDoctorRecord();
  if (doctor.status !== "ok" || !doctor.data) {
    return { status: "error", message: "Your doctor record could not be found." };
  }

  const supabase = await createClient();
  const { data: invoice, error: invoiceError } = await supabase
    .from("invoices")
    .select("organization_id, status, balance_paisa, appointment_id, appointment:appointments (doctor_id)")
    .eq("id", invoiceId)
    .maybeSingle();

  if (invoiceError || !invoice) return { status: "error", message: "That invoice could not be found." };

  const appointment = one(invoice.appointment as One<{ doctor_id: string }>);
  if (!appointment || appointment.doctor_id !== doctor.data.id) {
    return { status: "error", message: "Only the vet who attended this visit can collect payment for it." };
  }

  if (invoice.status !== "issued" && invoice.status !== "partially_paid") {
    return { status: "error", message: "Payment failed: this invoice is not open for payment." };
  }

  if (parsed.data.amountPaisa > invoice.balance_paisa) {
    return { status: "error", message: OVER_BALANCE, fieldErrors: { amountPaisa: ["More than the balance"] } };
  }

  const user = await getSessionUser();
  const { error } = await supabase.from("payments").insert({
    invoice_id: invoiceId,
    organization_id: invoice.organization_id,
    amount_paisa: parsed.data.amountPaisa,
    method: parsed.data.method,
    reference_number: parsed.data.referenceNumber,
    notes: parsed.data.notes,
    recorded_by: user?.id,
    source: "doctor_on_site",
    collected_by_doctor_id: doctor.data.id,
  });

  if (error) {
    if (error.code === "23514") return { status: "error", message: OVER_BALANCE };
    return failure("payments", error, "Payment failed: we could not record this payment just now. Please try again.");
  }

  revalidateInvoice(invoiceId, invoice.appointment_id);
  return { status: "success", message: "Payment recorded as collected by you." };
}

/**
 * A client telling the clinic they paid by bKash, Nagad or bank transfer. It is
 * pending until someone with billing access checks the transaction arrived —
 * the balance does not move before then.
 */
export async function submitClientPaymentAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireRole("client");
  const invoiceId = text(formData, "invoiceId");
  if (!invoiceId) return { status: "error", message: "We could not tell which invoice this payment is for." };

  const parsed = clientPaymentSubmissionSchema.safeParse({
    amountPaisa: text(formData, "amountPaisa") ?? "",
    method: text(formData, "method") ?? "",
    referenceNumber: text(formData, "referenceNumber") ?? "",
  });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data: invoice, error: invoiceError } = await supabase
    .from("invoices")
    .select("organization_id, status")
    .eq("id", invoiceId)
    .maybeSingle();

  if (invoiceError || !invoice) return { status: "error", message: "That invoice could not be found." };
  if (invoice.status !== "issued" && invoice.status !== "partially_paid") {
    return { status: "error", message: "This invoice is not open for payment." };
  }

  const { error } = await supabase.from("payments").insert({
    invoice_id: invoiceId,
    organization_id: invoice.organization_id,
    amount_paisa: parsed.data.amountPaisa,
    method: parsed.data.method,
    reference_number: parsed.data.referenceNumber,
    status: "pending",
    source: "client_submission",
    submitted_by: user.id,
  });

  if (error) {
    if (error.code === "23505") {
      return {
        status: "error",
        message: "That transaction ID has already been submitted.",
        fieldErrors: { referenceNumber: ["Already submitted"] },
      };
    }
    if (error.code === "23514") {
      return {
        status: "error",
        message: "That amount is more than is still to be paid, counting payments already awaiting verification.",
        fieldErrors: { amountPaisa: ["More than is owed"] },
      };
    }
    return failure("payments", error, "We could not send your payment details just now. Please try again.");
  }

  revalidateInvoice(invoiceId);
  return {
    status: "success",
    message: "Thank you. The clinic will confirm your payment once it has checked the transaction arrived.",
  };
}

/** Confirms a client-submitted payment arrived. Billing access is enforced by payments_verify. */
export async function verifyPaymentAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const paymentId = text(formData, "paymentId");
  if (!paymentId) return { status: "error", message: "We could not tell which payment to verify." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("payments")
    .update({ status: "completed", verified_by: user.id })
    .eq("id", paymentId)
    .eq("status", "pending")
    .select("id, invoice_id")
    .maybeSingle();

  if (error) {
    if (error.code === "23514") {
      return {
        status: "error",
        message: "This payment is more than the balance still owed. Reject it, and refund the client for what they overpaid.",
      };
    }
    return failure("payments", error, "We could not verify this payment just now. Please try again.");
  }
  if (!data) return { status: "error", message: "This payment has already been handled, or you do not have billing access." };

  revalidateInvoice(data.invoice_id);
  return { status: "success", message: "Payment verified." };
}

/** Marks a client-submitted payment as not received, with the reason the client will read. */
export async function rejectPaymentAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const paymentId = text(formData, "paymentId");
  if (!paymentId) return { status: "error", message: "We could not tell which payment to reject." };

  const parsed = rejectPaymentSchema.safeParse({ reason: text(formData, "reason") ?? "" });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("payments")
    .update({ status: "failed", verified_by: user.id, rejection_reason: parsed.data.reason })
    .eq("id", paymentId)
    .eq("status", "pending")
    .select("id, invoice_id")
    .maybeSingle();

  if (error) return failure("payments", error, "We could not update this payment just now. Please try again.");
  if (!data) return { status: "error", message: "This payment has already been handled, or you do not have billing access." };

  revalidateInvoice(data.invoice_id);
  return { status: "success", message: "Payment marked as not received." };
}

async function requestOrigin(): Promise<string> {
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host") ?? "localhost:3000";
  const protocol =
    headerList.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");
  return `${protocol}://${host}`;
}

/** Sends a client to the hosted checkout for what is left on their invoice. */
export async function startOnlinePaymentAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const user = await requireRole("client");
  const invoiceId = text(formData, "invoiceId");
  if (!invoiceId) return { status: "error", message: "We could not tell which invoice to pay." };

  if (!isOnlineGatewayConfigured()) {
    return {
      status: "error",
      message: "Online payment is not available. You can pay by bKash or Nagad and send the transaction ID instead.",
    };
  }

  const result = await startCheckout(invoiceId, user, await requestOrigin());
  if (result.status === "error") return { status: "error", message: result.message };

  redirect(result.url);
}
