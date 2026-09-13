import { NextResponse } from "next/server";

import { abandonGatewayPayment, settleGatewayPayment } from "@/features/payments/gateway";

/**
 * Where the client's browser comes back from the hosted checkout — a cross-site
 * POST, so no session cookie arrives with it and none is needed. Success is
 * settled through the gateway's validation API exactly as the IPN is (either
 * may arrive first). A failure or cancellation only ever moves a still-pending
 * row to failed; the transaction ID it names is 112 random bits, so it cannot
 * be aimed at somebody else's checkout.
 *
 * Then a 303 to the invoices page, which the browser follows as a normal GET
 * with the client's session.
 */
export async function POST(request: Request) {
  const outcome = new URL(request.url).searchParams.get("outcome");
  const form = await request.formData().catch(() => null);
  const tranId = form?.get("tran_id");
  const valId = form?.get("val_id");

  let status: Awaited<ReturnType<typeof settleGatewayPayment>> = "unknown";

  if (typeof tranId === "string" && tranId !== "") {
    status =
      outcome === "success"
        ? await settleGatewayPayment({ tranId, valId: typeof valId === "string" && valId !== "" ? valId : null })
        : await abandonGatewayPayment(
            tranId,
            outcome === "cancel" ? "Cancelled at checkout." : "Declined at the payment gateway.",
          );
  }

  const result =
    status === "completed" ? "paid" : status === "pending" ? "processing" : outcome === "cancel" ? "cancelled" : "failed";

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? new URL(request.url).host;
  const protocol = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");

  return NextResponse.redirect(new URL(`/client/invoices?payment=${result}`, `${protocol}://${host}`), 303);
}
