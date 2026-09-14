import { dhakaInstant } from "@/lib/age";
import { minutesToTime, timeToMinutes } from "@/lib/validation/availability";

/**
 * The slot rule, as arithmetic.
 *
 * Kept apart from `availability.ts` because everything here is a pure
 * function of values a caller already holds: no database, no session, no
 * `next/headers`. That lets the rule be unit-tested directly
 * (`slots.test.ts`), and lets a client component import the types without
 * reaching a server-only module through them.
 *
 * The day is returned whole — every start time the doctor's windows define,
 * each labelled with why it can or cannot be booked — rather than a filtered
 * list of the free ones. A booking screen that shows only what is left cannot
 * tell a client whether eleven o'clock is taken or the clinic simply shuts at
 * half past ten, and both are worth knowing before they try another date.
 */

/** Why a day has nothing to offer at all — each maps to a sentence the client reads. */
export type AvailabilityEmptyReason =
  | "date_in_past"
  | "date_too_far"
  | "doctor_unavailable"
  | "service_unavailable"
  | "no_availability";

/**
 * What a start time is.
 *
 * `does_not_fit` is the one that is easy to mistake for `booked`: nothing is
 * booked at that time, the doctor simply stops working before this particular
 * service would finish. A shorter service may well fit there, so it is offered
 * again the moment one is chosen.
 */
export type SlotStatus = "available" | "booked" | "past" | "too_soon" | "does_not_fit";

export type Slot = { time: string; status: SlotStatus };

export type AvailabilityResult =
  | { status: "error" }
  | { status: "empty"; reason: AvailabilityEmptyReason }
  | { status: "ok"; slots: Slot[] };

/** One configured window, reduced to what slot generation needs. */
export type SlotWindow = { startsAt: string; endsAt: string; slotMinutes: number };

/** An interval already spoken for, as epoch milliseconds. */
export type OccupiedInterval = { starts: number; ends: number };

/** Minutes past midnight, half-open like the database's own ranges. */
type Span = { start: number; end: number };

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
 * The stretches of the day the doctor is actually working, as one set of
 * spans — windows that touch or overlap merged into the single stretch they
 * really are.
 *
 * A window is a unit of configuration, not a wall. `doctor_availability_no_overlap`
 * compares `timerange(starts_at, ends_at, '[)')`, and half-open ranges that
 * touch do not overlap, so 09:00–12:00 and 12:00–15:00 are both storable and
 * describe a doctor working straight through to three. Asking whether a visit
 * fits inside *one* window would refuse a sixty-minute appointment at 11:30
 * for want of a boundary that exists only in the configuration. A real break —
 * 09:00–13:00 and 14:00–18:00 — leaves a gap here, and a visit spanning it
 * still correctly does not fit.
 */
export function workingSpans(windows: SlotWindow[]): Span[] {
  const spans = windows
    .map((window) => ({ start: timeToMinutes(window.startsAt), end: timeToMinutes(window.endsAt) }))
    .filter((span) => span.end > span.start)
    .sort((a, b) => a.start - b.start);

  const merged: Span[] = [];

  for (const span of spans) {
    const last = merged[merged.length - 1];

    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }

  return merged;
}

/** Whether a visit of this length, starting here, stays inside the doctor's working time. */
function fitsInWorkingTime(start: number, durationMinutes: number, spans: Span[]): boolean {
  return spans.some((span) => span.start <= start && start + durationMinutes <= span.end);
}

/**
 * Every start time the day offers, each labelled with what it is.
 *
 * Times come from each window's own slot length, counted from that window's
 * own start, so a practice offering quarter-hourly vaccination slots inside
 * half-hourly clinic hours gets both. Whether the visit *fits* is asked of the
 * merged working time rather than the window that produced the boundary — see
 * {@link workingSpans}.
 *
 * `now` and `earliestStart` are separate because they answer different
 * questions: a time that has passed is gone, while a time inside the
 * practice's notice period is real but too close to book, and a client
 * deserves to be told which. Both are instants, so a notice period that
 * crosses midnight needs no special case.
 */
export function daySlots(params: {
  date: string;
  windows: SlotWindow[];
  durationMinutes: number;
  occupied: OccupiedInterval[];
  now: number;
  earliestStart: number;
}): Slot[] {
  const { date, windows, durationMinutes, occupied, now, earliestStart } = params;

  const spans = workingSpans(windows);
  const byTime = new Map<string, Slot>();

  /**
   * The order matters: a time that has gone is gone whatever else is true of
   * it, and "booked" is more use to a client than "would not fit" when both
   * apply — it says the doctor is there, just not free.
   */
  function statusOf({ startsAt, endsAt, start }: { startsAt: number; endsAt: number; start: number }): SlotStatus {
    if (startsAt < now) return "past";
    if (startsAt < earliestStart) return "too_soon";

    const taken = occupied.some((existing) => startsAt < existing.ends && endsAt > existing.starts);
    if (taken) return "booked";

    if (!fitsInWorkingTime(start, durationMinutes, spans)) return "does_not_fit";

    return "available";
  }

  for (const window of windows) {
    const windowStart = timeToMinutes(window.startsAt);
    const windowEnd = timeToMinutes(window.endsAt);
    const step = window.slotMinutes;

    if (step <= 0 || windowEnd <= windowStart) continue;

    for (let start = windowStart; start < windowEnd; start += step) {
      const time = minutesToTime(start);
      if (byTime.has(time)) continue;

      const startsAt = dhakaInstant(date, time).getTime();
      const endsAt = startsAt + durationMinutes * 60_000;

      byTime.set(time, { time, status: statusOf({ startsAt, endsAt, start }) });
    }
  }

  return [...byTime.values()].sort((a, b) => a.time.localeCompare(b.time));
}

/** The subset a booking may actually be made at. */
export function availableTimes(slots: Slot[]): string[] {
  return slots.filter((slot) => slot.status === "available").map((slot) => slot.time);
}
