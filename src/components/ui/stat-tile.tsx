"use client";

import { ArrowDown, ArrowUp, ArrowUpRight, Minus } from "lucide-react";
import Link from "next/link";
import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";

import { Sparkline, type FigureFormat } from "@/components/charts/sparkline";
import { formatCount, formatDelta, MISSING } from "@/lib/format";
import { cn } from "@/lib/utils";

import { SeverityMark, type Severity } from "./badge";
import { Skeleton } from "./skeleton";
import { useFigureLocale } from "./use-figures";

/** Which way is good for this figure: fewer breaches is good, more resolved is good. */
export type GoodDirection = "up" | "down" | "neither";

const MINUS = "\u2212";

/**
 * A formatter for a change: the figure with + or a true minus ("+1.2 h",
 * "−3"). A change that rounds to nothing at this precision reads as
 * the plain zero, never "+0.0 h".
 */
export function signed(format: FigureFormat): FigureFormat {
  return (value, options) => {
    const magnitude = format(Math.abs(value), options);
    if (value === 0 || magnitude === format(0, options)) return format(0, options);
    return value > 0 ? `+${magnitude}` : `${MINUS}${magnitude}`;
  };
}

export type DeltaVerdict = "better" | "worse" | "neutral" | "flat" | "none";

/** Judge a change: better, worse, flat, neutral (no direction is good), or none (unknown). */
export function deltaVerdict(delta: number | null | undefined, good: GoodDirection): DeltaVerdict {
  if (delta === null || delta === undefined || !Number.isFinite(delta)) return "none";
  if (delta === 0) return "flat";
  if (good === "neither") return "neutral";
  return (delta > 0) === (good === "up") ? "better" : "worse";
}

const VERDICT_CLASS: Record<DeltaVerdict, string> = {
  better: "text-ok-ink",
  // Worsening is "on its way to being bad": the warning ink, not the breach one.
  worse: "text-warn-ink",
  neutral: "text-ink-mid",
  flat: "text-ink-low",
  none: "text-ink-low",
};

export interface DeltaProps {
  delta: number | null | undefined;
  goodDirection: GoodDirection;
  /** The comparison, e.g. "vs last week". */
  label?: string;
  /** How the change reads; formatDelta by default ("+3", "−2"). */
  format?: FigureFormat;
  className?: string;
}

/**
 * A change against the previous period. Never colour alone: an arrow, a
 * signed figure with a true minus, the comparison in words, and (for screen
 * readers) whether that is better or worse.
 */
export function Delta({ delta, goodDirection, label, format = formatDelta, className }: DeltaProps) {
  const locale = useFigureLocale();
  const known = typeof delta === "number" && Number.isFinite(delta);
  const figure = known ? format(delta, { locale }) : MISSING;
  // A change too small to show at this precision is no change, whatever its sign.
  const verdict = known && figure === format(0, { locale }) ? "flat" : deltaVerdict(delta, goodDirection);
  // With no figure to compare there is no direction to draw, only the dash.
  const Icon = verdict === "none" ? null : verdict === "flat" ? Minus : (delta ?? 0) > 0 ? ArrowUp : ArrowDown;
  const spoken =
    verdict === "better" ? "better" : verdict === "worse" ? "worse" : verdict === "flat" ? "no change" : null;

  return (
    <span className={cn("inline-flex items-center gap-1 text-xs whitespace-nowrap", VERDICT_CLASS[verdict], className)}>
      {Icon ? <Icon aria-hidden size={12} strokeWidth={2.25} className="shrink-0" /> : null}
      <span className="mono font-medium" data-figure>
        {figure}
      </span>
      {label ? <span className="text-ink-low">{label}</span> : null}
      {spoken ? <span className="sr-only">, {spoken}</span> : null}
    </span>
  );
}

/**
 * A formatted figure with its unit set back: "38.2 h" and "1.51×" keep the
 * number at full size and the unit smaller in the muted ink, so the eye lands
 * on the figure. A figure without a unit is left as it is.
 */
export function FigureText({ text }: { text: string }) {
  const spaced = /^(.+)\u00a0(\S+)$/.exec(text);
  const times = /^(.+)(\u00d7)$/.exec(text);
  const match = spaced ?? times;
  if (!match) return <>{text}</>;
  return (
    <>
      {match[1]}
      <span className={cn("text-[0.62em] font-normal tracking-normal text-ink-low", spaced && "ml-[0.3em]")}>
        {match[2]}
      </span>
    </>
  );
}

export interface StatTileProps {
  /** What is counted, in sentence case: "Open breaches". */
  label: string;
  /** The figure; null when there is none to show. */
  value: number | null;
  /** How the figure reads; formatCount by default. Pass formatHours, formatRatio, formatShare... */
  format?: FigureFormat;
  /** The status this figure is about, shown as its mark before the label. */
  mark?: Severity | "neutral";
  delta?: number | null;
  deltaFormat?: FigureFormat;
  /** "vs last week". */
  deltaLabel?: string;
  goodDirection?: GoodDirection;
  /** The last few periods, oldest first, drawn as a sparkline. */
  trend?: readonly (number | null)[];
  trendLabels?: readonly string[];
  /** The span the trend covers, for its accessible summary: "last 12 weeks". */
  trendPeriod?: string;
  trendTone?: "neutral" | "breach" | "warning" | "resolved";
  /** Makes the whole tile a link, e.g. to the filtered findings. */
  href?: string;
  /** What following the link shows, for screen readers: "Show these findings". */
  hrefLabel?: string;
  state?: "ready" | "loading" | "not-measurable";
  /** Why it cannot be measured: "Jira records no code review". */
  notMeasurableReason?: string;
  /** A short line at the foot, e.g. "of 291 resolved". */
  footnote?: ReactNode;
  className?: string;
}

/**
 * A headline figure: its label, the number in Plex Mono, the change since
 * last period with its direction judged, and optionally the recent trend.
 * With href the whole tile clicks through to the rows behind the number.
 */
export function StatTile({
  label,
  value,
  format = formatCount,
  mark,
  delta,
  deltaFormat,
  deltaLabel,
  goodDirection = "neither",
  trend,
  trendLabels,
  trendPeriod,
  trendTone = "neutral",
  href,
  hrefLabel,
  state = "ready",
  notMeasurableReason,
  footnote,
  className,
}: StatTileProps) {
  const locale = useFigureLocale();
  const interactive = Boolean(href) && state === "ready";

  const body = (
    <>
      {/* A long label takes a second line, in balanced lines, rather than being cut, at every width (JO-14: on a
          MacBook too, not only on a phone); a grid whose labels may wrap keeps two lines for each (StatTileGrid's
          labelLines), so its figures stay level. On a phone the label has the row to itself (the arrow shows only on
          hover, which a phone has none of), and the row takes up any height its neighbour's label adds. */}
      <span className="flex min-h-5 items-start gap-2 max-sm:grow">
        {mark ? (
          <span className="flex h-5 shrink-0 items-center">
            <SeverityMark severity={mark} size={9} />
          </span>
        ) : null}
        <span className="line-clamp-2 min-h-[calc(var(--tile-label-lines,1)*1lh)] text-sm text-balance text-ink-mid" data-tile-label>
          {label}
        </span>
        {interactive ? (
          <ArrowUpRight
            aria-hidden
            size={14}
            strokeWidth={1.75}
            className="my-[3px] ml-auto shrink-0 text-ink-low opacity-0 transition-opacity duration-[var(--dur-fast)] group-hover:opacity-100 group-focus-visible:opacity-100 max-sm:hidden @max-[10.5rem]:hidden"
          />
        ) : null}
      </span>

      {state === "loading" ? (
        <>
          <span className="flex items-end justify-between gap-3">
            <Skeleton className="h-8 w-16" />
            {trend ? <Skeleton className="h-7 w-2/5" /> : null}
          </span>
          <Skeleton className="h-3 w-28" />
          <span className="sr-only">Loading</span>
        </>
      ) : state === "not-measurable" ? (
        <>
          <span className="flex items-center gap-2.5">
            <span aria-hidden className="hatch h-7 w-9 rounded-xs border border-hatch-edge" />
            <span className="text-sm font-medium text-ink-mid">Not measurable</span>
          </span>
          <span className="text-xs text-ink-low">{notMeasurableReason ?? "Jira holds no evidence for this."}</span>
        </>
      ) : (
        <>
          <span className="flex items-end justify-between gap-3">
            <span className="mono text-hero leading-none font-medium tracking-[-0.02em] whitespace-nowrap text-ink" data-figure>
              {value === null ? MISSING : <FigureText text={format(value, { locale })} />}
            </span>
            {trend && trend.length > 1 ? (
              <Sparkline
                values={trend}
                labels={trendLabels}
                label={label}
                period={trendPeriod}
                format={format}
                tone={trendTone}
                height={30}
                className="mb-0.5 max-w-[46%]"
              />
            ) : null}
          </span>
          {delta !== undefined ? (
            <Delta delta={delta} goodDirection={goodDirection} label={deltaLabel} format={deltaFormat} />
          ) : null}
        </>
      )}

      {footnote ? <span className="text-xs text-ink-low">{footnote}</span> : null}
    </>
  );

  // A container, so a tile too narrow for its label and the hover arrow beside it (a fifth of a 1024 px page) gives the
  // arrow's room to the label: "Rules not measurable" read "measurab…" there (the JO-14 review). The tile's own hover
  // ground still says it opens.
  const tileClass = cn("@container flex min-w-0 flex-col gap-2.5 bg-sheet p-4 max-sm:p-3", className);

  if (interactive && href) {
    return (
      <Link
        href={href}
        className={cn(
          tileClass,
          // The sparkline's ring is drawn in the chart surface; it follows the hover ground.
          "group pressable outline-offset-[-2px] transition-colors duration-[var(--dur-fast)] hover:bg-rail hover:[--chart-surface:var(--paper-100)]",
        )}
      >
        {body}
        {hrefLabel ? <span className="sr-only">{hrefLabel}</span> : null}
      </Link>
    );
  }

  return (
    <div className={tileClass} aria-busy={state === "loading" || undefined}>
      {body}
    </div>
  );
}

/** How many lines a label's text takes, whatever height its box is held at. */
function linesOf(label: HTMLElement): number {
  const range = document.createRange();
  range.selectNodeContents(label);
  // A page without layout (a test's DOM) draws no lines to count: one.
  if (typeof range.getClientRects !== "function") return 1;
  const tops = new Set([...(range.getClientRects() ?? [])].filter((rect) => rect.height > 0).map((rect) => Math.round(rect.top)));
  return Math.max(1, tops.size);
}

/**
 * Keeps the figures in each row of a grid level: where one tile's label takes a second line, every label in that row
 * keeps two (the label's --tile-label-lines), and a row whose labels all fit keeps one, so no row carries a blank line
 * (the JO-14 review: two lines kept everywhere pushed the Overview's first screen down). Measured before the paint of
 * every render (tiles are drawn anew when their figures arrive) and again whenever the grid changes size; a change
 * made on a resize waits a frame, so the observer never loops.
 */
function useLevelLabels(grid: RefObject<HTMLElement | null>, active: boolean) {
  // No dependencies on purpose: the tiles inside may be new on any render.
  useLayoutEffect(() => {
    const element = grid.current;
    if (!active || !element || typeof ResizeObserver === "undefined") return;
    const level = () => {
      const rows = new Map<number, HTMLElement[]>();
      for (const label of element.querySelectorAll<HTMLElement>("[data-tile-label]")) {
        const top = Math.round(label.getBoundingClientRect().top);
        rows.set(top, [...(rows.get(top) ?? []), label]);
      }
      for (const labels of rows.values()) {
        const lines = labels.some((label) => linesOf(label) > 1) ? "2" : "1";
        for (const label of labels) if (label.style.getPropertyValue("--tile-label-lines") !== lines) label.style.setProperty("--tile-label-lines", lines);
      }
    };
    level();
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(level);
    });
    observer.observe(element);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  });
}

/**
 * Tiles in a row, divided by hairlines inside one rounded frame (not a row of
 * cards). Five tiles in two columns would leave a hole, so the last takes the
 * whole row on narrow screens.
 */
export function StatTileGrid({
  children,
  columns = 5,
  label,
  labelLines = 1,
  className,
}: {
  children: ReactNode;
  columns?: 2 | 3 | 4 | 5;
  /** Names the group for assistive technology: "Headline figures". */
  label?: string;
  /**
   * Lines kept for every tile's label: 2 where one may wrap at a width the page is read at (a tile a third of half
   * a MacBook's page), so the figures under the labels stay level whichever wraps; "auto" keeps two only in a row
   * where a label takes them, measured in the browser, so a row whose labels all fit has no blank line.
   */
  labelLines?: 1 | 2 | "auto";
  className?: string;
}) {
  const grid = useRef<HTMLElement>(null);
  useLevelLabels(grid, labelLines === "auto");
  const lg = { 2: "lg:grid-cols-2", 3: "lg:grid-cols-3", 4: "lg:grid-cols-4", 5: "lg:grid-cols-5" }[columns];
  return (
    <section
      ref={grid}
      aria-label={label}
      className={cn(
        "grid grid-cols-2 gap-px overflow-hidden rounded-md border border-rule-weak bg-rule-weak",
        columns % 2 === 1 && "[&>*:last-child]:col-span-2 lg:[&>*:last-child]:col-span-1",
        lg,
        labelLines === 2 && "[--tile-label-lines:2]",
        className,
      )}
    >
      {children}
    </section>
  );
}
