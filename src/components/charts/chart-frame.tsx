"use client";

import { ChartLine, Table2 } from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton, SkeletonGroup } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import { ChartTable, type ChartTableData } from "./chart-table";

export type ChartState = "ready" | "loading" | "empty" | "error";
export type ChartView = "chart" | "table";

export interface ChartFrameProps {
  /** What the chart shows: "Median cycle time". Names the figure for assistive technology. */
  title: string;
  /** A visible line under the title: the unit, the scope, the period. */
  description?: ReactNode;
  summary: string;
  /** A Legend, for two or more series. */
  legend?: ReactNode;
  /** The same figures as a table; enables the Chart | Table switch. */
  table?: ChartTableData;
  state?: ChartState;
  /** The chart is redrawing for new data: hold the previous picture, dimmed, rather than flash a skeleton. */
  refreshing?: boolean;
  /** Said when there is nothing to draw; say what was looked at. */
  emptyTitle?: string;
  emptyDescription?: ReactNode;
  errorTitle?: string;
  errorDescription?: ReactNode;
  errorDetail?: ReactNode;
  onRetry?: () => void;
  retrying?: boolean;
  /** The placeholder's shape while loading: rows of bars, a line, or a block. */
  loadingShape?: "bars" | "line" | "block";
  /** Height kept for the chart in every state, so nothing jumps (px). */
  height?: number;
  /** Controls beside the switch: an export, a link to the full view. */
  actions?: ReactNode;
  /** A note under the chart: the source, how weeks are counted. */
  footnote?: ReactNode;
  view?: ChartView;
  defaultView?: ChartView;
  onViewChange?: (view: ChartView) => void;
  headingLevel?: 2 | 3 | 4;
  className?: string;
  /** The chart itself. */
  children: ReactNode;
}

const VIEW_OPTIONS = [
  { value: "chart", label: "Chart", icon: ChartLine },
  { value: "table", label: "Table", icon: Table2 },
] as const;

export function ChartFrame({
  title,
  description,
  summary,
  legend,
  table,
  state = "ready",
  refreshing = false,
  emptyTitle = "Nothing to chart",
  emptyDescription,
  errorTitle = "This chart could not be loaded",
  errorDescription = "Try again.",
  errorDetail,
  onRetry,
  retrying,
  loadingShape = "block",
  height = 220,
  actions,
  footnote,
  view,
  defaultView = "chart",
  onViewChange,
  headingLevel = 3,
  className,
  children,
}: ChartFrameProps) {
  const titleId = useId();
  const summaryId = useId();
  const [ownView, setOwnView] = useState<ChartView>(defaultView);
  const current = table ? (view ?? ownView) : "chart";
  const Heading = `h${headingLevel}` as const;

  const setView = (next: ChartView) => {
    if (view === undefined) setOwnView(next);
    onViewChange?.(next);
  };

  return (
    <figure
      aria-labelledby={titleId}
      aria-describedby={summaryId}
      className={cn("jo-chart flex min-w-0 flex-col gap-3", className)}
      data-refreshing={refreshing || undefined}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <Heading id={titleId} className="text-sm font-medium text-ink">
            {title}
          </Heading>
          {description ? <p className="text-xs text-ink-low">{description}</p> : null}
        </div>
        {actions || (table && state === "ready") ? (
          <div data-print="hide" className="flex shrink-0 items-center gap-2">
            {actions}
            {table && state === "ready" ? (
              <SegmentedControl
                label={`${title}: show as`}
                size="sm"
                options={VIEW_OPTIONS}
                value={current}
                onValueChange={setView}
              />
            ) : null}
          </div>
        ) : null}
      </div>

      {legend && state === "ready" && current === "chart" ? legend : null}

      <div style={{ minHeight: height }} className="relative flex min-w-0 flex-col">
        {state === "loading" ? (
          <SkeletonGroup label={`Loading ${title.toLowerCase()}`} className="flex flex-1 flex-col">
            <LoadingShape shape={loadingShape} height={height} />
          </SkeletonGroup>
        ) : state === "error" ? (
          <ErrorState
            size="compact"
            title={errorTitle}
            description={errorDescription}
            detail={errorDetail}
            onRetry={onRetry}
            retrying={retrying}
            className="my-auto"
          />
        ) : state === "empty" ? (
          <EmptyState size="compact" title={emptyTitle} description={emptyDescription} className="my-auto" />
        ) : current === "table" && table ? (
          <ChartTable data={table} caption={title} />
        ) : (
          children
        )}
      </div>

      <p id={summaryId} className="sr-only">
        {summary}
      </p>
      {footnote ? <figcaption className="text-xs text-ink-low">{footnote}</figcaption> : null}
    </figure>
  );
}

/** A still-shimmering stand-in in the chart's own shape. */
function LoadingShape({ shape, height }: { shape: "bars" | "line" | "block"; height: number }) {
  if (shape === "bars") {
    const widths = ["92%", "74%", "61%", "47%", "38%", "29%", "22%"];
    const rows = Math.max(3, Math.min(widths.length, Math.floor(height / 34)));
    return (
      <div className="flex flex-col gap-4 pt-1">
        {widths.slice(0, rows).map((width) => (
          <div key={width} className="grid grid-cols-[minmax(0,9rem)_1fr_2.5rem] items-center gap-3">
            <Skeleton className="h-2.5 w-full" />
            <Skeleton className="h-2.5" style={{ width }} />
            <Skeleton className="ml-auto h-2.5 w-7" />
          </div>
        ))}
      </div>
    );
  }
  if (shape === "line") {
    return (
      <div className="relative flex-1" style={{ height }}>
        {[0, 1, 2, 3].map((line) => (
          <span
            key={line}
            aria-hidden
            className="absolute inset-x-0 h-px bg-rule-weak"
            style={{ top: `${12 + line * 25}%` }}
          />
        ))}
        <Skeleton className="absolute inset-x-0 top-[38%] h-[30%] rounded-md opacity-60" />
      </div>
    );
  }
  return <Skeleton className="w-full flex-1 rounded-md" style={{ height }} />;
}
