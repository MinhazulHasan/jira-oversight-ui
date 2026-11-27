import type { CsvColumn } from "@/components/ui/csv";
import { ACCESS_ACTION_LABELS, LOCAL_VIEWER, type AccessLogEntry } from "@/lib/api/schemas";

/* ---------------------------------------------------------------- days --- */

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** "2026-11-04": the calendar day an instant falls on in `zone` (the organisation's report zone). */
export function dayIn(instant: string | number | Date, zone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(
    new Date(instant),
  );
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** A calendar day `days` later (earlier, when negative): plain calendar arithmetic, no zone involved. */
export function addDays(day: string, days: number): string {
  if (!DAY_PATTERN.test(day)) throw new RangeError(`Not a calendar day: ${day}`);
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function isCalendarDay(value: string): boolean {
  if (!DAY_PATTERN.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** The periods offered at a press: each the last n calendar days to today, both included, in the organisation's zone. */
export const PERIOD_PRESETS = [
  { value: "7d", label: "Last 7 days", days: 7 },
  { value: "30d", label: "Last 30 days", days: 30 },
  { value: "90d", label: "Last 90 days", days: 90 },
  { value: "365d", label: "Last 365 days", days: 365 },
] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number]["value"];

export interface Period {
  from: string | null;
  to: string | null;
}

/** A preset's days, counted back from `today` (a calendar day). */
export function presetPeriod(preset: PeriodPreset, today: string): Period {
  const days = PERIOD_PRESETS.find((option) => option.value === preset)?.days ?? 7;
  return { from: addDays(today, -(days - 1)), to: today };
}

/** Which preset a period is, counted back from `today`; "all" with no days; null for any other range. */
export function presetOf(period: Period, today: string | null): PeriodPreset | "all" | null {
  if (period.from === null && period.to === null) return "all";
  if (today === null) return null;
  return PERIOD_PRESETS.find((option) => {
    const preset = presetPeriod(option.value, today);
    return preset.from === period.from && preset.to === period.to;
  })?.value ?? null;
}

/* --------------------------------------------------------------- words --- */

/** Who the viewer was, as the page says it under their name: the level they read at, in plain words. */
export function viewerRole(entry: Pick<AccessLogEntry, "viewer" | "level">): string {
  if (entry.viewer.hash === LOCAL_VIEWER) return "Sign-in off";
  return entry.level === "people" ? "Admin" : "User";
}

export function viewerRoleLine(entry: Pick<AccessLogEntry, "viewer" | "level">): string | null {
  return entry.viewer.hash === LOCAL_VIEWER ? null : viewerRole(entry);
}

export function zoneName(zone: string, locale?: string): string {
  if (zone === "UTC" || zone === "Etc/UTC" || zone === "Etc/GMT") return "UTC";
  try {
    const name = new Intl.DateTimeFormat(locale ?? "en-GB", { timeZone: zone, timeZoneName: "longGeneric" })
      .formatToParts(new Date())
      .find((part) => part.type === "timeZoneName")?.value;
    if (name) return name;
  } catch {
    // A zone this browser's Intl does not know: its city, as words.
  }
  return zone.slice(zone.lastIndexOf("/") + 1).replace(/_/g, " ");
}

/** What an entry's detail adds, in a few words: a scorecard's period, how many entries a read of the log returned. */
export function detailWords(entry: AccessLogEntry, locale?: string): string | null {
  const { days, entries } = entry.detail;
  const count = (value: number) => new Intl.NumberFormat(locale ?? "en-GB").format(value);
  if (
    (entry.action === "scorecard_view" || entry.action === "people_compare_view" || entry.action === "person_card_view" || entry.action === "scorecard_tickets_view") &&
    days !== null
  ) {
    return `Last ${count(days)} days`;
  }
  if ((entry.action === "access_log_view" || entry.action === "access_log_export") && entries !== null) {
    return `${count(entries)} ${entries === 1 ? "entry" : "entries"}`;
  }
  return null;
}

export const ACCESS_LOG_CSV_COLUMNS: readonly CsvColumn<AccessLogEntry>[] = [
  { header: "Time (UTC)", value: (entry) => entry.at },
  { header: "Viewer", value: (entry) => entry.viewer.name },
  { header: "Viewer id (keyed hash)", value: (entry) => entry.viewer.hash },
  { header: "Role", value: viewerRole },
  { header: "Action", value: (entry) => ACCESS_ACTION_LABELS[entry.action] },
  { header: "Board", value: (entry) => entry.project ?? "Every board" },
  { header: "Whose figures", value: (entry) => entry.subjects.map((person) => person.name).join("; ") },
  { header: "Person ids", value: (entry) => entry.subjects.map((person) => person.id).join(" ") },
  { header: "Period (days)", value: (entry) => entry.detail.days },
  { header: "Entries read", value: (entry) => entry.detail.entries },
  { header: "Ask reference", value: (entry) => entry.detail.qa_id },
  { header: "Entry id", value: (entry) => entry.id },
];
