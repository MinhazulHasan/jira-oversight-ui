"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { FloatingTooltip, TooltipBody, type TooltipRow } from "@/components/charts/chart-tooltip";
import { formatLocalClock, formatLocalDayMonth } from "@/components/charts/dates";
import { STAGE_LABELS, stageColour } from "@/components/charts/palette";
import { timelineTicks } from "@/components/charts/status-timeline";
import { useElementWidth } from "@/components/charts/use-element-width";
import { useFigureLocale } from "@/components/ui/use-figures";
import { formatDateTime, formatHours } from "@/lib/format";
import { useHydrated } from "@/lib/use-hydrated";
import { cn } from "@/lib/utils";

import { ms } from "./model";
import { TimelineLegend } from "./timeline-legend";
import {
  spellHours,
  timelineSpan,
  type IssueEvent,
  type IssueLane,
  type IssueSkip,
  type IssueSpell,
} from "./timeline-model";
import { barPath, CUT_GAP, diamondPath, PAD_X, timelineScale } from "./timeline-scale";

/*
 * The issue's swimlane: the kit's StatusTimeline (same lanes, bars, skip
 * stops, hatch, now line, readouts and keyboard walk) extended for one
 * issue's whole life. A quiet stretch after the last change is cut out of the
 * axis (see timeline-scale.ts), and estimate changes stand as diamonds on the
 * Estimate lane, so "points set five days into development" is visible.
 */

export interface IssueTimelineChartProps {
  lanes: readonly IssueLane[];
  spells: readonly IssueSpell[];
  skips?: readonly IssueSkip[];
  events?: readonly IssueEvent[];
  /** The data's now (the last sync): where an open spell runs to and the now line stands. */
  now: string;
  /** Names the figure for assistive technology: "DEMO-1, status timeline". */
  title: string;
  laneHeight?: number;
  labelWidth?: number;
  /** One line per lane label and thinner bars, for a narrow screen. */
  compact?: boolean;
  /**
   * Finished work: cut a long quiet stretch after the last change out of the
   * axis. Never for open work, whose long spell is the evidence.
   */
  cutQuietTail?: boolean;
  className?: string;
}

const AXIS_H = 26;
const DAY = 86_400_000;
const TICK_CHAR_W = 6.3;
const NOW_LABEL_W = 28;

type Item =
  | { kind: "spell"; id: string; time: number; spell: IssueSpell }
  | { kind: "skip"; id: string; time: number; skip: IssueSkip }
  | { kind: "event"; id: string; time: number; event: IssueEvent };

function laneColour(lane: IssueLane | undefined): string {
  return lane?.stage ? stageColour(lane.stage) : "var(--series-other)";
}

export function IssueTimelineChart({
  lanes,
  spells,
  skips = [],
  events = [],
  now,
  title,
  laneHeight = 32,
  labelWidth = 148,
  compact = false,
  cutQuietTail = false,
  className,
}: IssueTimelineChartProps) {
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
        ...spells.map((spell) => ({ kind: "spell" as const, id: spell.id, time: ms(spell.start), spell })),
        ...skips.map((skip) => ({ kind: "skip" as const, id: skip.id, time: ms(skip.at), skip })),
        ...events.map((event) => ({ kind: "event" as const, id: event.id, time: ms(event.at), event })),
      ].sort((a, b) => a.time - b.time),
    [spells, skips, events],
  );

  const scale = useMemo(
    () => timelineScale({ ...timelineSpan({ spells, skips, events }, clock), clock, width: plotWidth, allowCut: cutQuietTail }),
    [spells, skips, events, clock, plotWidth, cutQuietTail],
  );
  const { x } = scale;

  const height = AXIS_H + lanes.length * laneHeight;
  const laneTop = (laneId: string) => AXIS_H + (laneIndex.get(laneId) ?? 0) * laneHeight;
  const laneOf = (laneId: string) => lanes[laneIndex.get(laneId) ?? -1];
  const ready = plotWidth > 0;
  const mainWidth = scale.mainEnd - PAD_X;
  // Ticks fall on the viewer's local midnights, so they wait for the viewer's clock.
  const { step, ticks } =
    ready && hydrated
      ? timelineTicks(scale.t0, scale.cutAt ?? scale.t1, Math.floor(mainWidth / 84))
      : { step: DAY, ticks: [] as number[] };

  const laneLabel = (laneId: string) => laneOf(laneId)?.label ?? laneId;
  // "In Progress · Development", but just "Done" where the status is named after its stage.
  const statusAndStage = (spell: IssueSpell, separator: (stage: string) => string) => {
    const lane = laneOf(spell.lane);
    const stage = lane?.stage ? STAGE_LABELS[lane.stage] : (lane?.label ?? spell.lane);
    return stage.toLowerCase() === spell.status.toLowerCase() ? spell.status : `${spell.status}${separator(stage)}`;
  };
  const hours = (spell: IssueSpell) => formatHours(spellHours(spell, clock), { locale });
  const when = (iso: string) => (hydrated ? formatDateTime(iso, { locale }) : "");

  const describe = (item: Item): string => {
    if (item.kind === "spell") {
      const { spell } = item;
      const span = hydrated ? `, from ${when(spell.start)} ${spell.end ? `to ${when(spell.end)}` : "until now"}` : "";
      return `${statusAndStage(spell, (stage) => ` (${stage})`)}: ${hours(spell)}${span}`;
    }
    if (item.kind === "event") {
      const { event } = item;
      return `${event.label}: ${event.value}${hydrated ? `, at ${when(event.at)}` : ""}`;
    }
    const { skip } = item;
    const names = skip.skipped.map(laneLabel).join(", ");
    return `Skipped ${names}${hydrated ? ` at ${when(skip.at)}` : ""}, ${skip.fromStatus} to ${skip.toStatus}`;
  };

  const tooltipFor = (item: Item): { heading: string; rows: TooltipRow[]; x: number; y: number } => {
    const log = (id: string | undefined) => (id ? [{ id: "log", value: id, name: "changelog" }] : []);
    if (item.kind === "spell") {
      const { spell } = item;
      const x1 = x(ms(spell.start));
      const x2 = x(spell.end === null ? clock : ms(spell.end));
      return {
        heading: statusAndStage(spell, (stage) => ` · ${stage}`),
        rows: [
          { id: "hours", value: hours(spell), name: "in this status", colour: laneColour(laneOf(spell.lane)), key: "block" },
          { id: "start", value: when(spell.start), name: "entered" },
          { id: "end", value: spell.end ? when(spell.end) : "still here", name: spell.end ? "left" : "" },
          ...log(spell.changelogId),
        ],
        x: labelWidth + (x1 + x2) / 2,
        y: laneTop(spell.lane) + (laneHeight - barH) / 2,
      };
    }
    if (item.kind === "event") {
      const { event } = item;
      return {
        heading: event.label,
        rows: [
          { id: "value", value: event.value, name: "" },
          { id: "at", value: when(event.at), name: "in Jira" },
          ...log(event.changelogId),
        ],
        x: labelWidth + x(ms(event.at)),
        y: laneTop(event.lane) + laneHeight / 2 - 6,
      };
    }
    const { skip } = item;
    const top = Math.min(...[skip.from, skip.to, ...skip.skipped].map(laneTop));
    return {
      heading: `Skipped ${skip.skipped.length === 1 ? "a stage" : `${skip.skipped.length} stages`}`,
      rows: [
        ...skip.skipped.map((laneId) => ({ id: laneId, value: laneLabel(laneId), name: "never entered" })),
        { id: "at", value: when(skip.at), name: `${skip.fromStatus} → ${skip.toStatus}` },
        ...log(skip.changelogId),
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
  // A tick label never runs into the "Now" label, the cut, or past the plot's right edge.
  const nowX = x(clock);
  const labelEdge = scale.cutAt === null ? plotWidth : scale.mainEnd - 4;
  const labelledTicks = ticks.filter((tick) => {
    const from = x(tick) + 3;
    const to = from + tickLabel(tick).length * TICK_CHAR_W;
    const clearOfNow = to < nowX - 4 - NOW_LABEL_W - 6 || from > nowX + 6;
    return clearOfNow && to <= labelEdge;
  });
  const hatchLanes = lanes.some((lane) => lane.measurable === false);

  const markProps = (item: Item, index: number) => ({
    ref: (element: SVGGElement | null) => {
      if (element) markRefs.current.set(item.id, element);
      else markRefs.current.delete(item.id);
    },
    tabIndex: index === active ? 0 : -1,
    role: "img",
    "aria-label": describe(item),
    className: "jo-mark-focus cursor-default",
    onFocus: () => {
      setActive(index);
      setFocused(item.id);
    },
    onBlur: () => setFocused(null),
    onPointerEnter: () => setHovered(item.id),
    onPointerLeave: () => setHovered(null),
    onKeyDown: (event: KeyboardEvent<SVGGElement>) => onKeyDown(event, index),
  });

  const renderMark = (item: Item, index: number) => {
    const lit = (hovered ?? focused) === item.id;
    if (item.kind === "spell") {
      const { spell } = item;
      const open = spell.end === null;
      const endTime = open ? clock : ms(spell.end ?? spell.start);
      // Two spells in one lane that touch are kept apart by 2 px of the surface.
      const touchesNext = spells.some((other) => other.id !== spell.id && other.lane === spell.lane && ms(other.start) === endTime);
      const x1 = x(ms(spell.start));
      const w = Math.max(3, x(endTime) - x1 - (touchesNext ? 2 : 0));
      const y = laneTop(spell.lane) + (laneHeight - barH) / 2;
      return (
        // A data mark has no interactive ARIA role; it takes focus so its reading reaches the keyboard.
        <g key={item.id} {...markProps(item, index)}>
          <rect x={x1 - 6} y={y - 8} width={w + 12} height={barH + 16} fill="transparent" />
          <path
            d={barPath(x1, y, w, barH, 3, open ? 0 : 3)}
            fill={laneColour(laneOf(spell.lane))}
            className={cn("jo-segment", lit && "brightness-110")}
          />
          <rect className="jo-mark-ring" x={x1 - 2.5} y={y - 2.5} width={w + 5} height={barH + 5} rx={5} fill="none" stroke="transparent" />
        </g>
      );
    }
    if (item.kind === "event") {
      const { event } = item;
      const cx = x(ms(event.at));
      const cy = laneTop(event.lane) + laneHeight / 2;
      const r = compact ? 4.5 : 5.5;
      return (
        <g key={item.id} {...markProps(item, index)}>
          <rect x={cx - 10} y={cy - 10} width={20} height={20} fill="transparent" />
          <path d={diamondPath(cx, cy, r)} fill={lit ? "var(--text-hi)" : "var(--text-mid)"} stroke="var(--chart-surface)" strokeWidth={1.5} />
          <rect className="jo-mark-ring" x={cx - r - 3} y={cy - r - 3} width={2 * r + 6} height={2 * r + 6} rx={4} fill="none" stroke="transparent" />
        </g>
      );
    }
    const { skip } = item;
    const sx = x(ms(skip.at));
    const centres = [skip.from, skip.to].map((laneId) => laneTop(laneId) + laneHeight / 2);
    const r = compact ? 4 : 4.5;
    return (
      <g key={item.id} {...markProps(item, index)}>
        <rect x={sx - 10} y={Math.min(...centres) - 8} width={20} height={Math.abs(centres[1] - centres[0]) + 16} fill="transparent" />
        <line x1={sx} x2={sx} y1={Math.min(...centres)} y2={Math.max(...centres)} stroke="var(--text-low)" strokeWidth={1.25} />
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
  };

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
              <div key={lane.id} className="flex min-w-0 flex-col justify-center border-t border-rule-weak pr-3" style={{ height: laneHeight }}>
                <span className={cn("truncate text-xs leading-tight", measurable ? "text-ink" : "text-ink-low")}>{lane.label}</span>
                {!compact && detail ? <span className="truncate text-[11px] leading-tight text-ink-low">{detail}</span> : null}
              </div>
            );
          })}
        </div>

        <div ref={plot} className="relative min-w-0" style={{ height }}>
          {ready ? (
            <svg width={plotWidth} height={height} role="group" aria-label={title} className="block overflow-visible">
              <defs>
                <pattern id={patternId} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width="8" height="8" fill="var(--hatch-a)" />
                  <rect width="4" height="8" fill="var(--hatch-b)" />
                </pattern>
              </defs>

              {lanes.map((lane, index) => (
                <g key={lane.id} aria-hidden>
                  <line x1={0} x2={plotWidth} y1={AXIS_H + index * laneHeight} y2={AXIS_H + index * laneHeight} stroke="var(--chart-grid)" />
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

              {items.map(renderMark)}

              {scale.cutAt !== null ? (
                // The cut: the surface shows through every lane, and a double slash marks it on the axis.
                <g aria-hidden pointerEvents="none" data-axis-cut>
                  <rect x={scale.mainEnd} y={AXIS_H - 16} width={CUT_GAP} height={height - AXIS_H + 16} fill="var(--chart-surface)" />
                  {[2.5, CUT_GAP - 5.5].map((offset) => (
                    <line
                      key={offset}
                      x1={scale.mainEnd + offset}
                      x2={scale.mainEnd + offset + 3}
                      y1={AXIS_H - 4}
                      y2={AXIS_H - 15}
                      stroke="var(--text-low)"
                      strokeWidth={1.25}
                    />
                  ))}
                </g>
              ) : null}

              <g aria-hidden>
                <line x1={nowX} x2={nowX} y1={AXIS_H - 14} y2={height} stroke="var(--chart-now)" strokeWidth={1.25} />
                <text x={nowX - 4} y={AXIS_H - 9} textAnchor="end" className="micro" style={{ fill: "var(--chart-now)" }}>
                  Now
                </text>
              </g>
            </svg>
          ) : null}
        </div>
      </div>

      <TimelineLegend
        style={{ paddingLeft: labelWidth }}
        skips={skips.length > 0}
        events={events.length > 0}
        hatch={hatchLanes}
        cut={scale.cutAt !== null}
      />

      {tooltip ? (
        <FloatingTooltip anchor={frame} x={tooltip.x} y={tooltip.y}>
          <TooltipBody heading={tooltip.heading} rows={tooltip.rows} />
        </FloatingTooltip>
      ) : null}
    </div>
  );
}
