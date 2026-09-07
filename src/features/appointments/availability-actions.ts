"use server";

import { revalidatePath } from "next/cache";

import { failure, invalid, text, type FormState } from "@/lib/forms";
import { createClient } from "@/lib/supabase/server";
import {
  availabilityCreateSchema,
  availabilityCreateToRow,
  availabilitySchema,
  availabilityToRow,
  WEEKDAY_LABELS,
} from "@/lib/validation/availability";

/**
 * Doctor availability writes — the practice's own schedule, so row level
 * security decides who may make them (`doctor_availability_insert`/`_update`,
 * plus the `doctors.manage` permission policy). Nothing here re-states that;
 * these actions resolve the form into rows and translate the two database
 * refusals that mean something to a human.
 */

/** The exclusion constraint: two active windows cannot cover the same minute. */
const OVERLAP = "23P01";

function readWindowForm(formData: FormData) {
  return {
    startsAt: text(formData, "startsAt") ?? "",
    endsAt: text(formData, "endsAt") ?? "",
    slotMinutes: text(formData, "slotMinutes") ?? "",
    visitType: text(formData, "visitType") ?? null,
    branchId: text(formData, "branchId") ?? null,
  };
}

function overlapError(): FormState {
  return {
    status: "error",
    message: "This window overlaps another one already set for this doctor on this day.",
  };
}

/** "Monday", "Monday and Tuesday", "Monday, Tuesday and Wednesday". */
function listDays(weekdays: number[]): string {
  const names = weekdays.map((day) => WEEKDAY_LABELS[day]);
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export async function createAvailabilityAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const doctorId = text(formData, "doctorId");
  if (!doctorId) return { status: "error", message: "We could not tell which doctor this is for." };

  const parsed = availabilityCreateSchema.safeParse({
    ...readWindowForm(formData),
    weekdays: formData.getAll("weekdays").filter((value): value is string => typeof value === "string"),
  });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();

  const { data: doctor, error: doctorError } = await supabase
    .from("doctors")
    .select("organization_id")
    .eq("id", doctorId)
    .is("deleted_at", null)
    .maybeSingle();

  if (doctorError || !doctor) return { status: "error", message: "That doctor could not be found." };

  // One row per day, written one at a time rather than as a single multi-row
  // insert: a Sunday-to-Thursday window that clashes with an existing Tuesday
  // should add the other four days and say so, not refuse the lot.
  const added: number[] = [];
  const clashed: number[] = [];

  for (const weekday of parsed.data.weekdays) {
    const { error } = await supabase.from("doctor_availability").insert({
      ...availabilityCreateToRow(parsed.data, weekday),
      doctor_id: doctorId,
      organization_id: doctor.organization_id,
    });

    if (!error) {
      added.push(weekday);
      continue;
    }

    if (error.code === OVERLAP) {
      clashed.push(weekday);
      continue;
    }

    return failure(
      "doctor_availability",
      error,
      "We could not save this window just now. Please try again.",
    );
  }

  revalidatePath("/admin/appointments/availability");

  if (added.length === 0) return overlapError();

  return {
    status: "success",
    message: `Availability added for ${listDays(added)}.`,
    warning:
      clashed.length > 0
        ? `${listDays(clashed)} already had a window covering these hours, so ${clashed.length === 1 ? "it was" : "they were"} left unchanged.`
        : undefined,
  };
}

export async function updateAvailabilityAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const availabilityId = text(formData, "availabilityId");
  if (!availabilityId) return { status: "error", message: "We could not tell which window to update." };

  const parsed = availabilitySchema.safeParse({
    ...readWindowForm(formData),
    weekday: text(formData, "weekday") ?? "",
  });
  if (!parsed.success) return invalid(parsed.error);

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("doctor_availability")
    .update(availabilityToRow(parsed.data))
    .eq("id", availabilityId)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    if (error.code === OVERLAP) return overlapError();
    return failure("doctor_availability", error, "We could not save these changes just now. Please try again.");
  }
  if (!data) return { status: "error", message: "You do not have access to this window." };

  revalidatePath("/admin/appointments/availability");
  return { status: "success", message: "Changes saved." };
}

/**
 * Puts a window on hold, or brings it back.
 *
 * A doctor away for a month is not a doctor whose Tuesday hours were wrong,
 * and rebuilding a week of windows on their return is how one comes back
 * subtly different. `is_active` is outside the exclusion constraint's
 * predicate, so a paused window may sit under a temporary one covering the
 * same hours — which is exactly what makes bringing it back able to clash.
 */
export async function setAvailabilityActiveAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const availabilityId = text(formData, "availabilityId");
  if (!availabilityId) return { status: "error", message: "We could not tell which window to change." };

  const isActive = text(formData, "isActive") === "true";

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("doctor_availability")
    .update({ is_active: isActive })
    .eq("id", availabilityId)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    if (error.code === OVERLAP) {
      return {
        status: "error",
        message:
          "Another window now covers these hours. Remove or move it before putting this one back in use.",
      };
    }
    return failure("doctor_availability", error, "We could not change this window just now. Please try again.");
  }
  if (!data) return { status: "error", message: "You do not have access to this window." };

  revalidatePath("/admin/appointments/availability");
  return {
    status: "success",
    message: isActive ? "Window back in use." : "Window paused. Existing appointments are unaffected.",
  };
}

export async function deleteAvailabilityAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const availabilityId = text(formData, "availabilityId");
  if (!availabilityId) return { status: "error", message: "We could not tell which window to remove." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("doctor_availability")
    .update({ deleted_at: new Date().toISOString(), is_active: false })
    .eq("id", availabilityId)
    .is("deleted_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    return failure("doctor_availability", error, "We could not remove this window just now. Please try again.");
  }
  if (!data) return { status: "error", message: "You do not have access to this window." };

  revalidatePath("/admin/appointments/availability");
  return { status: "success", message: "Availability window removed." };
}
