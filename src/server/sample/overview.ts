import type { Overview, TrendCard, TrendMetric } from "@/lib/api/schemas";

import { coverage, hotSpots, openByRule, statusMix } from "./aggregates";
import { missingFor } from "./catalogue";
import { memo, meta, type Dataset } from "./dataset";
import { briefing } from "./insights";
import { SERIES_WEEKS, TREND_DEFINITIONS, totals, trendPoints, weekStarts } from "./series";
import { WEEK, isoDay } from "./time";

/** Open findings (breaches and warnings) in one epic at the end of each week, as the trend series count them. */
function epicSeries(dataset: Dataset, epicKey: string | null): Overview["hot_spots"][number]["series"] {
  const findings = dataset.engine.findings.filter((finding) => (finding.issue?.epicKey ?? null) === epicKey);
  return weekStarts(dataset.now, SERIES_WEEKS).map((start) => {
    const end = start + WEEK;
    return {
      t: isoDay(start),
      value: findings.filter((finding) => finding.firstSeenAt < end && (finding.resolvedAt === null || finding.resolvedAt >= end))
        .length,
    };
  });
}

function trendCard(dataset: Dataset, metric: TrendMetric): TrendCard {
  const points = trendPoints(dataset, metric);
  const { label, unit, direction_good } = TREND_DEFINITIONS[metric];
  return {
    metric,
    label,
    unit,
    current: points[points.length - 1].value,
    previous: points[points.length - 2].value,
    direction_good,
    points,
  };
}

export function overview(dataset: Dataset): Overview {
  return memo(dataset, "overview", () => {
    const open = openByRule(dataset);
    const { insights } = briefing(dataset);
    return {
      meta: meta(dataset),
      totals: totals(dataset),
      hot_spots: hotSpots(dataset)
        .slice(0, 5)
        .map((spot) => ({
          epic_key: spot.epicKey,
          epic_title: spot.epicTitle,
          open_breaches: spot.openBreaches,
          open_warnings: spot.openWarnings,
          issues: spot.issues,
          series: epicSeries(dataset, spot.epicKey),
        })),
      by_rule: dataset.rules.filter(({ enabled }) => enabled).map(({ def, catalogue }) => ({
        rule_id: def.id,
        title: def.title,
        severity: def.severity,
        kind: def.kind,
        open: open.get(def.id) ?? 0,
        measurable: missingFor(catalogue).length === 0,
        missing_evidence: missingFor(catalogue),
      })),
      coverage: {
        estimate: coverage(dataset, "estimate", "90d"),
        story_points: coverage(dataset, "story_points", "90d"),
        time_logged: coverage(dataset, "time_logged", "90d"),
        code_review: coverage(dataset, "code_review", "90d"),
        test_evidence: coverage(dataset, "test_evidence", "90d"),
      },
      trend_cards: {
        median_cycle_time_h: trendCard(dataset, "median_cycle_time_h"),
        median_effort_ratio: trendCard(dataset, "median_effort_ratio"),
        skipped_stage_share: trendCard(dataset, "skipped_stage_share"),
        reopen_rate: trendCard(dataset, "reopen_rate"),
      },
      status_mix: statusMix(dataset),
      latest_insight: {
        week_of: insights.week_of,
        generated_at: insights.generated_at,
        verified: insights.verified,
        sentences: insights.sentences.slice(0, 2),
      },
    };
  });
}
