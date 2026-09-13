import { dhakaInstant } from "@/lib/age";
import { minutesToTime, timeToMinutes } from "@/lib/validation/availability";

/**
 * The slot rule, as arithmetic.
 *
 * Kept apart from `availability.ts` because everything here is a pure
 * function of values a caller already holds: no database, no session, no
 * `next/headers`. That lets the rule be unit-tested directly
 * (`availability.test.ts`), and lets a client component import the reason
 * type without reaching a server-only module through it.
 */

/** Why a day has nothing to offer — each maps to a sentence the client reads. */
export type AvailabilityEmptyReason =
  | "date_in_past"
  | "date_too_far"
  | "doctor_unavailable"
  | "service_unavailable"
  | "no_availability"
  | "fully_booked";

export type AvailabilityResult =
  | { status: "error" }
  | { status: "empty"; reason: AvailabilityEmptyReason }
  | { status: "ok"; slots: string[] };

/** One configured window, reduced to what slot generation needs. */
export type SlotWindow = { startsAt: string; endsAt: string; slotMinutes: number };

/** An interval already spoken for, as epoch milliseconds. */
export type OccupiedInterval = { starts: number; ends: number };

const DAY_MS = 24 * 60 * 60 * 1000;

/** `yyyy-MM-dd`, and a real calendar date rather than one that rolls over. */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;

  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

/** The weekday of a calendar date, in `date_part('dow')` numbering (0 = Sunday). */
export function weekdayOf(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** Whole days between two calendar dates, `later` minus `earlier`. */
export function daysBetween(earlier: string, later: string): number {
  const [y1, m1, d1] = earlier.split("-").map(Number);
  const [y2, m2, d2] = later.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / DAY_MS);
}

/**
 * The start times bookable on one day — the whole slot rule, as a pure
 * function, so it can be reasoned about and tested without a database.
 *
 * Times are generated from each window's own start, stepping by that window's
 * slot length, and kept only when the whole visit fits inside the window. A
 * service longer than the slot length therefore still gets offered every slot
 * boundary it fits at, and the ones it would overrun are dropped rather than
 * booked and run late.
 *
 * `earliestStart` is the practice's lead time, already resolved to an instant:
 * comparing instants rather than clock minutes means "not before tomorrow
 * 09:00" needs no special case for a lead time that crosses midnight.
 */
export function bookableSlots(params: {
  date: string;
  windows: SlotWindow[];
  durationMinutes: number;
  occupied: OccupiedInterval[];
  earliestStart: number;
}): string[] {
  const { date, windows, durationMinutes, occupied, earliestStart } = params;
  const candidates = new Set<string>();

  for (const window of windows) {
    const windowStart = timeToMinutes(window.startsAt);
    const windowEnd = timeToMinutes(window.endsAt);
    const step = window.slotMinutes;

    if (step <= 0 || windowEnd <= windowStart) continue;

    for (let start = windowStart; start + durationMinutes <= windowEnd; start += step) {
      const time = minutesToTime(start);
      if (candidates.has(time)) continue;

      const candidateStart = dhakaInstant(date, time).getTime();
      if (candidateStart < earliestStart) continue;

      const candidateEnd = candidateStart + durationMinutes * 60_000;
      const overlaps = occupied.some(
        (existing) => candidateStart < existing.ends && candidateEnd > existing.starts,
      );

      if (!overlaps) candidates.add(time);
    }
  }

  return [...candidates].sort();
}
