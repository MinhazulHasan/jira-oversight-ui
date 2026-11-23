import { limitWords, listWords, unitWords, type CustomRuleBoard } from "@/lib/api/custom-rules";
import {
  CHECK_REGISTRY,
  CHECKS_BY_NAME,
  MISSING_FIELD_LABELS,
  type CustomRuleDefinition,
  type MissingField,
  type ParamOption,
  type ParamValue,
  type RuleCheck,
  type RuleKind,
  type Severity,
  type Stage,
  type StatusCategory,
} from "@/lib/api/schemas";

import { EVIDENCE_SOURCES, ORDERED_STAGES, PROCESS_STAGES, RECORDED_EVIDENCE, STATUSES, type AppliesTo, type RuleDef } from "./catalogue";
import type { World } from "./world";

/*
 * A board's own rules (JO-20) for the sample: the sample's mirror of the
 * service's custom_rules table and its registry. A rule an admin adds is a
 * record the board keeps for good: a deleted one keeps its row (deletedAt),
 * so an undo brings it back with the same id and the same findings. Its id is
 * R-CUS-nn for a breach and W-CUS-nn for a warning, the next number across
 * every board, never reused. Pure functions: the records themselves live in
 * the board's settings (settings-store.ts), revision by revision.
 */

/** A custom rule as the board keeps it. */
export interface CustomRuleRecord {
  id: string;
  title: string;
  description: string | null;
  /** From the seriousness it was added with: a breach is one of the board's rules, a warning an early warning. */
  kind: RuleKind;
  /** As it was added; the board's rule settings may report it at another since (JO-15). */
  severity: Severity;
  check: string;
  /** As it was added or last edited. */
  params: Readonly<Record<string, ParamValue>>;
  appliesTo: AppliesTo;
  createdAt: number;
  /** The board's settings revision that added it: its findings' identity version, `c<revision>`. */
  createdRevision: number;
  /** Who added it, by the name the access log keeps for them. */
  createdBy: string;
  updatedAt: number;
  /** When it was deleted; null while it stands. */
  deletedAt: number | null;
}

/** The id a custom rule of this seriousness is given: R-CUS-07, W-CUS-12. */
export function customRuleId(severity: Severity, number: number): string {
  return `${severity === "breach" ? "R" : "W"}-CUS-${String(number).padStart(2, "0")}`;
}

/** The number in a custom rule's id, and its letter: ["R", 7] for R-CUS-07; null for a catalogue rule's. */
export function customRuleNumber(id: string): ["R" | "W", number] | null {
  const match = /^([RW])-CUS-(\d{2,3})$/.exec(id);
  return match ? [match[1] as "R" | "W", Number(match[2])] : null;
}

/**
 * A custom rule's identity version: the revision that added it (`c3`), and the severity the board reports it at
 * when that is not the one it was added with (`c3+warning`). Only a severity change gives it new finding ids;
 * an edit of its limits or of what it looks at never does.
 */
export function customVersion(record: CustomRuleRecord, severity: Severity): string {
  return `c${record.createdRevision}${severity === record.severity ? "" : `+${severity}`}`;
}

/* -------------------------------------------------------------- options -- */

/** What a custom rule may name on a board: its statuses (with their categories), issue types, stages and evidence. */
export interface BoardOptions {
  statuses: readonly { name: string; category: StatusCategory }[];
  /** The types its issues have, as Jira names them, Epic last. */
  issueTypes: readonly string[];
  /** The stages its workflow maps a status to, in process order. */
  stages: readonly Stage[];
  /** The evidence names process.yaml has, and those the board records. */
  evidence: readonly string[];
  recordedEvidence: readonly string[];
}

const ISSUE_TYPE_ORDER = ["Task", "Bug", "Subtask", "Test", "Story"];

/** A sample board's options: its workflow's statuses, its issues' types, its mapped stages and its evidence. */
export function boardOptions(world: World): BoardOptions {
  const types = [...new Set(world.issues.map((issue) => issue.type as string))];
  const rank = (type: string) => (type === "Epic" ? 1_000 : ISSUE_TYPE_ORDER.indexOf(type) >= 0 ? ISSUE_TYPE_ORDER.indexOf(type) : 100);
  return {
    statuses: STATUSES.map((status) => ({ name: status.name, category: status.category })),
    issueTypes: types.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)),
    stages: ORDERED_STAGES,
    evidence: EVIDENCE_SOURCES,
    recordedEvidence: RECORDED_EVIDENCE,
  };
}

/** A stage or an evidence name in words, as the process map names it ("Code review", "Dev sign-off"). */
export function stageWords(key: string): string {
  return PROCESS_STAGES.find((stage) => stage.stage === key)?.label ?? key.replace(/_/g, " ");
}

function optionsFor(kind: string, options: BoardOptions): ParamOption[] {
  switch (kind) {
    case "statuses":
      return options.statuses.map((status) => ({ value: status.name, label: status.name, category: status.category }));
    case "stage":
      return options.stages.map((stage) => ({ value: stage, label: stageWords(stage), category: null }));
    case "evidence":
      return options.evidence.map((name) => ({ value: name, label: stageWords(name), category: null }));
    case "field":
      return Object.entries(MISSING_FIELD_LABELS).map(([value, label]) => ({ value, label, category: null }));
    default:
      return [];
  }
}

/** What a check would read that the board does not record: its evidence, when no evidence name is recorded there. */
function missingForCheck(name: string, options: BoardOptions): string[] {
  const usesEvidence = CHECKS_BY_NAME.get(name)?.params.some((param) => param.kind === "evidence") ?? false;
  if (!usesEvidence || options.recordedEvidence.length > 0) return [];
  return [...options.evidence];
}

/**
 * The checks a custom rule may use on the board (GET /rules/settings `checks`): the registry, each param with the
 * board's own options and its default there (the registry's, or the board's first option where the board has not
 * the registry's: DEMO maps no testing stage), and whether the board can measure it at all.
 */
export function boardChecks(options: BoardOptions): RuleCheck[] {
  return CHECK_REGISTRY.map((check) => {
    const missing = missingForCheck(check.name, options);
    return {
      name: check.name,
      label: check.label,
      summary: check.summary,
      scope: check.scope,
      params: check.params.map((param) => {
        if (param.kind === "number") {
          return { name: param.name, label: param.label, kind: param.kind, unit: param.unit, min: param.min, max: param.max, step: param.step, default: param.default as number, options: null };
        }
        const choices = optionsFor(param.kind, options);
        const fallback = typeof param.default === "string" && choices.some((option) => option.value === param.default) ? param.default : (choices[0]?.value ?? null);
        return {
          name: param.name,
          label: param.label,
          kind: param.kind,
          unit: null,
          min: null,
          max: null,
          step: null,
          default: param.kind === "statuses" ? [] : fallback,
          options: choices,
        };
      }),
      categories: [...check.categories],
      default_categories: [...check.defaultCategories],
      measurable: missing.length === 0,
      missing_evidence: missing,
    };
  });
}

/** What a custom rule is checked against on a board: its checks, its issue types and the rules it runs. */
export function customRuleBoard(options: BoardOptions, rules: readonly { def: RuleDef }[]): CustomRuleBoard {
  return {
    checks: boardChecks(options),
    issueTypes: options.issueTypes,
    rules: rules.map((rule) => ({ rule_id: rule.def.id, title: rule.def.title })),
  };
}

/* ------------------------------------------------- a rule as it is read -- */

/** A rule's params as a definition holds them: numbers, names and statuses. */
type Params = Readonly<Record<string, number | string | readonly string[]>>;

const numberOf = (params: Params, name: string) => Number(params[name]);
const namesOf = (params: Params, name: string): string[] => {
  const value = params[name];
  return Array.isArray(value) ? [...value] : typeof value === "string" ? [value] : [];
};

/**
 * The limit of one of the four new checks in words, as GET /rules writes a threshold ("Over 3 days in In Progress",
 * "Open over 30 days", "No change for 7 days", "No epic"); null for a check of the catalogue's, whose words are
 * board-rules.ts's.
 */
export function newCheckThreshold(check: string, params: Params): string | null {
  switch (check) {
    case "time_in_status_over":
      return `Over ${limitWords(numberOf(params, "hours"))} in ${listWords(namesOf(params, "statuses"), "or")}`;
    case "open_longer_than":
      return `Open over ${unitWords("days", numberOf(params, "days"))}`;
    case "no_update_for":
      return `No change for ${unitWords("days", numberOf(params, "days"))}`;
    case "missing_field": {
      const field = String(params.field) as MissingField;
      return field === "sprint" ? "In no sprint" : `No ${(MISSING_FIELD_LABELS[field] ?? field).toLowerCase()}`;
    }
    default:
      return null;
  }
}

/** What a check reads from Jira, in plain words, as GET /rules `needs` says it (routes/rules.py `_needs`). */
export function checkNeeds(check: string, params: Params): string[] {
  const evidence = typeof params.evidence === "string" ? `${stageWords(params.evidence)} evidence` : "Evidence";
  switch (check) {
    case "time_in_status_over":
      return ["Status history"];
    case "open_longer_than":
      return ["Created date"];
    case "no_update_for":
      return ["Last updated"];
    case "missing_field": {
      const field = String(params.field);
      return [field === "estimate" ? "Estimate (story points)" : field === "sprint" ? "Sprints" : (MISSING_FIELD_LABELS[field as MissingField] ?? field)];
    }
    case "missing_estimate":
      return ["Estimate (story points)", "Status history"];
    case "estimate_after_start":
      return ["Estimate (story points)", "Field history"];
    case "effort_ratio_at_least":
      return ["Estimate (story points)", "Logged time"];
    case "entered_stage_without_evidence":
      return [evidence, `A ${stageWords(String(params.stage)).toLowerCase()} stage in the workflow`];
    case "skipped_stage":
      return ["Mapped stages", "Status history"];
    case "reopened":
      return ["Status history"];
    case "in_progress_unassigned":
      return ["Assignee"];
    case "stuck_in_status":
      return ["Status history", "Closed work from the last 180 days"];
    case "no_evidence_after_percentile":
      return [evidence, "Closed work from the last 180 days"];
    case "unestimated_in_active_sprint":
      return ["Sprints", "Estimate (story points)"];
    case "sprint_at_risk":
      return ["Sprints"];
    default:
      return [];
  }
}

/**
 * A custom rule as the engine and every view read a rule: its definition, reported at `severity`, its evidence
 * needs worked out from its params (so a board that records no code review cannot measure one that needs it).
 */
export function customRuleDef(record: CustomRuleRecord, severity: Severity, threshold: string | null): RuleDef {
  const evidence = typeof record.params.evidence === "string" ? [record.params.evidence] : [];
  const stage = record.check === "entered_stage_without_evidence" && typeof record.params.stage === "string" ? [record.params.stage] : [];
  return {
    id: record.id,
    title: record.title,
    description: record.description ?? "",
    check: record.check,
    params: record.params,
    scope: CHECKS_BY_NAME.get(record.check)?.scope ?? "issue",
    kind: record.kind,
    severity,
    threshold,
    needs: checkNeeds(record.check, record.params),
    requiresEvidence: evidence,
    requiresStages: stage,
    escalatesTo: null,
    appliesTo: record.appliesTo,
  };
}

/** A custom rule's definition in plain fields, as the history keeps it: what was added, deleted or brought back. */
export function definitionOf(record: CustomRuleRecord, severity: Severity): CustomRuleDefinition {
  return {
    title: record.title,
    description: record.description,
    check: record.check,
    params: { ...record.params },
    applies_to: { status_category: [...record.appliesTo.statusCategory], issue_type: record.appliesTo.issueType ? [...record.appliesTo.issueType] : null },
    severity,
  };
}
