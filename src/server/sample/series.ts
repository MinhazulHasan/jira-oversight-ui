import type { Direction, TrendMetric, TrendPoint, ValueUnit, WindowTotal } from "@/lib/api/schemas";

import { NOT_MEASURABLE_RULES } from "./catalogue";
import { memo, type Dataset } from "./dataset";
import { openAt } from "./engine";
import { median, round4OrNull, share } from "./stats";
import { WEEK, isoDay, iso, mondayUtc } from "./time";
import { workItems, type Issue } from "./world";

/**
 * Effort can be compared with an estimate only when both exist. Estimated work
 * with nothing logged has an effort ratio of 0 in the metrics, but that is
 * missing data, not work done in no time, so medians leave it out.
 */
export function hasMeasuredEffort(issue: Issue): boolean {
  return issue.effortRatio !== null && issue.timeSpentS > 0;
}

/**
 * Weekly series and headline totals. Weeks start on Monday (UTC) and end with
 * the current week to date, as oversight_trend's do; "work finished in the
 * week" is every issue whose done_at falls in it, Epics included, as the
 * backend counts it.
 */

export const SERIES_WEEKS = 12;

export interface TrendDefinition {
  label: string;
  unit: ValueUnit;
  direction_good: Direction;
  note: string;
}

export const TREND_DEFINITIONS: Record<TrendMetric, TrendDefinition> = {
  median_cycle_time_h: {
    label: "Median cycle time",
    unit: "hours",
    direction_good: "down",
    note: "Median hours from the start of development to Done, over work finished in the week.",
  },
  median_effort_ratio: {
    label: "Median effort ratio",
    unit: "ratio",
    direction_good: "down",
    note: "Median logged time over estimate, over work finished in the week that has both an estimate and logged time.",
  },
  skipped_stage_share: {
    label: "Skipped a stage",
    unit: "share",
    direction_good: "down",
    note: "Share of work finished in the week that skipped a stage on the way, such as To Do straight to Done.",
  },
  reopen_rate: {
    label: "Reopen rate",
    unit: "share",
    direction_good: "down",
    note: "Share of work finished in the week that had been reopened after Done.",
  },
  open_breaches: {
    label: "Open breaches",
    unit: "count",
    direction_good: "down",
    note: "Breach findings open at the end of the week; for the current week, open now.",
  },
  open_warnings: {
    label: "Open warnings",
    unit: "count",
    direction_good: "down",
    note: "Warning findings open at the end of the week; for the current week, open now.",
  },
};

/** Mondays (UTC midnight), oldest first, ending with the current week. */
export function weekStarts(now: number, count: number): number[] {
  const current = mondayUtc(now);
  return Array.from({ length: count }, (_, index) => current - (count - 1 - index) * WEEK);
}

function trendValues(dataset: Dataset, metric: TrendMetric): (number | null)[] {
  const weeks = weekStarts(dataset.now, SERIES_WEEKS);
  const { findings } = dataset.engine;

  if (metric === "open_breaches" || metric === "open_warnings") {
    const severity = metric === "open_breaches" ? "breach" : "warning";
    const relevant = findings.filter((finding) => finding.rule.severity === severity);
    return weeks.map((start) => {
      const end = start + WEEK;
      return relevant.filter(
        (finding) => finding.firstSeenAt < end && (finding.resolvedAt === null || finding.resolvedAt >= end),
      ).length;
    });
  }

  return weeks.map((start) => {
    const end = start + WEEK;
    const finished = dataset.world.issues.filter(
      (issue) => issue.doneAt !== null && issue.doneAt >= start && issue.doneAt < end,
    );
    switch (metric) {
      case "median_cycle_time_h":
        return round4OrNull(median(finished.flatMap((issue) => (issue.cycleTimeH === null ? [] : [issue.cycleTimeH]))));
      case "median_effort_ratio":
        return round4OrNull(median(finished.flatMap((issue) => (hasMeasuredEffort(issue) ? [issue.effortRatio!] : []))));
      case "skipped_stage_share":
        return round4OrNull(share(finished.filter((issue) => issue.skips.length > 0).length, finished.length));
      case "reopen_rate":
        return round4OrNull(share(finished.filter((issue) => issue.reopenCount > 0).length, finished.length));
    }
  });
}

/** The last `count` weeks of a metric (at most 12), oldest first. */
export function trendPoints(dataset: Dataset, metric: TrendMetric, count: number = SERIES_WEEKS): TrendPoint[] {
  const points = memo(dataset, `trend:${metric}`, () => {
    const weeks = weekStarts(dataset.now, SERIES_WEEKS);
    const values = trendValues(dataset, metric);
    return weeks.map((start, index) => ({ t: isoDay(start), value: values[index] }));
  });
  return points.slice(points.length - Math.min(count, SERIES_WEEKS));
}

/* -------------------------------------------------------- headline totals -- */

/** True when `time` falls in the 7 days ending at `end` (both edges included, as the findings filter counts). */
export function inWeekEnding(time: number | null, end: number): boolean {
  return time !== null && time >= end - WEEK && time <= end;
}

/** Ends of the rolling 7-day windows, oldest first; the last is now. */
function windowEnds(now: number, count: number = SERIES_WEEKS): number[] {
  return Array.from({ length: count }, (_, index) => now - (count - 1 - index) * WEEK);
}

function windowTotal(ends: number[], measure: (end: number) => number): WindowTotal {
  const series = ends.map((end) => ({ end_at: iso(end), value: measure(end) }));
  return { current: series[series.length - 1].value, previous: series[series.length - 2].value, series };
}

export interface Totals {
  open_breaches: WindowTotal;
  open_warnings: WindowTotal;
  new_7d: WindowTotal;
  resolved_7d: WindowTotal;
  issues_in_scope: WindowTotal;
  rules_not_measurable: WindowTotal;
}

export function totals(dataset: Dataset): Totals {
  return memo(dataset, "totals", () => {
    const { findings } = dataset.engine;
    const ends = windowEnds(dataset.now);
    const openOf = (severity: "breach" | "warning") => (end: number) =>
      findings.filter((finding) => finding.rule.severity === severity && openAt(finding, end)).length;
    const work = workItems(dataset.world);
    return {
      open_breaches: windowTotal(ends, openOf("breach")),
      open_warnings: windowTotal(ends, openOf("warning")),
      new_7d: windowTotal(ends, (end) => findings.filter((finding) => inWeekEnding(finding.firstSeenAt, end)).length),
      resolved_7d: windowTotal(ends, (end) => findings.filter((finding) => inWeekEnding(finding.resolvedAt, end)).length),
      issues_in_scope: windowTotal(ends, (end) => work.filter((issue) => issue.createdAt <= end).length),
      rules_not_measurable: windowTotal(ends, () => NOT_MEASURABLE_RULES.length),
    };
  });
}
