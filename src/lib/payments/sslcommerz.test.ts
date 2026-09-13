import { describe, expect, it } from "vitest";

import { assessValidation, paisaToGatewayAmount } from "@/lib/payments/sslcommerz";

const expected = { tranId: "TV0123456789abcdef0123456789ab", amountPaisa: 150000 };

describe("assessValidation", () => {
  it("accepts a VALID response for this transaction and amount", () => {
    expect(assessValidation({ status: "VALID", tran_id: expected.tranId, amount: "1500.00", currency: "BDT" }, expected)).toBe(
      "valid",
    );
  });

  it("accepts a transaction the gateway already validated once", () => {
    expect(
      assessValidation({ status: "VALIDATED", tran_id: expected.tranId, amount: "1500.00", currency: "BDT" }, expected),
    ).toBe("valid");
  });

  it.each([
    [{ tran_id: "TVsomeoneelse", amount: "1500.00", currency: "BDT" }, "another transaction"],
    [{ tran_id: expected.tranId, amount: "15.00", currency: "BDT" }, "a smaller amount"],
    [{ tran_id: expected.tranId, amount: "1500.00", currency: "USD" }, "another currency"],
    [{ tran_id: expected.tranId, amount: "abc", currency: "BDT" }, "an unreadable amount"],
  ])("never completes a valid payment that is not this one: %o (%s)", (fields) => {
    expect(assessValidation({ status: "VALID", ...fields }, expected)).toBe("mismatch");
  });

  it.each(["FAILED", "CANCELLED", "INVALID_TRANSACTION", "UNATTEMPTED"])("treats %s as not paid", (status) => {
    expect(assessValidation({ status, tran_id: expected.tranId, amount: "1500.00", currency: "BDT" }, expected)).toBe(
      "not_valid",
    );
  });

  it("leaves the payment pending when the gateway cannot be reached", () => {
    expect(assessValidation(null, expected)).toBe("unreachable");
  });
});

describe("paisaToGatewayAmount", () => {
  it("formats taka with two decimals", () => {
    expect(paisaToGatewayAmount(150000)).toBe("1500.00");
    expect(paisaToGatewayAmount(1)).toBe("0.01");
  });
});
