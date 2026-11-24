import { formatDate, resolveLocale, tidyZoneName } from "@/lib/format";

const cache = new Map<string, Intl.DateTimeFormat>();

function formatter(locale: string | undefined, key: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const tag = resolveLocale(locale);
  const id = `${tag}|${key}`;
  let format = cache.get(id);
  if (!format) {
    format = new Intl.DateTimeFormat(tag, options);
    cache.set(id, format);
  }
  return format;
}

function valid(value: Date | string | number): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "2 Nov" (en-GB), "Nov 2" (en-US) for a calendar date: an axis tick, where the year is obvious. */
export function formatDayMonth(isoDate: string, locale?: string): string {
  const date = valid(isoDate);
  return date ? formatter(locale, "dm-utc", { day: "numeric", month: "short", timeZone: "UTC" }).format(date) : isoDate;
}

/** "Week of 2 Nov 2026": weeks start on Monday and are never numbered (US readers do not use ISO weeks). */
export function formatWeekOf(isoDate: string, locale?: string): string {
  return `Week of ${formatDate(isoDate, { locale, timeZone: "UTC" })}`;
}

/** "2 Nov" for an instant, in the viewer's zone. */
export function formatLocalDayMonth(value: Date | number, locale?: string): string {
  const date = valid(value);
  return date ? formatter(locale, "dm", { day: "numeric", month: "short" }).format(date) : "";
}

/** "14:00" (or "2:00 PM") for an instant, in the viewer's zone, without the zone: the axis names it once. */
export function formatLocalClock(value: Date | number, locale?: string): string {
  const date = valid(value);
  return date ? formatter(locale, "hm", { hour: "numeric", minute: "2-digit" }).format(date) : "";
}

/** The viewer's zone as readers name it at that moment: "GMT", "BST", "CET", "EST". */
export function zoneName(value: Date | number, locale?: string): string {
  const date = valid(value);
  if (!date) return "";
  const part = formatter(locale, "zone", { hour: "numeric", timeZoneName: "short" })
    .formatToParts(date)
    .find((candidate) => candidate.type === "timeZoneName");
  return part ? tidyZoneName(part.value) : "";
}
