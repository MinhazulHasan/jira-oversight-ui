"use client";

import { useId, useRef, useState, type PointerEvent } from "react";

import { useFigureLocale } from "@/components/ui/use-figures";
import { formatCount } from "@/lib/format";
import { cn } from "@/lib/utils";

import { FloatingTooltip, TooltipBody } from "./chart-tooltip";
import { OTHER_COLOUR, STATUS_COLOURS, SERIES_COLOURS } from "./palette";

/** Any formatter from src/lib/format.ts fits: a value and the locale to read it in. */
export type FigureFormat = (value: number, options: { locale?: string }) => string;

export interface SparklineProps {
  /** One value per period, oldest first. null is a gap (nothing measured that week). */
  values: readonly (number | null)[];
  /** One label per value for the hover readout, e.g. "Week of 2 Nov". */
  labels?: readonly string[];
  /** What the line shows, for its accessible summary: "Open breaches". */
  label: string;
  /** The span it covers: "last 12 weeks". */
  period?: string;
  /** How a value reads; any formatter from src/lib/format.ts fits. */
  format?: FigureFormat;
  tone?: "neutral" | "breach" | "warning" | "resolved";
  /** Height in px; the width follows the container. */
  height?: number;
  /** A faint wash under the line. */
  area?: boolean;
  /** Show the hover readout. Off when the sparkline sits inside another control's tooltip. */
  interactive?: boolean;
  className?: string;
}

const PAD_Y = 4;

const TONE_COLOUR: Record<NonNullable<SparklineProps["tone"]>, string> = {
  neutral: SERIES_COLOURS[0],
  breach: STATUS_COLOURS.breach,
  warning: STATUS_COLOURS.warning,
  resolved: STATUS_COLOURS.resolved,
};

/** Where each value sits, in the sparkline's 100-wide coordinate space. */
export function sparklinePoints(
  values: readonly (number | null)[],
  height: number,
): ({ x: number; y: number } | null)[] {
  const present = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (present.length === 0) return values.map(() => null);
  const min = Math.min(...present);
  const max = Math.max(...present);
  const span = max - min;
  const step = values.length > 1 ? 100 / (values.length - 1) : 0;
  return values.map((value, index) => {
    if (value === null || !Number.isFinite(value)) return null;
    // A flat series sits in the middle rather than on the floor.
    const t = span === 0 ? 0.5 : (value - min) / span;
    return { x: values.length > 1 ? index * step : 50, y: PAD_Y + (1 - t) * (height - PAD_Y * 2) };
  });
}

/** A summary a screen reader can use instead of the picture. */
export function sparklineSummary(
  label: string,
  values: readonly (number | null)[],
  format: (value: number) => string,
  period?: string,
): string {
  const present = values.filter((value): value is number => value !== null && Number.isFinite(value));
  const head = period ? `${label}, ${period}` : label;
  if (present.length === 0) return `${head}: no values`;
  const first = present[0];
  const last = present[present.length - 1];
  const low = Math.min(...present);
  const high = Math.max(...present);
  if (present.length === 1) return `${head}: ${format(last)}`;
  return `${head}: from ${format(first)} to ${format(last)}, between ${format(low)} and ${format(high)}`;
}

function toPath(points: ({ x: number; y: number } | null)[]): string {
  let d = "";
  let drawing = false;
  for (const point of points) {
    if (!point) {
      drawing = false;
      continue;
    }
    d += `${drawing ? "L" : "M"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
    drawing = true;
  }
  return d;
}

export function Sparkline({
  values,
  labels,
  label,
  period,
  format = formatCount,
  tone = "neutral",
  height = 32,
  area = false,
  interactive = true,
  className,
}: SparklineProps) {
  const locale = useFigureLocale();
  const gradientId = `spark-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const frame = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ index: number; width: number } | null>(null);

  const read = (value: number) => format(value, { locale });
  const points = sparklinePoints(values, height);
  const path = toPath(points);
  const lastIndex = points.findLastIndex((point) => point !== null);
  const last = lastIndex >= 0 ? points[lastIndex] : null;
  const first = points.find((point) => point !== null) ?? null;
  const colour = TONE_COLOUR[tone];
  const summary = sparklineSummary(label, values, read, period);

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!interactive || values.length === 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const index = Math.round(ratio * (values.length - 1));
    if (points[index] && (hover?.index !== index || hover.width !== rect.width)) {
      setHover({ index, width: rect.width });
    }
  };

  const hovered = hover ? points[hover.index] : null;
  const hoveredValue = hover ? values[hover.index] : null;

  return (
    <div
      ref={frame}
      role="img"
      aria-label={summary}
      className={cn("relative w-full", className)}
      style={{ height }}
      onPointerMove={onPointerMove}
      onPointerLeave={() => setHover(null)}
    >
      <svg
        aria-hidden
        width="100%"
        height={height}
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        className="block overflow-visible"
      >
        {area && first && last ? (
          <>
            <defs>
              <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor={OTHER_COLOUR} style={{ stopOpacity: "var(--chart-area-opacity)" }} />
                <stop offset="1" stopColor={OTHER_COLOUR} stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={`${path}L${last.x} ${height}L${first.x} ${height}Z`} fill={`url(#${gradientId})`} stroke="none" />
          </>
        ) : null}
        <path
          d={path}
          fill="none"
          stroke={OTHER_COLOUR}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      {last && !hover ? <Dot x={last.x} y={last.y} colour={colour} /> : null}
      {hover && hovered ? <Dot x={hovered.x} y={hovered.y} colour={colour} /> : null}

      {hover && hovered && hoveredValue !== null && hoveredValue !== undefined ? (
        <FloatingTooltip anchor={frame} x={(hovered.x / 100) * hover.width} y={hovered.y}>
          <TooltipBody
            heading={labels?.[hover.index]}
            rows={[{ id: "value", value: read(hoveredValue), name: label, colour, key: "line" }]}
          />
        </FloatingTooltip>
      ) : null}
    </div>
  );
}

/** The latest (or hovered) point: 8 px, filled, with a ring of the surface so it lifts off the line. */
function Dot({ x, y, colour }: { x: number; y: number; colour: string }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
      style={{ left: `${x}%`, top: y, background: colour, boxShadow: "0 0 0 2px var(--chart-surface)" }}
    />
  );
}
