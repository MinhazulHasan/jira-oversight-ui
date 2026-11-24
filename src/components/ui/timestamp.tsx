"use client";

import { FALLBACK_LOCALE, formatDate, formatDateTime, formatRelative, formatTime } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";

import { Tooltip } from "./tooltip";

export interface TimestampProps {
  /** An ISO 8601 instant. */
  value: string;
  mode?: "date" | "datetime" | "time" | "relative";
  className?: string;
}

/** A moment in time, in the reader's zone and conventions, in a <time> element. */
export function Timestamp({ value, mode = "date", className }: TimestampProps) {
  const now = useNow();
  const viewer = now !== null;
  const options = viewer ? {} : { locale: FALLBACK_LOCALE, timeZone: "UTC" };

  if (mode === "relative") {
    const absolute = formatDateTime(value, options);
    if (now === null) {
      return (
        <time dateTime={value} className={cn("mono", className)} data-figure>
          {absolute}
        </time>
      );
    }
    return (
      <Tooltip content={absolute}>
        <time dateTime={value} className={cn("decoration-rule-strong underline-offset-2 hover:underline", className)}>
          {formatRelative(value, { now })}
          <span className="sr-only"> ({absolute})</span>
        </time>
      </Tooltip>
    );
  }

  const text =
    mode === "datetime" ? formatDateTime(value, options) : mode === "time" ? formatTime(value, options) : formatDate(value, options);
  return (
    <time dateTime={value} className={cn("mono", className)} data-figure>
      {text}
    </time>
  );
}
