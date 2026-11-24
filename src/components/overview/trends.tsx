"use client";

import { useMemo } from "react";

import { ChartFrame } from "@/components/charts/chart-frame";
import { TrendLine, trendTable, type TrendSeries, type TrendThreshold } from "@/components/charts/trend-line";
import { EmptyState } from "@/components/ui/empty-state";
import { Section } from "@/components/ui/section";
import { Skeleton } from "@/components/ui/skeleton";
import { Delta } from "@/components/ui/stat-tile";
import { useFigureLocale } from "@/components/ui/use-figures";
import type { Overview, TrendCard } from "@/lib/api/schemas";
import { formatCount, formatDate, formatRatio } from "@/lib/format";

import {
  EFFORT_RATIO_BREACH,
  TREND_DESCRIPTION,
  TREND_KEYS,
  trendRows,
  unitAxis,
  unitDeltaFormat,
  unitFormat,
  weekOnWeek,
  type TrendKey,
} from "./copy";

const CHART_HEIGHT = 168;

/** The service's own labels; used while the figures load. */
const TREND_TITLE: Record<TrendKey, string> = {
  median_cycle_time_h: "Median cycle time",
  median_effort_ratio: "Median effort ratio",
  skipped_stage_share: "Skipped a stage",
  reopen_rate: "Reopen rate",
};

const NO_SERIES: TrendSeries[] = [];

/** "Week of" a Monday, read in UTC so every reader sees the same date. */
function weekDate(isoDate: string, locale: string | undefined): string {
  return formatDate(isoDate, { locale, timeZone: "UTC" });
}

/** One or two sentences a screen reader can use in place of the line. */
export function trendSummary(card: TrendCard, locale: string | undefined, threshold?: number): string {
  const read = (value: number) => unitFormat(card.unit)(value, { locale });
  const weeks = (count: number) => `${formatCount(count, { locale })} ${count === 1 ? "week" : "weeks"}`;
  const measured = card.points.filter((point): point is { t: string; value: number } => point.value !== null);
  const last = card.points.at(-1);
  if (measured.length === 0 || !last) return `${card.label}: nothing was finished in these ${weeks(card.points.length)}.`;

  const values = measured.map((point) => point.value);
  const range = `Over ${weeks(card.points.length)} it ranged from ${read(Math.min(...values))} to ${read(Math.max(...values))}.`;
  let lead: string;
  if (card.current === null) {
    lead = `${card.label}: nothing was finished in the week of ${weekDate(last.t, locale)} so far.`;
  } else {
    const change = weekOnWeek(card.current, card.previous);
    const before =
      change === null || card.previous === null
        ? ""
        : change === 0
          ? ", the same as the week before"
          : `, ${change > 0 ? "up" : "down"} from ${read(card.previous)} the week before`;
    lead = `${card.label} was ${read(card.current)} in the week of ${weekDate(last.t, locale)} to date${before}.`;
  }
  if (threshold === undefined) return `${lead} ${range}`;
  const over = values.filter((value) => value >= threshold).length;
  return `${lead} ${range} The breach threshold is ${read(threshold)}; ${over === 0 ? "no week reached it" : `${weeks(over)} reached it`}.`;
}

function TrendChart({ metric, card }: { metric: TrendKey; card?: TrendCard }) {
  const locale = useFigureLocale();
  const rows = useMemo(() => (card ? trendRows(card) : []), [card]);
  const series = useMemo<TrendSeries[]>(() => (card ? [{ key: "value", label: card.label }] : NO_SERIES), [card]);
  const title = card?.label ?? TREND_TITLE[metric];
  const isRatio = metric === "median_effort_ratio";

  if (!card) {
    return (
      <ChartFrame
        title={title}
        description={
          <>
            <span className="block">{TREND_DESCRIPTION[metric]}</span>
            <Skeleton className="mt-1.5 h-3 w-28" />
          </>
        }
        summary={`Loading ${title.toLowerCase()}.`}
        state="loading"
        loadingShape="line"
        height={CHART_HEIGHT}
      >
        {null}
      </ChartFrame>
    );
  }

  const format = unitFormat(card.unit);
  const empty = card.points.every((point) => point.value === null);
  const threshold: TrendThreshold | undefined = isRatio
    ? {
        value: EFFORT_RATIO_BREACH,
        label: `Breach at ${formatRatio(EFFORT_RATIO_BREACH, { locale })} (R-EFF-01)`,
        // On a phone's narrow plot one line is crossed by the data wherever it stands; two lines are not.
        lines: [`Breach at ${formatRatio(EFFORT_RATIO_BREACH, { locale })}`, "(R-EFF-01)"],
        tone: "breach",
      }
    : undefined;

  return (
    <ChartFrame
      title={title}
      description={
        <>
          <span className="block">{TREND_DESCRIPTION[metric]}</span>
          <Delta
            delta={weekOnWeek(card.current, card.previous)}
            goodDirection={card.direction_good}
            label="vs last week"
            format={unitDeltaFormat(card.unit)}
            className="mt-1"
          />
        </>
      }
      summary={trendSummary(card, locale, threshold?.value)}
      table={empty ? undefined : trendTable(rows, series, { format, locale })}
      state={empty ? "empty" : "ready"}
      height={CHART_HEIGHT}
      emptyTitle="Nothing finished in these weeks"
    >
      <TrendLine
        title={title}
        data={rows}
        series={series}
        format={format}
        axisFormat={unitAxis(card.unit)}
        threshold={threshold}
        zeroBased={card.unit === "share" || card.unit === "count"}
        height={CHART_HEIGHT}
      />
    </ChartFrame>
  );
}

export function Trends({ data, className }: { data?: Overview; className?: string }) {
  // Nothing finished in twelve weeks (a board just synced, a small one): one line, not four empty charts (SQA).
  const none = data !== undefined && TREND_KEYS.every((metric) => data.trend_cards[metric].points.every((point) => point.value === null));
  return (
    <Section
      id="trends"
      title="Trends"
      description="Work finished each week, last 12 weeks."
      className={className}
    >
      {none ? (
        <EmptyState size="compact" title="Nothing finished in the last 12 weeks" />
      ) : (
        <div className="grid gap-x-12 gap-y-9 lg:grid-cols-2">
          {TREND_KEYS.map((metric) => (
            <TrendChart key={metric} metric={metric} card={data?.trend_cards[metric]} />
          ))}
        </div>
      )}
    </Section>
  );
}
