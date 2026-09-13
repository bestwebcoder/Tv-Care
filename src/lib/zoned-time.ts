/**
 * Wall-clock time in a practice's own timezone (organizations.timezone), with
 * no date library: Intl already knows every zone's rules, including daylight
 * saving where a zone has it.
 *
 * Used where a person types a date and a time that mean "at the practice" —
 * a course starting 09:30 in Dhaka is 03:30 UTC however the server is set up.
 */

function partsIn(utc: Date, timeZone: string): Record<string, number> {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(utc);

  return Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
}

/** Minutes the zone is ahead of UTC at this instant. */
function offsetMinutes(utc: Date, timeZone: string): number {
  const p = partsIn(utc, timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asIfUtc - utc.getTime()) / 60_000);
}

/** `2026-10-20` + `09:30` in `Asia/Dhaka` → `2026-10-20T03:30:00.000Z`. */
export function zonedToUtcIso(date: string, time: string, timeZone: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour, minute);

  // Twice, because the offset at the guessed instant can differ from the offset
  // at the answer when a daylight-saving change falls between them.
  let utc = wallClockAsUtc - offsetMinutes(new Date(wallClockAsUtc), timeZone) * 60_000;
  utc = wallClockAsUtc - offsetMinutes(new Date(utc), timeZone) * 60_000;

  return new Date(utc).toISOString();
}

const pad = (value: number) => String(value).padStart(2, "0");

/** The date (`yyyy-MM-dd`) and time (`HH:mm`) an instant reads as in the zone. */
export function utcToZonedParts(iso: string, timeZone: string): { date: string; time: string } {
  const p = partsIn(new Date(iso), timeZone);
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, time: `${pad(p.hour)}:${pad(p.minute)}` };
}

export function formatInZone(iso: string, timeZone: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, ...options }).format(new Date(iso));
}

/** "20 Oct 2026, 09:30 – 17:00" or "20 Oct, 09:30 – 22 Oct 2026, 13:00". */
export function formatZonedRange(startsAt: string, endsAt: string, timeZone: string): string {
  const start = utcToZonedParts(startsAt, timeZone);
  const end = utcToZonedParts(endsAt, timeZone);
  const time = (iso: string) => formatInZone(iso, timeZone, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

  if (start.date === end.date) {
    return `${formatInZone(startsAt, timeZone, { day: "numeric", month: "short", year: "numeric" })}, ${time(startsAt)} – ${time(endsAt)}`;
  }

  return `${formatInZone(startsAt, timeZone, { day: "numeric", month: "short" })}, ${time(startsAt)} – ${formatInZone(endsAt, timeZone, {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}, ${time(endsAt)}`;
}
