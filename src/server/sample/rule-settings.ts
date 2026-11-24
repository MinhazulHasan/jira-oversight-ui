import { canonicalRule, customRuleProblems } from "@/lib/api/custom-rules";
import {
  CHECKS_BY_NAME,
  CUSTOM_RULE_LIMIT,
  RULE_SETTINGS_CONFLICT,
  RULE_SETTINGS_EXAMPLES_MAX,
  RULE_SETTINGS_HISTORY_MAX,
  changeRuleId,
  type RuleDraft,
  type RuleDraftRequest,
  type RuleSettings,
  type RuleSettingsApply,
  type RuleSettingsImpact,
  type RuleSettingsParam,
  type RuleSettingsPreview,
  type RuleSettingsPreviewRequest,
  type RuleSettingsRule,
  type RuleSettingsSaveRequest,
} from "@/lib/api/schemas";

import { applyChanges, catalogueParam, editableParams, fieldChanges, NO_OVERRIDES, type BoardRule, type ChangeContext, type SettingsProblem } from "./board-rules";
import { missingFor, RULES_VERSION } from "./catalogue";
import { boardChecks, boardOptions, customRuleBoard, type BoardOptions } from "./custom-rules";
import { meta, sampleDataset, simulateRecheck, type Dataset } from "./dataset";
import { scriptedDraft } from "./drafter";
import type { FindingRecord } from "./engine";
import { boardSettings, nextCustomNumber, recordChange, revisionOf, startRecheck, type BoardSettings } from "./settings-store";
import { iso } from "./time";

/** What the sample answers: a body, or the service's refusal in this interface's words. */
export type SettingsAnswer =
  | { ok: true; body: unknown }
  | { ok: false; status: 409 | 422; error: "rule_settings_conflict" | "rule_settings_invalid"; message: string; issues?: SettingsProblem[] };

export const SETTINGS_INVALID = "Some of these rule settings cannot be saved. Each problem is said beside its setting.";
/** The service's note on a rule left on that the board cannot measure: the change does nothing until it can run. */
export const NOT_MEASURABLE_NOTE = "Not measurable on this board, so this change has no effect until it can run.";

/** Who saved a change, as the access log names a reader: a keyed hash and a display name. */
export interface SettingsReader {
  hash: string;
  name: string;
}

function invalid(problems: SettingsProblem[]): SettingsAnswer {
  return { ok: false, status: 422, error: "rule_settings_invalid", message: SETTINGS_INVALID, issues: problems };
}

/** Whether the board's findings reflect its settings: running while the sample's re-check takes its moment. */
function applyState(settings: BoardSettings, revision: number, wallClock: number): RuleSettingsApply {
  const recheck = settings.recheck;
  if (revision === 0 || recheck === null || recheck.revision !== revision) {
    return { state: "applied", applied_revision: revision, started_at: null, finished_at: null, message: null, result: null };
  }
  const startedAt = iso(recheck.startedAt);
  if (wallClock < recheck.endsAt) {
    return { state: "running", applied_revision: revision - 1, started_at: startedAt, finished_at: null, message: null, result: null };
  }
  return { state: "applied", applied_revision: revision, started_at: startedAt, finished_at: startedAt, message: null, result: recheck.result };
}

/** A check's label from the registry ("Time in a status"); the check's name in words for one it does not hold. */
const checkLabel = (check: string) => CHECKS_BY_NAME.get(check)?.label ?? check.replace(/_/g, " ");

/** A catalogue rule's editable thresholds, as the page reads them. */
function catalogueParams(rule: BoardRule): RuleSettingsParam[] {
  return editableParams(rule.catalogue).map((spec) => ({
    name: spec.name,
    label: spec.label,
    kind: "number" as const,
    unit: spec.unit,
    value: rule.params[spec.name],
    default: catalogueParam(rule.catalogue, spec.name),
    min: spec.min,
    max: spec.max,
    step: spec.step,
    options: null,
  }));
}

/** Every param of a custom rule's check, its choices with the board's options, its defaults its own. */
function customParams(rule: BoardRule, options: BoardOptions): RuleSettingsParam[] {
  const record = rule.custom!;
  const check = boardChecks(options).find((candidate) => candidate.name === record.check);
  return (check?.params ?? []).map((param): RuleSettingsParam => {
    const value = record.params[param.name];
    if (param.kind === "number") {
      return {
        name: param.name,
        label: param.label,
        kind: "number",
        unit: param.unit!,
        value: Number(value),
        default: Number(value),
        min: param.min!,
        max: param.max!,
        step: param.step!,
        options: null,
      };
    }
    const chosen = Array.isArray(value) ? [...value] : String(value);
    return { name: param.name, label: param.label, kind: param.kind, unit: null, value: chosen, default: chosen, min: null, max: null, step: null, options: param.options ?? [] };
  });
}

/** One rule as the page reads it: a catalogue rule, or one of the board's own. */
function settingsRule(rule: BoardRule, open: number, options: BoardOptions): RuleSettingsRule {
  const { def, catalogue } = rule;
  const missing = missingFor(catalogue);
  const record = rule.custom;
  return {
    rule_id: def.id,
    title: def.title,
    description: def.description,
    kind: def.kind,
    check: def.check,
    check_label: checkLabel(def.check),
    scope: def.scope,
    escalates_to: def.escalatesTo,
    enabled: rule.enabled,
    default_enabled: true,
    severity: def.severity,
    default_severity: catalogue.severity,
    params: record ? customParams(rule, options) : catalogueParams(rule),
    customised: rule.customised,
    measurable: missing.length === 0,
    missing_evidence: missing,
    open,
    custom: record !== null,
    applies_to: { status_category: [...def.appliesTo.statusCategory], issue_type: def.appliesTo.issueType ? [...def.appliesTo.issueType] : null },
    created_at: record ? iso(record.createdAt) : null,
    created_by: record ? record.createdBy : null,
  };
}

/** The board's settings as they stood at a revision: its overrides and its own rules, deleted ones too. */
function stateAt(settings: BoardSettings, revision: number) {
  const change = revision > 0 ? settings.history[revision - 1] : undefined;
  return { overrides: change?.overrides ?? NO_OVERRIDES, custom: change?.custom ?? [] };
}

/** The board's settings, as the page reads them: every rule as the board runs it, the checks it may add, the newest changes. */
export function settingsView(dataset: Dataset, wallClock: number = Date.now()): RuleSettings {
  const settings = boardSettings(dataset.board.key);
  const options = boardOptions(dataset.world);
  const open = new Map<string, number>();
  for (const finding of dataset.engine.findings) {
    if (finding.resolvedAt === null) open.set(finding.rule.id, (open.get(finding.rule.id) ?? 0) + 1);
  }
  const made = settings.history.slice(0, dataset.revision);
  const latest = made.at(-1) ?? null;
  return {
    meta: meta(dataset),
    project: dataset.board.key,
    revision: dataset.revision,
    catalogue_version: RULES_VERSION,
    updated_at: latest ? iso(latest.at) : null,
    updated_by: latest ? latest.viewer.name : null,
    apply: applyState(settings, dataset.revision, wallClock),
    rules: dataset.rules.map((rule) => settingsRule(rule, open.get(rule.def.id) ?? 0, options)),
    history: made
      .slice()
      .reverse()
      .slice(0, RULE_SETTINGS_HISTORY_MAX)
      .map((change) => ({
        change_id: change.changeId,
        at: iso(change.at),
        revision: change.revision,
        by: { hash: change.viewer.hash, name: change.viewer.name },
        reason: change.reason,
        undo_of: change.undoOf,
        changes: change.changes,
      })),
    checks: boardChecks(options),
    issue_types: [...options.issueTypes],
    custom_limit: CUSTOM_RULE_LIMIT,
    custom_count: dataset.rules.filter((rule) => rule.custom !== null).length,
    ai_draft: { available: true, reason: null },
  };
}

const subjectOf = (finding: FindingRecord) => finding.issue?.key ?? `sprint:${finding.sprint!.id}`;
/** Issues before sprints, then by number (the service's order): "DEMO-2", "DEMO-10", "sprint:26". */
const exampleOrder = (key: string): [number, number, string] => [key.startsWith("sprint:") ? 1 : 0, Number(key.slice(key.search(/\d+$/))), key];

/** Up to five tickets (or sprints) the findings are on, each once, issues by number and then sprints. */
function examples(findings: readonly FindingRecord[]): string[] {
  const compare = (a: string, b: string) => {
    const [left, right] = [exampleOrder(a), exampleOrder(b)];
    return left[0] - right[0] || left[1] - right[1] || (left[2] < right[2] ? -1 : 1);
  };
  return [...new Set(findings.map(subjectOf))].sort(compare).slice(0, RULE_SETTINGS_EXAMPLES_MAX);
}

/** What a change set reads beyond the board's rules: its own rules and options, and the change it would be. */
function contextFor(dataset: Dataset, at: number, by: string): ChangeContext {
  const state = stateAt(boardSettings(dataset.board.key), dataset.revision);
  return {
    options: boardOptions(dataset.world),
    custom: state.custom,
    overrides: state.overrides,
    at,
    by,
    revision: dataset.revision + 1,
    nextNumber: nextCustomNumber,
  };
}

/** What the changes would do to each rule they touch, against the board's data */
export function previewView(dataset: Dataset, request: RuleSettingsPreviewRequest, at: number): SettingsAnswer {
  const applied = applyChanges(dataset.rules, request.changes, contextFor(dataset, at, ""));
  if (!applied.ok) return invalid(applied.problems);
  const outcome = simulateRecheck(dataset, { overrides: applied.overrides, custom: applied.custom }, at);
  const changed = new Set([...request.changes.flatMap((change) => changeRuleId(change) ?? []), ...applied.created]);
  const before = new Map(dataset.rules.map((rule) => [rule.def.id, rule]));
  const after = new Map(outcome.rules.map((rule) => [rule.def.id, rule]));
  const order = [...dataset.rules.map((rule) => rule.def.id), ...outcome.rules.map((rule) => rule.def.id).filter((id) => !before.has(id))];
  const impact: RuleSettingsImpact[] = order
    .filter((id) => changed.has(id))
    .map((id) => {
      const rule = after.get(id) ?? before.get(id)!;
      const openNow = dataset.engine.findings.filter((finding) => finding.rule.id === id && finding.resolvedAt === null).length;
      const closing = outcome.closed.filter((finding) => finding.rule.id === id);
      const opening = outcome.opened.filter((finding) => finding.rule.id === id);
      const measurable = missingFor(rule.catalogue).length === 0;
      // Said, as the service says it, of a rule left on that cannot run here and so would change nothing yet.
      const idle = (after.get(id)?.enabled ?? false) && !measurable && closing.length === 0;
      return {
        rule_id: id,
        measurable,
        open_now: openNow,
        would_open: opening.length,
        would_close: closing.length,
        would_stay: openNow - closing.length,
        examples: { open: examples(opening), close: examples(closing) },
        note: idle ? NOT_MEASURABLE_NOTE : null,
      };
    });
  const body: RuleSettingsPreview = {
    meta: meta(dataset),
    project: dataset.board.key,
    revision: dataset.revision,
    impact,
    totals: {
      would_open: impact.reduce((sum, rule) => sum + rule.would_open, 0),
      would_close: impact.reduce((sum, rule) => sum + rule.would_close, 0),
    },
  };
  return { ok: true, body };
}

/** A save: refused when the board has moved on from the reader's revision (409) */
export function saveView(
  dataset: Dataset,
  request: RuleSettingsSaveRequest,
  reader: SettingsReader,
  at: number,
  recheckMs: number,
  wallClock: number = Date.now(),
): SettingsAnswer {
  const settings = boardSettings(dataset.board.key);
  if (request.revision !== revisionOf(settings) || request.revision !== dataset.revision) {
    return { ok: false, status: 409, error: "rule_settings_conflict", message: RULE_SETTINGS_CONFLICT };
  }
  const applied = applyChanges(dataset.rules, request.changes, contextFor(dataset, at, reader.name));
  const problems = applied.ok ? [] : [...applied.problems];
  if (request.undo_of !== undefined && !settings.history.some((change) => change.changeId === request.undo_of)) {
    problems.push({ path: "undo_of", message: "The change to undo is not one of this board's." });
  }
  if (!applied.ok || problems.length > 0) return invalid(problems);
  const outcome = simulateRecheck(dataset, { overrides: applied.overrides, custom: applied.custom }, at);
  const reason = request.reason?.trim() ? request.reason.trim() : null;
  const stored = recordChange(dataset.board.key, {
    at,
    viewer: { hash: reader.hash, name: reader.name },
    reason,
    undoOf: request.undo_of ?? null,
    changes: fieldChanges(dataset.rules, outcome.rules),
    overrides: applied.overrides,
    custom: applied.custom,
  });
  startRecheck(dataset.board.key, {
    revision: stored.revision,
    startedAt: at,
    endsAt: wallClock + recheckMs,
    result: { opened: outcome.opened.length, closed: outcome.closed.length },
  });
  return { ok: true, body: settingsView(sampleDataset(dataset.now, dataset.board), wallClock) };
}

export function draftView(dataset: Dataset, request: RuleDraftRequest): RuleDraft {
  const options = boardOptions(dataset.world);
  const result = scriptedDraft(request.text, options);
  const base = { meta: meta(dataset), project: dataset.board.key };
  if (result.outcome !== "drafted" || result.draft === null) {
    return { ...base, outcome: result.outcome, draft: null, explanation: null, note: result.note, problems: [] };
  }
  const board = customRuleBoard(options, dataset.rules);
  const draft = canonicalRule(result.draft, board);
  return {
    ...base,
    outcome: "drafted",
    draft: {
      title: draft.title,
      description: draft.description,
      check: draft.check,
      params: Object.fromEntries(Object.entries(draft.params).map(([name, value]) => [name, Array.isArray(value) ? [...value] : value])),
      applies_to: { status_category: [...draft.applies_to.status_category], issue_type: draft.applies_to.issue_type ? [...draft.applies_to.issue_type] : null },
      severity: draft.severity,
    },
    explanation: result.explanation,
    note: null,
    problems: customRuleProblems(draft, board),
  };
}
