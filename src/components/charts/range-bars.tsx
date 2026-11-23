"use client";

import { Fragment, useRef, useState, type PointerEvent } from "react";

import { useFigureLocale } from "@/components/ui/use-figures";
import { formatCount, formatHours } from "@/lib/format";
import { cn } from "@/lib/utils";

import { FloatingTooltip, TooltipBody } from "./chart-tooltip";
import { MEASURE_COLOURS } from "./palette";
import { axisHours, type AxisFormat } from "./scale";
import type { FigureFormat } from "./sparkline";

export interface RangeRow {
  id: string;
  /** The status: "In Progress". */
  label: string;
  /** A second line: the stage it maps to, or how many issues it covers. */
  detail?: string;
  /** How many intervals the percentiles were computed from. */
  count?: number;
  median: number;
  p75: number;
  p90: number;
}

export interface RangeBarsProps {
  rows: readonly RangeRow[];
  /** The table's name: "Time in status". */
  title: string;
  /** How a value reads; hours to one decimal by default. */
  format?: FigureFormat;
  /** How a tick on the shared scale reads; whole hours by default. */
  axisFormat?: AxisFormat;
  /** The value the full bar stands for; the largest p90 by default, rounded up. */
  max?: number;
  className?: string;
}

const PARTS = [
  { key: "median", label: "Median", from: () => 0, to: (row: RangeRow) => row.median },
  { key: "p75", label: "75th percentile", from: (row: RangeRow) => row.median, to: (row: RangeRow) => row.p75 },
  { key: "p90", label: "90th percentile", from: (row: RangeRow) => row.p75, to: (row: RangeRow) => row.p90 },
] as const;

/** Round a maximum up to a value that makes clean ticks: 64 -> 80, 7.2 -> 8. */
export function niceCeiling(value: number): number {
  if (!(value > 0)) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (value <= step * power) return step * power;
  }
  return 10 * power;
}

type Part = (typeof PARTS)[number];

/** The scale's ticks, placed along the width they are given: the first from its start, the last to its end. */
function Scale({ ticks, ceiling, labels, className }: { ticks: readonly number[]; ceiling: number; labels: readonly string[]; className?: string }) {
  return (
    <span aria-hidden className={cn("absolute top-1/2 -translate-y-1/2", className)}>
      {ticks.map((tick, index) => (
        <span
          key={tick}
          className={cn(
            "jo-chart-text absolute -translate-y-1/2 text-[10.5px] whitespace-nowrap text-ink-low",
            index === 0 ? "" : index === ticks.length - 1 ? "-translate-x-full" : "-translate-x-1/2",
          )}
          style={{ left: `${(tick / ceiling) * 100}%` }}
        >
          {labels[index]}
        </span>
      ))}
    </span>
  );
}

/** One status's bar on the shared scale, with the inner ticks as hairlines `rule` past its edges. */
function Track({
  row,
  ticks,
  ceiling,
  rule,
  onEnter,
  onLeave,
  className,
}: {
  row: RangeRow;
  ticks: readonly number[];
  ceiling: number;
  rule: string;
  onEnter: (event: PointerEvent<HTMLSpanElement>, row: RangeRow, part: Part) => void;
  onLeave: () => void;
  className?: string;
}) {
  return (
    <span aria-hidden className={cn("relative block h-2.5", className)}>
      {ticks.slice(1, -1).map((tick) => (
        <span key={tick} className={cn("absolute w-px bg-rule-weak", rule)} style={{ left: `${(tick / ceiling) * 100}%` }} />
      ))}
      {PARTS.map((part, index) => {
        const from = Math.min(part.from(row), ceiling) / ceiling;
        const to = Math.min(part.to(row), ceiling) / ceiling;
        if (to <= from) return null;
        const last = index === PARTS.length - 1;
        return (
          <span
            key={part.key}
            onPointerEnter={(event) => onEnter(event, row, part)}
            onPointerLeave={onLeave}
            className={cn("jo-segment absolute inset-y-0", last && "rounded-r-[4px]")}
            style={{
              left: `${from * 100}%`,
              // A 2 px gap of the surface between parts; the last part keeps its full end.
              width: last ? `${(to - from) * 100}%` : `calc(${(to - from) * 100}% - 2px)`,
              background: MEASURE_COLOURS[part.key],
            }}
          />
        );
      })}
    </span>
  );
}

/*
 * Below a 42rem frame (a phone, a tablet's column) the bars have no room
 * beside the status and its three figures, and the scale's ticks would draw
 * over each other. There each status reads as BarList's stacked rows do: its
 * name and figures on one line, then what it maps to and its bar across the
 * full width, under the scale drawn once above them. The narrow lines are
 * pictures only (hidden from assistive technology, which reads each figure
 * once in its row); the row header keeps the whole status.
 */
const WIDE_ONLY = "@max-[42rem]:hidden";
const NARROW_ONLY = "hidden @max-[42rem]:table-row";
/** A narrow frame's name line: the status and its figures on one baseline, its stage and bar close under it. */
const NAME_LINE = "@max-[42rem]:pt-2.5 @max-[42rem]:pb-0.5 @max-[42rem]:align-baseline";

/**
 * How long work sits in each status: for every row a bar in three steps of
 * one hue (the deepest to the median, then to the 75th and the 90th
 * percentile) against one shared scale, and the three figures in columns.
 * It is a table with a picture in it, so the figures are read as figures.
 * Nothing in it is cut short: a long status or stage wraps.
 */
export function RangeBars({ rows, title, format = formatHours, axisFormat = axisHours, max, className }: RangeBarsProps) {
  const locale = useFigureLocale();
  const read = (value: number) => format(value, { locale });
  const ceiling = max ?? niceCeiling(Math.max(0, ...rows.map((row) => row.p90)));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * ceiling);
  const labels = ticks.map((tick) => axisFormat(tick, { locale, step: ceiling / 4 }));
  const frame = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ row: RangeRow; part: Part; x: number; y: number } | null>(null);

  const onEnter = (event: PointerEvent<HTMLSpanElement>, row: RangeRow, part: Part) => {
    const host = frame.current?.getBoundingClientRect();
    const rect = event.currentTarget.getBoundingClientRect();
    if (!host) return;
    setHover({ row, part, x: rect.left + rect.width / 2 - host.left, y: rect.top - host.top });
  };
  const onLeave = () => setHover(null);
  const detailOf = (row: RangeRow) =>
    [row.detail, row.count !== undefined ? `${formatCount(row.count, { locale })} intervals` : null].filter(Boolean).join(" · ");

  return (
    <div ref={frame} className={cn("@container relative min-w-0", className)}>
      <table className="w-full table-fixed border-separate border-spacing-0 text-sm" data-range-bars>
        <caption className="sr-only">{title}</caption>
        <colgroup>
          <col className="w-[30%] @max-[42rem]:w-auto" />
          <col className="@max-[42rem]:w-0" />
          <col className="w-[4.75rem]" />
          <col className="w-[4.75rem]" />
          <col className="w-[4.75rem]" />
        </colgroup>
        <thead>
          <tr className="h-7">
            <th scope="col" className="micro pr-3 text-left font-medium text-ink-low">
              Status
            </th>
            <th scope="col" className="relative px-2 font-normal @max-[42rem]:px-0">
              <span className="sr-only">Distribution</span>
              <Scale ticks={ticks} ceiling={ceiling} labels={labels} className={cn("inset-x-2", WIDE_ONLY)} />
            </th>
            {PARTS.map((part) => (
              <th key={part.key} scope="col" className="micro pl-2 text-right font-medium text-ink-low">
                {part.key === "median" ? (
                  "Median"
                ) : (
                  <>
                    <span aria-hidden>{part.key}</span>
                    <span className="sr-only">{part.label}</span>
                  </>
                )}
              </th>
            ))}
          </tr>
          <tr aria-hidden className={NARROW_ONLY} data-range-scale>
            <td colSpan={5} className="relative h-5 p-0">
              <Scale ticks={ticks} ceiling={ceiling} labels={labels} className="inset-x-0" />
            </td>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const detail = detailOf(row);
            return (
              <Fragment key={row.id}>
                <tr className="h-11 @max-[42rem]:h-auto">
                  <th scope="row" className={cn("border-t border-rule-weak pr-3 text-left align-middle font-normal", NAME_LINE)}>
                    <span className="block break-words text-ink">{row.label}</span>
                    {detail ? <span className="block break-words text-xs text-ink-low @max-[42rem]:sr-only">{detail}</span> : null}
                  </th>
                  <td className="relative border-t border-rule-weak px-2 align-middle @max-[42rem]:px-0">
                    <Track row={row} ticks={ticks} ceiling={ceiling} rule="-inset-y-3" onEnter={onEnter} onLeave={onLeave} className={WIDE_ONLY} />
                  </td>
                  {PARTS.map((part) => (
                    <td
                      key={part.key}
                      className={cn(
                        "mono border-t border-rule-weak pl-2 text-right align-middle",
                        NAME_LINE,
                        part.key === "median" ? "text-ink" : "text-ink-mid",
                      )}
                      data-figure
                    >
                      {read(row[part.key])}
                    </td>
                  ))}
                </tr>
                <tr aria-hidden className={NARROW_ONLY} data-range-bar={row.id}>
                  <td colSpan={5} className="px-0 pt-0 pb-3">
                    {detail ? <span className="block text-xs break-words text-ink-low">{detail}</span> : null}
                    <Track row={row} ticks={ticks} ceiling={ceiling} rule="-inset-y-1" onEnter={onEnter} onLeave={onLeave} className="mt-2" />
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>

      {hover ? (
        <FloatingTooltip anchor={frame} x={hover.x} y={hover.y}>
          <TooltipBody
            heading={hover.row.label}
            rows={PARTS.map((part) => ({
              id: part.key,
              value: read(hover.row[part.key]),
              name: part.label,
              colour: MEASURE_COLOURS[part.key],
              key: "block" as const,
            }))}
          />
        </FloatingTooltip>
      ) : null}
    </div>
  );
}
