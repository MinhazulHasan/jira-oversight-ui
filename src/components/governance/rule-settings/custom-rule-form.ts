import { customRuleProblems, type CustomRuleBoard, type CustomRuleInput } from "@/lib/api/custom-rules";
import type { ParamValue, RuleCheck, RuleDraftRule, RuleSettingsNumberParam, Severity, StatusCategory } from "@/lib/api/schemas";

import { fieldText, fieldValue, numberProblem, type CustomDraft, type DraftRule } from "./model";

/*
 * The "New rule" sheet's form (JO-20), kept apart from its components so the
 * sheet, the page and the tests read the same rules: what the form holds, a
 * check's defaults when it is picked, the AI's draft put into it, and what is
 * wrong with it, in the words the service and the sample use too.
 */

/** The form as the admin fills it: its numbers as typed, its choices, what it looks at, how serious it is. */
export interface RuleForm {
  title: string;
  description: string;
  /** The check by name; "" until one is picked. */
  check: string;
  numbers: Readonly<Record<string, string>>;
  choices: Readonly<Record<string, string | readonly string[]>>;
  categories: readonly StatusCategory[];
  /** null: every type but Epic. */
  issueTypes: readonly string[] | null;
  severity: Severity;
}

export const EMPTY_FORM: RuleForm = {
  title: "",
  description: "",
  check: "",
  numbers: {},
  choices: {},
  categories: [],
  issueTypes: null,
  severity: "breach",
};

/** A check's number param, as the threshold helpers read one (its unit, bounds and step are set for a number). */
export function asNumberParam(param: RuleCheck["params"][number]): RuleSettingsNumberParam {
  return {
    name: param.name,
    label: param.label,
    kind: "number",
    unit: param.unit ?? "hours",
    value: typeof param.default === "number" ? param.default : (param.min ?? 0),
    default: typeof param.default === "number" ? param.default : (param.min ?? 0),
    min: param.min ?? 0,
    max: param.max ?? 0,
    step: param.step ?? 1,
    options: null,
  };
}

/** A check's own default for a choice: the board's, else its first option; statuses none until the admin picks them. */
function defaultChoice(param: RuleCheck["params"][number]): string | readonly string[] {
  if (param.kind === "statuses") return Array.isArray(param.default) ? param.default : [];
  if (typeof param.default === "string" && (param.options ?? []).some((option) => option.value === param.default)) return param.default;
  return param.options?.[0]?.value ?? "";
}

/** The form with a check picked: its params at the check's defaults, and the categories it looks at by default. */
export function withCheck(form: RuleForm, check: RuleCheck): RuleForm {
  const numbers: Record<string, string> = {};
  const choices: Record<string, string | readonly string[]> = {};
  for (const param of check.params) {
    if (param.kind === "number") numbers[param.name] = typeof param.default === "number" ? fieldText(asNumberParam(param), param.default) : "";
    else choices[param.name] = defaultChoice(param);
  }
  return {
    ...form,
    check: check.name,
    numbers,
    choices,
    categories: [...check.default_categories],
    issueTypes: check.scope === "sprint" ? null : form.issueTypes,
  };
}

/** The form for a rule already in the draft (a saved custom rule, or one added before): its definition as it stands. */
export function formFromRule(rule: DraftRule & { custom: CustomDraft }): RuleForm {
  return {
    title: rule.custom.title,
    description: rule.custom.description,
    check: rule.custom.check,
    numbers: { ...rule.params },
    choices: { ...rule.custom.choices },
    categories: [...rule.custom.categories],
    issueTypes: rule.custom.issueTypes ? [...rule.custom.issueTypes] : null,
    severity: rule.severity,
  };
}

/**
 * The AI's draft in the form: every field it filled, as the admin would have typed it. A check the board does not
 * offer leaves the check unpicked (the draft's problems say why); a param it left out takes the check's default.
 */
export function formFromAiDraft(draft: RuleDraftRule, checks: readonly RuleCheck[]): RuleForm {
  const check = checks.find((candidate) => candidate.name === draft.check);
  const base: RuleForm = { ...EMPTY_FORM, title: draft.title, description: draft.description ?? "", severity: draft.severity };
  if (!check) return base;
  const filled = withCheck(base, check);
  const numbers = { ...filled.numbers };
  const choices = { ...filled.choices };
  for (const param of check.params) {
    const value = draft.params[param.name];
    if (value === undefined) continue;
    if (param.kind === "number" && typeof value === "number") numbers[param.name] = fieldText(asNumberParam(param), value);
    else if (param.kind !== "number") choices[param.name] = Array.isArray(value) ? [...value] : String(value);
  }
  return {
    ...filled,
    numbers,
    choices,
    categories: check.scope === "sprint" ? [] : [...draft.applies_to.status_category],
    issueTypes: check.scope === "sprint" || draft.applies_to.issue_type === null ? null : [...draft.applies_to.issue_type],
  };
}

/** The form as the rule it defines: its number params read from their fields (those that read as numbers). */
export function formInput(form: RuleForm, check: RuleCheck | undefined): CustomRuleInput {
  const params: Record<string, ParamValue> = {};
  for (const param of check?.params ?? []) {
    if (param.kind === "number") {
      const value = fieldValue(asNumberParam(param), form.numbers[param.name]);
      if (value !== null) params[param.name] = value;
    } else {
      const value = form.choices[param.name];
      if (value !== undefined) params[param.name] = Array.isArray(value) ? [...value] : (value as string);
    }
  }
  return {
    title: form.title,
    description: form.description.trim() ? form.description : null,
    check: form.check,
    params,
    applies_to: { status_category: [...form.categories], issue_type: form.issueTypes ? [...form.issueTypes] : null },
    severity: form.severity,
  };
}

/**
 * What is wrong with the form, by its field ("title", "check", "params.hours", "applies_to.status_category"): a
 * number that is empty, not a number, out of its bounds or too precise first, as the rule settings rows say it;
 * then everything the service would refuse (the shared check, custom-rules.ts), the name against every other rule
 * on the board.
 */
export function formProblems(
  form: RuleForm,
  board: CustomRuleBoard,
  own: { ruleId?: string; others?: readonly string[] } = {},
  locale?: string,
): Map<string, string> {
  const problems = new Map<string, string>();
  const check = board.checks.find((candidate) => candidate.name === form.check);
  for (const param of check?.params ?? []) {
    if (param.kind !== "number") continue;
    const problem = numberProblem(asNumberParam(param), form.numbers[param.name] ?? "", true, locale);
    if (problem) problems.set(`params.${param.name}`, problem);
  }
  for (const problem of customRuleProblems(formInput(form, check), board, own, locale)) {
    if (!problems.has(problem.field)) problems.set(problem.field, problem.message);
  }
  return problems;
}

/**
 * What a rule in the form flags, as one value to compare: its check, its params as they read and what it looks at.
 * Its name, description and seriousness are left out: they change nothing it flags.
 */
export function definitionKey(form: RuleForm, check: RuleCheck | undefined): string {
  const { check: name, params, applies_to } = formInput(form, check);
  return JSON.stringify([name, params, applies_to]);
}

/**
 * A request to draft from on the board's own names, for the Describe box's placeholder: its bugs (or tickets) in its
 * first status in progress ("Bugs in Code Review for more than 3 days"), a status named "In …" said as a reader says
 * it ("Bugs in progress for more than 3 days"); one any board can draft from where it has no status.
 */
export function describeExample(checks: readonly RuleCheck[], issueTypes: readonly string[]): string {
  const statuses = checks.find((check) => check.name === "time_in_status_over")?.params.find((param) => param.kind === "statuses")?.options ?? [];
  const status = statuses.find((option) => option.category === "indeterminate") ?? statuses[0];
  const who = issueTypes.some((type) => type.toLowerCase() === "bug") ? "Bugs" : "Tickets";
  if (!status) return `${who} open for more than 30 days`;
  return `${who} ${/^in\s/i.test(status.value) ? status.value.toLowerCase() : `in ${status.value}`} for more than 3 days`;
}

/** The form as a rule in the page's draft: its numbers as typed, its definition. */
export function formDraftRule(form: RuleForm, enabled = true): DraftRule & { custom: CustomDraft } {
  return {
    enabled,
    severity: form.severity,
    params: { ...form.numbers },
    custom: {
      title: form.title.trim(),
      description: form.description.trim(),
      check: form.check,
      choices: { ...form.choices },
      categories: [...form.categories],
      issueTypes: form.issueTypes ? [...form.issueTypes] : null,
    },
  };
}

/**
 * The form's fields for a check, in the order it asks for them: where a problem can be said, and where the focus goes
 * first when some cannot be saved. A problem at any other place (the rule as a whole) is said with the draft.
 */
export function formFields(check: RuleCheck | undefined): string[] {
  return [
    "title",
    "check",
    ...(check?.params ?? []).map((param) => `params.${param.name}`),
    "applies_to",
    "applies_to.status_category",
    "applies_to.issue_type",
    "severity",
    "description",
  ];
}

/** The first field, in the form's order, with a problem: where the focus goes when the rule cannot be added. */
export function firstProblem(problems: ReadonlyMap<string, string>, check: RuleCheck | undefined): string | null {
  return formFields(check).find((field) => problems.has(field)) ?? [...problems.keys()][0] ?? null;
}
