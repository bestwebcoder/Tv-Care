import { describe, expect, it } from "vitest";

import { bookableSlots, daysBetween, weekdayOf } from "@/features/appointments/slots";
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
 * overruns the end of a window, a slot that starts exactly as another ends,
 * a lead time that falls in the middle of the morning.
 */

const DATE = "2026-09-10"; // A Thursday.
const NO_LEAD = 0;

/** An interval on the test date, from wall-clock times. */
function occupied(startsAt: string, endsAt: string) {
  return { starts: dhakaInstant(DATE, startsAt).getTime(), ends: dhakaInstant(DATE, endsAt).getTime() };
}

function slots(params: {
  windows: { startsAt: string; endsAt: string; slotMinutes: number }[];
  durationMinutes: number;
  occupied?: { starts: number; ends: number }[];
  earliestStart?: number;
}) {
  return bookableSlots({
    date: DATE,
    windows: params.windows,
    durationMinutes: params.durationMinutes,
    occupied: params.occupied ?? [],
    earliestStart: params.earliestStart ?? NO_LEAD,
  });
}

describe("slot generation", () => {
  it("offers a start time every slot length, sorted", () => {
    expect(slots({ windows: [{ startsAt: "09:00", endsAt: "11:00", slotMinutes: 30 }], durationMinutes: 30 })).toEqual([
      "09:00",
      "09:30",
      "10:00",
      "10:30",
    ]);
  });

  it("drops the start times a longer visit would overrun the window at", () => {
    // 10:30 + 60 minutes ends at 11:30, past the window; 10:00 + 60 fits exactly.
    expect(slots({ windows: [{ startsAt: "09:00", endsAt: "11:00", slotMinutes: 30 }], durationMinutes: 60 })).toEqual([
      "09:00",
      "09:30",
      "10:00",
    ]);
  });

  it("offers nothing when the visit is longer than the whole window", () => {
    expect(slots({ windows: [{ startsAt: "09:00", endsAt: "09:30", slotMinutes: 30 }], durationMinutes: 45 })).toEqual([]);
  });

  it("leaves the gap between two windows out — a break is the absence of a window", () => {
    const morningAndAfternoon = slots({
      windows: [
        { startsAt: "09:00", endsAt: "10:00", slotMinutes: 30 },
        { startsAt: "13:00", endsAt: "14:00", slotMinutes: 30 },
      ],
      durationMinutes: 30,
    });

    expect(morningAndAfternoon).toEqual(["09:00", "09:30", "13:00", "13:30"]);
  });

  it("does not offer the same time twice when two windows agree on it", () => {
    // A clinic-wide window and a vaccination window can both cover 09:00 —
    // the database only forbids that within one visit type.
    expect(
      slots({
        windows: [
          { startsAt: "09:00", endsAt: "10:00", slotMinutes: 30 },
          { startsAt: "09:00", endsAt: "10:00", slotMinutes: 20 },
        ],
        durationMinutes: 20,
      }),
    ).toEqual(["09:00", "09:20", "09:30", "09:40"]);
  });

  it("ignores a window that ends before it starts, rather than looping forever", () => {
    expect(slots({ windows: [{ startsAt: "17:00", endsAt: "09:00", slotMinutes: 30 }], durationMinutes: 30 })).toEqual([]);
  });
});

describe("times already spoken for", () => {
  it("drops a slot an appointment overlaps", () => {
    expect(
      slots({
        windows: [{ startsAt: "09:00", endsAt: "11:00", slotMinutes: 30 }],
        durationMinutes: 30,
        occupied: [occupied("09:30", "10:00")],
      }),
    ).toEqual(["09:00", "10:00", "10:30"]);
  });

  it("keeps a slot that starts exactly as an appointment ends", () => {
    // Half-open intervals, matching tstzrange(starts_at, ends_at, '[)') — the
    // database would accept this booking, so the form has to offer it.
    expect(
      slots({
        windows: [{ startsAt: "09:00", endsAt: "10:00", slotMinutes: 30 }],
        durationMinutes: 30,
        occupied: [occupied("08:30", "09:00")],
      }),
    ).toEqual(["09:00", "09:30"]);
  });

  it("drops every slot a long appointment covers, not just the one it starts on", () => {
    expect(
      slots({
        windows: [{ startsAt: "09:00", endsAt: "12:00", slotMinutes: 30 }],
        durationMinutes: 30,
        occupied: [occupied("09:30", "11:00")],
      }),
    ).toEqual(["09:00", "11:00", "11:30"]);
  });

  it("drops a slot the visit would run into, even though it starts free", () => {
    // 10:00 and 10:30 both start free, but a 60-minute visit from either
    // collides with the 10:30 appointment. 09:30 survives: it ends at exactly
    // 10:30, and touching is not overlapping.
    expect(
      slots({
        windows: [{ startsAt: "09:00", endsAt: "12:00", slotMinutes: 30 }],
        durationMinutes: 60,
        occupied: [occupied("10:30", "11:00")],
      }),
    ).toEqual(["09:00", "09:30", "11:00"]);
  });

  it("accounts for an appointment that began the day before", () => {
    const overnight = {
      starts: dhakaInstant("2026-09-09", "23:30").getTime(),
      ends: dhakaInstant(DATE, "00:30").getTime(),
    };

    expect(
      slots({
        windows: [{ startsAt: "00:00", endsAt: "01:00", slotMinutes: 30 }],
        durationMinutes: 30,
        occupied: [overnight],
      }),
    ).toEqual(["00:30"]);
  });
});

describe("the practice's lead time", () => {
  it("drops every slot before it", () => {
    expect(
      slots({
        windows: [{ startsAt: "09:00", endsAt: "11:00", slotMinutes: 30 }],
        durationMinutes: 30,
        earliestStart: dhakaInstant(DATE, "10:00").getTime(),
      }),
    ).toEqual(["10:00", "10:30"]);
  });

  it("keeps a slot starting exactly on it", () => {
    expect(
      slots({
        windows: [{ startsAt: "09:00", endsAt: "10:00", slotMinutes: 30 }],
        durationMinutes: 30,
        earliestStart: dhakaInstant(DATE, "09:30").getTime(),
      }),
    ).toEqual(["09:30"]);
  });

  it("empties a day it has already passed", () => {
    expect(
      slots({
        windows: [{ startsAt: "09:00", endsAt: "17:00", slotMinutes: 30 }],
        durationMinutes: 30,
        earliestStart: dhakaInstant("2026-09-11", "00:00").getTime(),
      }),
    ).toEqual([]);
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
  it("matches what the engine generates for a visit one slot long", () => {
    const cases: [string, string, number][] = [
      ["09:00", "17:00", 30],
      ["09:00", "09:50", 30],
      ["14:00", "16:15", 45],
      ["09:00", "09:20", 30],
    ];

    for (const [startsAt, endsAt, slotMinutes] of cases) {
      const generated = slots({ windows: [{ startsAt, endsAt, slotMinutes }], durationMinutes: slotMinutes });
      expect(slotCount(startsAt, endsAt, slotMinutes)).toBe(generated.length);
    }
  });
});
