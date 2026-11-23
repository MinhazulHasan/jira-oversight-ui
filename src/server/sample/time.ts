/**
 * Time for the sample world: epoch milliseconds throughout, written out in the
 * backend's storage format (UTC, milliseconds, `Z`). Weeks start on Monday in
 * UTC, as the backend's weekly series do.
 */

export const SECOND = 1_000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const WEEK = 7 * DAY;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "2026-11-04T14:30:00.000Z" */
export function iso(time: number): string {
  return new Date(time).toISOString();
}

/** "2026-11-04" (UTC). */
export function isoDay(time: number): string {
  return iso(time).slice(0, 10);
}

/** "4 Nov 2026" (UTC): how code-written messages name a day, readable on both sides of the Atlantic. */
export function spelledDay(time: number): string {
  const date = new Date(time);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** Monday 00:00 UTC of the week that contains `time`. */
export function mondayUtc(time: number): number {
  const date = new Date(time);
  const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const weekday = (date.getUTCDay() + 6) % 7; // Monday 0 ... Sunday 6
  return midnight - weekday * DAY;
}

export function floorToMinute(time: number): number {
  return Math.floor(time / MINUTE) * MINUTE;
}

/* ----------------------------------------------------------- time zones -- */

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const zoneFormats = new Map<string, Intl.DateTimeFormat>();

function zonedParts(time: number, timeZone: string): ZonedParts {
  let format = zoneFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    zoneFormats.set(timeZone, format);
  }
  const parts = Object.fromEntries(
    format.formatToParts(new Date(time)).map((part) => [part.type, part.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** The zone's offset from UTC at `time`, in milliseconds (BST is +1 h). */
function zoneOffset(time: number, timeZone: string): number {
  const parts = zonedParts(time, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return asUtc - Math.floor(time / SECOND) * SECOND;
}

/** The calendar day `time` falls on in the zone, "YYYY-MM-DD". */
export function zonedDay(time: number, timeZone: string): string {
  const { year, month, day } = zonedParts(time, timeZone);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Local midnight at the start of `day` in the zone, as epoch milliseconds (baseline.py's local_midnight). */
export function zonedMidnight(day: string, timeZone: string): number {
  const [year, month, date] = day.split("-").map(Number);
  const wall = Date.UTC(year, month - 1, date);
  // Two passes settle the offset even when the guess lands on the far side of a clock change.
  let guess = wall - zoneOffset(wall, timeZone);
  guess = wall - zoneOffset(guess, timeZone);
  return guess;
}

/** `day` plus or minus whole days, on the calendar. */
export function addDays(day: string, days: number): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date) + days * DAY).toISOString().slice(0, 10);
}

/** "2026-08-06T00:00:00+01:00": a moment as wall time in the zone, as Python's isoformat() writes it. */
export function zonedIso(time: number, timeZone: string): string {
  const parts = zonedParts(time, timeZone);
  const offsetMinutes = Math.round(zoneOffset(time, timeZone) / MINUTE);
  const sign = offsetMinutes < 0 ? "-" : "+";
  const absolute = Math.abs(offsetMinutes);
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}` +
    `${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`
  );
}
