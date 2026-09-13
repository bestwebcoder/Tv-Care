import { describe, expect, it } from "vitest";

import type { PrescriptionDetail } from "@/features/prescriptions/queries";
import { renderPrescriptionPdf } from "@/lib/prescription-pdf";

const BASE_PRESCRIPTION: PrescriptionDetail = {
  id: "11111111-1111-1111-1111-111111111111",
  appointmentId: "22222222-2222-2222-2222-222222222222",
  petId: "33333333-3333-3333-3333-333333333333",
  petName: "Bruno",
  speciesName: "Dog",
  breedName: "Golden Retriever",
  organizationId: "44444444-4444-4444-4444-444444444444",
  doctorId: "55555555-5555-5555-5555-555555555555",
  doctorName: "Imran Hossain",
  doctorRegistrationNumber: "BVC-2291",
  doctorSignaturePath: null,
  clientName: "Rashed Karim",
  clientPhone: "+8801711000401",
  visitDate: "2026-08-01T09:00:00.000Z",
  version: 1,
  status: "finalized",
  finalizedAt: "2026-08-01T09:30:00.000Z",
  supersededAt: null,
  prescriptionNumber: "RX-000001",
  followUpDate: "2026-08-15",
  instructions: "Give with food.",
  pdfPath: null,
  signedAt: "2026-08-01T09:30:00.000Z",
  weightGrams: 22000,
  weight: "22 kg",
  createdAt: "2026-08-01T09:15:00.000Z",
  items: [
    {
      id: "66666666-6666-6666-6666-666666666666",
      medicationId: null,
      drugName: "Meloxicam",
      genericName: null,
      strength: "1.5 mg/mL",
      formulation: "Oral suspension",
      dosePerKg: 0.1,
      doseUnit: "mg",
      computedDose: 2.2,
      doseForm: null,
      concentrationMgPerUnit: null,
      doseAmount: null,
      route: "PO",
      frequency: "SID",
      frequencyPerDay: null,
      duration: "5 days",
      durationDays: null,
      quantity: "11 mL",
      instructions: "With food",
      sortOrder: 10,
    },
  ],
};

/** A stub Supabase client: no organization row, no signature file — exercises both fallback paths. */
const stubSupabase = {
  from: () => ({
    select: () => ({
      eq: () => ({
        single: async () => ({ data: null }),
      }),
    }),
  }),
  storage: {
    from: () => ({
      download: async () => ({ data: null, error: { message: "not found" } }),
    }),
  },
};

describe("renderPrescriptionPdf", () => {
  it("renders an item carrying a concentration and the standard directions", async () => {
    const buffer = await renderPrescriptionPdf(
      {
        ...BASE_PRESCRIPTION,
        items: [
          {
            ...BASE_PRESCRIPTION.items[0],
            drugName: "Metacam",
            genericName: "Meloxicam",
            concentrationMgPerUnit: 1.5,
            doseForm: "ml",
            doseAmount: 1.47,
            frequencyPerDay: 1,
            durationDays: 5,
          },
        ],
      },
      stubSupabase,
    );

    expect(buffer.subarray(0, 4).toString("ascii")).toBe("%PDF");
  });

  it("produces a real PDF, without a clinic name or signature on record", async () => {
    const buffer = await renderPrescriptionPdf(BASE_PRESCRIPTION, stubSupabase);

    expect(Buffer.isBuffer(buffer)).toBe(true);
    // The PDF magic number.
    expect(buffer.subarray(0, 4).toString("ascii")).toBe("%PDF");
  });

  it("still renders with no items array entries beyond the required one and no follow-up date", async () => {
    const buffer = await renderPrescriptionPdf(
      { ...BASE_PRESCRIPTION, followUpDate: null, instructions: null },
      stubSupabase,
    );

    expect(buffer.subarray(0, 4).toString("ascii")).toBe("%PDF");
  });
});
