import { dhakaInstant, nowInDhaka } from "@/lib/age";
import { createClient } from "@/lib/supabase/server";
import { getService } from "@/features/services/queries";
import {
  bookableSlots,
  daysBetween,
  isCalendarDate,
  weekdayOf,
  type AvailabilityResult,
} from "@/features/appointments/slots";

export type {
  AvailabilityEmptyReason,
  AvailabilityResult,
  OccupiedInterval,
  SlotWindow,
} from "@/features/appointments/slots";

/** Statuses that still occupy a doctor's time — mirrors `occupies_slot` on `appointment_statuses`. */
export const OCCUPYING_STATUSES = [
  "requested",
  "confirmed",
  "checked_in",
  "in_consultation",
  "completed",
] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Turns a doctor's configured availability into the actual times a client can
 * book, for one day.
 *
 * The arithmetic is in `./slots`; what this adds is everything that has to be
 * asked of the database. It mirrors, in the browser's favour, what the
 * database's own exclusion constraints ultimately decide:
 * `doctor_availability_no_overlap` shapes which windows can exist,
 * `appointments_no_double_booking` is the real guarantee against two bookings
 * for the same time. This function only offers slots that guarantee would
 * accept — the insert can still race and lose, which the calling action
 * handles by catching the exclusion violation.
 *
 * It is also where a booking is decided to be possible at all: the booking
 * form lists doctors who are accepting appointments and services that are
 * active, but a form is a suggestion, and one left open while the practice
 * changes its mind is a stale one. Every rule the form applies is re-applied
 * here, because this runs on the server and the form does not.
 */
export async function computeAvailableSlots(params: {
  doctorId: string;
  serviceId: string;
  visitType: string;
  date: string;
  /**
   * The appointment being moved, when rescheduling. Without this an
   * appointment blocks its own new time: a 10:00–11:00 visit could not be
   * nudged to 10:30, because the slot check found the very booking it was
   * about to vacate. The database has never had this problem — an exclusion
   * constraint does not compare a row with itself.
   */
  excludeAppointmentId?: string;
}): Promise<AvailabilityResult> {
  const { doctorId, serviceId, visitType, date, excludeAppointmentId } = params;

  if (!isCalendarDate(date)) return { status: "error" };

  const today = nowInDhaka();
  if (date < today.date) return { status: "empty", reason: "date_in_past" };

  const supabase = await createClient();

  // The doctor decides both whether a booking is possible at all and, through
  // their practice, how soon and how far ahead one may be made.
  const { data: doctor, error: doctorError } = await supabase
    .from("doctors")
    .select(
      "id, is_accepting_appointments, organization:organization_id (booking_lead_minutes, booking_horizon_days)",
    )
    .eq("id", doctorId)
    .is("deleted_at", null)
    .maybeSingle();

  if (doctorError) {
    console.error("[appointments] availability doctor lookup failed", doctorError);
    return { status: "error" };
  }
  if (!doctor || !doctor.is_accepting_appointments) {
    return { status: "empty", reason: "doctor_unavailable" };
  }

  const organization = Array.isArray(doctor.organization) ? doctor.organization[0] : doctor.organization;
  const leadMinutes = organization?.booking_lead_minutes ?? 0;
  const horizonDays = organization?.booking_horizon_days ?? 365;

  if (daysBetween(today.date, date) > horizonDays) {
    return { status: "empty", reason: "date_too_far" };
  }

  // A form only ever offers active services, but the form is not the
  // authority: an id posted for one withdrawn since cannot become a booking.
  // Whether it belongs to this practice at all is left where it is already
  // guaranteed — row level security on the read, and the composite
  // `appointments_service_fk` on the write.
  const service = await getService(serviceId);
  if (service.status === "error") return { status: "error" };
  if (!service.data || !service.data.isActive) {
    return { status: "empty", reason: "service_unavailable" };
  }
  const durationMinutes = service.data.durationMinutes;

  const dayStart = dhakaInstant(date, "00:00");
  const dayEnd = new Date(dayStart.getTime() + DAY_MS);

  let bookedQuery = supabase
    .from("appointments")
    .select("starts_at, ends_at")
    .eq("doctor_id", doctorId)
    .is("deleted_at", null)
    .in("status", OCCUPYING_STATUSES)
    // Everything that touches this day, not everything that starts in it: a
    // visit running from 23:30 into the small hours occupies both.
    .lt("starts_at", dayEnd.toISOString())
    .gt("ends_at", dayStart.toISOString());

  if (excludeAppointmentId) bookedQuery = bookedQuery.neq("id", excludeAppointmentId);

  const [{ data: windows, error: windowsError }, { data: booked, error: bookedError }] =
    await Promise.all([
      supabase
        .from("doctor_availability")
        .select("starts_at, ends_at, slot_minutes, visit_type")
        .eq("doctor_id", doctorId)
        .eq("weekday", weekdayOf(date))
        .eq("is_active", true)
        .is("deleted_at", null)
        .or(`visit_type.is.null,visit_type.eq.${visitType}`),
      bookedQuery,
    ]);

  if (windowsError || bookedError) {
    console.error("[appointments] availability lookup failed", windowsError ?? bookedError);
    return { status: "error" };
  }

  if (!windows || windows.length === 0) {
    return { status: "empty", reason: "no_availability" };
  }

  const slots = bookableSlots({
    date,
    windows: windows.map((window) => ({
      startsAt: window.starts_at.slice(0, 5),
      endsAt: window.ends_at.slice(0, 5),
      slotMinutes: window.slot_minutes,
    })),
    durationMinutes,
    occupied: (booked ?? []).map((row) => ({
      starts: new Date(row.starts_at).getTime(),
      ends: new Date(row.ends_at).getTime(),
    })),
    earliestStart: Date.now() + leadMinutes * 60_000,
  });

  if (slots.length === 0) return { status: "empty", reason: "fully_booked" };

  return { status: "ok", slots };
}
