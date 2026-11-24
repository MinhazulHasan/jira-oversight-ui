import { SearchX, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  /** What is missing, plainly: "No findings match these filters". */
  title: ReactNode;
  /** At most one short line: what to change or do next. */
  description?: ReactNode;
  /** The way out, usually one secondary button ("Clear filters"). */
  action?: ReactNode;
  icon?: LucideIcon;
  /** Compact sits inside a table or a chart; regular fills a section. */
  size?: "regular" | "compact";
  className?: string;
}

/** Nothing to show, said calmly and specifically. */
export function EmptyState({
  title,
  description,
  action,
  icon: Icon = SearchX,
  size = "regular",
  className,
}: EmptyStateProps) {
  const compact = size === "compact";
  return (
    <div
      className={cn(
        "flex flex-col items-center text-center",
        compact ? "gap-2.5 px-4 py-7" : "gap-3.5 px-6 py-12",
        className,
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex items-center justify-center rounded-md border-[1.5px] border-dashed border-rule-strong text-ink-low",
          compact ? "size-9" : "size-11",
        )}
      >
        <Icon size={compact ? 16 : 18} strokeWidth={1.75} />
      </span>
      <div className="flex max-w-[52ch] flex-col gap-1">
        <p className={cn("font-medium text-ink", compact ? "text-sm" : "text-md")}>{title}</p>
        {description ? <p className={cn("text-ink-mid", compact ? "text-xs" : "text-sm")}>{description}</p> : null}
      </div>
      {action ? <div className="mt-1 flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
    </div>
  );
}
