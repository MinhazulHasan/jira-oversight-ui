import type { FactCell, FactColumnKind, FactSet, Finding, TrendMetric } from "@/lib/api/schemas";

import {
  coverage,
  effortByEpic,
  hotSpots,
  openByRule,
  periodWindow,
  timeInStatus,
  topIssues,
  type CoverageField,
  type Period,
  type TopMetric,
} from "../aggregates";
import { effortThreshold, numberWords } from "../board-rules";
import { RULES_VERSION, missingFor, ruleDef } from "../catalogue";
import type { Dataset } from "../dataset";
import { findingsOfIssue, intervalsOf, matchingFindings } from "../findings";
import { round4 } from "../stats";
import { iso } from "../time";
import { TREND_DEFINITIONS, trendPoints } from "../series";

/** The backend's read-only query catalogue (oversight/ask/catalog.py), run over */

type Params = FactSet["params"];
type Row = Record<string, FactCell>;

interface Column {
  key: string;
  label: string;
  kind: FactColumnKind;
}

function facts(
  dataset: Dataset,
  ref: string,
  tool: string,
  params: Params,
  columns: Column[],
  rows: Row[],
  note: string,
  truncated = false,
): FactSet {
  return { ref, tool, params, columns, rows, truncated, as_of: iso(dataset.world.syncAt), note };
}

const clean = (value: number | null): number | null => (value === null ? null : round4(value));

/* ------------------------------------------------------- time in status -- */

export function timeInStatusFacts(dataset: Dataset, ref: string, period: Period = "90d"): FactSet {
  const window = periodWindow(dataset, period);
  return facts(
    dataset,
    ref,
    "oversight_time_in_status",
    { group_by: "status", period },
    [
      { key: "group", label: "Group", kind: "text" },
      { key: "n", label: "Intervals", kind: "count" },
      { key: "median_h", label: "Median (h)", kind: "hours" },
      { key: "p75_h", label: "p75 (h)", kind: "hours" },
      { key: "p90_h", label: "p90 (h)", kind: "hours" },
    ],
    timeInStatus(dataset, period).map((spread) => ({ ...spread })),
    `closed status intervals that ended in ${window.phrase}`,
  );
}

/* ------------------------------------------------------------ hot spots -- */

export function hotSpotsFacts(dataset: Dataset, ref: string, n = 5): FactSet {
  const ranked = hotSpots(dataset);
  return facts(
    dataset,
    ref,
    "oversight_hot_spots",
    { n },
    [
      { key: "epic_key", label: "Epic", kind: "issue_key" },
      { key: "epic_title", label: "Epic title", kind: "text" },
      { key: "open_breaches", label: "Open breaches", kind: "count" },
      { key: "open_warnings", label: "Open warnings", kind: "count" },
      { key: "issues", label: "Issues with findings", kind: "count" },
    ],
    ranked.slice(0, n).map((spot) => ({
      epic_key: spot.epicKey,
      epic_title: spot.epicTitle,
      open_breaches: spot.openBreaches,
      open_warnings: spot.openWarnings,
      issues: spot.issues,
    })),
    "epics by open breaches, then open warnings",
    ranked.length > n,
  );
}

/* -------------------------------------------------------------- coverage -- */

export function coverageFacts(dataset: Dataset, ref: string, field: CoverageField, period: Period = "90d"): FactSet {
  const entry = coverage(dataset, field, period);
  return facts(
    dataset,
    ref,
    "oversight_coverage",
    { field, period },
    [
      { key: "covered", label: "Covered", kind: "count" },
      { key: "total", label: "Total", kind: "count" },
      { key: "share", label: "Share", kind: "share" },
      { key: "measurable", label: "Measurable", kind: "text" },
      { key: "note", label: "Note", kind: "text" },
    ],
    [{ covered: entry.covered, total: entry.total, share: entry.share, measurable: entry.measurable, note: entry.note }],
    entry.note,
  );
}

/* ----------------------------------------------------------- rule status -- */

export function ruleStatusFacts(dataset: Dataset, ref: string): FactSet {
  const open = openByRule(dataset);
  return facts(
    dataset,
    ref,
    "oversight_rule_status",
    {},
    [
      { key: "rule_id", label: "Rule", kind: "text" },
      { key: "title", label: "Title", kind: "text" },
      { key: "kind", label: "Kind", kind: "text" },
      { key: "severity", label: "Severity", kind: "text" },
      { key: "measurable", label: "Measurable", kind: "text" },
      { key: "missing", label: "Missing", kind: "text" },
      { key: "open_findings", label: "Open findings", kind: "count" },
      { key: "version", label: "Version", kind: "text" },
    ],
    // The rules the board runs, as its settings make them: a rule turned off there is not one of them.
    dataset.rules.filter((rule) => rule.enabled).map(({ def: rule, catalogue, custom, version }) => {
      const missing = missingFor(catalogue);
      return {
        rule_id: rule.id,
        title: rule.title,
        kind: rule.kind,
        severity: rule.severity,
        measurable: missing.length === 0,
        missing: missing.length > 0 ? missing.join(", ") : null,
        open_findings: open.get(rule.id) ?? 0,
        // A board's own rule by its own version, the revision that added it.
        version: custom ? version : RULES_VERSION,
      };
    }),
    "enabled rules; a rule is not measurable when Jira records no evidence for a stage it needs",
  );
}

/* ---------------------------------------------------------- list findings -- */

export interface ListFindingsParams {
  rule_id?: string;
  severity?: "breach" | "warning";
  state: "open" | "resolved" | "all";
  period: "7d" | "30d" | "90d" | "all";
  n: number;
}

export function listFindingsFacts(dataset: Dataset, ref: string, params: ListFindingsParams): FactSet {
  const matching = matchingFindings(dataset, {
    rule: params.rule_id ? [params.rule_id] : [],
    severity: params.severity,
    state: params.state,
    epic: [],
    person: [],
    q: undefined,
    first_seen: params.period,
    // Open first, then newest first, as the catalogue orders them.
    sort: "first_seen_at",
    order: "desc",
    page: 1,
    page_size: 100,
  });
  const ordered = [...matching].sort(
    (a, b) => Number(a.state !== "open") - Number(b.state !== "open"),
  );
  const described = [`${params.state} findings`];
  // The board's rule by its own title; a rule the board does not run, by its id alone.
  const named = params.rule_id ? dataset.rules.find((rule) => rule.def.id === params.rule_id)?.def.title : undefined;
  if (params.rule_id) described.push(named ? `rule ${params.rule_id} (${named})` : `rule ${params.rule_id}`);
  const window = periodWindow(dataset, params.period);
  if (window.since !== null) described.push(`first seen in ${window.phrase}`);
  const toRow = (finding: Finding): Row => ({
    finding_id: finding.finding_id,
    rule_id: finding.rule_id,
    rule_title: finding.rule_title,
    severity: finding.severity,
    issue_key: finding.issue_key,
    summary: finding.issue_summary,
    epic_key: finding.epic_key,
    message: finding.message,
    first_seen_at: finding.first_seen_at,
    resolved_at: finding.resolved_at,
  });
  const queryParams: Params = { state: params.state, period: params.period, n: params.n };
  if (params.rule_id) queryParams.rule_id = params.rule_id;
  if (params.severity) queryParams.severity = params.severity;
  return facts(
    dataset,
    ref,
    "oversight_list_findings",
    queryParams,
    [
      { key: "finding_id", label: "Finding", kind: "text" },
      { key: "rule_id", label: "Rule", kind: "text" },
      { key: "rule_title", label: "Rule title", kind: "text" },
      { key: "severity", label: "Severity", kind: "text" },
      { key: "issue_key", label: "Issue", kind: "issue_key" },
      { key: "summary", label: "Summary", kind: "text" },
      { key: "epic_key", label: "Epic", kind: "issue_key" },
      { key: "message", label: "Message", kind: "text" },
      { key: "first_seen_at", label: "First seen", kind: "date" },
      { key: "resolved_at", label: "Resolved", kind: "date" },
    ],
    ordered.slice(0, params.n).map(toRow),
    `${described.join(", ")}, newest first`,
    ordered.length > params.n,
  );
}

/** What listing a rule's findings depends on: the evidence that rule needs (catalog.py's _findings_evidence). */
export function listFindingsNeeds(ruleId: string | undefined): string[] {
  return ruleId ? ruleDef(ruleId).requiresEvidence : [];
}

/* ----------------------------------------------------------------- trend -- */

const TREND_KIND: Record<TrendMetric, FactColumnKind> = {
  median_cycle_time_h: "hours",
  median_effort_ratio: "ratio",
  skipped_stage_share: "share",
  reopen_rate: "share",
  open_breaches: "count",
  open_warnings: "count",
};

export function trendFacts(dataset: Dataset, ref: string, metric: TrendMetric, lastN = 12): FactSet {
  const counts = metric === "open_breaches" || metric === "open_warnings";
  const meaning = TREND_DEFINITIONS[metric].note.replace(/\.$/, "");
  return facts(
    dataset,
    ref,
    "oversight_trend",
    { metric, last_n: lastN },
    [
      { key: "week_of", label: "Week of", kind: "date" },
      { key: "value", label: metric.replace(/_/g, " "), kind: TREND_KIND[metric] },
    ],
    trendPoints(dataset, metric, lastN).map((point) => ({ week_of: point.t, value: point.value })),
    `${meaning}; weeks start on Monday (UTC), oldest first${counts ? "" : "; null = nothing finished that week"}`,
  );
}

/* --------------------------------------------------- effort vs estimate -- */

/** Grouped by epic, the group is an epic key, so its column is of kind */
export function effortFacts(dataset: Dataset, ref: string, period: Period = "90d"): FactSet {
  const window = periodWindow(dataset, period);
  return facts(
    dataset,
    ref,
    "oversight_effort_vs_estimate",
    { group_by: "epic", period },
    [
      { key: "group", label: "Epic", kind: "issue_key" },
      { key: "epic_title", label: "Epic title", kind: "text" },
      { key: "n", label: "Issues", kind: "count" },
      { key: "median_ratio", label: "Median ratio", kind: "ratio" },
      { key: "share_over_threshold", label: "Share over threshold", kind: "share" },
      { key: "threshold", label: "Threshold", kind: "ratio" },
    ],
    effortByEpic(dataset, period).map((group) => ({
      group: group.group,
      epic_title: dataset.world.byKey.get(group.group)?.summary ?? group.group,
      n: group.n,
      median_ratio: group.median_ratio,
      share_over_threshold: group.share_over_threshold,
      threshold: group.threshold,
    })),
    `done work finished in ${window.phrase} that has both an estimate and logged time; ratio = logged hours / estimated hours; threshold ${numberWords(effortThreshold(dataset.rules))}× from R-EFF-01`,
  );
}

/* ------------------------------------------------------------ top issues -- */

const TOP_META: Record<TopMetric, { kind: FactColumnKind; unit: string; meaning: string }> = {
  cycle_time: { kind: "hours", unit: "h", meaning: "hours from the start of development to done" },
  effort_ratio: { kind: "ratio", unit: "×", meaning: "logged time divided by the estimate" },
  status_age: { kind: "hours", unit: "h", meaning: "hours in the current status" },
  reopens: { kind: "count", unit: "reopens", meaning: "times reopened after done (at least once)" },
};

export function topIssuesFacts(
  dataset: Dataset,
  ref: string,
  metric: TopMetric,
  n: number,
  category?: "new" | "indeterminate" | "done",
): FactSet {
  const { kind, unit, meaning } = TOP_META[metric];
  const params: Params = { metric, n };
  if (category) params.status_category = category;
  return facts(
    dataset,
    ref,
    "oversight_top_issues",
    params,
    [
      { key: "issue_key", label: "Issue", kind: "issue_key" },
      { key: "summary", label: "Summary", kind: "text" },
      { key: "issue_type", label: "Type", kind: "text" },
      { key: "status", label: "Status", kind: "text" },
      { key: "epic_key", label: "Epic", kind: "issue_key" },
      { key: "value", label: metric.replace(/_/g, " ").replace(/^./, (letter) => letter.toUpperCase()), kind },
      { key: "unit", label: "Unit", kind: "text" },
    ],
    topIssues(dataset, metric, n, category).map(({ issue, value }) => ({
      issue_key: issue.key,
      summary: issue.summary,
      issue_type: issue.type,
      status: issue.status,
      epic_key: issue.epicKey,
      value: clean(value),
      unit,
    })),
    `value = ${meaning}, highest first; Epic issues left out (containers, not work)`,
  );
}

/* -------------------------------------------------------- issue timeline -- */

export function issueTimelineFacts(dataset: Dataset, ref: string, key: string): FactSet {
  const issue = dataset.world.byKey.get(key);
  const rows: Row[] = issue
    ? intervalsOf(issue).map((interval, index) => ({
        seq: index + 1,
        status: interval.status,
        stage: interval.stage,
        entered_at: interval.entered_at,
        left_at: interval.left_at,
        hours: clean(interval.hours),
      }))
    : [];
  let note: string;
  if (!issue) {
    note = `${key} is not in the snapshot`;
  } else {
    const findings = findingsOfIssue(dataset, key);
    note =
      findings.length > 0
        ? `Findings for ${key}: ${findings
            .map((finding) => `${finding.rule_id} ${finding.rule_title} (${finding.state})`)
            .join("; ")}`
        : `No findings for ${key}`;
  }
  return facts(
    dataset,
    ref,
    "oversight_issue_timeline",
    { issue_key: key },
    [
      { key: "seq", label: "Step", kind: "count" },
      { key: "status", label: "Status", kind: "text" },
      { key: "stage", label: "Stage", kind: "text" },
      { key: "entered_at", label: "Entered", kind: "date" },
      { key: "left_at", label: "Left", kind: "date" },
      { key: "hours", label: "Hours", kind: "hours" },
    ],
    rows,
    note,
  );
}
