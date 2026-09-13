import { z } from "zod";

import { CurrencyFormatError, taakaToPaisa } from "@/lib/currency";
import { isoDateSchema, optionalText, timeSchema, uuidSchema } from "@/lib/validation/common";
import { zonedToUtcIso } from "@/lib/zoned-time";

/** A scheduled training course session — 20261013000700_training_courses.sql. */

export const DELIVERY_MODES = ["in_person", "online", "hybrid"] as const;
export type DeliveryMode = (typeof DELIVERY_MODES)[number];

export const DELIVERY_MODE_LABELS: Record<DeliveryMode, string> = {
  in_person: "In person",
  online: "Online",
  hybrid: "In person & online",
};

function blankToNull() {
  return z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : value))
    .nullish()
    .transform((value) => value ?? null);
}

export const trainingCourseSchema = z
  .object({
    title: z.string().trim().min(1, "Enter a course title").max(200, "Keep the title under 200 characters"),
    summary: optionalText(2000, "Summary"),
    audience: optionalText(200, "Who it is for"),
    serviceId: blankToNull().pipe(uuidSchema.nullable()),
    deliveryMode: z.enum(DELIVERY_MODES, "Choose how the course is delivered"),
    location: optionalText(300, "Location"),
    startsOn: isoDateSchema,
    startTime: timeSchema,
    endsOn: isoDateSchema,
    endTime: timeSchema,
    feePaisa: blankToNull().transform((value, ctx) => {
      if (value === null) return null;
      if (/^0+(\.0+)?$/.test(value)) return 0;
      try {
        return taakaToPaisa(value);
      } catch (error) {
        ctx.addIssue({
          code: "custom",
          message: error instanceof CurrencyFormatError ? error.message : "Enter a fee in taka, or leave it blank",
        });
        return z.NEVER;
      }
    }),
    seats: blankToNull().pipe(
      z
        .string()
        .regex(/^\d+$/, "Seats must be a whole number")
        .transform(Number)
        .refine((value) => value > 0 && value <= 10000, "Seats must be between 1 and 10000")
        .nullable(),
    ),
    isPublished: z.enum(["true", "false"]).transform((value) => value === "true"),
  })
  .refine((values) => values.deliveryMode === "online" || values.location !== null, {
    message: "Say where the course is held",
    path: ["location"],
  })
  // `yyyy-MM-ddTHH:mm` strings compare correctly as text.
  .refine((values) => `${values.endsOn}T${values.endTime}` >= `${values.startsOn}T${values.startTime}`, {
    message: "The course must end after it starts",
    path: ["endsOn"],
  });

export type TrainingCourseValues = z.output<typeof trainingCourseSchema>;

/** The practice's timezone turns the typed dates and times into instants. */
export function trainingCourseToRow(values: TrainingCourseValues, timeZone: string) {
  return {
    title: values.title,
    summary: values.summary,
    audience: values.audience,
    service_id: values.serviceId,
    delivery_mode: values.deliveryMode,
    location: values.location,
    starts_at: zonedToUtcIso(values.startsOn, values.startTime, timeZone),
    ends_at: zonedToUtcIso(values.endsOn, values.endTime, timeZone),
    fee_paisa: values.feePaisa,
    seats: values.seats,
    is_published: values.isPublished,
  };
}
