import { describe, expect, it } from "vitest";

import { formatZonedRange, utcToZonedParts, zonedToUtcIso } from "@/lib/zoned-time";

describe("zonedToUtcIso", () => {
  it("reads a Dhaka wall-clock time as the right instant", () => {
    expect(zonedToUtcIso("2026-10-20", "09:30", "Asia/Dhaka")).toBe("2026-10-20T03:30:00.000Z");
  });

  it("crosses midnight backwards into the previous UTC day", () => {
    expect(zonedToUtcIso("2026-10-20", "02:00", "Asia/Dhaka")).toBe("2026-10-19T20:00:00.000Z");
  });

  it("follows daylight saving where a zone has it", () => {
    expect(zonedToUtcIso("2026-07-01", "09:00", "Europe/London")).toBe("2026-07-01T08:00:00.000Z");
    expect(zonedToUtcIso("2026-12-01", "09:00", "Europe/London")).toBe("2026-12-01T09:00:00.000Z");
  });
});

describe("utcToZonedParts", () => {
  it("round-trips what a person typed", () => {
    const iso = zonedToUtcIso("2026-11-03", "18:45", "Asia/Dhaka");
    expect(utcToZonedParts(iso, "Asia/Dhaka")).toEqual({ date: "2026-11-03", time: "18:45" });
  });
});

describe("formatZonedRange", () => {
  it("says a one-day session once", () => {
    expect(formatZonedRange("2026-10-20T03:30:00.000Z", "2026-10-20T11:00:00.000Z", "Asia/Dhaka")).toBe(
      "20 Oct 2026, 09:30 – 17:00",
    );
  });

  it("names both days of a multi-day session", () => {
    expect(formatZonedRange("2026-10-20T03:30:00.000Z", "2026-10-22T07:00:00.000Z", "Asia/Dhaka")).toBe(
      "20 Oct, 09:30 – 22 Oct 2026, 13:00",
    );
  });
});
