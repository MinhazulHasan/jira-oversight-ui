"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { useFigureLocale } from "@/components/ui/use-figures";
import { formatDateTime, formatHours } from "@/lib/format";
import { useHydrated } from "@/lib/use-hydrated";
import { cn } from "@/lib/utils";

import type { ChartTableData } from "./chart-table";
import { FloatingTooltip, TooltipBody, type TooltipRow } from "./chart-tooltip";
import { formatLocalClock, formatLocalDayMonth } from "./dates";
import { STAGE_LABELS, stageColour, type Stage } from "./palette";
import { useElementWidth } from "./use-element-width";

export interface TimelineLane {
  id: string;
  /** The lane's name, usually the stage: "Code review". */
  label: string;
  stage: Stage;
  /** A second line: the Jira statuses mapped to the stage. */
  detail?: string;
  /** False when the workflow has no status for this stage: the lane is hatched, "Not tracked in Jira". */
  measurable?: boolean;
}

export interface TimelineInterval {
  id: string;
  /** The lane (stage) it belongs to. */
  lane: string;
  /** The Jira status: "In Progress". */
  status: string;
  /** ISO 8601 instants. A null end means it is still in this status. */
  start: string;
  end: string | null;
  changelogId?: string;
}

export interface TimelineSkip {
  id: string;
  /** When the transition that skipped them happened. */
  at: string;
  /** The lane the issue left and the lane it landed in. */
  from: string;
  to: string;
  /** The lanes it went straight past. */
  skipped: readonly string[];
  fromStatus?: string;
  toStatus?: string;
  changelogId?: string;
}

export interface StatusTimelineProps {
  lanes: readonly TimelineLane[];
  intervals: readonly TimelineInterval[];
  skips?: readonly TimelineSkip[];
  /** The moment the open interval runs to, and where the now marker stands. */
  now: string | number;
  /** Names the figure for assistive technology: "DEMO-142, status timeline". */
  title: string;
  /** Start the axis earlier than the first interval. */
  start?: string;
  laneHeight?: number;
  labelWidth?: number;
  /** One line per lane label and thinner bars, for a drawer or a card. */
  compact?: boolean;
  /** The key to the skip marker, the hatch and the now line; on unless the page explains them. */
  legend?: boolean;
  className?: string;
}

const AXIS_H = 26;
const PAD_X = 10;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const TICK_STEPS = [6 * HOUR, 12 * HOUR, DAY, 2 * DAY, 7 * DAY, 14 * DAY, 30 * DAY];
// Plex Mono at 10.5 px is about 6.3 px a character; the "Now" label, tracked uppercase, about 26 px.
const TICK_CHAR_W = 6.3;
const NOW_LABEL_W = 28;

type Item =
  | { kind: "interval"; id: string; time: number; interval: TimelineInterval }
  | { kind: "skip"; id: string; time: number; skip: TimelineSkip };

function ms(value: string | number): number {
  return typeof value === "number" ? value : new Date(value).getTime();
}

/** Hours spent in an interval, to now while it is still open. */
export function intervalHours(interval: TimelineInterval, now: number): number {
  return Math.max(0, ((interval.end === null ? now : ms(interval.end)) - ms(interval.start)) / HOUR);
}

/** Ticks on local midnights, Mondays or month starts, as many as fit (computed in the viewer's zone). */
export function timelineTicks(from: number, to: number, maxTicks: number): { step: number; ticks: number[] } {
  const span = Math.max(1, to - from);
  const step = TICK_STEPS.find((candidate) => span / candidate <= Math.max(1, maxTicks)) ?? 30 * DAY;
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);
  if (step === 7 * DAY || step === 14 * DAY) cursor.setDate(cursor.getDate() - ((cursor.getDay() + 6) % 7));
  if (step === 30 * DAY) cursor.setDate(1);
  const ticks: number[] = [];
  for (let guard = 0; guard < 400 && cursor.getTime() <= to; guard += 1) {
    if (cursor.getTime() >= from) ticks.push(cursor.getTime());
    if (step < DAY) cursor.setHours(cursor.getHours() + step / HOUR);
    else if (step === 30 * DAY) cursor.setMonth(cursor.getMonth() + 1);
    else cursor.setDate(cursor.getDate() + step / DAY);
  }
  return { step, ticks };
}

/** A bar with independently rounded ends: an open interval has a square end at now. */
function barPath(x: number, y: number, w: number, h: number, left: number, right: number): string {
  const l = Math.min(left, w / 2, h / 2);
  const r = Math.min(right, w / 2, h / 2);
  return [
    `M${x + l} ${y}`,
    `H${x + w - r}`,
    r ? `A${r} ${r} 0 0 1 ${x + w} ${y + r}` : "",
    `V${y + h - r}`,
    r ? `A${r} ${r} 0 0 1 ${x + w - r} ${y + h}` : "",
    `H${x + l}`,
    l ? `A${l} ${l} 0 0 1 ${x} ${y + h - l}` : "",
    `V${y + l}`,
    l ? `A${l} ${l} 0 0 1 ${x + l} ${y}` : "",
    "Z",
  ].join("");
}

/** The figures behind a timeline, for its table view: one row per spell, in order. */
export function timelineTable(
  lanes: readonly TimelineLane[],
  intervals: readonly TimelineInterval[],
  now: string | number,
  locale?: string,
): ChartTableData {
  const laneById = new Map(lanes.map((lane) => [lane.id, lane]));
  const clock = ms(now);
  return {
    columns: [
      { header: "Status" },
      { header: "Stage" },
      { header: "Entered" },
      { header: "Left" },
      { header: "Hours", numeric: true },
    ],
    rows: [...intervals]
      .sort((a, b) => ms(a.start) - ms(b.start))
      .map((interval) => {
        const lane = laneById.get(interval.lane);
        return [
          interval.status,
          lane ? STAGE_LABELS[lane.stage] : interval.lane,
          formatDateTime(interval.start, { locale }),
          interval.end ? formatDateTime(interval.end, { locale }) : "Still here",
          formatHours(intervalHours(interval, clock), { locale }),
        ];
      }),
  };
}

export function StatusTimeline({
  lanes,
  intervals,
  skips = [],
  now,
  title,
  start,
  laneHeight = 32,
  labelWidth = 148,
  compact = false,
  legend = true,
  className,
}: StatusTimelineProps) {
  const locale = useFigureLocale();
  const hydrated = useHydrated();
  const patternId = `hatch-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const frame = useRef<HTMLDivElement>(null);
  const plot = useRef<HTMLDivElement>(null);
  const plotWidth = useElementWidth(plot);
  const [hovered, setHovered] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const markRefs = useRef(new Map<string, SVGGElement>());

  const barH = compact ? 10 : 14;
  const clock = ms(now);
  const laneIndex = useMemo(() => new Map(lanes.map((lane, index) => [lane.id, index])), [lanes]);
  const items = useMemo<Item[]>(
    () =>
      [
        ...intervals.map((interval) => ({ kind: "interval" as const, id: interval.id, time: ms(interval.start), interval })),
        ...skips.map((skip) => ({ kind: "skip" as const, id: skip.id, time: ms(skip.at), skip })),
      ].sort((a, b) => a.time - b.time),
    [intervals, skips],
  );

  const t0 = start ? ms(start) : Math.min(clock, ...intervals.map((interval) => ms(interval.start)));
  const latest = Math.max(clock, ...intervals.map((interval) => (interval.end ? ms(interval.end) : clock)));
  const t1 = latest + (latest - t0) * 0.02;
  const inner = Math.max(1, plotWidth - PAD_X * 2);
  const x = (time: number) => PAD_X + ((time - t0) / Math.max(1, t1 - t0)) * inner;
  const height = AXIS_H + lanes.length * laneHeight;
  const laneTop = (laneId: string) => AXIS_H + (laneIndex.get(laneId) ?? 0) * laneHeight;
  const ready = plotWidth > 0;
  // Ticks fall on the viewer's local midnights, so they wait for the viewer's clock.
  const { step, ticks } = ready && hydrated ? timelineTicks(t0, t1, Math.floor(inner / 84)) : { step: DAY, ticks: [] };

  const laneLabel = (laneId: string) => lanes[laneIndex.get(laneId) ?? 0]?.label ?? laneId;
  // "In Progress · Development", but just "Done" where the status is named after its stage.
  const statusAndStage = (interval: TimelineInterval, separator: (stage: string) => string) => {
    const lane = lanes[laneIndex.get(interval.lane) ?? 0];
    const stage = lane ? STAGE_LABELS[lane.stage] : interval.lane;
    return stage.toLowerCase() === interval.status.toLowerCase() ? interval.status : `${interval.status}${separator(stage)}`;
  };
  const hours = (interval: TimelineInterval) => formatHours(intervalHours(interval, clock), { locale });
  const when = (iso: string) => (hydrated ? formatDateTime(iso, { locale }) : "");

  const describe = (item: Item): string => {
    if (item.kind === "interval") {
      const { interval } = item;
      const span = hydrated
        ? `, from ${when(interval.start)} ${interval.end ? `to ${when(interval.end)}` : "until now"}`
        : "";
      return `${statusAndStage(interval, (stage) => ` (${stage})`)}: ${hours(interval)}${span}`;
    }
    const { skip } = item;
    const names = skip.skipped.map(laneLabel).join(", ");
    const at = hydrated ? ` at ${when(skip.at)}` : "";
    const move = skip.fromStatus && skip.toStatus ? `, ${skip.fromStatus} to ${skip.toStatus}` : "";
    return `Skipped ${names}${at}${move}`;
  };

  const tooltipFor = (item: Item): { heading: string; rows: TooltipRow[]; x: number; y: number } => {
    if (item.kind === "interval") {
      const { interval } = item;
      const lane = lanes[laneIndex.get(interval.lane) ?? 0];
      const x1 = x(ms(interval.start));
      const x2 = x(interval.end === null ? clock : ms(interval.end));
      return {
        heading: statusAndStage(interval, (stage) => ` · ${stage}`),
        rows: [
          {
            id: "hours",
            value: hours(interval),
            name: "in this status",
            colour: lane ? stageColour(lane.stage) : undefined,
            key: "block",
          },
          { id: "start", value: when(interval.start), name: "entered" },
          { id: "end", value: interval.end ? when(interval.end) : "still here", name: interval.end ? "left" : "" },
          ...(interval.changelogId ? [{ id: "log", value: interval.changelogId, name: "changelog" }] : []),
        ],
        x: labelWidth + (x1 + x2) / 2,
        y: laneTop(interval.lane) + (laneHeight - barH) / 2,
      };
    }
    const { skip } = item;
    const top = Math.min(...[skip.from, skip.to, ...skip.skipped].map(laneTop));
    return {
      heading: `Skipped ${skip.skipped.length === 1 ? "a stage" : `${skip.skipped.length} stages`}`,
      rows: [
        ...skip.skipped.map((laneId) => ({ id: laneId, value: laneLabel(laneId), name: "never entered" })),
        {
          id: "at",
          value: when(skip.at),
          name: skip.fromStatus && skip.toStatus ? `${skip.fromStatus} → ${skip.toStatus}` : "",
        },
        ...(skip.changelogId ? [{ id: "log", value: skip.changelogId, name: "changelog" }] : []),
      ],
      x: labelWidth + x(ms(skip.at)),
      y: top + laneHeight / 2 - 4,
    };
  };

  const focusItem = (index: number) => {
    const next = items[Math.max(0, Math.min(items.length - 1, index))];
    if (!next) return;
    setActive(items.indexOf(next));
    markRefs.current.get(next.id)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<SVGGElement>, index: number) => {
    const moves: Record<string, number> = {
      ArrowRight: index + 1,
      ArrowDown: index + 1,
      ArrowLeft: index - 1,
      ArrowUp: index - 1,
      Home: 0,
      End: items.length - 1,
    };
    if (event.key in moves) {
      event.preventDefault();
      focusItem(moves[event.key]);
    } else if (event.key === "Escape") {
      setFocused(null);
    }
  };

  const shown = items.find((item) => item.id === (hovered ?? focused));
  const tooltip = shown && hydrated ? tooltipFor(shown) : null;

  const tickLabel = (tick: number) => {
    const date = new Date(tick);
    if (step < DAY && (date.getHours() !== 0 || date.getMinutes() !== 0)) return formatLocalClock(date, locale);
    return formatLocalDayMonth(date, locale);
  };
  // A tick label never runs into the "Now" label or past the plot's right edge.
  const nowX = x(clock);
  const labelledTicks = ticks.filter((tick) => {
    const from = x(tick) + 3;
    const to = from + tickLabel(tick).length * TICK_CHAR_W;
    const clearOfNow = to < nowX - 4 - NOW_LABEL_W - 6 || from > nowX + 6;
    return clearOfNow && to <= plotWidth;
  });

  const hatchLanes = lanes.some((lane) => lane.measurable === false);

  return (
    <div ref={frame} className={cn("relative flex min-w-0 flex-col gap-3", className)}>
      <div className="grid" style={{ gridTemplateColumns: `${labelWidth}px minmax(0,1fr)` }}>
        <div aria-hidden className="flex flex-col">
          <div className="micro flex items-end pb-1.5 text-ink-low" style={{ height: AXIS_H }}>
            Stage
          </div>
          {lanes.map((lane) => {
            const measurable = lane.measurable !== false;
            const detail = measurable ? lane.detail : "Not tracked in Jira";
            return (
              <div
                key={lane.id}
                className="flex min-w-0 flex-col justify-center border-t border-rule-weak pr-3"
                style={{ height: laneHeight }}
              >
                <span className={cn("truncate text-xs leading-tight", measurable ? "text-ink" : "text-ink-low")}>
                  {lane.label}
                </span>
                {!compact && detail ? (
                  <span className="truncate text-[11px] leading-tight text-ink-low">{detail}</span>
                ) : null}
              </div>
            );
          })}
        </div>

        <div ref={plot} className="relative min-w-0" style={{ height }}>
          {ready ? (
            <svg width={plotWidth} height={height} role="group" aria-label={title} className="block overflow-visible">
              <defs>
                <pattern
                  id={patternId}
                  width="8"
                  height="8"
                  patternUnits="userSpaceOnUse"
                  patternTransform="rotate(45)"
                >
                  <rect width="8" height="8" fill="var(--hatch-a)" />
                  <rect width="4" height="8" fill="var(--hatch-b)" />
                </pattern>
              </defs>

              {lanes.map((lane, index) => (
                <g key={lane.id} aria-hidden>
                  <line
                    x1={0}
                    x2={plotWidth}
                    y1={AXIS_H + index * laneHeight}
                    y2={AXIS_H + index * laneHeight}
                    stroke="var(--chart-grid)"
                  />
                  {lane.measurable === false ? (
                    <rect
                      x={0}
                      y={AXIS_H + index * laneHeight + 4}
                      width={plotWidth}
                      height={laneHeight - 8}
                      rx={3}
                      fill={`url(#${patternId})`}
                      opacity={0.7}
                    />
                  ) : null}
                </g>
              ))}

              <g aria-hidden>
                {ticks.map((tick) => (
                  <line key={tick} x1={x(tick)} x2={x(tick)} y1={AXIS_H - 4} y2={height} stroke="var(--chart-grid)" />
                ))}
                {labelledTicks.map((tick) => (
                  <text key={tick} x={x(tick) + 3} y={AXIS_H - 9} className="jo-chart-text">
                    {tickLabel(tick)}
                  </text>
                ))}
              </g>

              <g aria-hidden>
                <line x1={nowX} x2={nowX} y1={AXIS_H - 14} y2={height} stroke="var(--chart-now)" strokeWidth={1.25} />
                <text x={nowX - 4} y={AXIS_H - 9} textAnchor="end" className="micro" style={{ fill: "var(--chart-now)" }}>
                  Now
                </text>
              </g>

              {items.map((item, index) => {
                const label = describe(item);
                const lit = (hovered ?? focused) === item.id;
                const common = {
                  ref: (element: SVGGElement | null) => {
                    if (element) markRefs.current.set(item.id, element);
                    else markRefs.current.delete(item.id);
                  },
                  tabIndex: index === active ? 0 : -1,
                  role: "img",
                  "aria-label": label,
                  className: "jo-mark-focus cursor-default",
                  onFocus: () => {
                    setActive(index);
                    setFocused(item.id);
                  },
                  onBlur: () => setFocused(null),
                  onPointerEnter: () => setHovered(item.id),
                  onPointerLeave: () => setHovered(null),
                  onKeyDown: (event: KeyboardEvent<SVGGElement>) => onKeyDown(event, index),
                };

                if (item.kind === "interval") {
                  const { interval } = item;
                  const lane = lanes[laneIndex.get(interval.lane) ?? 0];
                  const open = interval.end === null;
                  const endTime = open ? clock : ms(interval.end ?? interval.start);
                  // Two spells in one lane that touch are kept apart by 2 px of the surface.
                  const touchesNext = intervals.some(
                    (other) => other.id !== interval.id && other.lane === interval.lane && ms(other.start) === endTime,
                  );
                  const x1 = x(ms(interval.start));
                  const w = Math.max(3, x(endTime) - x1 - (touchesNext ? 2 : 0));
                  const y = laneTop(interval.lane) + (laneHeight - barH) / 2;
                  return (
                    // A data mark has no interactive ARIA role; it takes focus so its reading reaches the keyboard.
                    <g key={item.id} {...common}>
                      <rect x={x1 - 6} y={y - 8} width={w + 12} height={barH + 16} fill="transparent" />
                      <path
                        d={barPath(x1, y, w, barH, 3, open ? 0 : 3)}
                        fill={lane ? stageColour(lane.stage) : "var(--series-other)"}
                        className={cn("jo-segment", lit && "brightness-110")}
                      />
                      <rect
                        className="jo-mark-ring"
                        x={x1 - 2.5}
                        y={y - 2.5}
                        width={w + 5}
                        height={barH + 5}
                        rx={5}
                        fill="none"
                        stroke="transparent"
                      />
                    </g>
                  );
                }

                const { skip } = item;
                const sx = x(ms(skip.at));
                const centres = [skip.from, skip.to].map((laneId) => laneTop(laneId) + laneHeight / 2);
                const r = compact ? 4 : 4.5;
                return (
                  <g key={item.id} {...common}>
                    <rect
                      x={sx - 10}
                      y={Math.min(...centres) - 8}
                      width={20}
                      height={Math.abs(centres[1] - centres[0]) + 16}
                      fill="transparent"
                    />
                    <line
                      x1={sx}
                      x2={sx}
                      y1={Math.min(...centres)}
                      y2={Math.max(...centres)}
                      stroke="var(--text-low)"
                      strokeWidth={1.25}
                    />
                    {skip.skipped.map((laneId) => (
                      <circle
                        key={laneId}
                        cx={sx}
                        cy={laneTop(laneId) + laneHeight / 2}
                        r={r}
                        fill="var(--chart-surface)"
                        stroke={lit ? "var(--text-hi)" : "var(--text-mid)"}
                        strokeWidth={1.5}
                      />
                    ))}
                    <rect
                      className="jo-mark-ring"
                      x={sx - 8}
                      y={Math.min(...centres) - 7}
                      width={16}
                      height={Math.abs(centres[1] - centres[0]) + 14}
                      rx={8}
                      fill="none"
                      stroke="transparent"
                    />
                  </g>
                );
              })}
            </svg>
          ) : null}
        </div>
      </div>

      {legend ? (
        <ul aria-hidden className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink-mid" style={{ paddingLeft: labelWidth }}>
          <li className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-4 rounded-[2px] bg-[linear-gradient(90deg,var(--stage-backlog),var(--stage-done))]" />
            Stage, earlier to later
          </li>
          {skips.length > 0 ? (
            <li className="inline-flex items-center gap-1.5">
              <svg width="12" height="12" viewBox="0 0 12 12" className="shrink-0">
                <circle cx="6" cy="6" r="4" fill="var(--chart-surface)" stroke="var(--text-mid)" strokeWidth="1.5" />
              </svg>
              Skipped stage
            </li>
          ) : null}
          {hatchLanes ? (
            <li className="inline-flex items-center gap-1.5">
              <span className="hatch inline-block size-2.5 rounded-[2px] border border-hatch-edge" />
              Not tracked in Jira
            </li>
          ) : null}
          <li className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-px bg-ink-mid" />
            Now
          </li>
        </ul>
      ) : null}

      {tooltip ? (
        <FloatingTooltip anchor={frame} x={tooltip.x} y={tooltip.y}>
          <TooltipBody heading={tooltip.heading} rows={tooltip.rows} />
        </FloatingTooltip>
      ) : null}
    </div>
  );
}
