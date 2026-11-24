"use client";

import { formatLocalDayMonth } from "@/components/charts/dates";
import { StatTile, StatTileGrid, type GoodDirection } from "@/components/ui/stat-tile";
import { useFigureLocale } from "@/components/ui/use-figures";
import type { Overview, WindowTotal } from "@/lib/api/schemas";

import { TILE_HREF } from "./links";

type TileKey = keyof typeof TILE_HREF;

interface TileSpec {
  key: TileKey;
  label: string;
  /** Every tile carries a mark, so the labels line up. */
  mark: "breach" | "warning" | "resolved" | "not-measurable" | "neutral";
  /** Fewer breaches is good; more resolved is good. */
  good: GoodDirection;
  /** The colour of the sparkline's latest point: the status the figure is about. */
  tone: "neutral" | "breach" | "warning" | "resolved";
  /** What following the tile shows, for screen readers. */
  hrefLabel: string;
}

const TILES: readonly TileSpec[] = [
  {
    key: "open_breaches",
    label: "Open breaches",
    mark: "breach",
    good: "down",
    tone: "breach",
    hrefLabel: "Open breaches",
  },
  {
    key: "open_warnings",
    label: "Open warnings",
    mark: "warning",
    good: "down",
    tone: "warning",
    hrefLabel: "Open warnings",
  },
  {
    key: "new_7d",
    label: "New this week",
    mark: "neutral",
    good: "down",
    tone: "neutral",
    hrefLabel: "Findings first seen in the last 7 days",
  },
  {
    key: "resolved_7d",
    label: "Resolved this week",
    mark: "resolved",
    good: "up",
    tone: "resolved",
    hrefLabel: "Resolved findings, newest first",
  },
];

/** Each point is a rolling 7-day window ending at its moment: "7 days to 4 Nov". Read on hover only. */
function windowLabels(total: WindowTotal, locale: string | undefined): string[] {
  return total.series.map((point) => `7 days to ${formatLocalDayMonth(Date.parse(point.end_at), locale)}`);
}

export function HeadlineTiles({ data }: { data?: Overview }) {
  const locale = useFigureLocale();

  if (!data) {
    return (
      <StatTileGrid label="Headline figures" columns={4} labelLines="auto">
        {TILES.map((tile) => (
          <StatTile key={tile.key} label={tile.label} mark={tile.mark} value={null} state="loading" trend={[0, 0]} />
        ))}
      </StatTileGrid>
    );
  }

  const since = data.tracking_since ? Date.parse(data.tracking_since) : null;

  return (
    <StatTileGrid label="Headline figures" columns={4} labelLines="auto">
      {TILES.map((tile) => {
        const total = data.totals[tile.key];
        const firstWeek = startedThisWeek(total, since) || (tile.key === "new_7d" && againstFirstWeek(total, since));
        return (
          <StatTile
            key={tile.key}
            label={tile.label}
            mark={tile.mark}
            value={total.current}
            delta={firstWeek ? undefined : total.current - total.previous}
            deltaLabel={firstWeek ? undefined : "vs last week"}
            goodDirection={tile.good}
            trend={firstWeek ? undefined : total.series.map((point) => point.value)}
            trendLabels={windowLabels(total, locale)}
            trendPeriod="last 12 weeks"
            trendTone={tile.tone}
            href={TILE_HREF[tile.key]}
            hrefLabel={tile.hrefLabel}
            footnote={firstWeek && since !== null ? `Tracked since ${formatLocalDayMonth(since, locale)}` : undefined}
          />
        );
      })}
    </StatTileGrid>
  );
}

export function startedThisWeek(total: WindowTotal, since: number | null): boolean {
  if (since === null || Number.isNaN(since) || total.series.length < 2) return false;
  return since > Date.parse(total.series[total.series.length - 2].end_at);
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function againstFirstWeek(total: WindowTotal, since: number | null): boolean {
  if (since === null || Number.isNaN(since) || total.series.length < 2) return false;
  return since > Date.parse(total.series[total.series.length - 2].end_at) - WEEK_MS;
}
