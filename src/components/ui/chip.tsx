"use client";

import { X } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface ChipProps {
  /** What the filter is on: "Severity", "Rule", "First seen". */
  label: string;
  /** What it is set to: "Breach", "R-EST-01, R-FLOW-02". */
  value: ReactNode;
  /** The value in words for the remove button's name, when value is not plain text. */
  valueText?: string;
  /** Remove this filter. Without it the chip is a plain applied-filter label. */
  onRemove?: () => void;
  /** Set the value in Plex Mono (rule ids, issue keys). */
  mono?: boolean;
  className?: string;
}

/** An applied filter, shown as "Severity Breach ×". */
export function Chip({ label, value, valueText, onRemove, mono = false, className }: ChipProps) {
  const spoken = valueText ?? (typeof value === "string" ? value : "");
  return (
    <span
      className={cn(
        "inline-flex h-7 max-w-full shrink-0 items-center gap-1.5 rounded-md border border-rule bg-sheet text-xs",
        onRemove ? "pr-1 pl-2.5" : "px-2.5",
        className,
      )}
    >
      <span className="text-ink-low">{label}</span>{" "}
      <span className={cn("truncate font-medium text-ink", mono && "mono")}>{value}</span>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove filter: ${label} ${spoken}`.trim()}
          className="pressable -my-1 inline-flex size-5 shrink-0 items-center justify-center rounded-[4px] text-ink-low hover:bg-hover hover:text-ink"
        >
          <X aria-hidden size={12} strokeWidth={2} />
        </button>
      ) : null}
    </span>
  );
}
