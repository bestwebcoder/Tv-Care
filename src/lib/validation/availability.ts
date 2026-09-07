import { z } from "zod";

import { VISIT_TYPES } from "@/lib/validation/appointment";
import { timeSchema, uuidSchema } from "@/lib/validation/common";

/**
 * One schema for a doctor's availability window, shared by the form and the
 * server action. Working days, hours and breaks are all instances of this:
 * a doctor working 09:00–13:00 and 14:00–17:00 has two windows, and the gap
 * between them is the break — see the comment on `doctor_availability` in
 * `supabase/migrations/20260820000700_appointments.sql`.
 */

/** `HH:mm` as minutes past midnight. */
export function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

/** Minutes past midnight as `HH:mm`. */
export function minutesToTime(value: number): string {
  const hours = Math.floor(value / 60)
    .toString()
    .padStart(2, "0");
  const minutes = (value % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

/**
 * How many start times a window offers, for a visit as long as one slot.
 *
 * The figure shown beside a window on the admin screen. A longer service
 * fits fewer times into the same window, which is why the booking form asks
 * the server rather than counting here.
 */
export function slotCount(startsAt: string, endsAt: string, slotMinutes: number): number {
  const span = timeToMinutes(endsAt) - timeToMinutes(startsAt);
  if (span <= 0 || slotMinutes <= 0) return 0;
  return Math.floor(span / slotMinutes);
}

const windowShape = {
  startsAt: timeSchema,
  endsAt: timeSchema,
  slotMinutes: z.coerce
    .number()
    .int()
    .min(5, "Slots must be at least 5 minutes")
    .max(240, "Slots must be 240 minutes or fewer"),
  visitType: z
    .enum(VISIT_TYPES)
    .nullish()
    .transform((value) => value ?? null),
  branchId: uuidSchema.nullish().transform((value) => value ?? null),
};

/**
 * A window has to be ordered, and long enough to hold one slot: 09:00–09:20
 * in 30-minute slots is a window that can never offer a time, which the
 * database is happy to store and the booking form would silently show as
 * "not scheduled to work then".
 */
function refineWindow<T extends { startsAt: string; endsAt: string; slotMinutes: number }>(
  values: T,
  ctx: z.RefinementCtx,
) {
  const span = timeToMinutes(values.endsAt) - timeToMinutes(values.startsAt);

  if (span <= 0) {
    ctx.addIssue({
      code: "custom",
      path: ["endsAt"],
      message: "End time must be after the start time",
    });
    return;
  }

  if (span < values.slotMinutes) {
    ctx.addIssue({
      code: "custom",
      path: ["slotMinutes"],
      message: `This window is only ${span} minutes long, so a ${values.slotMinutes} minute slot never fits in it.`,
    });
  }
}

/** One window, on one day — what the edit form posts. */
export const availabilitySchema = z
  .object({
    weekday: z.coerce.number().int().min(0, "Choose a day").max(6, "Choose a day"),
    ...windowShape,
  })
  .superRefine(refineWindow);

/**
 * The same window across several days at once — what the add form posts.
 *
 * A doctor working Sunday to Thursday is one decision, not five, and making
 * an administrator repeat the form five times is how a Wednesday goes missing.
 * The action still writes one row per day: they are independent windows
 * afterwards, editable and removable one at a time.
 */
export const availabilityCreateSchema = z
  .object({
    weekdays: z
      .array(z.coerce.number().int().min(0).max(6))
      .min(1, "Choose at least one day")
      // A repeated checkbox name can only send each value once, but the field
      // is not the only possible caller.
      .transform((values) => [...new Set(values)].sort((a, b) => a - b)),
    ...windowShape,
  })
  .superRefine(refineWindow);

/** date_part('dow') numbering: 0 = Sunday. */
export const WEEKDAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** Short forms for the day picker, where seven full names do not fit a phone. */
export const WEEKDAY_SHORT_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export type AvailabilityInput = z.input<typeof availabilitySchema>;
export type AvailabilityValues = z.output<typeof availabilitySchema>;
export type AvailabilityCreateValues = z.output<typeof availabilityCreateSchema>;

export function availabilityToRow(values: AvailabilityValues) {
  return {
    weekday: values.weekday,
    starts_at: values.startsAt,
    ends_at: values.endsAt,
    slot_minutes: values.slotMinutes,
    visit_type: values.visitType,
    branch_id: values.branchId,
  };
}

/** The same row shape, for one of the days a create covers. */
export function availabilityCreateToRow(values: AvailabilityCreateValues, weekday: number) {
  return availabilityToRow({ ...values, weekday });
}
