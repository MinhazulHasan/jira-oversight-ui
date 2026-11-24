import { ruleSettingsSchema, type CustomRuleDefinition, type RuleSettings } from "@/lib/api/schemas";

import settingsJson from "../../../../../docs/sample-responses/rule-settings.json";

export const AT = "2026-11-04T14:31:00.000Z";
export const ADMIN = { hash: "b".repeat(32), name: "Morgan Ellis" };

export const BUGS: CustomRuleDefinition = {
  title: "Bugs in progress over 3 days",
  description: null,
  check: "time_in_status_over",
  params: { statuses: ["In Progress"], hours: 72 },
  applies_to: { status_category: ["indeterminate"], issue_type: ["Bug"] },
  severity: "breach",
};

export const UNTOUCHED: CustomRuleDefinition = {
  title: "Untouched for 10 days",
  description: "Work nobody has touched lately.",
  check: "no_update_for",
  params: { days: 10 },
  applies_to: { status_category: ["indeterminate"], issue_type: null },
  severity: "warning",
};

/** A custom rule as the board runs it, every param of its check with the board's options, as the service sends one. */
export function ownRule(ruleId: string, definition: CustomRuleDefinition, open = 0): Record<string, unknown> {
  const check = settingsJson.checks.find((candidate) => candidate.name === definition.check)!;
  return {
    rule_id: ruleId,
    title: definition.title,
    description: definition.description ?? "",
    kind: definition.severity === "breach" ? "rule" : "warning",
    check: check.name,
    check_label: check.label,
    scope: check.scope,
    escalates_to: null,
    enabled: true,
    default_enabled: true,
    severity: definition.severity,
    default_severity: definition.severity,
    params: check.params.map((param) =>
      param.kind === "number"
        ? { ...param, value: definition.params[param.name], default: definition.params[param.name], options: null }
        : { ...param, value: definition.params[param.name], unit: null, min: null, max: null, step: null },
    ),
    customised: false,
    measurable: check.measurable,
    missing_evidence: check.missing_evidence,
    open,
    custom: true,
    applies_to: definition.applies_to,
    created_at: AT,
    created_by: ADMIN.name,
  };
}

/** One change in the history, by the admin, at revision `revision`. */
export function entry(revision: number, changes: unknown[], more: Record<string, unknown> = {}) {
  return { change_id: String(revision).repeat(32), at: AT, revision, by: ADMIN, reason: null, undo_of: null, changes, ...more };
}

/** The board with its own rules after the catalogue's, at the history's revision, its findings applied. */
export function board(own: Record<string, unknown>[], history: readonly { revision: number }[] = [], more: Record<string, unknown> = {}): RuleSettings {
  const revision = history[0]?.revision ?? 0;
  return ruleSettingsSchema.parse({
    ...settingsJson,
    revision,
    updated_at: revision > 0 ? AT : null,
    updated_by: revision > 0 ? ADMIN.name : null,
    apply: { state: "applied", applied_revision: revision, started_at: null, finished_at: null, message: null, result: null },
    rules: [...settingsJson.rules, ...own],
    history,
    custom_count: own.length,
    ...more,
  });
}

/** R-CUS-01 (the bugs rule, 2 open) and W-CUS-01 (untouched work, 5 open), each added in a revision of its own. */
export const twoRules = () =>
  board(
    [ownRule("R-CUS-01", BUGS, 2), ownRule("W-CUS-01", UNTOUCHED, 5)],
    [entry(2, [{ rule_id: "W-CUS-01", field: "rule", from: null, to: UNTOUCHED }]), entry(1, [{ rule_id: "R-CUS-01", field: "rule", from: null, to: BUGS }])],
  );
