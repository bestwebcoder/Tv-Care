import { randomBytes } from "node:crypto";

import type { SessionUser } from "@/features/auth/session";
import {
  assessValidation,
  createCheckoutSession,
  validateTransaction,
} from "@/lib/payments/sslcommerz";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * Online payment settlement. Server-only.
 *
 * The service client is used for exactly three writes, each after the caller's
 * right to make it has been established another way:
 *
 *   - creating the pending row, once the client's own session has read the
 *     invoice (row level security is what proves it is theirs)
 *   - completing a row, once the gateway's validation API has confirmed the
 *     transaction, amount and currency
 *   - failing a row the gateway reports as not completed
 *
 * A client cannot write an online_gateway row themselves: no policy allows it,
 * which is the point — "paid online" must only ever be said by the gateway.
 */

/** Checkouts nobody finished within this long are retired, so they stop holding the balance. */
const ABANDONED_AFTER_MS = 60 * 60 * 1000;

type One<T> = T | T[] | null;
function one<T>(value: One<T>): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export async function startCheckout(
  invoiceId: string,
  user: SessionUser,
  origin: string,
): Promise<{ status: "ok"; url: string } | { status: "error"; message: string }> {
  const supabase = await createClient();

  // Under the client's own session: returns nothing unless the invoice is theirs.
  const { data: invoice, error } = await supabase
    .from("invoices")
    .select("id, organization_id, invoice_number, status, balance_paisa, client:clients (full_name, phone, email, address, city)")
    .eq("id", invoiceId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !invoice) return { status: "error", message: "That invoice could not be found." };
  if (invoice.status !== "issued" && invoice.status !== "partially_paid") {
    return { status: "error", message: "This invoice is not open for payment." };
  }

  const service = createServiceClient();

  await service
    .from("payments")
    .update({ status: "failed", rejection_reason: "Checkout was not completed." })
    .eq("invoice_id", invoiceId)
    .eq("source", "online_gateway")
    .eq("status", "pending")
    .lt("created_at", new Date(Date.now() - ABANDONED_AFTER_MS).toISOString());

  const { data: pending } = await service
    .from("payments")
    .select("amount_paisa")
    .eq("invoice_id", invoiceId)
    .eq("status", "pending");

  const amountPaisa = invoice.balance_paisa - (pending ?? []).reduce((total, row) => total + row.amount_paisa, 0);
  if (amountPaisa <= 0) {
    return {
      status: "error",
      message: "A payment for this invoice is already waiting to be confirmed. Please check back shortly.",
    };
  }

  // SSLCommerz allows 30 characters; 28 hex characters is 112 bits of randomness,
  // so a transaction ID cannot be guessed to interfere with someone's checkout.
  const tranId = `TV${randomBytes(14).toString("hex")}`;

  const { data: payment, error: insertError } = await service
    .from("payments")
    .insert({
      invoice_id: invoice.id,
      organization_id: invoice.organization_id,
      amount_paisa: amountPaisa,
      method: "other",
      gateway: "sslcommerz",
      status: "pending",
      source: "online_gateway",
      reference_number: tranId,
      submitted_by: user.id,
    })
    .select("id")
    .single();

  if (insertError || !payment) {
    console.error("[payments] could not open an online payment", insertError);
    return { status: "error", message: "We could not start an online payment just now. Please try again." };
  }

  const { data: organization } = await service
    .from("organizations")
    .select("email")
    .eq("id", invoice.organization_id)
    .maybeSingle();

  const client = one(invoice.client as One<{ full_name: string; phone: string | null; email: string | null; address: string | null; city: string | null }>);
  const returnBase = `${origin}/api/payments/sslcommerz`;

  const session = await createCheckoutSession({
    tranId,
    amountPaisa,
    productName: `Invoice ${invoice.invoice_number}`,
    customer: {
      name: client?.full_name ?? user.fullName,
      // The gateway requires an address to send its own receipt to.
      email: client?.email || user.email || organization?.email || "payments@tvcare.invalid",
      phone: client?.phone || user.phone || "",
      address: client?.address ?? null,
      city: client?.city ?? null,
    },
    urls: {
      success: `${returnBase}/return?outcome=success`,
      fail: `${returnBase}/return?outcome=fail`,
      cancel: `${returnBase}/return?outcome=cancel`,
      ipn: `${returnBase}/ipn`,
    },
  });

  if (!session.ok) {
    await service
      .from("payments")
      .update({ status: "failed", rejection_reason: "The payment gateway could not be reached." })
      .eq("id", payment.id)
      .eq("status", "pending");
    return { status: "error", message: "Online payment is unavailable just now. You can pay by bKash or Nagad instead." };
  }

  return { status: "ok", url: session.url };
}

export type SettledStatus = "completed" | "failed" | "pending" | "unknown";

async function currentStatus(tranId: string): Promise<{ id: string; amountPaisa: number; status: SettledStatus } | null> {
  const { data } = await createServiceClient()
    .from("payments")
    .select("id, amount_paisa, status")
    .eq("gateway", "sslcommerz")
    .eq("reference_number", tranId)
    .maybeSingle();

  return data ? { id: data.id, amountPaisa: data.amount_paisa, status: data.status } : null;
}

/**
 * Settles one online payment from a gateway callback. Idempotent: the IPN and
 * the browser return both call it, in either order, any number of times.
 */
export async function settleGatewayPayment(input: { tranId: string; valId: string | null }): Promise<SettledStatus> {
  const payment = await currentStatus(input.tranId);
  if (!payment) return "unknown";
  if (payment.status !== "pending" || !input.valId) return payment.status;

  const verdict = assessValidation(await validateTransaction(input.valId), {
    tranId: input.tranId,
    amountPaisa: payment.amountPaisa,
  });

  if (verdict === "unreachable") return "pending";

  const service = createServiceClient();

  if (verdict === "valid") {
    const { error } = await service
      .from("payments")
      .update({ status: "completed", gateway_validation_id: input.valId })
      .eq("id", payment.id)
      .eq("status", "pending");

    if (!error) return "completed";

    // The money was taken but the invoice can no longer accept it (settled by
    // another payment meanwhile). Recorded, loudly, rather than lost.
    console.error("[payments] validated online payment could not be applied", error);
    await service
      .from("payments")
      .update({
        status: "failed",
        gateway_validation_id: input.valId,
        rejection_reason: "Paid online after the invoice was already settled. A refund is due.",
      })
      .eq("id", payment.id)
      .eq("status", "pending");
    return "failed";
  }

  await service
    .from("payments")
    .update({
      status: "failed",
      rejection_reason:
        verdict === "mismatch"
          ? "The gateway's confirmation did not match this payment. Check with SSLCommerz before taking any action."
          : "The payment was not completed at the gateway.",
    })
    .eq("id", payment.id)
    .eq("status", "pending");
  return "failed";
}

/** A checkout the client cancelled, or the gateway declined, before paying. */
export async function abandonGatewayPayment(tranId: string, reason: string): Promise<SettledStatus> {
  const payment = await currentStatus(tranId);
  if (!payment) return "unknown";
  if (payment.status !== "pending") return payment.status;

  await createServiceClient()
    .from("payments")
    .update({ status: "failed", rejection_reason: reason })
    .eq("id", payment.id)
    .eq("status", "pending");
  return "failed";
}
