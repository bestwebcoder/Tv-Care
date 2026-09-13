import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import { admin, createUserWithRole, organizationId, runId, signedInClient } from "./setup/http";

/**
 * Payments that do not start at a billing desk, and per-vet revenue —
 * 20261013000500_field_and_client_payments.sql and 20261013000600_vet_revenue_reports.sql.
 *
 * Every write goes through a really signed-in user so the policies are what is
 * under test, and every invoice figure is read back from the trigger's own
 * arithmetic.
 */

const RUN = runId();

let orgA: string;
let owner: SupabaseClient;
let otherOwner: SupabaseClient;
let vet: SupabaseClient;
let otherVet: SupabaseClient;
let practiceAdmin: SupabaseClient;

let adminUserId: string;
let ownerUserId: string;
let vetUserId: string;
let vetDoctorId: string;
let otherVetDoctorId: string;
let invoiceId: string;

async function invoiceState() {
  const { data } = await admin.from("invoices").select("status, amount_paid_paisa, balance_paisa").eq("id", invoiceId).single();
  return data!;
}

beforeAll(async () => {
  orgA = await organizationId();

  const [ownerUser, otherOwnerUser, vetUser, otherVetUser, adminUser] = await Promise.all([
    createUserWithRole(`fp-owner-${RUN}`, "client"),
    createUserWithRole(`fp-other-${RUN}`, "client"),
    createUserWithRole(`fp-vet-${RUN}`, "doctor"),
    createUserWithRole(`fp-vet2-${RUN}`, "doctor"),
    createUserWithRole(`fp-admin-${RUN}`, "admin"),
  ]);
  ownerUserId = ownerUser.userId;
  vetUserId = vetUser.userId;
  adminUserId = adminUser.userId;

  const [{ data: clientRow }, , { data: vetRow }, { data: otherVetRow }] = await Promise.all([
    admin
      .from("clients")
      .insert({ user_id: ownerUser.userId, organization_id: orgA, full_name: `FP Owner ${RUN}`, phone: `+88017${RUN}71` })
      .select("id")
      .single(),
    admin
      .from("clients")
      .insert({ user_id: otherOwnerUser.userId, organization_id: orgA, full_name: `FP Other ${RUN}`, phone: `+88017${RUN}72` }),
    admin.from("doctors").insert({ user_id: vetUser.userId, organization_id: orgA }).select("id").single(),
    admin.from("doctors").insert({ user_id: otherVetUser.userId, organization_id: orgA }).select("id").single(),
  ]);
  vetDoctorId = vetRow!.id;
  otherVetDoctorId = otherVetRow!.id;

  const { data: species } = await admin.from("species").select("id").eq("slug", "dog").single();
  const { data: pet } = await admin
    .from("pets")
    .insert({ client_id: clientRow!.id, organization_id: orgA, name: `FP Pet ${RUN}`, species_id: species!.id })
    .select("id")
    .single();
  const { data: service } = await admin
    .from("services")
    .insert({ organization_id: orgA, name: `FP Home Visit ${RUN}`, price_paisa: 100_000 })
    .select("id")
    .single();

  const starts = new Date(Date.now() - 2 * 3_600_000);
  const { data: appointment, error: appointmentError } = await admin
    .from("appointments")
    .insert({
      organization_id: orgA,
      client_id: clientRow!.id,
      pet_id: pet!.id,
      doctor_id: vetDoctorId,
      service_id: service!.id,
      visit_type: "home",
      starts_at: starts.toISOString(),
      ends_at: new Date(starts.getTime() + 30 * 60_000).toISOString(),
      status: "completed",
    })
    .select("id")
    .single();
  if (appointmentError) throw appointmentError;

  const { data: invoice } = await admin
    .from("invoices")
    .insert({
      organization_id: orgA,
      client_id: clientRow!.id,
      pet_id: pet!.id,
      appointment_id: appointment!.id,
      status: "issued",
      issued_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  invoiceId = invoice!.id;

  await admin
    .from("invoice_items")
    .insert({ invoice_id: invoiceId, description: `FP Home Visit ${RUN}`, quantity: 1, unit_price_paisa: 100_000, line_total_paisa: 100_000 });

  [owner, otherOwner, vet, otherVet, practiceAdmin] = await Promise.all([
    signedInClient(ownerUser.email),
    signedInClient(otherOwnerUser.email),
    signedInClient(vetUser.email),
    signedInClient(otherVetUser.email),
    signedInClient(adminUser.email),
  ]);
}, 180_000);

const onSite = (doctorId: string, recordedBy: string, amount: number) => ({
  invoice_id: invoiceId,
  organization_id: orgA,
  amount_paisa: amount,
  method: "cash",
  source: "doctor_on_site",
  collected_by_doctor_id: doctorId,
  recorded_by: recordedBy,
});

describe("a traveling vet collecting payment on site", () => {
  it("lets the attending vet record what they collected, and applies it at once", async () => {
    const { error } = await vet.from("payments").insert(onSite(vetDoctorId, vetUserId, 30_000));
    expect(error).toBeNull();

    expect(await invoiceState()).toMatchObject({ status: "partially_paid", amount_paid_paisa: 30_000, balance_paisa: 70_000 });
  });

  it("refuses a vet who did not attend the visit", async () => {
    const { data: me } = await otherVet.auth.getUser();
    const { error } = await otherVet.from("payments").insert(onSite(otherVetDoctorId, me.user!.id, 1_000));
    expect(error).not.toBeNull();
  });

  it("refuses the attending vet posing as billing staff", async () => {
    const { error } = await vet.from("payments").insert({ ...onSite(vetDoctorId, vetUserId, 1_000), source: "staff" });
    expect(error).not.toBeNull();
  });
});

describe("a client submitting a payment they made", () => {
  const submission = (reference: string, amount: number, overrides: Record<string, unknown> = {}) => ({
    invoice_id: invoiceId,
    organization_id: orgA,
    amount_paisa: amount,
    method: "bkash",
    reference_number: reference,
    status: "pending",
    source: "client_submission",
    submitted_by: ownerUserId,
    ...overrides,
  });

  it("records it as pending, without moving the balance", async () => {
    const { error } = await owner.from("payments").insert(submission(`TRX${RUN}A`, 20_000));
    expect(error).toBeNull();
    expect((await invoiceState()).balance_paisa).toBe(70_000);
  });

  it("refuses a client declaring their own payment complete", async () => {
    const { error } = await owner.from("payments").insert(submission(`TRX${RUN}B`, 1_000, { status: "completed" }));
    expect(error).not.toBeNull();
  });

  it("refuses the same transaction ID twice", async () => {
    const { error } = await owner.from("payments").insert(submission(`trx${RUN}a`, 1_000));
    expect(error?.code).toBe("23505");
  });

  it("counts payments already awaiting verification against what is left", async () => {
    // 70,000 owed, 20,000 already pending: 60,000 more would overpay.
    const { error } = await owner.from("payments").insert(submission(`TRX${RUN}C`, 60_000));
    expect(error).not.toBeNull();
  });

  it("refuses a submission against somebody else's invoice", async () => {
    const { data: me } = await otherOwner.auth.getUser();
    const { error } = await otherOwner.from("payments").insert(submission(`TRX${RUN}D`, 1_000, { submitted_by: me.user!.id }));
    expect(error).not.toBeNull();
  });

  it("does not let a client verify their own submission", async () => {
    const { data } = await owner
      .from("payments")
      .update({ status: "completed", verified_by: ownerUserId })
      .eq("reference_number", `TRX${RUN}A`)
      .select("id");
    expect(data ?? []).toHaveLength(0);

    const { data: row } = await admin.from("payments").select("status").eq("reference_number", `TRX${RUN}A`).single();
    expect(row!.status).toBe("pending");
  });
});

describe("verifying and rejecting", () => {
  it("applies a verified payment and tells the client it arrived", async () => {
    const { data, error } = await practiceAdmin
      .from("payments")
      .update({ status: "completed", verified_by: adminUserId })
      .eq("reference_number", `TRX${RUN}A`)
      .select("id, verified_at")
      .single();

    expect(error).toBeNull();
    expect(data!.verified_at).not.toBeNull();
    expect(await invoiceState()).toMatchObject({ amount_paid_paisa: 50_000, balance_paisa: 50_000 });

    const { data: notifications } = await admin
      .from("notifications")
      .select("type")
      .eq("related_table", "payments")
      .eq("related_id", data!.id);
    expect(notifications!.map((row) => row.type)).toContain("payment_confirmation");
  });

  it("never lets a completed payment be edited", async () => {
    const { error } = await practiceAdmin.from("payments").update({ status: "failed" }).eq("reference_number", `TRX${RUN}A`);
    expect(error).not.toBeNull();
  });

  it("rejects a submission with a reason, leaving the balance alone", async () => {
    await owner.from("payments").insert({
      invoice_id: invoiceId,
      organization_id: orgA,
      amount_paisa: 5_000,
      method: "nagad",
      reference_number: `TRX${RUN}E`,
      status: "pending",
      source: "client_submission",
      submitted_by: ownerUserId,
    });

    const { error } = await practiceAdmin
      .from("payments")
      .update({ status: "failed", verified_by: adminUserId, rejection_reason: "Not on the Nagad statement" })
      .eq("reference_number", `TRX${RUN}E`);

    expect(error).toBeNull();
    expect((await invoiceState()).balance_paisa).toBe(50_000);
  });
});

describe("per-vet revenue", () => {
  const today = new Date();
  const range = {
    p_from: new Date(today.getTime() - 86_400_000).toISOString().slice(0, 10),
    p_to: new Date(today.getTime() + 86_400_000).toISOString().slice(0, 10),
  };

  it("shows a vet their own figures without report access", async () => {
    const { data, error } = await vet.rpc("report_vet_revenue", { p_organization_id: orgA, ...range, p_doctor_id: vetDoctorId });

    expect(error).toBeNull();
    expect(data).toHaveLength(1);
    expect(data![0]).toMatchObject({
      completed_appointments: 1,
      home_visits: 1,
      billed_paisa: 100_000,
      collected_paisa: 50_000,
      collected_on_site_paisa: 30_000,
      outstanding_paisa: 50_000,
    });
  });

  it("refuses a vet asking about another vet, or the whole practice", async () => {
    const other = await vet.rpc("report_vet_revenue", { p_organization_id: orgA, ...range, p_doctor_id: otherVetDoctorId });
    expect(other.error).not.toBeNull();

    const everyone = await vet.rpc("report_vet_revenue", { p_organization_id: orgA, ...range, p_doctor_id: null });
    expect(everyone.error).not.toBeNull();
  });

  it("gives an administrator every vet, and each vet's services", async () => {
    const { data, error } = await practiceAdmin.rpc("report_vet_revenue", { p_organization_id: orgA, ...range, p_doctor_id: null });
    expect(error).toBeNull();
    expect(data!.some((row: { doctor_id: string }) => row.doctor_id === vetDoctorId)).toBe(true);

    const byService = await practiceAdmin.rpc("report_vet_revenue_by_service", {
      p_organization_id: orgA,
      p_doctor_id: vetDoctorId,
      ...range,
    });
    expect(byService.error).toBeNull();
    expect(byService.data).toEqual([{ service_name: `FP Home Visit ${RUN}`, quantity: 1, revenue_paisa: 100_000 }]);
  });
});
