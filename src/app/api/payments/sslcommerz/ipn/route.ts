import { settleGatewayPayment } from "@/features/payments/gateway";

/**
 * SSLCommerz's server-to-server notification. Unauthenticated by nature, and
 * never trusted: settleGatewayPayment asks the gateway's own validation API
 * what happened to val_id before completing anything, and is idempotent, so a
 * repeated or forged notification changes nothing it should not.
 */
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const tranId = form?.get("tran_id");
  const valId = form?.get("val_id");

  if (typeof tranId !== "string" || tranId === "") {
    return new Response("Missing tran_id", { status: 400 });
  }

  const status = await settleGatewayPayment({ tranId, valId: typeof valId === "string" && valId !== "" ? valId : null });

  // A 200 tells the gateway to stop retrying. While validation could not reach
  // the gateway the payment is still pending, so ask it to try again.
  return new Response(status, { status: status === "pending" ? 503 : 200 });
}
