import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface KeyValueItem {
  /** A stable key; defaults to the label when it is text. */
  id?: string;
  label: ReactNode;
  value: ReactNode;
  /** A figure, an id or a timestamp: set in Plex Mono, aligned right. */
  mono?: boolean;
  /**
   * The value the evidence turns on (the field that broke the rule), marked
   * in the accent as Ask the System marks the cited field.
   */
  highlight?: boolean;
}

export interface KeyValueListProps {
  items: readonly KeyValueItem[];
  /**
   * boxed: ruled rows in a hairline frame, like a record as it was read.
   * plain: two columns of label and value without a frame.
   */
  variant?: "boxed" | "plain";
  /** Width of the label column, e.g. "minmax(0,42%)". */
  labelWidth?: string;
  className?: string;
}

/**
 * Facts about one thing, as a description list: what each figure is, and
 * the figure. Values align on the right edge so figures read as a column.
 * A label is never cut short: on a narrow screen it wraps in balanced lines,
 * its value centred beside it.
 */
export function KeyValueList({ items, variant = "boxed", labelWidth = "minmax(0,46%)", className }: KeyValueListProps) {
  const boxed = variant === "boxed";
  return (
    <dl
      className={cn(
        "flex min-w-0 flex-col text-sm",
        boxed && "overflow-hidden rounded-sm border border-rule-weak",
        className,
      )}
    >
      {items.map((item, index) => (
        <div
          key={item.id ?? (typeof item.label === "string" ? item.label : index)}
          className={cn(
            "grid items-center gap-3",
            boxed ? "min-h-8 border-t border-rule-weak px-3 py-1 first:border-t-0" : "min-h-7 py-0.5",
            item.highlight && "bg-cite-tint",
          )}
          style={{ gridTemplateColumns: `${labelWidth} minmax(0,1fr)` }}
        >
          <dt className={cn("min-w-0 break-words text-balance text-ink-low", item.highlight && "text-cite")} data-key-label>
            {item.label}
          </dt>
          <dd
            className={cn(
              "min-w-0 truncate text-right",
              item.mono && "mono",
              item.highlight ? "font-medium text-cite-hot" : "text-ink",
            )}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
