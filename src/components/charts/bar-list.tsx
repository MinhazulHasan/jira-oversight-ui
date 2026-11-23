"use client";

import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { Tooltip } from "@/components/ui/tooltip";
import { useFigureLocale } from "@/components/ui/use-figures";
import { formatCount, formatShare, MISSING } from "@/lib/format";
import { cn } from "@/lib/utils";

import type { ChartTableData } from "./chart-table";
import { TooltipBody } from "./chart-tooltip";
import { SERIES_COLOURS } from "./palette";
import type { FigureFormat } from "./sparkline";

export interface BarListItem {
  id: string;
  /** The category: an epic's name, a rule's title. */
  label: string;
  /** A key before the label in Plex Mono: "DEMO-12", "R-EST-01". */
  meta?: string;
  value: number;
  /** Click through to the rows behind the bar (the filtered findings). */
  href?: string;
  onSelect?: () => void;
}

export interface BarListProps {
  /** Ranked, largest first: the order is the reading. */
  items: readonly BarListItem[];
  /** Names the list for assistive technology: "Hot spots". */
  title: string;
  /** What a value counts, read after it: "open findings". */
  valueNoun?: string;
  format?: FigureFormat;
  /** The value a full-width bar stands for; the largest value by default. */
  max?: number;
  /** The whole the shares in the tooltip are of; the sum of the values by default. */
  total?: number;
  /** One colour for every bar: the bars are one series, ranked. */
  colour?: string;
  /**
   * auto: one line per row when the list is wide, the name over its bar when
   * it is narrow (a container query), so a name is never cut short to make
   * room for a bar. inline or stacked forces one, e.g. to match a neighbour;
   * in either, a name longer than its room wraps onto a second line (in
   * balanced lines) rather than being cut, as on a phone (JO-14).
   */
  layout?: BarLayout;
  className?: string;
}

/**
 * A category as a table cell: its key in Plex Mono, then its name, after the
 * row's decorative mark if it has one (a person's picture). The name is
 * running text, so it keeps proportional figures in the table, where tabular
 * ones would space a hyphen ("Anne - Marie"; globals.css).
 */
export function categoryCell(item: { label: string; meta?: string; leading?: ReactNode }): ReactNode {
  const name = <span className="normal-nums">{item.label}</span>;
  const cell = item.meta ? (
    <>
      <span className="mono text-ink-low">{item.meta}</span> {name}
    </>
  ) : (
    name
  );
  return item.leading ? (
    <span className="inline-flex items-center gap-2">
      {item.leading}
      <span>{cell}</span>
    </span>
  ) : (
    cell
  );
}

/** The figures behind a ranked list, for its table view: each category, its value and its share. */
export function barListTable(
  items: readonly BarListItem[],
  {
    category = "Category",
    value = "Count",
    format = formatCount,
    total,
    locale,
  }: { category?: string; value?: string; format?: FigureFormat; total?: number; locale?: string } = {},
): ChartTableData {
  const whole = total ?? items.reduce((sum, item) => sum + item.value, 0);
  return {
    columns: [{ header: category }, { header: value, numeric: true }, { header: "Share", numeric: true }],
    rows: items.map((item) => [
      categoryCell(item),
      format(item.value, { locale }),
      whole > 0 ? formatShare(item.value / whole, { locale }) : MISSING,
    ]),
  };
}

/**
 * A ranked list with bars: the label, a thin bar from a shared baseline, the
 * figure in a right-aligned column. Every row clicks through to what it
 * counts, shows where it leads on hover and focus, and its tooltip gives the
 * share of the whole.
 */
export function BarList({
  items,
  title,
  valueNoun,
  format = formatCount,
  max,
  total,
  colour = SERIES_COLOURS[0],
  layout = "auto",
  className,
}: BarListProps) {
  const locale = useFigureLocale();
  const largest = max ?? Math.max(0, ...items.map((item) => item.value));
  const whole = total ?? items.reduce((sum, item) => sum + item.value, 0);

  return (
    <ul aria-label={title} className={cn("@container flex flex-col", className)}>
      {items.map((item) => {
        const width = largest > 0 ? (item.value / largest) * 100 : 0;
        const figure = format(item.value, { locale });
        const share = whole > 0 ? formatShare(item.value / whole, { locale }) : null;
        const content = (
          <>
            <span className="flex min-w-0 items-baseline gap-2 [grid-area:label]">
              {item.meta ? <span className="mono shrink-0 text-xs text-ink-low">{item.meta}</span> : null}
              <span className="min-w-0 text-sm text-balance text-ink [overflow-wrap:break-word]">{item.label}</span>
            </span>
            <span aria-hidden className="relative flex h-2.5 items-center [grid-area:bar]">
              {item.value > 0 ? (
                <span
                  className="jo-bar-fill h-full rounded-r-[4px]"
                  style={{ width: `max(${width}%, 3px)`, background: colour }}
                />
              ) : null}
            </span>
            <span className="mono text-right text-sm text-ink [grid-area:value]" data-figure>
              {figure}
              {valueNoun ? <span className="sr-only"> {valueNoun}</span> : null}
            </span>
          </>
        );
        return (
          <li key={item.id}>
            <BarRow
              item={item}
              layout={layout}
              tooltip={
                <TooltipBody
                  heading={item.meta ? `${item.meta} · ${item.label}` : item.label}
                  rows={[
                    { id: "value", value: figure, name: valueNoun, colour, key: "block" },
                    ...(share ? [{ id: "share", value: share, name: "of the total" }] : []),
                  ]}
                />
              }
            >
              {content}
            </BarRow>
          </li>
        );
      })}
    </ul>
  );
}

export type BarLayout = "auto" | "inline" | "stacked";

/*
 * Row grids, written out in full because Tailwind reads class names from the
 * source. Inline: name, bar, figure and arrow on one line 32 px high, the bar
 * on a baseline shared by every row; a name too long for its column takes a
 * second line and its row grows to hold it. Stacked: name and figure on the
 * first line, the bar under them at full width. Auto switches at a 36rem
 * container, and from a 64rem container (a list across a whole page) the name
 * column stops at 16rem, so a name stays beside its bar rather than far to
 * its left.
 */
const STACKED =
  "gap-y-1.5 py-2 grid-cols-[minmax(0,1fr)_auto_0.875rem] [grid-template-areas:'label_value_go'_'bar_bar_bar']";
const ROW_LAYOUT: Record<BarLayout, Record<"single" | "stacked", string>> = {
  inline: {
    single: "min-h-8 py-1 grid-cols-[minmax(0,2fr)_minmax(0,3fr)_3.5rem_0.875rem] [grid-template-areas:'label_bar_value_go']",
    stacked: "min-h-8 py-1 grid-cols-[minmax(0,2fr)_minmax(0,3fr)_5.5rem_0.875rem] [grid-template-areas:'label_bar_value_go']",
  },
  stacked: { single: STACKED, stacked: STACKED },
  auto: {
    single: `${STACKED} @xl:min-h-8 @xl:py-1 @xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_3.5rem_0.875rem] @xl:[grid-template-areas:'label_bar_value_go'] @5xl:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_3.5rem_0.875rem]`,
    stacked: `${STACKED} @xl:min-h-8 @xl:py-1 @xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_5.5rem_0.875rem] @xl:[grid-template-areas:'label_bar_value_go'] @5xl:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_5.5rem_0.875rem]`,
  },
};
const ROW = "jo-bar-row grid items-center gap-x-3 rounded-[6px] px-2";

/**
 * A row that leads somewhere (link or button), or a plain row; the tooltip goes on whichever it is.
 *
 * `behind`: the row holds a control of its own (a person's name that opens their card, JO-13), which a link may
 * not hold. The row is then a box with the link stretched behind its content, named by `behind.label`, and the
 * control stands above it: a press on the name is the name's, a press anywhere else follows the row.
 */
export function BarRow({
  item,
  tooltip,
  grid = "single",
  layout = "auto",
  behind,
  children,
}: {
  item: { href?: string; onSelect?: () => void };
  tooltip: ReactNode;
  grid?: "single" | "stacked";
  layout?: BarLayout;
  behind?: { label: string };
  children: ReactNode;
}) {
  const row = cn(ROW, ROW_LAYOUT[layout][grid]);
  const affordance = (
    <ChevronRight aria-hidden size={14} strokeWidth={1.75} className="jo-row-affordance text-ink-low [grid-area:go]" />
  );
  if (item.href && behind) {
    return (
      <Tooltip content={tooltip} side="top" align="end" className="bg-transparent p-0 shadow-none">
        <div className={cn(row, "relative hover:bg-rail")} data-row-behind>
          {children}
          {affordance}
          <Link href={item.href} aria-label={behind.label} className="jo-bar-link pressable absolute inset-0 rounded-[6px] outline-offset-[-2px]" />
        </div>
      </Tooltip>
    );
  }
  if (item.href) {
    return (
      <Tooltip content={tooltip} side="top" align="end" className="bg-transparent p-0 shadow-none">
        <Link href={item.href} className={cn(row, "pressable outline-offset-[-2px] hover:bg-rail")}>
          {children}
          {affordance}
        </Link>
      </Tooltip>
    );
  }
  if (item.onSelect) {
    return (
      <Tooltip content={tooltip} side="top" align="end" className="bg-transparent p-0 shadow-none">
        <button
          type="button"
          onClick={item.onSelect}
          className={cn(row, "pressable w-full text-left outline-offset-[-2px] hover:bg-rail")}
        >
          {children}
          {affordance}
        </button>
      </Tooltip>
    );
  }
  return (
    <Tooltip content={tooltip} side="top" align="end" className="bg-transparent p-0 shadow-none">
      <div className={row}>
        {children}
        <span className="[grid-area:go]" />
      </div>
    </Tooltip>
  );
}
