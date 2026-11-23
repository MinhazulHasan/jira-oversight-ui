import { STAGE_LABELS } from "@/components/charts/palette";
import type { Finding, IssueTimeline, Rules, Severity, Stage } from "@/lib/api/schemas";

/*
 * The Issue page's reading of one issue-timeline response: pure functions, so
 * every figure the page derives (an estimate in hours, how late it was set,
 * which changelog entry a finding cites) is tested and traceable.
 */

export type IssueData = IssueTimeline;
export type Issue = IssueTimeline["issue"];
export type Change = IssueTimeline["changes"][number];
export type ProcessMap = Rules["process"];

const HOUR = 3_600_000;
const WEEK = 7 * 24 * HOUR;

export function ms(value: string): number {
  return new Date(value).getTime();
}

/* ------------------------------------------------------------ findings -- */

/** A fact on the page a rule can fire on: its tile wears the finding's mark and opens it. */
export type FactId = "estimate" | "effort" | "reopens" | "estimateSet";

/** Which rules speak to which fact (the rule catalogue's ids). An id the catalogue drops links nowhere. */
export const FACT_RULES: Record<FactId, readonly string[]> = {
  estimate: ["R-EST-01", "W-EST-01"],
  effort: ["R-EFF-01", "W-EFF-01"],
  reopens: ["R-FLOW-03"],
  estimateSet: ["R-EST-02"],
};

const SEVERITY_RANK: Record<Severity, number> = { breach: 0, warning: 1 };

/** The open finding a fact answers to, the most severe first; null when no rule has fired on it. */
export function findingForFact(findings: readonly Finding[], fact: FactId): Finding | null {
  const rules = FACT_RULES[fact];
  const open = findings.filter((finding) => finding.state === "open" && rules.includes(finding.rule_id));
  open.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  return open[0] ?? null;
}

/** Where a finding opens: the Findings page with its evidence drawer. */
export function findingHref(findingId: string): string {
  return `/findings?finding=${encodeURIComponent(findingId)}`;
}

/** Every finding about this issue, open and resolved, on the Findings page. */
export function issueFindingsHref(key: string): string {
  return `/findings?q=${encodeURIComponent(key)}&state=all`;
}

export function epicFindingsHref(epicKey: string): string {
  return `/findings?epic=${encodeURIComponent(epicKey)}`;
}

/** The open findings on the work assigned to this person now, across the board. */
export function personFindingsHref(personId: string): string {
  return `/findings?person=${encodeURIComponent(personId)}`;
}

/** The findings that cite each changelog entry as evidence, by changelog id. */
export function citationsByChange(findings: readonly Finding[]): Map<string, Finding[]> {
  const cited = new Map<string, Finding[]>();
  for (const finding of findings) {
    for (const item of finding.evidence) {
      if (!item.changelog_id) continue;
      const list = cited.get(item.changelog_id) ?? [];
      if (!list.includes(finding)) list.push(finding);
      cited.set(item.changelog_id, list);
    }
  }
  return cited;
}

/* ------------------------------------------------------------ estimate -- */

/**
 * The estimate in hours. Points are converted at the process's hours a point;
 * otherwise (an original estimate, or no process map to hand) it is what the
 * effort ratio was measured against: logged hours over the ratio.
 */
export function estimateHours(issue: Issue, hoursPerPoint: number | null | undefined): number | null {
  if (issue.estimate_basis === "none") return null;
  if (issue.estimate_basis === "points" && issue.story_points !== null && hoursPerPoint) {
    return issue.story_points * hoursPerPoint;
  }
  if (issue.time_spent_h !== null && issue.time_spent_h > 0 && issue.effort_ratio) {
    return issue.time_spent_h / issue.effort_ratio;
  }
  return null;
}

export type EstimateTiming =
  /** No estimate has been set. */
  | { kind: "none" }
  /** Set, and work has not started. */
  | { kind: "unstarted"; setAt: string }
  /** Set before, as, or after work started, `hours` apart. */
  | { kind: "before" | "at" | "after"; setAt: string; startedAt: string; hours: number };

/** When the estimate was first set, against when work started (R-EST-02's question). */
export function estimateTiming(issue: Issue): EstimateTiming {
  const setAt = issue.estimate_set_at;
  if (!setAt) return { kind: "none" };
  const startedAt = issue.started_at;
  if (!startedAt) return { kind: "unstarted", setAt };
  const gap = (ms(setAt) - ms(startedAt)) / HOUR;
  const kind = gap > 0 ? "after" : gap < 0 ? "before" : "at";
  return { kind, setAt, startedAt, hours: Math.abs(gap) };
}

export type EffortVerdict = "over" | "at" | "under";

/** The effort ratio against R-EFF-01's threshold, which fires at or above it. */
export function effortVerdict(ratio: number | null, threshold: number): EffortVerdict | null {
  if (ratio === null) return null;
  return ratio > threshold ? "over" : ratio === threshold ? "at" : "under";
}

/* ------------------------------------------------------------- changes -- */

/** A changelog row: one field of one changelog entry (an entry can change several), with the findings that cite it. */
export interface ChangeRow extends Change {
  rowId: string;
  cited: Finding[];
}

const FIELD_LABELS: Record<string, string> = {
  status: "Status",
  story_points: "Story points",
  original_estimate: "Original estimate",
  sprint: "Sprint",
  assignee: "Assignee",
};

/** A tracked field in words: "story_points" reads "Story points". */
export function fieldLabel(field: string): string {
  const known = FIELD_LABELS[field];
  if (known) return known;
  const words = field.replace(/[_-]+/g, " ").trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : field;
}

/** Status changes that left a done status for one that is not: the issue was reopened. */
export function reopenChanges(data: Pick<IssueData, "changes" | "intervals">): Change[] {
  const category = new Map(data.intervals.map((interval) => [interval.status, interval.status_category]));
  return data.changes.filter(
    (change) =>
      change.kind === "status" &&
      change.from !== null &&
      change.to !== null &&
      category.get(change.from) === "done" &&
      category.get(change.to) !== "done",
  );
}

/** The status the issue sat in just before this change, with the hours it spent there. */
export function spellBefore(data: Pick<IssueData, "intervals">, change: Change) {
  if (change.kind !== "status") return null;
  const at = ms(change.changed_at);
  return data.intervals.find((interval) => interval.left_at !== null && ms(interval.left_at) === at) ?? null;
}

/* -------------------------------------------------------------- stages -- */

/** "In Progress · Development", or just "Done" where the status is named after its stage. */
export function stageWords(status: string, stage: Stage | null): string | null {
  if (stage === null) return "Not mapped to a stage";
  const label = STAGE_LABELS[stage];
  return label.toLowerCase() === status.toLowerCase() ? null : `${label} stage`;
}

/* ------------------------------------------------------------ worklogs -- */

export interface WeekTotal {
  week: string;
  hours: number;
}

/**
 * Logged hours a week, oldest first. The weeks between the first and last
 * with time logged are filled with zero, so the bars keep the calendar's
 * rhythm; a span longer than `maxSpan` weeks keeps only the weeks with time.
 */
export function weeklyTotals(worklogs: readonly WeekTotal[], maxSpan = 16): WeekTotal[] {
  const sorted = [...worklogs].sort((a, b) => a.week.localeCompare(b.week));
  if (sorted.length < 2) return sorted;
  const first = Date.parse(`${sorted[0].week}T00:00:00Z`);
  const last = Date.parse(`${sorted[sorted.length - 1].week}T00:00:00Z`);
  const span = Math.round((last - first) / WEEK) + 1;
  if (!Number.isFinite(span) || span > maxSpan) return sorted;
  const byWeek = new Map(sorted.map((entry) => [entry.week, entry.hours]));
  return Array.from({ length: span }, (_, index) => {
    const week = new Date(first + index * WEEK).toISOString().slice(0, 10);
    return { week, hours: byWeek.get(week) ?? 0 };
  });
}
