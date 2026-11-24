"use client";

import { useRef } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  Tooltip,
  XAxis,
  YAxis,
  usePlotArea,
  useXAxisScale,
  useYAxisScale,
  type TooltipContentProps,
} from "recharts";

import { useFigureLocale } from "@/components/ui/use-figures";
import { formatCount, formatDate, MISSING } from "@/lib/format";

import type { ChartTableData } from "./chart-table";
import { TooltipBody } from "./chart-tooltip";
import { formatDayMonth, formatWeekOf } from "./dates";
import { seriesColour, STATUS_COLOURS } from "./palette";
import { niceScale, weekTicks, type AxisFormat } from "./scale";
import type { FigureFormat } from "./sparkline";
import { useElementWidth } from "./use-element-width";
import { useReducedMotion } from "./use-reduced-motion";

/** One row per week: the Monday that starts it, and a value per series (null where nothing was measured). */
export type TrendRow = { week: string } & Record<string, string | number | null>;

export interface TrendSeries {
  /** The field in each row that holds this series. */
  key: string;
  label: string;
  slot?: number;
}

export interface TrendThreshold {
  value: number;
  /** "Breach above 1.50×". */
  label: string;
  lines?: readonly [string, string];
  /** A rule's limit is drawn in its status colour, with its label; anything else in ink. */
  tone?: "neutral" | "warning" | "breach";
}

export interface TrendLineProps {
  /** Weekly rows, oldest first. Keep the array stable between renders. */
  data: readonly TrendRow[];
  series: readonly TrendSeries[];
  /** How a value reads in the tooltip and the end label. */
  format?: FigureFormat;
  axisFormat?: AxisFormat;
  threshold?: TrendThreshold;
  /** Start the value axis at zero (counts) or let it fit the data (a trend of a few hours). */
  zeroBased?: boolean;
  height?: number;
  /** The chart's accessible name (use the ChartFrame title). */
  title: string;
}

const LABEL_GAP = 14;
const RIGHT_FOR_LABELS = 104;
// The value axis sizes itself; this is enough to plan how many weeks can be named.
const Y_AXIS_ESTIMATE = 56;
const WEEK_LABEL_WIDTH = 72;

function valueOf(row: TrendRow | undefined, key: string): number | null {
  const value = row?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function valuesIn(rows: readonly TrendRow[], series: readonly TrendSeries[]): number[] {
  return rows.flatMap((row) => series.map((item) => valueOf(row, item.key))).filter((value): value is number => value !== null);
}

export function trendTable(
  data: readonly TrendRow[],
  series: readonly TrendSeries[],
  { format = formatCount, locale }: { format?: FigureFormat; locale?: string } = {},
): ChartTableData {
  return {
    columns: [{ header: "Week of" }, ...series.map((item) => ({ header: item.label, numeric: true }))],
    rows: data.map((row) => [
      formatDate(row.week, { locale, timeZone: "UTC" }),
      ...series.map((item) => {
        const value = valueOf(row, item.key);
        return value === null ? MISSING : format(value, { locale });
      }),
    ]),
  };
}

export function thresholdPlacement(
  data: readonly TrendRow[],
  series: readonly TrendSeries[],
  threshold: number,
): { end: "start" | "end"; above: boolean } {
  const head = valuesIn(data.slice(0, 3), series);
  const tail = valuesIn(data.slice(-3), series);
  const clearance = (values: number[]) =>
    values.length ? Math.min(...values.map((value) => Math.abs(value - threshold))) : Number.POSITIVE_INFINITY;
  const end = clearance(head) >= clearance(tail) ? "start" : "end";
  const near = end === "start" ? head : tail;
  const mean = near.length ? near.reduce((sum, value) => sum + value, 0) / near.length : threshold - 1;
  return { end, above: mean < threshold };
}

/** A point in the plot, in px. */
export interface PlotPoint {
  x: number;
  y: number;
}

export interface LabelSpot {
  end: "start" | "end";
  above: boolean;
}

/** The threshold label's size and its gaps, in px: 11 px text, set 6 px in from the plot's end, 7 px above or 14 below the rule's baseline. */
const THRESHOLD_FONT = 11;
/** A second line's baseline under the first. */
const THRESHOLD_LEADING = 13;
const THRESHOLD_INSET = 6;
/** Room kept clear around the label's text: its halo (4 px, half outside) and a little air. */
const THRESHOLD_CLEAR = 3;

/** About how wide the threshold's label is drawn: Inter's average advance at 11 px, a little over, so a near miss counts. */
export function thresholdLabelWidth(label: string): number {
  return label.length * THRESHOLD_FONT * 0.56;
}

/** Where the label's first line sits: above the rule its last line stands 7 px over it, below it the first 14 px under. */
export function thresholdBaseline(spot: LabelSpot, ruleY: number, rows: 1 | 2 = 1): number {
  return spot.above ? ruleY - 7 - (rows - 1) * THRESHOLD_LEADING : ruleY + 14;
}

/** The label's box at one spot, in one line or two: the text's own box with the clearance round it. */
export function thresholdLabelBox(
  spot: LabelSpot,
  plot: { x: number; y: number; width: number; height: number },
  ruleY: number,
  width: number,
  rows: 1 | 2 = 1,
): { left: number; right: number; top: number; bottom: number } {
  const left = spot.end === "start" ? plot.x + THRESHOLD_INSET : plot.x + plot.width - THRESHOLD_INSET - width;
  const first = thresholdBaseline(spot, ruleY, rows);
  return {
    left: left - THRESHOLD_CLEAR,
    right: left + width + THRESHOLD_CLEAR,
    top: first - THRESHOLD_FONT * 0.8 - THRESHOLD_CLEAR,
    bottom: first + (rows - 1) * THRESHOLD_LEADING + THRESHOLD_FONT * 0.25 + THRESHOLD_CLEAR,
  };
}

/** Whether the segment from a to b passes through the box (Liang–Barsky clipping). */
function crossesBox(a: PlotPoint, b: PlotPoint, box: { left: number; right: number; top: number; bottom: number }): boolean {
  let enter = 0;
  let leave = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  for (const [p, q] of [
    [-dx, a.x - box.left],
    [dx, box.right - a.x],
    [-dy, a.y - box.top],
    [dy, box.bottom - a.y],
  ]) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) enter = Math.max(enter, t);
    else leave = Math.min(leave, t);
    if (enter > leave) return false;
  }
  return true;
}

/** Whether a drawn line runs through the box, or one of its points lies in it. */
function touches(line: readonly PlotPoint[], box: { left: number; right: number; top: number; bottom: number }): boolean {
  return line.some(
    (point, i) =>
      (point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom) ||
      (i > 0 && crossesBox(line[i - 1], point, box)),
  );
}

export function clearLabelSpot(
  preferred: LabelSpot,
  lines: readonly (readonly PlotPoint[])[],
  plot: { x: number; y: number; width: number; height: number },
  ruleY: number,
  width: number,
  rows: 1 | 2 = 1,
): LabelSpot | null {
  const other = preferred.end === "start" ? "end" : "start";
  const spots: LabelSpot[] = [
    preferred,
    { end: preferred.end, above: !preferred.above },
    { end: other, above: preferred.above },
    { end: other, above: !preferred.above },
  ];
  for (const spot of spots) {
    const box = thresholdLabelBox(spot, plot, ruleY, width, rows);
    if (box.top < plot.y || box.bottom > plot.y + plot.height) continue;
    if (!lines.some((line) => touches(line, box))) return spot;
  }
  return null;
}

export function TrendLine({
  data,
  series,
  format = formatCount,
  axisFormat,
  threshold,
  zeroBased = true,
  height = 220,
  title,
}: TrendLineProps) {
  const locale = useFigureLocale();
  const reduced = useReducedMotion();
  const frame = useRef<HTMLDivElement>(null);
  const width = useElementWidth(frame);
  const read = (value: number) => format(value, { locale });
  const single = series.length === 1;
  const labelled = series.length <= 4;

  const values = valuesIn(data, series);
  const lo = Math.min(...values, threshold?.value ?? Number.POSITIVE_INFINITY);
  const hi = Math.max(...values, threshold?.value ?? Number.NEGATIVE_INFINITY);
  const scale = niceScale(lo, hi, { zero: zeroBased });
  const readAxis = (value: number) => (axisFormat ?? format)(value, { locale, step: scale.step });

  const plotWidth = Math.max(0, width - Y_AXIS_ESTIMATE - (labelled ? RIGHT_FOR_LABELS : 12));
  const ticks = weekTicks(data, Math.max(2, Math.floor(plotWidth / WEEK_LABEL_WIDTH)));
  const placement = threshold ? thresholdPlacement(data, series, threshold.value) : null;

  return (
    <div ref={frame} style={{ height }} className="w-full min-w-0">
      <LineChart
        responsive
        data={data as TrendRow[]}
        title={title}
        margin={{ top: 12, right: labelled ? RIGHT_FOR_LABELS : 12, bottom: 4, left: 0 }}
        style={{ width: "100%", height }}
      >
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeWidth={1} />
        <XAxis
          dataKey="week"
          ticks={ticks}
          interval={0}
          tickFormatter={(value: string) => formatDayMonth(value, locale)}
          tickLine={false}
          axisLine={{ stroke: "var(--chart-axis)" }}
          tickMargin={8}
          padding={{ left: 6, right: 6 }}
        />
        <YAxis
          width="auto"
          domain={[scale.min, scale.max]}
          ticks={scale.ticks}
          interval={0}
          allowDataOverflow
          tickFormatter={(value: number) => readAxis(value)}
          tickLine={false}
          axisLine={false}
          tickMargin={6}
        />
        {threshold && placement ? <ThresholdRule threshold={threshold} placement={placement} data={data} series={series} /> : null}
        <Tooltip
          cursor={{ stroke: "var(--chart-crosshair)", strokeWidth: 1 }}
          isAnimationActive={false}
          content={(props: TooltipContentProps) => (
            <TrendTooltip props={props} data={data} series={series} read={read} locale={locale} />
          )}
        />
        {series.map((item, index) => (
          <Line
            key={item.key}
            dataKey={item.key}
            name={item.label}
            type="linear"
            stroke={seriesColour(item.slot ?? index)}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--chart-surface)", fill: seriesColour(item.slot ?? index) }}
            connectNulls={false}
            isAnimationActive={!reduced}
            animationDuration={420}
            animationEasing="ease-out"
          />
        ))}
        {labelled ? <EndLabels data={data} series={series} read={read} single={single} /> : null}
      </LineChart>
    </div>
  );
}

function TrendTooltip({
  props,
  data,
  series,
  read,
  locale,
}: {
  props: TooltipContentProps;
  data: readonly TrendRow[];
  series: readonly TrendSeries[];
  read: (value: number) => string;
  locale: string | undefined;
}) {
  if (!props.active || props.label === undefined) return null;
  const week = String(props.label);
  const row = data.find((candidate) => candidate.week === week);
  return (
    <TooltipBody
      heading={formatWeekOf(week, locale)}
      rows={series.map((item, index) => {
        const value = valueOf(row, item.key);
        return {
          id: item.key,
          value: value === null ? MISSING : read(value),
          name: item.label,
          colour: seriesColour(item.slot ?? index),
          key: "line" as const,
        };
      })}
    />
  );
}

/** The last point of each series, marked and labelled; labels that would collide are spread and joined by a leader. */
function EndLabels({
  data,
  series,
  read,
  single,
}: {
  data: readonly TrendRow[];
  series: readonly TrendSeries[];
  read: (value: number) => string;
  single: boolean;
}) {
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();
  const plot = usePlotArea();
  if (!xScale || !yScale || !plot) return null;

  const ends = series
    .map((item, index) => {
      for (let i = data.length - 1; i >= 0; i -= 1) {
        const value = valueOf(data[i], item.key);
        if (value === null) continue;
        const x = xScale(data[i].week);
        const y = yScale(value);
        if (x === undefined || y === undefined) return null;
        return { item, colour: seriesColour(item.slot ?? index), x, y, labelY: y, value };
      }
      return null;
    })
    .filter((end): end is NonNullable<typeof end> => end !== null)
    .sort((a, b) => a.y - b.y);

  // Spread the labels downwards, then pull the stack back inside the plot.
  for (let i = 1; i < ends.length; i += 1) {
    ends[i].labelY = Math.max(ends[i].labelY, ends[i - 1].labelY + LABEL_GAP);
  }
  const overflow = (ends.at(-1)?.labelY ?? 0) - (plot.y + plot.height);
  if (overflow > 0) for (const end of ends) end.labelY -= overflow;

  return (
    <g aria-hidden className="pointer-events-none">
      {ends.map((end) => {
        const labelX = end.x + 10;
        const moved = Math.abs(end.labelY - end.y) > 3;
        return (
          <g key={end.item.key}>
            {moved ? (
              <path
                d={`M${end.x + 5} ${end.y}L${labelX - 2} ${end.labelY}`}
                stroke="var(--chart-crosshair)"
                strokeWidth={1}
                fill="none"
              />
            ) : null}
            <circle cx={end.x} cy={end.y} r={4} fill={end.colour} stroke="var(--chart-surface)" strokeWidth={2} />
            <text
              x={labelX}
              y={end.labelY}
              dominantBaseline="central"
              className={single ? "jo-chart-text" : undefined}
              style={single ? { fill: "var(--text-hi)", fontWeight: 500 } : { fill: "var(--text-mid)", fontSize: 11 }}
            >
              {single ? read(end.value) : end.item.label}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function ThresholdRule({
  threshold,
  placement: suggested,
  data,
  series,
}: {
  threshold: TrendThreshold;
  placement: LabelSpot;
  data: readonly TrendRow[];
  series: readonly TrendSeries[];
}) {
  const xScale = useXAxisScale();
  const yScale = useYAxisScale();
  const plot = usePlotArea();
  if (!xScale || !yScale || !plot) return null;
  const y = yScale(threshold.value);
  if (y === undefined) return null;
  // Each series as drawn: a run of measured weeks is a line, and a week with no value breaks it (connectNulls off).
  const lines = series.flatMap((item) => {
    const runs: PlotPoint[][] = [[]];
    for (const row of data) {
      const value = valueOf(row, item.key);
      const px = value === null ? undefined : xScale(row.week);
      const py = value === null ? undefined : yScale(value);
      if (px === undefined || py === undefined) {
        if (runs[runs.length - 1].length > 0) runs.push([]);
        continue;
      }
      runs[runs.length - 1].push({ x: px, y: py });
    }
    return runs.filter((run) => run.length > 0);
  });
  // On one line where it stands clear of the data; else in two (a phone's narrow plot), where they stand clear.
  const oneLine = clearLabelSpot(suggested, lines, plot, y, thresholdLabelWidth(threshold.label));
  const twoLines = oneLine === null ? threshold.lines : undefined;
  const placement =
    oneLine ?? (twoLines ? clearLabelSpot(suggested, lines, plot, y, Math.max(...twoLines.map(thresholdLabelWidth)), 2) : null) ?? suggested;
  const colour =
    threshold.tone === "breach"
      ? STATUS_COLOURS.breach
      : threshold.tone === "warning"
        ? STATUS_COLOURS.warning
        : "var(--text-mid)";
  const atStart = placement.end === "start";
  const textX = atStart ? plot.x + THRESHOLD_INSET : plot.x + plot.width - THRESHOLD_INSET;
  return (
    <g aria-hidden className="pointer-events-none">
      <line x1={plot.x} x2={plot.x + plot.width} y1={y} y2={y} stroke={colour} strokeWidth={1.25} strokeDasharray="5 4" />
      <text
        x={textX}
        y={thresholdBaseline(placement, y, twoLines ? 2 : 1)}
        textAnchor={atStart ? "start" : "end"}
        style={{ fill: "var(--text-mid)", fontSize: THRESHOLD_FONT }}
        paintOrder="stroke"
        stroke="var(--chart-surface)"
        strokeWidth={4}
        strokeLinejoin="round"
      >
        {twoLines
          ? twoLines.map((line, index) => (
              <tspan key={line} x={textX} dy={index === 0 ? 0 : THRESHOLD_LEADING}>
                {line}
              </tspan>
            ))
          : threshold.label}
      </text>
    </g>
  );
}
