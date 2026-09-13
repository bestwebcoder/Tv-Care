import { parseServerEnv } from "@/lib/env";

/**
 * SSLCommerz hosted checkout — the Bangladesh card, bKash, Nagad and bank
 * gateway. Server-only: it reads the store password.
 *
 * The flow, and where trust lives:
 *
 *   1. createCheckoutSession  asks the gateway for a checkout page for one
 *                             pending payment row (tran_id = that row's
 *                             reference_number) and sends the client there.
 *   2. The gateway POSTs back to the IPN and return URLs. Those POSTs are
 *      unauthenticated and are never believed on their own.
 *   3. validateTransaction    asks the gateway's validation API, with the store
 *                             credentials, what actually happened to val_id.
 *   4. assessValidation       accepts it only if the gateway says VALID and the
 *                             transaction ID, amount and currency all match the
 *                             pending row. Only then is the payment completed.
 */

export type GatewayConfig = { storeId: string; storePassword: string; baseUrl: string };

export function gatewayConfig(): GatewayConfig | null {
  const env = parseServerEnv(process.env);
  if (!env.SSLCOMMERZ_STORE_ID || !env.SSLCOMMERZ_STORE_PASSWORD) return null;

  return {
    storeId: env.SSLCOMMERZ_STORE_ID,
    storePassword: env.SSLCOMMERZ_STORE_PASSWORD,
    baseUrl: env.SSLCOMMERZ_LIVE === "true" ? "https://securepay.sslcommerz.com" : "https://sandbox.sslcommerz.com",
  };
}

export function isOnlineGatewayConfigured(): boolean {
  return gatewayConfig() !== null;
}

export type CheckoutInput = {
  tranId: string;
  amountPaisa: number;
  productName: string;
  customer: { name: string; email: string; phone: string; city: string | null; address: string | null };
  urls: { success: string; fail: string; cancel: string; ipn: string };
};

/** SSLCommerz takes taka with two decimals. */
export function paisaToGatewayAmount(amountPaisa: number): string {
  return (amountPaisa / 100).toFixed(2);
}

export async function createCheckoutSession(input: CheckoutInput): Promise<{ ok: true; url: string } | { ok: false }> {
  const config = gatewayConfig();
  if (!config) return { ok: false };

  const body = new URLSearchParams({
    store_id: config.storeId,
    store_passwd: config.storePassword,
    total_amount: paisaToGatewayAmount(input.amountPaisa),
    currency: "BDT",
    tran_id: input.tranId,
    success_url: input.urls.success,
    fail_url: input.urls.fail,
    cancel_url: input.urls.cancel,
    ipn_url: input.urls.ipn,
    cus_name: input.customer.name,
    cus_email: input.customer.email,
    cus_phone: input.customer.phone,
    cus_add1: input.customer.address ?? "Not provided",
    cus_city: input.customer.city ?? "Dhaka",
    cus_country: "Bangladesh",
    shipping_method: "NO",
    product_name: input.productName,
    product_category: "Veterinary services",
    product_profile: "non-physical-goods",
  });

  try {
    const response = await fetch(`${config.baseUrl}/gwprocess/v4/api.php`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
    });
    const json = (await response.json()) as { status?: string; GatewayPageURL?: string; failedreason?: string };

    if (json.status === "SUCCESS" && json.GatewayPageURL) {
      return { ok: true, url: json.GatewayPageURL };
    }

    console.error("[payments] gateway refused to open a session", json.status, json.failedreason);
    return { ok: false };
  } catch (error) {
    console.error("[payments] gateway session request failed", error);
    return { ok: false };
  }
}

export type GatewayValidation = {
  status: string;
  tran_id?: string;
  amount?: string;
  currency?: string;
  val_id?: string;
};

export async function validateTransaction(valId: string): Promise<GatewayValidation | null> {
  const config = gatewayConfig();
  if (!config) return null;

  const query = new URLSearchParams({
    val_id: valId,
    store_id: config.storeId,
    store_passwd: config.storePassword,
    format: "json",
  });

  try {
    const response = await fetch(`${config.baseUrl}/validator/api/validationserverAPI.php?${query}`, { cache: "no-store" });
    return (await response.json()) as GatewayValidation;
  } catch (error) {
    console.error("[payments] gateway validation request failed", error);
    return null;
  }
}

/**
 * What a validation response means for the pending row it claims to settle.
 *
 *   valid       the gateway confirms it, and it is this transaction, this amount, in taka
 *   mismatch    the gateway confirms A payment, but not this one — never complete it
 *   not_valid   the gateway does not confirm it (failed, cancelled, unknown)
 *   unreachable no answer — leave the row pending and let the IPN retry
 */
export function assessValidation(
  validation: GatewayValidation | null,
  expected: { tranId: string; amountPaisa: number },
): "valid" | "mismatch" | "not_valid" | "unreachable" {
  if (!validation) return "unreachable";
  if (validation.status !== "VALID" && validation.status !== "VALIDATED") return "not_valid";

  const amountPaisa = Math.round(Number(validation.amount) * 100);
  if (
    validation.tran_id !== expected.tranId ||
    validation.currency !== "BDT" ||
    !Number.isFinite(amountPaisa) ||
    amountPaisa !== expected.amountPaisa
  ) {
    return "mismatch";
  }

  return "valid";
}
