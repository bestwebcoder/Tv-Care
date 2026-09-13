import type { AvailabilityEmptyReason } from "@/features/appointments/slots";

/**
 * Why a day is offering no times, in the words a client reads.
 *
 * Shared by the booking form and the reschedule dialog, which used to each
 * carry their own nested ternary and had already drifted apart — the
 * reschedule dialog told a client "fully booked for that day" when the real
 * answer was that the date had passed. Both are client components, so the map
 * lives beside the reason type rather than inside either of them.
 *
 * Each sentence says what happened and what to do about it. "Fully booked" is
 * the fallback because it is the one a booking form most often means and the
 * only one that is safe to show for an unrecognised reason.
 */
const NO_SLOTS_MESSAGES: Record<AvailabilityEmptyReason, string> = {
  date_in_past: "That date has already passed — choose another.",
  date_too_far: "That is further ahead than this practice takes bookings. Try a nearer date.",
  doctor_unavailable: "This doctor is not taking appointments at the moment. Try another doctor.",
  service_unavailable: "This service is not being offered at the moment. Try another one.",
  no_availability: "This doctor is not scheduled to work then. Try another date or doctor.",
  fully_booked: "Fully booked for that day. Try another date.",
};

/**
 * The sentence for a reason, falling back for one this build does not know.
 *
 * The reason arrives from a server action, so it crosses a boundary where
 * TypeScript's guarantee stops: a page still open while the server is
 * redeployed can be handed a reason added since it loaded.
 */
export function noSlotsMessage(reason: string): string {
  return NO_SLOTS_MESSAGES[reason as AvailabilityEmptyReason] ?? NO_SLOTS_MESSAGES.fully_booked;
}
