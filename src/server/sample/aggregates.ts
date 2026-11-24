import type { CoverageEntry, Overview } from "@/lib/api/schemas";

import { effortThreshold } from "./board-rules";
import { PROCESS_STAGES, STATUS, STATUSES, type StatusName } from "./catalogue";
import { memo, type Dataset } from "./dataset";
import { hasMeasuredEffort } from "./series";
import { median, percentile, round4, round4OrNull, share } from "./stats";
import { DAY, HOUR, spelledDay } from "./time";
import { workItems, type Issue } from "./world";

/** The figures several views share, each computed one way only: the overview, */

const NO_EPIC_LABEL = "(no epic)";

export type Period = "7d" | "30d" | "90d" | "sprint" | "all";

export interface Window {
  since: number | null;
  /** "the last 90 days", "the active sprint (Sprint 26, since )". */
  phrase: string;
}

export function periodWindow(dataset: Dataset, period: Period): Window {
  if (period === "all") return { since: null, phrase: "all time" };
  if (period === "sprint") {
    const sprint = dataset.world.activeSprint;
    return { since: sprint.start, phrase: `the active sprint (${sprint.name}, since ${spelledDay(sprint.start)})` };
  }
  const days = Number(period.slice(0, -1));
  return { since: dataset.now - days * DAY, phrase: `the last ${days} days` };
}

/* ---------------------------------------------------------- rule counts -- */

/** Open findings per rule id; rules with none are absent. */
export function openByRule(dataset: Dataset): Map<string, number> {
  return memo(dataset, "open-by-rule", () => {
    const counts = new Map<string, number>();
    for (const finding of dataset.engine.findings) {
      if (finding.resolvedAt === null) counts.set(finding.rule.id, (counts.get(finding.rule.id) ?? 0) + 1);
    }
    return counts;
  });
}

/* ------------------------------------------------------------ hot spots -- */

export interface HotSpot {
  epicKey: string | null;
  epicTitle: string;
  openBreaches: number;
  openWarnings: number;
  /** Distinct issues with at least one open finding. */
  issues: number;
}

/** Open findings by epic, ranked by open breaches, then open warnings (as */
export function hotSpots(dataset: Dataset): HotSpot[] {
  return memo(dataset, "hot-spots", () => {
    const groups = new Map<string | null, { breaches: number; warnings: number; issues: Set<string> }>();
    for (const finding of dataset.engine.findings) {
      if (finding.resolvedAt !== null) continue;
      const epic = finding.issue?.epicKey ?? null;
      const group = groups.get(epic) ?? { breaches: 0, warnings: 0, issues: new Set<string>() };
      if (finding.rule.severity === "breach") group.breaches += 1;
      else group.warnings += 1;
      if (finding.issue) group.issues.add(finding.issue.key);
      groups.set(epic, group);
    }
    return [...groups.entries()]
      .map(([epicKey, group]) => ({
        epicKey,
        epicTitle: epicKey === null ? NO_EPIC_LABEL : dataset.world.byKey.get(epicKey)!.summary,
        openBreaches: group.breaches,
        openWarnings: group.warnings,
        issues: group.issues.size,
      }))
      .sort(
        (a, b) =>
          b.openBreaches - a.openBreaches ||
          b.openWarnings - a.openWarnings ||
          (a.epicKey ?? "").localeCompare(b.epicKey ?? ""),
      );
  });
}

/* -------------------------------------------------------------- coverage -- */

export type CoverageField = keyof Overview["coverage"];

/** Evidence DEMO's workflow does not record: a share of it cannot be counted. */
const UNRECORDED: Record<"code_review" | "test_evidence", string> = {
  code_review: "code review",
  test_evidence: "testing",
};

/** Evidence Jira does record, and how to tell an issue has it. Points are the estimate basis in DEMO. */
const RECORDED: Record<"estimate" | "story_points" | "time_logged", { what: string; has: (issue: Issue) => boolean }> = {
  estimate: { what: "an estimate (story points)", has: (issue) => (issue.storyPoints ?? 0) > 0 },
  story_points: { what: "story points", has: (issue) => (issue.storyPoints ?? 0) > 0 },
  time_logged: { what: "logged time", has: (issue) => issue.timeSpentS > 0 },
};

/** Share of the work created in the period that carries a piece of evidence (oversight_coverage). */
export function coverage(dataset: Dataset, field: CoverageField, period: Period): CoverageEntry {
  return memo(dataset, `coverage:${field}:${period}`, () => {
    const window = periodWindow(dataset, period);
    const issues = workItems(dataset.world).filter((issue) => window.since === null || issue.createdAt >= window.since);
    const scope = `issues created in ${window.phrase}, Epics left out`;
    if (field === "code_review" || field === "test_evidence") {
      return {
        covered: null,
        total: issues.length,
        share: null,
        measurable: false,
        note: `Jira records no ${UNRECORDED[field]} for ${dataset.board.key}, so it cannot be counted; ${scope}.`,
      };
    }
    const { what, has } = RECORDED[field];
    const covered = issues.filter(has).length;
    return {
      covered,
      total: issues.length,
      share: round4OrNull(share(covered, issues.length)),
      measurable: true,
      note: `Issues with ${what}, of the ${scope}.`,
    };
  });
}

/* ---------------------------------------------------------- where it sits -- */

export function statusMix(dataset: Dataset): Overview["status_mix"] {
  return memo(dataset, "status-mix", () => {
    const work = workItems(dataset.world);
    return STATUSES.map((status) => ({
      status: status.name,
      stage: status.stage,
      status_category: status.category,
      count: work.filter((issue) => issue.status === status.name).length,
    }));
  });
}

/* -------------------------------------------------------- time in status -- */

export interface Spread {
  group: string;
  n: number;
  median_h: number | null;
  p75_h: number | null;
  p90_h: number | null;
}

const STAGE_RANK = new Map(PROCESS_STAGES.map((stage, index) => [stage.stage, index]));

/** Closed status intervals that ended in the period, per status in James's stage order (oversight_time_in_status). */
export function timeInStatus(dataset: Dataset, period: Period): Spread[] {
  return memo(dataset, `time-in-status:${period}`, () => {
    const { since } = periodWindow(dataset, period);
    const hours = new Map<StatusName, number[]>();
    for (const issue of dataset.world.issues) {
      for (const interval of issue.intervals) {
        if (interval.leftAt === null || (since !== null && interval.leftAt < since)) continue;
        const list = hours.get(interval.status) ?? [];
        list.push(Math.max(0, (interval.leftAt - interval.enteredAt) / HOUR));
        hours.set(interval.status, list);
      }
    }
    return [...hours.keys()]
      .sort((a, b) => STAGE_RANK.get(STATUS[a].stage)! - STAGE_RANK.get(STATUS[b].stage)! || a.localeCompare(b))
      .map((status) => {
        const values = hours.get(status)!;
        return {
          group: status,
          n: values.length,
          median_h: round4OrNull(median(values)),
          p75_h: round4OrNull(percentile(values, 75)),
          p90_h: round4OrNull(percentile(values, 90)),
        };
      });
  });
}

/* ---------------------------------------------------- effort vs estimate -- */

export interface EffortGroup {
  group: string;
  n: number;
  median_ratio: number | null;
  share_over_threshold: number | null;
  threshold: number;
}

/** Done work finished in the period with an estimate and logged time, by epic (oversight_effort_vs_estimate). */
export function effortByEpic(dataset: Dataset, period: Period): EffortGroup[] {
  return memo(dataset, `effort-by-epic:${period}`, () => {
    const { since } = periodWindow(dataset, period);
    // R-EFF-01's threshold on the board.
    const threshold = effortThreshold(dataset.rules);
    const ratios = new Map<string, number[]>();
    for (const issue of dataset.world.issues) {
      if (issue.doneAt === null || !hasMeasuredEffort(issue)) continue;
      if (since !== null && issue.doneAt < since) continue;
      const group = issue.epicKey ?? NO_EPIC_LABEL;
      const list = ratios.get(group) ?? [];
      list.push(issue.effortRatio!);
      ratios.set(group, list);
    }
    return [...ratios.entries()]
      .map(([group, values]) => ({
        group,
        n: values.length,
        median_ratio: round4OrNull(median(values)),
        share_over_threshold: round4OrNull(share(values.filter((ratio) => ratio >= threshold).length, values.length)),
        threshold,
      }))
      .sort((a, b) => (b.median_ratio ?? 0) - (a.median_ratio ?? 0) || a.group.localeCompare(b.group));
  });
}

/* ------------------------------------------------------------ top issues -- */

export type TopMetric = "cycle_time" | "effort_ratio" | "status_age" | "reopens";

export interface TopIssue {
  issue: Issue;
  value: number;
}

const TOP_VALUE: Record<TopMetric, (issue: Issue) => number | null> = {
  cycle_time: (issue) => issue.cycleTimeH,
  effort_ratio: (issue) => issue.effortRatio,
  status_age: (issue) => issue.statusAgeH,
  reopens: (issue) => (issue.reopenCount > 0 ? issue.reopenCount : null),
};

/** Work ranked by a metric, highest first, Epics left out (oversight_top_issues). */
export function topIssues(
  dataset: Dataset,
  metric: TopMetric,
  n: number,
  category?: "new" | "indeterminate" | "done",
): TopIssue[] {
  return workItems(dataset.world)
    .filter((issue) => category === undefined || STATUS[issue.status].category === category)
    .flatMap((issue) => {
      const value = TOP_VALUE[metric](issue);
      return value === null ? [] : [{ issue, value: round4(value) }];
    })
    .sort((a, b) => b.value - a.value || a.issue.num - b.issue.num)
    .slice(0, n);
}
