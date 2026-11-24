"use client";

import { CalendarRange, ChevronDown } from "lucide-react";

import { formatDate } from "@/lib/format";
import { useNow } from "@/lib/use-now";
import { cn } from "@/lib/utils";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { fieldTrigger } from "./surfaces";

export type DateRangePreset = "7d" | "30d" | "90d" | "all";

export const DATE_RANGE_PRESETS: readonly { value: DateRangePreset; label: string; days: number | null }[] = [
  { value: "7d", label: "Last 7 days", days: 7 },
  { value: "30d", label: "Last 30 days", days: 30 },
  { value: "90d", label: "Last 90 days", days: 90 },
  { value: "all", label: "All time", days: null },
];

const DAY_MS = 24 * 60 * 60 * 1000;

/** The first instant a preset includes, measured back from now; null for all time. */
export function dateRangeStart(preset: DateRangePreset, now: number): Date | null {
  const days = DATE_RANGE_PRESETS.find((option) => option.value === preset)?.days ?? null;
  return days === null ? null : new Date(now - days * DAY_MS);
}

export function isDateRangePreset(value: string): value is DateRangePreset {
  return DATE_RANGE_PRESETS.some((option) => option.value === value);
}

export interface DateRangeProps {
  /** What the range filters, e.g. "First seen". */
  label: string;
  value: DateRangePreset;
  onValueChange: (value: DateRangePreset) => void;
  /** The moment to count back from; defaults to the viewer's clock once it is known. */
  now?: number;
  size?: "sm" | "md";
  className?: string;
}

export function DateRange({ label, value, onValueChange, now, size = "md", className }: DateRangeProps) {
  const clock = useNow();
  const reference = now ?? clock;
  const current = DATE_RANGE_PRESETS.find((option) => option.value === value) ?? DATE_RANGE_PRESETS[3];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(fieldTrigger, size === "sm" ? "h-7 pr-1.5 pl-2 text-xs" : "h-8 pr-2 pl-2.5 text-sm", className)}
      >
        <CalendarRange aria-hidden size={14} strokeWidth={1.75} className="shrink-0 text-ink-low" />
        <span className="text-ink-low">{label}</span>{" "}
        <span className={value === "all" ? "text-ink-mid" : "font-medium text-ink"}>{current.label}</span>
        <ChevronDown aria-hidden size={14} strokeWidth={1.75} className="shrink-0 text-ink-low" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[280px]">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next) => {
            if (isDateRangePreset(next)) onValueChange(next);
          }}
        >
          {DATE_RANGE_PRESETS.map((option) => {
            const start = reference === null ? null : dateRangeStart(option.value, reference);
            return (
              <DropdownMenuRadioItem
                key={option.value}
                value={option.value}
                hint={start ? <span className="mono">since {formatDate(start)}</span> : null}
              >
                {option.label}
              </DropdownMenuRadioItem>
            );
          })}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
