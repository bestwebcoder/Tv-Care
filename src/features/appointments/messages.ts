import type { AvailabilityEmptyReason, SlotStatus } from "@/features/appointments/slots";

/**
 * Why a day is offering no times, in the words a client reads.
 *
 * Shared by the booking form and the reschedule dialog, which used to each
 * carry their own nested ternary and had already drifted apart — the
 * reschedule dialog told a client "fully booked for that day" when the real
 * answer was that the date had passed. Both are client components, so the map
 * lives beside the reason type rather than inside either of them.
 *
 * Each sentence says what happened and what to do about it. The fallback is
 * "not scheduled to work then", the one reason that is safe to show for a
 * value this build does not recognise: it blames nobody and suggests a move.
 */
const NO_SLOTS_MESSAGES: Record<AvailabilityEmptyReason, string> = {
  date_in_past: "That date has already passed — choose another.",
  date_too_far: "That is further ahead than this practice takes bookings. Try a nearer date.",
  doctor_unavailable: "This doctor is not taking appointments at the moment. Try another doctor.",
  service_unavailable: "This service is not being offered at the moment. Try another one.",
  no_availability: "This doctor is not scheduled to work then. Try another date or doctor.",
};

/**
 * Shown above the grid when the day is drawn but nothing on it can be booked.
 * Deliberately not "fully booked": the day may be gone, or too close, or the
 * visit too long for what is left, and each slot says which underneath.
 */
export const NOTHING_BOOKABLE_MESSAGE =
  "No time on this day can be booked. Try another date or doctor.";

/**
 * The short word under a time that cannot be chosen.
 *
 * Carried in each button's accessible name too, so the reason is not left to
 * colour and a line through the text.
 */
export const SLOT_STATUS_LABELS: Record<SlotStatus, string> = {
  available: "Available",
  booked: "Booked",
  past: "Passed",
  too_soon: "Too soon",
  does_not_fit: "Won't fit",
};

/**
 * The sentence for a reason, falling back for one this build does not know.
 *
 * The reason arrives from a server action, so it crosses a boundary where
 * TypeScript's guarantee stops: a page still open while the server is
 * redeployed can be handed a reason added since it loaded.
 */
export function noSlotsMessage(reason: string): string {
  return NO_SLOTS_MESSAGES[reason as AvailabilityEmptyReason] ?? NO_SLOTS_MESSAGES.no_availability;
}
