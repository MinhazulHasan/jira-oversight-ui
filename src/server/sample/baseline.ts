import { createHash } from "node:crypto";

import type { Baseline } from "@/lib/api/schemas";

import {
  REPORT_TIMEZONE,
  EVIDENCE_SOURCES,
  HOURS_PER_POINT,
  PROCESS_STAGES,
  PROCESS_VERSION,
  STATUS,
  type StatusName,
} from "./catalogue";
import { memo, meta, type Dataset } from "./dataset";
import { median, percentile, round4, round4OrNull, share } from "./stats";
import { HOUR, SECOND, addDays, iso, zonedDay, zonedIso, zonedMidnight } from "./time";
import type { Issue } from "./world";

/** The Phase 2 ground-truth report, computed over the sample project the way */

const WINDOW_DAYS = 90;
/** Hours per point within this fraction of the configured 8 count as near it (both edges included). */
const NEAR = 0.25;
const EDGE = 1e-9;

type Figures = Baseline["figures"];

function countShare(part: number, whole: number) {
  return { count: part, share: round4OrNull(share(part, whole)) };
}

function spread(values: number[]) {
  return {
    n: values.length,
    median: round4OrNull(median(values)),
    p75: round4OrNull(percentile(values, 75)),
    p90: round4OrNull(percentile(values, 90)),
  };
}

/** Counts by value, the largest first, ties by name (baseline.py's _counts). */
function counts(values: readonly string[]): Record<string, number> {
  const tally = new Map<string, number>();
  for (const value of values) tally.set(value || "(none)", (tally.get(value || "(none)") ?? 0) + 1);
  return Object.fromEntries([...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
}

const STAGE_RANK = new Map(PROCESS_STAGES.map((stage, index) => [stage.stage, index]));

function figures(dataset: Dataset, start: number, end: number): Figures {
  const { world } = dataset;
  const within = (time: number | null) => time !== null && time >= start && time < end;
  const resolved = world.issues.filter((issue) => within(issue.resolvedAt));
  const whole = resolved.length;
  const counted = (test: (issue: Issue) => boolean) => countShare(resolved.filter(test).length, whole);

  const hoursPerPoint = resolved
    .filter((issue) => issue.timeSpentS > 0 && (issue.storyPoints ?? 0) > 0)
    .map((issue) => issue.timeSpentS / 3600 / issue.storyPoints!);
  const near = hoursPerPoint.filter((ratio) => Math.abs(ratio / HOURS_PER_POINT - 1) <= NEAR + EDGE).length;
  const timed = resolved.filter((issue) => issue.estimateSetAt !== null && issue.startedAt !== null);
  const late = timed.filter((issue) => issue.estimateSetAt! > issue.startedAt!).length;

  const intervalHours = new Map<StatusName, number[]>();
  for (const issue of world.issues) {
    for (const interval of issue.intervals) {
      if (!within(interval.leftAt)) continue;
      const list = intervalHours.get(interval.status) ?? [];
      list.push(Math.max(0, (interval.leftAt! - interval.enteredAt) / HOUR));
      intervalHours.set(interval.status, list);
    }
  }
  const timeInStatus = Object.fromEntries(
    [...intervalHours.keys()]
      .sort((a, b) => STAGE_RANK.get(STATUS[a].stage)! - STAGE_RANK.get(STATUS[b].stage)! || a.localeCompare(b))
      .map((status) => [status, { stage: STATUS[status].stage, ...spread(intervalHours.get(status)!) }]),
  );

  const worklogs = resolved.flatMap((issue) => issue.worklogs);
  const seconds = worklogs.reduce((sum, log) => sum + log.seconds, 0);
  // One time-tracking app account writes every worklog: its share, never its id.
  const appShare = worklogs.length > 0 ? { seconds: 1, count: 1 } : { seconds: null, count: null };
  const links = world.issues.flatMap((issue) => issue.links);

  return {
    snapshot: {
      last_synced_at: iso(world.syncAt),
      total_issues: world.issues.length,
      created_before_window_end: world.issues.filter((issue) => issue.createdAt < end).length,
      by_type: counts(world.issues.map((issue) => issue.type)),
      by_status: counts(world.issues.map((issue) => issue.status)),
      by_status_category: counts(world.issues.map((issue) => STATUS[issue.status].category)),
    },
    resolved: {
      in_window: whole,
      with_original_estimate: countShare(0, whole),
      with_story_points: counted((issue) => (issue.storyPoints ?? 0) > 0),
      with_logged_time: {
        timespent: counted((issue) => issue.timeSpentS > 0),
        aggregate: counted((issue) => issue.aggregateTimeSpentS > 0),
        worklog_rows: counted((issue) => issue.worklogs.length > 0),
      },
      straight_todo_to_done: {
        ...counted((issue) => issue.statusChanges.some((change) => change.from === "To Do" && change.to === "Done")),
        from_statuses: ["To Do"],
        to_statuses: ["Done"],
      },
      created_in_done: counted((issue) => issue.statusChanges.length === 0 && issue.status === "Done"),
      done_entered_in_window: world.issues.filter((issue) => within(issue.doneAt)).length,
    },
    estimates: {
      hours_per_point: {
        n: hoursPerPoint.length,
        median: round4OrNull(median(hoursPerPoint)),
        p25: round4OrNull(percentile(hoursPerPoint, 25)),
        p75: round4OrNull(percentile(hoursPerPoint, 75)),
      },
      within_25pct: { hours_per_point: HOURS_PER_POINT, ...countShare(near, hoursPerPoint.length) },
      estimate_set_after_start: { count: late, of: timed.length, share: round4OrNull(share(late, timed.length)) },
    },
    time_in_status: timeInStatus,
    cycle_time: spread(resolved.flatMap((issue) => (issue.cycleTimeH === null ? [] : [issue.cycleTimeH]))),
    reopens: counted((issue) => issue.reopenCount > 0),
    worklogs: {
      count: worklogs.length,
      total_hours: round4(seconds / 3600),
      authors: worklogs.length > 0 ? 1 : 0,
      top_author_share: appShare,
      tempo_share: appShare,
    },
    evidence: { not_measurable: [...EVIDENCE_SOURCES], configured: [] },
    issue_links: {
      issues_with_issue_links: world.issues.filter((issue) => issue.links.length > 0).length,
      issue_links: links.length,
      issue_links_by_title: counts(links),
      // No pull request or other remote link is recorded: why code review cannot be measured.
      remote_links: 0,
      remote_links_by_host: {},
    },
  };
}

/** "4 Nov" for a note: the audit day as a reader says it. */
function dayMonth(day: string): string {
  const [, month, date] = day.split("-").map(Number);
  return `${date} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][month - 1]}`;
}

export function baselineView(dataset: Dataset): Baseline {
  return memo(dataset, "baseline", () => {
    const { world } = dataset;
    const asOf = zonedDay(dataset.now, REPORT_TIMEZONE);
    const start = zonedMidnight(addDays(asOf, -WINDOW_DAYS), REPORT_TIMEZONE);
    const end = zonedMidnight(asOf, REPORT_TIMEZONE);
    const result = figures(dataset, start, end);

    const auditAt = world.syncAt;
    const audited = {
      total_issues: world.issues.filter((issue) => issue.createdAt < auditAt).length,
      resolved_in_window: result.resolved.in_window,
      with_original_estimate: 0,
      with_story_points: result.resolved.with_story_points.count,
      with_logged_time: result.resolved.with_logged_time.aggregate.count,
      straight_todo_to_done: result.resolved.straight_todo_to_done.count,
    };
    const day = dayMonth(asOf);
    const variants = result.resolved.with_logged_time;
    const rows = [
      {
        metric: "total_issues",
        expected: audited.total_issues,
        actual: result.snapshot.created_before_window_end,
        reason: `the audit counted during ${day}; the window end is midnight before it`,
      },
      { metric: "resolved_in_window", expected: audited.resolved_in_window, actual: result.resolved.in_window, reason: "" },
      { metric: "with_original_estimate", expected: 0, actual: result.resolved.with_original_estimate.count, reason: "" },
      { metric: "with_story_points", expected: audited.with_story_points, actual: result.resolved.with_story_points.count, reason: "" },
      {
        metric: "with_logged_time",
        expected: audited.with_logged_time,
        actual: variants.timespent.count,
        reason: `the audit may have counted logged time another way; other variants: aggregate ${variants.aggregate.count.toLocaleString("en-GB")}, worklog_rows ${variants.worklog_rows.count.toLocaleString("en-GB")}`,
      },
      {
        metric: "straight_todo_to_done",
        expected: audited.straight_todo_to_done,
        actual: result.resolved.straight_todo_to_done.count,
        reason: "",
      },
    ].map(({ metric, expected, actual, reason }) => ({
      metric,
      expected,
      actual,
      match: expected === actual,
      note: expected === actual ? "" : reason,
    }));

    return {
      meta: meta(dataset),
      metadata: {
        project: dataset.board.key,
        as_of: asOf,
        window_days: WINDOW_DAYS,
        zone: REPORT_TIMEZONE,
        window: {
          start: iso(start),
          end: iso(end),
          start_local: zonedIso(start, REPORT_TIMEZONE),
          end_local: zonedIso(end, REPORT_TIMEZONE),
        },
        generated_at: iso(world.rulesAt),
        process_version: PROCESS_VERSION,
        last_synced_at: iso(world.syncAt),
        metrics_computed_at: iso(world.syncAt + 20 * SECOND),
        metrics_stale: false,
        issues_without_metrics: 0,
        comparison_status: "compared",
        comparison_note:
          "Sample data: the expected figures come from a fictional audit of DEMO, recorded so that this comparison can be shown.",
        run_id: createHash("sha256").update(`baseline\u001f${dataset.now}`).digest("hex").slice(0, 32),
      },
      figures: result,
      comparison: rows,
    };
  });
}

