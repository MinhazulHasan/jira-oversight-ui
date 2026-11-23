"use client";

import type { ReactNode } from "react";

import { SeverityMark, type Severity } from "@/components/ui/badge";
import { useFigureLocale } from "@/components/ui/use-figures";
import { formatCount } from "@/lib/format";
import { cn } from "@/lib/utils";

import { BarRow, categoryCell, type BarLayout } from "./bar-list";
import type { ChartTableData } from "./chart-table";
import { TooltipBody } from "./chart-tooltip";
import { STATUS_COLOURS } from "./palette";
import type { FigureFormat } from "./sparkline";

export interface StackSegment {
  key: string;
  /** Singular and plural, for "3 breaches, 1 warning". */
  label: string;
  plural: string;
  colour: string;
  /** A status segment keys with its mark, so it never rests on colour. */
  severity?: Severity;
}

/** Breach first, then warning: the order of severity, and of reading. */
export const SEVERITY_SEGMENTS: readonly StackSegment[] = [
  { key: "breach", label: "breach", plural: "breaches", colour: STATUS_COLOURS.breach, severity: "breach" },
  { key: "warning", label: "warning", plural: "warnings", colour: STATUS_COLOURS.warning, severity: "warning" },
];

export interface StackedBarItem {
  id: string;
  label: string;
  /** A key before the label in Plex Mono: "DEMO-12". */
  meta?: string;
  /** A decorative mark before the label, centred on its line: a person's picture. */
  leading?: ReactNode;
  /** A row that stands for no one (the unassigned tickets): its name in the secondary ink. */
  muted?: boolean;
  /**
   * Wraps the row's name (its picture and its label) in a control of its own: a person's name that opens their
   * card (JO-13). The row's link then stands behind the row, and the control above it.
   */
  wrapLabel?: (label: ReactNode) => ReactNode;
  /** A value per segment key; a missing key counts as zero. */
  values: Readonly<Record<string, number>>;
  href?: string;
  onSelect?: () => void;
}

export interface StackedBarListProps {
  /** Ranked by total, largest first. */
  items: readonly StackedBarItem[];
  title: string;
  segments?: readonly StackSegment[];
  format?: FigureFormat;
  /** The total a full-width bar stands for; the largest total by default. */
  max?: number;
  /** One line per row, or the name over its bar; auto follows the container (see BarList). */
  layout?: BarLayout;
  className?: string;
}

function total(item: StackedBarItem): number {
  return Object.values(item.values).reduce((sum, value) => sum + (value > 0 ? value : 0), 0);
}

/** "3 breaches and 1 warning", for a row's accessible name. */
export function describeStack(item: StackedBarItem, segments: readonly StackSegment[], read: (value: number) => string): string {
  const parts = segments
    .map((segment) => {
      const value = item.values[segment.key] ?? 0;
      return value > 0 ? `${read(value)} ${value === 1 ? segment.label : segment.plural}` : null;
    })
    .filter((part): part is string => part !== null);
  if (parts.length === 0) return "none";
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/** The figures behind stacked bars, for their table view: a column per part, then the total. */
export function stackedBarTable(
  items: readonly StackedBarItem[],
  {
    category = "Category",
    segments = SEVERITY_SEGMENTS,
    format = formatCount,
    locale,
  }: { category?: string; segments?: readonly StackSegment[]; format?: FigureFormat; locale?: string } = {},
): ChartTableData {
  const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
  return {
    columns: [
      { header: category },
      ...segments.map((segment) => ({ header: sentence(segment.plural), numeric: true })),
      { header: "Total", numeric: true },
    ],
    rows: items.map((item) => [
      categoryCell(item),
      ...segments.map((segment) => format(item.values[segment.key] ?? 0, { locale })),
      format(total(item), { locale }),
    ]),
  };
}

/**
 * Ranked bars split into parts: breaches and warnings per epic. The parts sit
 * end to end from one baseline with a 2 px gap of the surface between them,
 * the last part has the rounded end, and each part's count is printed with
 * its mark, so the split never depends on telling clay from amber.
 */
export function StackedBarList({
  items,
  title,
  segments = SEVERITY_SEGMENTS,
  format = formatCount,
  max,
  layout = "auto",
  className,
}: StackedBarListProps) {
  const locale = useFigureLocale();
  const read = (value: number) => format(value, { locale });
  const largest = max ?? Math.max(0, ...items.map(total));
  // Each part's figures take the width of its longest, so "15 ▲1" lines up under "88 ▲36".
  const widths = segments.map((segment) => Math.max(1, ...items.map((item) => read(item.values[segment.key] ?? 0).length)));

  return (
    <ul aria-label={title} className={cn("@container flex flex-col", className)}>
      {items.map((item) => {
        const parts = segments
          .map((segment) => ({ segment, value: item.values[segment.key] ?? 0 }))
          .filter((part) => part.value > 0);
        const gaps = Math.max(0, parts.length - 1) * 2;
        const name = (
          <>
            {item.leading ? <span className="flex shrink-0 self-center">{item.leading}</span> : null}
            {item.meta ? <span className="mono shrink-0 text-xs text-ink-low">{item.meta}</span> : null}
            {/* A person's name, beside their picture, keeps one line as DESIGN.md sets names (their card, or the
                tooltip and the row's accessible name, give it in full); any other label, an epic's title, wraps
                rather than being cut, as BarList's do: a phone has no hover for the tooltip (the JO-14 review). */}
            <span
              className={cn(
                item.wrapLabel || item.leading ? "truncate" : "min-w-0 text-balance [overflow-wrap:break-word]",
                "text-sm",
                item.muted ? "text-ink-low" : "text-ink",
              )}
              data-person-name
            >
              {item.label}
            </span>
          </>
        );
        return (
          <li key={item.id}>
            <BarRow
              item={item}
              grid="stacked"
              layout={layout}
              behind={item.wrapLabel ? { label: `${item.label}: ${describeStack(item, segments, read)}, open findings` } : undefined}
              tooltip={
                <TooltipBody
                  heading={item.meta ? `${item.meta} · ${item.label}` : item.label}
                  rows={segments.map((segment) => ({
                    id: segment.key,
                    value: read(item.values[segment.key] ?? 0),
                    name: segment.plural,
                    colour: segment.colour,
                    severity: segment.severity,
                    key: "block" as const,
                  }))}
                />
              }
            >
              <span className="flex min-w-0 items-baseline gap-2 [grid-area:label]">{item.wrapLabel ? item.wrapLabel(name) : name}</span>
              <span aria-hidden className="flex h-2.5 items-stretch gap-[2px] [grid-area:bar]">
                {parts.map((part, index) => (
                  <span
                    key={part.segment.key}
                    className={cn("jo-segment jo-bar-fill min-w-[3px]", index === parts.length - 1 && "rounded-r-[4px]")}
                    style={{
                      width: largest > 0 ? `calc((100% - ${gaps}px) * ${part.value / largest})` : 0,
                      background: part.segment.colour,
                    }}
                  />
                ))}
              </span>
              <span className="flex items-center justify-end gap-2.5 text-sm text-ink [grid-area:value]">
                {segments.map((segment, index) => (
                  <span key={segment.key} aria-hidden className="inline-flex items-center gap-1">
                    {segment.severity ? <SeverityMark severity={segment.severity} size={8} palette="chart" /> : null}
                    <span className="mono text-right" style={{ minWidth: `${widths[index]}ch` }} data-figure>
                      {read(item.values[segment.key] ?? 0)}
                    </span>
                  </span>
                ))}
                {/* With the link behind the row, its name says this: said once, not twice. */}
                {item.wrapLabel ? null : <span className="sr-only">{describeStack(item, segments, read)}</span>}
              </span>
            </BarRow>
          </li>
        );
      })}
    </ul>
  );
}
