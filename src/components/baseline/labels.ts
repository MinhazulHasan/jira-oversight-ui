import { isStage, STAGE_LABELS } from "@/components/charts/palette";
import type { Baseline } from "@/lib/api/schemas";
import { formatDate, formatDateTime, type ZoneOptions } from "@/lib/format";

export type BaselineMetadata = Baseline["metadata"];
export type BaselineFigures = Baseline["figures"];

/** A key in words: "is_blocked_by" -> "Is blocked by". */
export function humanize(key: string): string {
  const words = key.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

/** A stage of the agreed process by its name: "code_review" -> "Code review". */
export function stageName(key: string): string {
  return isStage(key) ? STAGE_LABELS[key] : humanize(key);
}

/** Jira's three status categories, by the names Jira shows for them. */
const STATUS_CATEGORY: Record<string, string> = { new: "To Do", indeterminate: "In progress", done: "Done" };

export function statusCategoryName(key: string): string {
  return STATUS_CATEGORY[key] ?? humanize(key);
}

/** Counts by value, largest first (the report sends them that way; this keeps it so). */
export function ranked(counts: Readonly<Record<string, number>>): [string, number][] {
  return Object.entries(counts).sort((a, b) => b[1] - a[1]);
}

/* ------------------------------------------------------------- window --- */

function inZone<T>(zone: string, format: (options: ZoneOptions) => T, locale?: string): T {
  try {
    return format({ timeZone: zone, locale });
  } catch {
    return format({ locale });
  }
}

export function windowDays(metadata: BaselineMetadata, locale?: string): { first: string; last: string; span: string } {
  const lastInstant = new Date(new Date(metadata.window.end).getTime() - 1);
  const first = inZone(metadata.zone, (options) => formatDate(metadata.window.start, options), locale);
  const last = inZone(metadata.zone, (options) => formatDate(lastInstant, options), locale);
  const from = inZone(metadata.zone, (options) => formatDateTime(metadata.window.start, { ...options, zoneNamed: true }), locale);
  const to = inZone(metadata.zone, (options) => formatDateTime(metadata.window.end, { ...options, zoneNamed: true }), locale);
  return { first, last, span: `From ${from} up to ${to}` };
}
