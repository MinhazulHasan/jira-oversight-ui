"use client";

import { RadioGroup } from "radix-ui";
import type { ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { useFigureLocale } from "@/components/ui/use-figures";
import { formatCount } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface FacetSegment<T extends string> {
  value: T;
  label: string;
  /** How many findings this choice would give (the facet counts every other filter). */
  count?: number;
  /** A mark before the label, e.g. the severity's shape. */
  mark?: ReactNode;
}

export interface FacetSegmentsProps<T extends string> {
  /** The group's accessible name: "Severity". */
  label: string;
  options: readonly FacetSegment<T>[];
  value: T;
  onValueChange: (value: T) => void;
  /** The counts are on their way: hold their place so nothing shifts when they land. */
  pending?: boolean;
  className?: string;
}

const ITEM =
  "group pressable inline-flex h-7 items-center justify-center gap-1.5 rounded-[6px] px-2.5 text-sm whitespace-nowrap text-ink-mid select-none hover:text-ink data-[state=checked]:bg-sheet data-[state=checked]:text-ink data-[state=checked]:shadow-raised data-[disabled]:pointer-events-none data-[disabled]:opacity-45";

export function FacetSegments<T extends string>({
  label,
  options,
  value,
  onValueChange,
  pending = false,
  className,
}: FacetSegmentsProps<T>) {
  const locale = useFigureLocale();
  return (
    <RadioGroup.Root
      aria-label={label}
      orientation="horizontal"
      loop
      value={value}
      onValueChange={(next) => {
        const option = options.find((candidate) => candidate.value === next);
        if (option) onValueChange(option.value);
      }}
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-md border border-rule-weak bg-rail p-0.5",
        className,
      )}
    >
      {options.map((option) => {
        const count = option.count === undefined ? null : formatCount(option.count, { locale });
        return (
          <RadioGroup.Item
            key={option.value}
            value={option.value}
            data-segment=""
            aria-label={count === null ? option.label : `${option.label}, ${count}`}
            className={ITEM}
          >
            {option.mark}
            {option.label}
            {pending ? (
              <Skeleton className="h-2 w-5" />
            ) : count !== null ? (
              <span
                data-figure
                className="mono text-[11px] text-ink-low tabular-nums group-data-[state=checked]:text-ink-mid"
              >
                {count}
              </span>
            ) : null}
          </RadioGroup.Item>
        );
      })}
    </RadioGroup.Root>
  );
}
