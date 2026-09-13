import { z } from "zod";

import { DOSE_FORMS, prescriptionDirections, type DoseForm } from "@/lib/prescription-directions";
import { kilogramsToGrams, WeightFormatError } from "@/lib/units";
import { optionalText, uuidSchema } from "@/lib/validation/common";

/**
 * One schema for a prescription's header, and one for a single item —
 * shared by the form and the server action, same convention as `soap.ts`.
 */

const optionalDate = z
  .string()
  .trim()
  .refine((value) => value === "" || /^\d{4}-\d{2}-\d{2}$/.test(value), "Enter a valid date")
  .transform((value) => (value === "" ? null : value))
  .nullish()
  .transform((value) => value ?? null);

function optionalDecimal(label: string) {
  return z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : value))
    .nullish()
    .transform((value) => value ?? null)
    .pipe(
      z
        .string()
        .regex(/^\d+(\.\d+)?$/, `${label} must be a number`)
        .transform(Number)
        .refine((value) => value > 0, `${label} must be greater than zero`)
        .nullable(),
    );
}

function optionalInt(label: string, min: number, max: number) {
  return z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : value))
    .nullish()
    .transform((value) => value ?? null)
    .pipe(
      z
        .string()
        .regex(/^\d+$/, `${label} must be a whole number`)
        .transform(Number)
        .refine((value) => value >= min && value <= max, `${label} must be between ${min} and ${max}`)
        .nullable(),
    );
}

export const prescriptionSchema = z.object({
  followUpDate: optionalDate,
  instructions: optionalText(2000, "Instructions"),
});

export type PrescriptionInput = z.input<typeof prescriptionSchema>;
export type PrescriptionValues = z.output<typeof prescriptionSchema>;

export function prescriptionToRow(values: PrescriptionValues) {
  return {
    follow_up_date: values.followUpDate,
    instructions: values.instructions,
  };
}

/** The body weight a prescription is dosed against, typed in kg, stored in grams. */
export const prescriptionWeightSchema = z.object({
  weightKg: z
    .string()
    .trim()
    .min(1, "Enter the patient's weight")
    .transform((value, ctx) => {
      try {
        return kilogramsToGrams(value);
      } catch (error) {
        ctx.addIssue({
          code: "custom",
          message: error instanceof WeightFormatError ? error.message : "Enter a weight in kilograms, for example 12.4",
        });
        return z.NEVER;
      }
    }),
});

export const prescriptionItemSchema = z
  .object({
    medicationId: uuidSchema.nullish().transform((value) => value ?? null),
    drugName: z.string().trim().min(1, "Enter a drug name").max(200, "Keep it under 200 characters"),
    genericName: optionalText(200, "Generic name"),
    strength: optionalText(100, "Strength"),
    formulation: optionalText(100, "Formulation"),
    dosePerKg: optionalDecimal("Dose per kg"),
    doseUnit: optionalText(20, "Dose unit"),
    computedDose: optionalDecimal("Dose"),
    doseForm: z
      .enum(DOSE_FORMS)
      .or(z.literal(""))
      .nullish()
      .transform((value): DoseForm | null => (value ? value : null)),
    concentrationMgPerUnit: optionalDecimal("Concentration"),
    doseAmount: optionalDecimal("Amount to give"),
    route: optionalText(50, "Route"),
    frequencyPerDay: optionalInt("Times a day", 1, 24),
    durationDays: optionalInt("Days", 1, 365),
    // Free-text fields from before structured directions existed. Still read,
    // so editing an older item does not wipe what it said.
    frequency: optionalText(50, "Frequency"),
    duration: optionalText(100, "Duration"),
    quantity: optionalText(100, "Quantity"),
    instructions: optionalText(500, "Instructions"),
  })
  .refine((values) => values.concentrationMgPerUnit === null || values.doseForm !== null, {
    message: "Choose what the concentration is per — mL, tablet or capsule",
    path: ["doseForm"],
  })
  .refine((values) => values.doseAmount === null || values.doseForm !== null, {
    message: "Choose mL, tablet or capsule for the amount",
    path: ["doseForm"],
  });

export type PrescriptionItemInput = z.input<typeof prescriptionItemSchema>;
export type PrescriptionItemValues = z.output<typeof prescriptionItemSchema>;

export function prescriptionItemToRow(values: PrescriptionItemValues) {
  return {
    medication_id: values.medicationId,
    drug_name: values.drugName,
    generic_name: values.genericName,
    strength: values.strength,
    formulation: values.formulation,
    dose_per_kg: values.dosePerKg,
    dose_unit: values.doseUnit,
    computed_dose: values.computedDose,
    dose_form: values.doseForm,
    concentration_mg_per_unit: values.concentrationMgPerUnit,
    dose_amount: values.doseAmount,
    route: values.route,
    frequency_per_day: values.frequencyPerDay,
    duration_days: values.durationDays,
    // Kept readable for anything still showing the free-text columns (exports,
    // older screens): derived from the structured value when there is one.
    frequency: values.frequencyPerDay !== null ? `${values.frequencyPerDay}× a day` : values.frequency,
    duration: values.durationDays !== null ? `${values.durationDays} day${values.durationDays === 1 ? "" : "s"}` : values.duration,
    quantity: values.quantity,
    instructions: values.instructions,
  };
}

/**
 * Items that cannot be signed yet: every medication on a finalized prescription
 * must carry the standard directions — amount, form, route, times a day and
 * days — so the owner reads the same sentence shape on every prescription.
 * Returns the drug names still incomplete, in order.
 */
export function itemsMissingDirections(
  items: {
    drugName: string;
    doseAmount: number | null;
    doseForm: DoseForm | null;
    route: string | null;
    frequencyPerDay: number | null;
    durationDays: number | null;
  }[],
): string[] {
  return items.filter((item) => prescriptionDirections(item) === null).map((item) => item.drugName);
}
