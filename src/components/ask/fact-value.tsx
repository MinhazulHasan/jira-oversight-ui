"use client";

import { Timestamp } from "@/components/ui/timestamp";
import { useFigureLocale } from "@/components/ui/use-figures";
import type { FactCell, FactColumnKind } from "@/lib/api/schemas";
import { formatByKind, formatDate, MISSING } from "@/lib/format";

const NUMERIC: ReadonlySet<FactColumnKind> = new Set<FactColumnKind>(["number", "count", "hours", "share", "ratio"]);
const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Figures align right in Plex Mono. */
export function isNumericKind(kind: FactColumnKind): boolean {
  return NUMERIC.has(kind);
}

/**
 * One fact cell as text, written the way the rest of the product writes that
 * kind. A calendar day ("2026-08-17", a week's Monday) is a date, not an
 * instant, so it is never shifted into the reader's zone.
 */
export function factText(value: FactCell, kind: FactColumnKind, locale?: string): string {
  if (value === null || value === "") return MISSING;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (kind === "date" && typeof value === "string" && CALENDAR_DAY.test(value)) {
    return formatDate(value, { locale, timeZone: "UTC" });
  }
  return formatByKind(value, kind, { locale });
}

/** A fact cell on screen: instants through Timestamp, everything else through factText. */
export function FactValue({ value, kind }: { value: FactCell; kind: FactColumnKind }) {
  const locale = useFigureLocale();
  if (kind === "date" && typeof value === "string" && !CALENDAR_DAY.test(value) && !Number.isNaN(Date.parse(value))) {
    return <Timestamp value={value} mode="date" />;
  }
  const text = factText(value, kind, locale);
  if (text === MISSING) {
    return (
      <span className="text-ink-low">
        <span aria-hidden>{MISSING}</span>
        <span className="sr-only">none</span>
      </span>
    );
  }
  if (kind === "date" && typeof value === "string") {
    return (
      <time dateTime={value} className="mono" data-figure>
        {text}
      </time>
    );
  }
  return <>{text}</>;
}
