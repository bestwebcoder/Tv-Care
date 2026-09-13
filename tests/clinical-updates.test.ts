import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";

import { admin, createUserWithRole, organizationId, runId, signedInClient } from "./setup/http";

/**
 * Temperature in °F with owner history (20261013000200), prescriptions dosed
 * from a concentration (20261013000300), and internal/external parasite
 * treatment (20261013000400) — checked in the database, as the doctor.
 */

const RUN = runId();

let orgA: string;
let vet: SupabaseClient;
let vetDoctorId: string;
let petId: string;
let ownerUserId: string;
const appointmentIds: string[] = [];

beforeAll(async () => {
  orgA = await organizationId();

  const [ownerUser, vetUser] = await Promise.all([
    createUserWithRole(`cu-owner-${RUN}`, "client"),
    createUserWithRole(`cu-vet-${RUN}`, "doctor"),
  ]);
  ownerUserId = ownerUser.userId;

  const [{ data: clientRow }, { data: doctorRow }] = await Promise.all([
    admin
      .from("clients")
      .insert({ user_id: ownerUser.userId, organization_id: orgA, full_name: `CU Owner ${RUN}`, phone: `+88019${RUN}81` })
      .select("id")
      .single(),
    admin.from("doctors").insert({ user_id: vetUser.userId, organization_id: orgA }).select("id").single(),
  ]);
  vetDoctorId = doctorRow!.id;

  const { data: species } = await admin.from("species").select("id").eq("slug", "dog").single();
  const { data: pet } = await admin
    .from("pets")
    .insert({ client_id: clientRow!.id, organization_id: orgA, name: `CU Pet ${RUN}`, species_id: species!.id })
    .select("id")
    .single();
  petId = pet!.id;

  const { data: service } = await admin
    .from("services")
    .insert({ organization_id: orgA, name: `CU Consult ${RUN}`, price_paisa: 50_000 })
    .select("id")
    .single();

  for (let index = 0; index < 3; index += 1) {
    const starts = new Date(Date.now() - (index + 2) * 3_600_000);
    const { data, error } = await admin
      .from("appointments")
      .insert({
        organization_id: orgA,
        client_id: clientRow!.id,
        pet_id: petId,
        doctor_id: vetDoctorId,
        service_id: service!.id,
        visit_type: "clinic",
        starts_at: starts.toISOString(),
        ends_at: new Date(starts.getTime() + 30 * 60_000).toISOString(),
        status: "completed",
      })
      .select("id")
      .single();
    if (error) throw error;
    appointmentIds.push(data!.id);
  }

  vet = await signedInClient(vetUser.email);
}, 180_000);

const soapFor = (appointmentId: string, fields: Record<string, unknown>) => ({
  appointment_id: appointmentId,
  pet_id: petId,
  organization_id: orgA,
  doctor_id: vetDoctorId,
  ...fields,
});

describe("SOAP temperature in Fahrenheit", () => {
  let soapId: string;

  it("stores °F as typed and derives Celsius", async () => {
    const { data, error } = await vet
      .from("soap_records")
      .insert(
        soapFor(appointmentIds[0], {
          temperature_fahrenheit: 102.5,
          owner_history: `Spayed in 2024 ${RUN}`,
          prior_medications: "Carprofen 25 mg, last given yesterday",
        }),
      )
      .select("id, temperature_fahrenheit, temperature_celsius")
      .single();

    expect(error).toBeNull();
    expect(data).toMatchObject({ temperature_fahrenheit: 102.5, temperature_celsius: 39.2 });
    soapId = data!.id;
  });

  it("keeps Celsius in step when °F is corrected", async () => {
    const { data } = await vet
      .from("soap_records")
      .update({ temperature_fahrenheit: 101 })
      .eq("id", soapId)
      .select("temperature_celsius")
      .single();
    expect(data!.temperature_celsius).toBe(38.3);
  });

  it("refuses a temperature no animal could have", async () => {
    const { error } = await vet.from("soap_records").update({ temperature_fahrenheit: 115 }).eq("id", soapId);
    expect(error).not.toBeNull();
  });

  it("carries °F and both history fields into a revision", async () => {
    await vet.from("soap_records").update({ status: "finalized", finalized_at: new Date().toISOString() }).eq("id", soapId);

    const { data: revisedId, error } = await vet.rpc("revise_soap_record", { p_soap_record_id: soapId });
    expect(error).toBeNull();

    const { data: revised } = await admin
      .from("soap_records")
      .select("version, temperature_fahrenheit, owner_history, prior_medications")
      .eq("id", revisedId)
      .single();
    expect(revised).toMatchObject({
      version: 2,
      temperature_fahrenheit: 101,
      owner_history: `Spayed in 2024 ${RUN}`,
      prior_medications: "Carprofen 25 mg, last given yesterday",
    });
  });

  it("fills °F for a writer that only knows Celsius", async () => {
    const { data } = await admin
      .from("soap_records")
      .insert(soapFor(appointmentIds[1], { temperature_celsius: 38.5 }))
      .select("temperature_fahrenheit")
      .single();
    expect(data!.temperature_fahrenheit).toBe(101.3);
  });
});

describe("prescriptions dosed from a concentration", () => {
  let prescriptionId: string;

  beforeAll(async () => {
    await admin
      .from("soap_records")
      .insert(soapFor(appointmentIds[2], { status: "finalized", finalized_at: new Date().toISOString() }));

    const { data } = await admin
      .from("prescriptions")
      .insert({ appointment_id: appointmentIds[2], pet_id: petId, organization_id: orgA, doctor_id: vetDoctorId, weight_grams: 22_000 })
      .select("id")
      .single();
    prescriptionId = data!.id;
  });

  it("refuses a concentration that does not say per what", async () => {
    const { error } = await admin
      .from("prescription_items")
      .insert({ prescription_id: prescriptionId, drug_name: "Metacam", concentration_mg_per_unit: 1.5 });
    expect(error?.code).toBe("23514");
  });

  it("carries the weight and every structured field into a revision", async () => {
    const { error: itemError } = await admin.from("prescription_items").insert({
      prescription_id: prescriptionId,
      drug_name: "Metacam",
      generic_name: "Meloxicam",
      dose_per_kg: 0.1,
      dose_unit: "mg",
      computed_dose: 2.2,
      concentration_mg_per_unit: 1.5,
      dose_form: "ml",
      dose_amount: 1.47,
      route: "PO",
      frequency_per_day: 1,
      duration_days: 5,
    });
    expect(itemError).toBeNull();

    await admin
      .from("prescriptions")
      .update({ status: "finalized", finalized_at: new Date().toISOString(), signed_at: new Date().toISOString() })
      .eq("id", prescriptionId);

    const { data: revisedId, error } = await vet.rpc("revise_prescription", { p_prescription_id: prescriptionId });
    expect(error).toBeNull();

    const { data: revised } = await admin
      .from("prescriptions")
      .select(
        "weight_grams, items:prescription_items (generic_name, concentration_mg_per_unit, dose_form, dose_amount, frequency_per_day, duration_days)",
      )
      .eq("id", revisedId)
      .single();

    expect(revised!.weight_grams).toBe(22_000);
    expect(revised!.items).toEqual([
      {
        generic_name: "Meloxicam",
        concentration_mg_per_unit: 1.5,
        dose_form: "ml",
        dose_amount: 1.47,
        frequency_per_day: 1,
        duration_days: 5,
      },
    ]);
  });
});

describe("internal and external parasite treatment", () => {
  const today = new Date().toISOString().slice(0, 10);
  const inAMonth = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);

  const treatment = (fields: Record<string, unknown>) => ({
    appointment_id: appointmentIds[2],
    pet_id: petId,
    organization_id: orgA,
    doctor_id: vetDoctorId,
    date_administered: today,
    interval: "monthly",
    next_due_date: inAMonth,
    ...fields,
  });

  it("keeps a separate latest status for each type", async () => {
    const { data: internal, error: internalError } = await vet
      .from("deworming_records")
      .insert(treatment({ product: `Drontal ${RUN}` }))
      .select("id, parasite_type")
      .single();
    const { data: external, error: externalError } = await vet
      .from("deworming_records")
      .insert(treatment({ product: `Bravecto ${RUN}`, parasite_type: "external" }))
      .select("id")
      .single();

    expect(internalError).toBeNull();
    expect(externalError).toBeNull();
    // Existing writers that do not know about the column still record deworming.
    expect(internal!.parasite_type).toBe("internal");

    const { data: statuses } = await vet.from("pet_deworming_status").select("parasite_type, product").eq("pet_id", petId);
    expect(statuses).toHaveLength(2);

    const { data: reminders } = await admin
      .from("notifications")
      .select("title")
      .eq("recipient_user_id", ownerUserId)
      .in("related_id", [internal!.id, external!.id]);
    // One reminder per delivery channel (20260829000100_notifications.sql), so
    // compare what they say rather than how many there are.
    expect([...new Set(reminders!.map((row) => row.title))].sort()).toEqual([
      `Deworming due: Drontal ${RUN}`,
      `Tick & flea treatment due: Bravecto ${RUN}`,
    ]);
  });

  it("refuses any other parasite type", async () => {
    const { error } = await vet.from("deworming_records").insert(treatment({ product: "Mystery", parasite_type: "both" }));
    expect(error).not.toBeNull();
  });
});
