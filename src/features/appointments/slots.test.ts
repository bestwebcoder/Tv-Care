import { describe, expect, it } from "vitest";

import {
  availableTimes,
  daySlots,
  daysBetween,
  weekdayOf,
  workingSpans,
  type Slot,
  type SlotStatus,
} from "@/features/appointments/slots";
import { dhakaInstant } from "@/lib/age";
import { slotCount } from "@/lib/validation/availability";

/**
 * The slot rule, tested where it is a pure function.
 *
 * Everything around it — which windows a doctor has, which appointments hold
 * time, whether the doctor is taking bookings at all — is row level security's
 * and the exclusion constraints', and is covered against a real database in
 * tests/appointments.test.ts. What is left here is the arithmetic those
 * answers are fed into, which is where the off-by-one lives: a visit that
 * overruns the end of the day, a slot that starts exactly as another ends, a
 * lead time that falls in the middle of the morning.
 */

const DATE = "2026-09-10"; // A Thursday.
/** Long before the test date, so nothing is "past" unless a test says so. */
const DAWN = dhakaInstant("2020-01-01", "00:00").getTime();

/** An interval on the test date, from wall-clock times. */
function occupied(startsAt: string, endsAt: string) {
  return { starts: dhakaInstant(DATE, startsAt).getTime(), ends: dhakaInstant(DATE, endsAt).getTime() };
}

function slots(params: {
  windows: { startsAt: string; endsAt: string; slotMinutes: number }[];
  durationMinutes: number;
  occupied?: { starts: number; ends: number }[];
  now?: number;
  earliestStart?: number;
}): Slot[] {
  return daySlots({
    date: DATE,
    windows: params.windows,
    durationMinutes: params.durationMinutes,
    occupied: params.occupied ?? [],
    now: params.now ?? DAWN,
    earliestStart: params.earliestStart ?? DAWN,
  });
}

/** The grid as "09:00 available, 09:30 booked", which is what a reader wants to see. */
function shown(result: Slot[]): string[] {
  return result.map((slot) => `${slot.time} ${slot.status}`);
}

function statusAt(result: Slot[], time: string): SlotStatus | undefined {
  return result.find((slot) => slot.time === time)?.status;
}

describe("the day is returned whole", () => {
  it("labels every start time the windows define, free or not", () => {
    expect(
      shown(
        slots({
          windows: [{ startsAt: "09:00", endsAt: "11:00", slotMinutes: 30 }],
          durationMinutes: 30,
          occupied: [occupied("09:30", "10:00")],
        }),
      ),
    ).toEqual(["09:00 available", "09:30 booked", "10:00 available", "10:30 available"]);
  });

  it("keeps the times a blocked one sits between selectable", () => {
    // The point of drawing the whole day: booking 10:00 must not take 09:30 or
    // 10:30 with it, and a time that is taken must not shadow its neighbours.
    const day = slots({
      windows: [{ startsAt: "09:00", endsAt: "12:00", slotMinutes: 30 }],
      durationMinutes: 30,
      occupied: [occupied("10:00", "10:30")],
    });

    expect(statusAt(day, "09:30")).toBe("available");
    expect(statusAt(day, "10:00")).toBe("booked");
    expect(statusAt(day, "10:30")).toBe("available");
    expect(availableTimes(day)).toEqual(["09:00", "09:30", "10:30", "11:00", "11:30"]);
  });

  it("marks a time the visit would overrun the day at, rather than dropping it", () => {
    // A 30-minute service would be offered 10:30. A 60-minute one cannot use
    // it, and saying so is more useful than a grid that quietly ends at 10:00.
    expect(
      shown(slots({ windows: [{ startsAt: "09:00", endsAt: "11:00", slotMinutes: 30 }], durationMinutes: 60 })),
    ).toEqual(["09:00 available", "09:30 available", "10:00 available", "10:30 does_not_fit"]);
  });

  it("still draws the day when no slot on it fits the service at all", () => {
    expect(
      shown(slots({ windows: [{ startsAt: "09:00", endsAt: "09:30", slotMinutes: 30 }], durationMinutes: 45 })),
    ).toEqual(["09:00 does_not_fit"]);
  });

  it("leaves the gap between two windows out — a break is the absence of a window", () => {
    expect(
      availableTimes(
        slots({
          windows: [
            { startsAt: "09:00", endsAt: "10:00", slotMinutes: 30 },
            { startsAt: "13:00", endsAt: "14:00", slotMinutes: 30 },
          ],
          durationMinutes: 30,
        }),
      ),
    ).toEqual(["09:00", "09:30", "13:00", "13:30"]);
  });

  it("does not offer the same time twice when two windows agree on it", () => {
    // A clinic-wide window and a vaccination window can both cover 09:00 —
    // the database only forbids that within one visit type.
    expect(
      availableTimes(
        slots({
          windows: [
            { startsAt: "09:00", endsAt: "10:00", slotMinutes: 30 },
            { startsAt: "09:00", endsAt: "10:00", slotMinutes: 20 },
          ],
          durationMinutes: 20,
        }),
      ),
    ).toEqual(["09:00", "09:20", "09:30", "09:40"]);
  });

  it("ignores a window that ends before it starts, rather than looping forever", () => {
    expect(slots({ windows: [{ startsAt: "17:00", endsAt: "09:00", slotMinutes: 30 }], durationMinutes: 30 })).toEqual([]);
  });
});

describe("windows that touch are one stretch of working time", () => {
  it("merges them, and leaves a real break alone", () => {
    expect(
      workingSpans([
        { startsAt: "09:00", endsAt: "12:00", slotMinutes: 30 },
        { startsAt: "12:00", endsAt: "15:00", slotMinutes: 30 },
        { startsAt: "16:00", endsAt: "17:00", slotMinutes: 30 },
      ]),
    ).toEqual([
      { start: 9 * 60, end: 15 * 60 },
      { start: 16 * 60, end: 17 * 60 },
    ]);
  });

  it("lets a visit run across the seam between two touching windows", () => {
    // [09:00,12:00) and [12:00,15:00) are both storable — half-open ranges that
    // touch do not overlap — and describe a doctor working straight through.
    // Asking whether the visit fits one window would refuse 11:30 for want of
    // a boundary that exists only in the configuration.
    const day = slots({
      windows: [
        { startsAt: "09:00", endsAt: "12:00", slotMinutes: 30 },
        { startsAt: "12:00", endsAt: "15:00", slotMinutes: 30 },
      ],
      durationMinutes: 60,
    });

    expect(statusAt(day, "11:30")).toBe("available");
    expect(statusAt(day, "14:00")).toBe("available");
    expect(statusAt(day, "14:30")).toBe("does_not_fit");
  });

  it("still refuses a visit that would span a real break", () => {
    const day = slots({
      windows: [
        { startsAt: "09:00", endsAt: "13:00", slotMinutes: 30 },
        { startsAt: "14:00", endsAt: "18:00", slotMinutes: 30 },
      ],
      durationMinutes: 60,
    });

    expect(statusAt(day, "12:00")).toBe("available");
    expect(statusAt(day, "12:30")).toBe("does_not_fit");
    expect(statusAt(day, "14:00")).toBe("available");
  });
});

describe("times already spoken for", () => {
  it("keeps a slot that starts exactly as an appointment ends", () => {
    // Half-open intervals, matching tstzrange(starts_at, ends_at, '[)') — the
    // database would accept this booking, so the form has to offer it.
    const day = slots({
      windows: [{ startsAt: "09:00", endsAt: "10:00", slotMinutes: 30 }],
      durationMinutes: 30,
      occupied: [occupied("08:30", "09:00")],
    });

    expect(availableTimes(day)).toEqual(["09:00", "09:30"]);
  });

  it("blocks every slot a long appointment covers, not just the one it starts on", () => {
    const day = slots({
      windows: [{ startsAt: "09:00", endsAt: "12:00", slotMinutes: 30 }],
      durationMinutes: 30,
      occupied: [occupied("09:30", "11:00")],
    });

    expect(availableTimes(day)).toEqual(["09:00", "11:00", "11:30"]);
    expect(statusAt(day, "10:00")).toBe("booked");
  });

  it("blocks a slot the visit would run into, even though it starts free", () => {
    // 10:00 and 10:30 both start free, but a 60-minute visit from either
    // collides with the 10:30 appointment. 09:30 survives: it ends at exactly
    // 10:30, and touching is not overlapping.
    const day = slots({
      windows: [{ startsAt: "09:00", endsAt: "12:00", slotMinutes: 30 }],
      durationMinutes: 60,
      occupied: [occupied("10:30", "11:00")],
    });

    expect(availableTimes(day)).toEqual(["09:00", "09:30", "11:00"]);
    expect(statusAt(day, "10:00")).toBe("booked");
  });

  it("accounts for an appointment that began the day before", () => {
    const overnight = {
      starts: dhakaInstant("2026-09-09", "23:30").getTime(),
      ends: dhakaInstant(DATE, "00:30").getTime(),
    };

    expect(
      shown(
        slots({
          windows: [{ startsAt: "00:00", endsAt: "01:00", slotMinutes: 30 }],
          durationMinutes: 30,
          occupied: [overnight],
        }),
      ),
    ).toEqual(["00:00 booked", "00:30 available"]);
  });
});

describe("the clock", () => {
  it("tells a time that has passed apart from one that is merely too close", () => {
    const day = slots({
      windows: [{ startsAt: "09:00", endsAt: "12:00", slotMinutes: 30 }],
      durationMinutes: 30,
      now: dhakaInstant(DATE, "09:45").getTime(),
      earliestStart: dhakaInstant(DATE, "10:45").getTime(),
    });

    expect(shown(day)).toEqual([
      "09:00 past",
      "09:30 past",
      "10:00 too_soon",
      "10:30 too_soon",
      "11:00 available",
      "11:30 available",
    ]);
  });

  it("keeps a slot starting exactly on the lead time", () => {
    const day = slots({
      windows: [{ startsAt: "09:00", endsAt: "10:00", slotMinutes: 30 }],
      durationMinutes: 30,
      earliestStart: dhakaInstant(DATE, "09:30").getTime(),
    });

    expect(availableTimes(day)).toEqual(["09:30"]);
  });

  it("leaves nothing bookable on a day that has wholly passed", () => {
    const day = slots({
      windows: [{ startsAt: "09:00", endsAt: "17:00", slotMinutes: 30 }],
      durationMinutes: 30,
      now: dhakaInstant("2026-09-11", "00:00").getTime(),
      earliestStart: dhakaInstant("2026-09-11", "00:00").getTime(),
    });

    expect(availableTimes(day)).toEqual([]);
    expect(day.every((slot) => slot.status === "past")).toBe(true);
  });
});

describe("calendar arithmetic", () => {
  it("numbers weekdays the way date_part('dow') does, with Sunday at 0", () => {
    expect(weekdayOf("2026-09-06")).toBe(0);
    expect(weekdayOf("2026-09-10")).toBe(4);
    expect(weekdayOf("2026-09-12")).toBe(6);
  });

  it("counts days across a month and a leap day", () => {
    expect(daysBetween("2026-09-10", "2026-09-10")).toBe(0);
    expect(daysBetween("2026-09-30", "2026-10-01")).toBe(1);
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2);
    expect(daysBetween("2026-09-10", "2026-09-09")).toBe(-1);
  });
});

describe("the slot count shown beside a window", () => {
  it("matches what the engine offers for a visit one slot long", () => {
    const cases: [string, string, number][] = [
      ["09:00", "17:00", 30],
      ["09:00", "09:50", 30],
      ["14:00", "16:15", 45],
      ["09:00", "09:20", 30],
    ];

    for (const [startsAt, endsAt, slotMinutes] of cases) {
      const offered = availableTimes(
        slots({ windows: [{ startsAt, endsAt, slotMinutes }], durationMinutes: slotMinutes }),
      );
      expect(slotCount(startsAt, endsAt, slotMinutes)).toBe(offered.length);
    }
  });
});
