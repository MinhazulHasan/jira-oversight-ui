/**
 * The rule catalogue and the process map for the sample project, mirroring
 * jira-oversight-sys/config/rules.yaml (v0.1.0) and the DEMO entry in
 * config/process.yaml. DEMO has the same three-status workflow as the real
 * project, so code review, sign-off and testing leave no evidence in Jira and
 * the rules that need them are "not measurable".
 */

import { EVIDENCE_NAMES, type RuleKind, type Severity, type Stage, type StatusCategory } from "@/lib/api/schemas";

export const PROJECT_KEY = "DEMO";
/** The board's name as people know it (process.yaml's `name`): what the board list and the Portfolio call it. */
export const PROJECT_NAME = "Demo project";
export const REPORT_TIMEZONE = "Europe/London";
export const API_VERSION = "0.1.0";
export const RULES_VERSION = "0.1.0";
export const PROCESS_VERSION = "0.1.0";
export const HOURS_PER_POINT = 8;
/*
 * The catalogue's thresholds (rules.yaml): every board's defaults. A board's own, where an admin has changed
 * them, are its rule settings (JO-15, board-rules.ts), which the engine and the views read instead.
 */
export const EFFORT_THRESHOLD = 1.5;
export const EFFORT_WARNING = 0.8;
export const ESTIMATE_GRACE_HOURS = 1;
export const STUCK_PERCENTILE = 90;
export const HISTORY_DAYS = 180;
export const MIN_HISTORY = 20;
export const SPRINT_DAYS_LEFT = 2;
export const SPRINT_NOT_STARTED_SHARE = 0.3;

export type StatusName = "To Do" | "In Progress" | "Done";

interface StatusDef {
  name: StatusName;
  category: StatusCategory;
  stage: Stage;
}

export const STATUSES: readonly StatusDef[] = [
  { name: "To Do", category: "new", stage: "backlog" },
  { name: "In Progress", category: "indeterminate", stage: "development" },
  { name: "Done", category: "done", stage: "done" },
];

export const STATUS: Record<StatusName, StatusDef> = {
  "To Do": STATUSES[0],
  "In Progress": STATUSES[1],
  Done: STATUSES[2],
};

/** The stages this workflow maps, in James's order: what a skip is measured against. */
export const ORDERED_STAGES: readonly Stage[] = ["backlog", "development", "done"];

/** Evidence sources process.yaml can name; every one is null for DEMO. */
export const EVIDENCE_SOURCES = EVIDENCE_NAMES;
/** The evidence DEMO's workflow records: none (process.yaml's evidence block is all null for it). */
export const RECORDED_EVIDENCE: readonly string[] = [];

/** What a rule looks at (rules.yaml's applies_to): the status categories, and the issue types (null: all but Epic). */
export interface AppliesTo {
  statusCategory: readonly StatusCategory[];
  issueType: readonly string[] | null;
}

/** A rule with no status filter in rules.yaml looks at every category. */
const ANY_STATUS: AppliesTo = { statusCategory: ["new", "indeterminate", "done"], issueType: null };
const STARTED_WORK: AppliesTo = { statusCategory: ["indeterminate", "done"], issueType: null };
const OPEN_WORK: AppliesTo = { statusCategory: ["new", "indeterminate"], issueType: null };
/** A sprint's rule looks at the active sprint, not at issues: no status categories or types. */
const SPRINT_SCOPE: AppliesTo = { statusCategory: [], issueType: null };

export interface RuleDef {
  id: string;
  title: string;
  description: string;
  /** The check it runs, as rules.yaml names it: what its params mean (and which of them a board may change, JO-15). */
  check: string;
  /** Its params as rules.yaml sets them (a custom rule's statuses among them); a threshold the check reads with a default may be left out. */
  params: Readonly<Record<string, number | string | readonly string[]>>;
  /** W-SPR-01 looks at a sprint; every other rule at an issue. */
  scope: "issue" | "sprint";
  kind: RuleKind;
  severity: Severity;
  threshold: string | null;
  needs: string[];
  requiresEvidence: string[];
  requiresStages: string[];
  escalatesTo: string | null;
  appliesTo: AppliesTo;
}

export const RULES: readonly RuleDef[] = [
  {
    id: "R-EST-01",
    title: "Work started without an estimate",
    description:
      "The issue entered development (or a later stage) and has no estimate on the project's estimate basis.",
    check: "missing_estimate",
    params: {},
    scope: "issue",
    kind: "rule",
    severity: "breach",
    threshold: null,
    needs: ["Estimate (story points)", "Status history"],
    requiresEvidence: [],
    requiresStages: [],
    escalatesTo: null,
    appliesTo: STARTED_WORK,
  },
  {
    id: "R-EST-02",
    title: "Estimate first set after work started",
    description:
      "The estimate was first recorded after the issue had already entered development; it may describe the work rather than predict it.",
    check: "estimate_after_start",
    params: { grace_hours: ESTIMATE_GRACE_HOURS },
    scope: "issue",
    kind: "rule",
    severity: "warning",
    threshold: "1 h grace",
    needs: ["Estimate (story points)", "Field history"],
    requiresEvidence: [],
    requiresStages: [],
    escalatesTo: null,
    appliesTo: STARTED_WORK,
  },
  {
    id: "R-EFF-01",
    title: "Effort far beyond the estimate",
    description: "Logged effort on finished work is at least the threshold times the estimate.",
    check: "effort_ratio_at_least",
    params: { threshold: EFFORT_THRESHOLD },
    scope: "issue",
    kind: "rule",
    severity: "breach",
    threshold: "1.5×",
    needs: ["Estimate (story points)", "Logged time"],
    requiresEvidence: [],
    requiresStages: [],
    escalatesTo: null,
    appliesTo: { statusCategory: ["done"], issueType: null },
  },
  {
    id: "R-FLOW-01",
    title: "Reached testing without code review",
    description:
      "The issue entered the testing stage with no code-review evidence recorded before that moment.",
    check: "entered_stage_without_evidence",
    params: { stage: "testing", evidence: "code_review" },
    scope: "issue",
    kind: "rule",
    severity: "breach",
    threshold: null,
    needs: ["Code review evidence", "A testing stage in the workflow"],
    requiresEvidence: ["code_review"],
    requiresStages: ["testing"],
    escalatesTo: null,
    appliesTo: ANY_STATUS,
  },
  {
    id: "R-FLOW-02",
    title: "Skipped a stage",
    description:
      "A status change jumped forward over a stage the project's workflow maps (for example To Do straight to Done).",
    check: "skipped_stage",
    params: {},
    scope: "issue",
    kind: "rule",
    severity: "breach",
    threshold: null,
    needs: ["Mapped stages", "Status history"],
    requiresEvidence: [],
    requiresStages: [],
    escalatesTo: null,
    appliesTo: ANY_STATUS,
  },
  {
    id: "R-FLOW-03",
    title: "Reopened after Done",
    description: "The issue left a Done status for a status that is not Done.",
    check: "reopened",
    params: {},
    scope: "issue",
    kind: "rule",
    severity: "warning",
    threshold: null,
    needs: ["Status history"],
    requiresEvidence: [],
    requiresStages: [],
    escalatesTo: null,
    appliesTo: ANY_STATUS,
  },
  {
    id: "R-HYG-01",
    title: "In progress with no assignee",
    description: "The issue is in progress and nobody is assigned.",
    check: "in_progress_unassigned",
    params: {},
    scope: "issue",
    kind: "rule",
    severity: "breach",
    threshold: null,
    needs: ["Assignee"],
    requiresEvidence: [],
    requiresStages: [],
    escalatesTo: null,
    appliesTo: { statusCategory: ["indeterminate"], issueType: null },
  },
  {
    id: "W-EFF-01",
    title: "Effort burning fast",
    description: "Work still in progress has already used at least the threshold share of its estimate.",
    check: "effort_ratio_at_least",
    params: { threshold: EFFORT_WARNING },
    scope: "issue",
    kind: "warning",
    severity: "warning",
    threshold: "0.8×",
    needs: ["Estimate (story points)", "Logged time"],
    requiresEvidence: [],
    requiresStages: [],
    escalatesTo: "R-EFF-01",
    appliesTo: { statusCategory: ["indeterminate"], issueType: null },
  },
  {
    id: "W-AGE-01",
    title: "Stuck in a status",
    description:
      "Longer in its current status than 90% of finished work took there.",
    check: "stuck_in_status",
    params: { pct: STUCK_PERCENTILE },
    scope: "issue",
    kind: "warning",
    severity: "warning",
    threshold: "Slower than 90% of finished work in the status",
    needs: ["Status history", "Closed work from the last 180 days"],
    requiresEvidence: [],
    requiresStages: [],
    escalatesTo: null,
    appliesTo: OPEN_WORK,
  },
  {
    id: "W-REV-01",
    title: "No review evidence yet",
    description: "In development longer than 75% of finished work, with no code review recorded.",
    check: "no_evidence_after_percentile",
    params: { stage: "development", evidence: "code_review", pct: 75 },
    scope: "issue",
    kind: "warning",
    severity: "warning",
    threshold: "Slower than 75% of finished work in development",
    // As the service names them (its check reads the board's closed work for the p75 as well as the evidence).
    needs: ["Code review evidence", "Closed work from the last 180 days"],
    requiresEvidence: ["code_review"],
    requiresStages: [],
    escalatesTo: "R-FLOW-01",
    appliesTo: { statusCategory: ["indeterminate"], issueType: null },
  },
  {
    id: "W-SPR-01",
    title: "Sprint at risk",
    description:
      "The active sprint has at most the given days left and more than the given share of its issues not yet started.",
    check: "sprint_at_risk",
    params: { days_left: SPRINT_DAYS_LEFT, not_started_share: SPRINT_NOT_STARTED_SHARE },
    scope: "sprint",
    kind: "warning",
    severity: "warning",
    threshold: "≤ 2 days left, > 30% not started",
    needs: ["Sprints"],
    requiresEvidence: [],
    requiresStages: [],
    escalatesTo: null,
    appliesTo: SPRINT_SCOPE,
  },
  {
    id: "W-EST-01",
    title: "Unestimated work in the active sprint",
    description: "An issue in the active sprint has no estimate.",
    check: "unestimated_in_active_sprint",
    params: {},
    scope: "issue",
    kind: "warning",
    severity: "warning",
    threshold: null,
    needs: ["Sprints", "Estimate (story points)"],
    requiresEvidence: [],
    requiresStages: [],
    escalatesTo: "R-EST-01",
    appliesTo: OPEN_WORK,
  },
];

const RULE_BY_ID: ReadonlyMap<string, RuleDef> = new Map(RULES.map((rule) => [rule.id, rule]));

export function ruleDef(id: string): RuleDef {
  const rule = RULE_BY_ID.get(id);
  if (!rule) throw new Error(`unknown rule ${id}`);
  return rule;
}

/**
 * What a rule needs that the project lacks, the way the engine and
 * oversight_rule_status work it out: missing evidence first, then stages the
 * workflow does not map.
 */
/**
 * Work, as every rule counts it: an Epic is a container, not work
 * (rules.yaml defaults.exclude_types). A person's tickets, open tickets and
 * findings count over work only, everywhere (JO-12, G5).
 */
export const isWork = (issue: { type: string }) => issue.type !== "Epic";

export function missingFor(rule: RuleDef): string[] {
  const missing = rule.requiresEvidence.filter((name) => (EVIDENCE_SOURCES as readonly string[]).includes(name));
  for (const stage of rule.requiresStages) {
    if (!(ORDERED_STAGES as readonly string[]).includes(stage) && !missing.includes(stage)) missing.push(stage);
  }
  return missing;
}

export const NOT_MEASURABLE_RULES = RULES.filter((rule) => missingFor(rule).length > 0).map((rule) => rule.id);

interface StageDef {
  stage: Stage;
  label: string;
  mappedStatuses: StatusName[];
  evidence: "status" | "field" | "none";
  note: string;
}

export const PROCESS_STAGES: readonly StageDef[] = [
  { stage: "backlog", label: "Backlog", mappedStatuses: ["To Do"], evidence: "status", note: "Work waiting to start sits in To Do." },
  {
    stage: "estimate",
    label: "Estimate",
    mappedStatuses: [],
    evidence: "field",
    note: "Recorded as story points, at 8 hours per point. No original estimates (hours) are used.",
  },
  { stage: "development", label: "Development", mappedStatuses: ["In Progress"], evidence: "status", note: "Work in development sits in In Progress." },
  {
    stage: "code_review",
    label: "Code review",
    mappedStatuses: [],
    evidence: "none",
    note: "No status, field or pull-request link records a review, so rules that need one cannot run.",
  },
  {
    stage: "dev_signoff",
    label: "Dev sign-off",
    mappedStatuses: [],
    evidence: "none",
    note: "Nothing in Jira records a developer sign-off.",
  },
  {
    stage: "testing",
    label: "Testing",
    mappedStatuses: [],
    evidence: "none",
    note: "The workflow has no testing status, and no field records testing.",
  },
  {
    stage: "test_review",
    label: "Test review",
    mappedStatuses: [],
    evidence: "none",
    note: "Nothing in Jira records a test review.",
  },
  {
    stage: "test_signoff",
    label: "Test sign-off",
    mappedStatuses: [],
    evidence: "none",
    note: "Nothing in Jira records a test sign-off.",
  },
  { stage: "done", label: "Done", mappedStatuses: ["Done"], evidence: "status", note: "Finished work sits in Done." },
];
