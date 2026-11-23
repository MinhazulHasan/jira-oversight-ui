import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/*
 * Building blocks for a page that has its layout but not yet its data: real
 * section headings over still, quiet shapes in the final proportions. Still
 * rather than shimmering, because nothing is loading; the shimmer is kept for
 * loading.tsx, where something is.
 */

export function Bone({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton-still rounded-xs", className)} />;
}

export function PlaceholderSection({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex min-w-0 flex-col gap-3", className)}>
      <h2 className="micro text-ink-low">{title}</h2>
      {children}
    </section>
  );
}

/** A label over a figure: the shape of a stat tile or a fact. */
export function PlaceholderFigure({ label, wide = false }: { label: string; wide?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-2.5">
      <span className="truncate text-xs text-ink-low">{label}</span>
      <Bone className={cn("h-7", wide ? "w-24" : "w-14")} />
      <Bone className="h-2.5 w-20" />
    </div>
  );
}

/** Rows of a table: real column names over quiet cells. */
export function PlaceholderTable({
  columns,
  rows = 8,
  numericFrom,
}: {
  columns: string[];
  rows?: number;
  /** Columns from this index on are figures, so they align right. */
  numericFrom?: number;
}) {
  const widths = ["w-16", "w-3/4", "w-20", "w-14", "w-24", "w-12", "w-10", "w-16"];
  const isNumeric = (index: number) => numericFrom !== undefined && index >= numericFrom;
  return (
    <div className="overflow-hidden rounded-md border border-rule-weak">
      <div
        className="grid h-[var(--row-table-head)] items-center gap-4 border-b border-rule-weak bg-rail px-4"
        style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
      >
        {columns.map((column, index) => (
          <span
            key={column}
            className={cn("micro truncate text-ink-low", isNumeric(index) && "text-right")}
          >
            {column}
          </span>
        ))}
      </div>
      {Array.from({ length: rows }, (_, row) => (
        <div
          key={row}
          aria-hidden
          className="grid h-[var(--row-table)] items-center gap-4 border-b border-rule-weak px-4 last:border-b-0"
          style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
        >
          {columns.map((column, index) => (
            <Bone
              key={column}
              className={cn(
                "h-2.5",
                widths[(index + row) % widths.length],
                isNumeric(index) && "ml-auto",
              )}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Horizontal bars of decreasing length: a ranking. */
export function PlaceholderBars({ rows = 5 }: { rows?: number }) {
  const lengths = ["w-[92%]", "w-[74%]", "w-[61%]", "w-[47%]", "w-[38%]", "w-[29%]", "w-[22%]"];
  return (
    <div aria-hidden className="flex flex-col gap-3">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="grid grid-cols-[minmax(0,9rem)_1fr_2.5rem] items-center gap-3">
          <Bone className="h-2.5 w-full" />
          <Bone className={cn("h-3", lengths[index % lengths.length])} />
          <Bone className="ml-auto h-2.5 w-6" />
        </div>
      ))}
    </div>
  );
}

/** Lines of prose with a ragged last line. */
export function PlaceholderProse({ lines = 4 }: { lines?: number }) {
  return (
    <div aria-hidden className="flex flex-col gap-2.5">
      {Array.from({ length: lines }, (_, index) => (
        <Bone key={index} className={cn("h-3", index === lines - 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  );
}
