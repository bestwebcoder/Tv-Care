import { describe, expect, it } from "vitest";

import {
  doseAmountFromMass,
  InvalidConcentrationError,
  prescriptionDirections,
  prescriptionItemLabel,
} from "@/lib/prescription-directions";

describe("doseAmountFromMass", () => {
  it("turns a mass into millilitres from mg/mL", () => {
    // 28 kg × 10 mg/kg = 280 mg, at 50 mg/mL
    expect(doseAmountFromMass(280, 50)).toBe(5.6);
  });

  it("does not round a solid dose to a practical fraction", () => {
    // 140 mg of a 250 mg tablet: the vet decides whether that is a half.
    expect(doseAmountFromMass(140, 250)).toBe(0.56);
  });

  it.each([
    [0, 50],
    [280, 0],
    [280, Number.NaN],
    [-5, 50],
  ])("refuses dose %s at concentration %s", (dose, concentration) => {
    expect(() => doseAmountFromMass(dose, concentration)).toThrow(InvalidConcentrationError);
  });
});

describe("prescriptionItemLabel", () => {
  it("reads generic name (concentration)", () => {
    expect(
      prescriptionItemLabel({ drugName: "Moxclav", genericName: "Amoxicillin", concentrationMgPerUnit: 50, doseForm: "ml" }),
    ).toBe("Amoxicillin (50 mg/mL)");
  });

  it("names the solid unit in the concentration", () => {
    expect(
      prescriptionItemLabel({ drugName: "Metacam", genericName: "Meloxicam", concentrationMgPerUnit: 2.5, doseForm: "tablet" }),
    ).toBe("Meloxicam (2.5 mg/tablet)");
  });

  it("falls back to the drug name and drops brackets for an older item", () => {
    expect(prescriptionItemLabel({ drugName: "Doxycycline", genericName: null, concentrationMgPerUnit: null, doseForm: null })).toBe(
      "Doxycycline",
    );
  });
});

describe("prescriptionDirections", () => {
  const complete = { doseAmount: 5.6, doseForm: "ml" as const, route: "PO", frequencyPerDay: 2, durationDays: 7 };

  it("follows the standard sentence", () => {
    expect(prescriptionDirections(complete)).toBe("Give 5.6 mL PO, 2 times a day for 7 days");
  });

  it("pluralises tablets, days and times only when it should", () => {
    expect(prescriptionDirections({ ...complete, doseAmount: 1, doseForm: "tablet", frequencyPerDay: 1, durationDays: 1 })).toBe(
      "Give 1 tablet PO, 1 time a day for 1 day",
    );
    expect(prescriptionDirections({ ...complete, doseAmount: 2, doseForm: "capsule" })).toBe(
      "Give 2 capsules PO, 2 times a day for 7 days",
    );
    expect(prescriptionDirections({ ...complete, doseAmount: 0.5, doseForm: "tablet" })).toBe(
      "Give 0.5 tablet PO, 2 times a day for 7 days",
    );
  });

  it.each(["doseAmount", "doseForm", "route", "frequencyPerDay", "durationDays"] as const)(
    "writes nothing rather than half a sentence when %s is missing",
    (field) => {
      expect(prescriptionDirections({ ...complete, [field]: field === "route" ? "  " : null })).toBeNull();
    },
  );
});
