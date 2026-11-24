import {
  boardText,
  CATEGORY_LABELS,
  characterCount,
  CUSTOM_DESCRIPTION_MAX,
  CUSTOM_RULE_WORDS,
  nameKey,
  plainText,
  RULE_PARAM_DECIMALS,
  titleTextProblem,
  withinDecimals,
  type CheckParam,
  type ParamValue,
  type RuleCheck,
  type RuleParamUnit,
  type Severity,
  type StatusCategory,
} from "./schemas";

/** What a custom rule is checked against: the board's checks (with their options), issue types and rules. */
export interface CustomRuleBoard {
  checks: readonly RuleCheck[];
  issueTypes: readonly string[];
  /** Every rule on the board by id and title (deleted ones left out): a name must be its own. */
  rules: readonly { rule_id: string; title: string }[];
}

/** A custom rule as it is defined: what a new rule sends, an edit makes, or the AI drafts. */
export interface CustomRuleInput {
  title: string;
  description: string | null;
  check: string;
  params: Readonly<Record<string, ParamValue>>;
  applies_to: { status_category: readonly StatusCategory[]; issue_type: readonly string[] | null };
  severity: Severity;
}

/** A problem at a field of the rule: "title", "params.hours", "applies_to.status_category". */
export interface CustomRuleProblem {
  field: string;
  message: string;
}

const NUMBER_WORDS = new Map<string, Intl.NumberFormat>();

function plain(value: number, locale?: string): string {
  const key = locale ?? "";
  let format = NUMBER_WORDS.get(key);
  if (!format) {
    format = new Intl.NumberFormat(locale ?? "en-GB", { maximumFractionDigits: RULE_PARAM_DECIMALS });
    NUMBER_WORDS.set(key, format);
  }
  return format.format(value);
}

export function unitWords(unit: RuleParamUnit, value: number, locale?: string): string {
  switch (unit) {
    case "ratio":
      return `${plain(value, locale)}×`;
    case "hours":
      return `${plain(value, locale)} h`;
    case "percentile":
      return `${plain(value, locale)}%`;
    case "days":
      return `${plain(value, locale)} ${value === 1 ? "day" : "days"}`;
    case "share":
      return `${plain(Math.round(value * 10_000) / 100, locale)}%`;
  }
}

export function limitWords(hours: number, locale?: string): string {
  if (hours >= 48 && Number.isInteger(hours / 24)) return unitWords("days", hours / 24, locale);
  if (hours >= 48) return `${plain(Math.round((hours / 24) * 10) / 10, locale)} days`;
  return unitWords("hours", hours, locale);
}

/** A board's check by its name. */
export function checkOf(board: Pick<CustomRuleBoard, "checks">, name: string): RuleCheck | undefined {
  return board.checks.find((check) => check.name === name);
}

/** The board's name for a value typed in another case ("in progress" for "In Progress"); null when it has none. */
export function boardSpelling(options: readonly string[], value: string): string | null {
  const wanted = boardText(value).toLowerCase();
  return options.find((option) => option.toLowerCase() === wanted) ?? null;
}

/** "a", "a and b", "a, b and c". */
export function listWords(items: readonly string[], conjunction = "and"): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} ${conjunction} ${items.at(-1)}`;
}

/** What is wrong with one param's value on the board; null when nothing is. */
export function paramProblem(param: CheckParam, value: ParamValue | undefined, locale?: string): string | null {
  if (param.kind === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return "Enter a number.";
    if (param.unit !== null && param.min !== null && param.max !== null && (value < param.min || value > param.max)) {
      return `Must be from ${unitWords(param.unit, param.min, locale)} to ${unitWords(param.unit, param.max, locale)}.`;
    }
    return withinDecimals(value) ? null : `Use at most ${RULE_PARAM_DECIMALS} decimal places.`;
  }
  const options = (param.options ?? []).map((option) => option.value);
  if (param.kind === "statuses") {
    if (!Array.isArray(value) || value.length === 0) return CUSTOM_RULE_WORDS.statuses;
    const unknown = value.filter((status) => boardSpelling(options, status) === null);
    if (unknown.length > 0) return `This board has no status called ${listWords(unknown.map((status) => `"${boardText(status)}"`))}.`;
    const named = value.map((status) => boardSpelling(options, status));
    return new Set(named).size === named.length ? null : "Names a status twice.";
  }
  if (typeof value !== "string" || !options.includes(value)) {
    return param.kind === "stage" ? CUSTOM_RULE_WORDS.stage : param.kind === "evidence" ? CUSTOM_RULE_WORDS.evidence : CUSTOM_RULE_WORDS.field;
  }
  return null;
}

/** What is wrong with what the rule looks at, for its check, on the board. */
export function appliesToProblems(check: RuleCheck, applies: CustomRuleInput["applies_to"], issueTypes: readonly string[]): CustomRuleProblem[] {
  const problems: CustomRuleProblem[] = [];
  if (check.scope === "sprint") {
    if (applies.status_category.length > 0 || applies.issue_type !== null) problems.push({ field: "applies_to", message: CUSTOM_RULE_WORDS.sprintScope });
    return problems;
  }
  const categories = applies.status_category;
  if (categories.length === 0) {
    problems.push({ field: "applies_to.status_category", message: CUSTOM_RULE_WORDS.categories });
  } else if (categories.some((category) => !check.categories.includes(category))) {
    const allowed = listWords(check.categories.map((category) => CATEGORY_LABELS[category]));
    problems.push({ field: "applies_to.status_category", message: `This check looks only at ${allowed} work.` });
  }
  if (applies.issue_type !== null) {
    const unknown = applies.issue_type.filter((type) => boardSpelling(issueTypes, type) === null);
    if (applies.issue_type.length === 0) {
      problems.push({ field: "applies_to.issue_type", message: "Pick at least one issue type, or all types." });
    } else if (unknown.length > 0) {
      problems.push({ field: "applies_to.issue_type", message: `This board has no issue type called ${listWords(unknown.map((type) => `"${boardText(type)}"`))}.` });
    }
  }
  return problems;
}

export function titleProblem(title: string, board: Pick<CustomRuleBoard, "rules">, own: { ruleId?: string; others?: readonly string[] } = {}): string | null {
  const text = plainText(title);
  const problem = titleTextProblem(text);
  if (problem) return problem;
  const name = nameKey(text);
  const taken =
    board.rules.some((rule) => rule.rule_id !== own.ruleId && nameKey(rule.title) === name) || (own.others ?? []).some((other) => nameKey(other) === name);
  return taken ? CUSTOM_RULE_WORDS.titleTaken : null;
}

export function customRuleProblems(
  rule: CustomRuleInput,
  board: CustomRuleBoard,
  own: { ruleId?: string; others?: readonly string[] } = {},
  locale?: string,
): CustomRuleProblem[] {
  const problems: CustomRuleProblem[] = [];
  const title = titleProblem(rule.title, board, own);
  if (title) problems.push({ field: "title", message: title });
  const check = checkOf(board, rule.check);
  if (!check) {
    problems.push({ field: "check", message: CUSTOM_RULE_WORDS.check });
  } else {
    for (const param of check.params) {
      const problem = paramProblem(param, rule.params[param.name], locale);
      if (problem) problems.push({ field: `params.${param.name}`, message: problem });
    }
    for (const name of Object.keys(rule.params)) {
      if (!check.params.some((param) => param.name === name)) problems.push({ field: `params.${name}`, message: "Is not a setting of this check." });
    }
    problems.push(...appliesToProblems(check, rule.applies_to, board.issueTypes));
  }
  if (rule.description !== null && characterCount(plainText(rule.description)) > CUSTOM_DESCRIPTION_MAX) {
    problems.push({ field: "description", message: CUSTOM_RULE_WORDS.description });
  }
  return problems;
}

export function canonicalRule(rule: CustomRuleInput, board: CustomRuleBoard): CustomRuleInput {
  const check = checkOf(board, rule.check);
  const statusOptions = (name: string) => (check?.params.find((param) => param.name === name)?.options ?? []).map((option) => option.value);
  const params = Object.fromEntries(
    Object.entries(rule.params).map(([name, value]) => [
      name,
      Array.isArray(value) ? value.map((status) => boardSpelling(statusOptions(name), status) ?? boardText(status)) : value,
    ]),
  );
  const sprint = check?.scope === "sprint";
  return {
    title: plainText(rule.title),
    description: rule.description === null ? null : plainText(rule.description) || null,
    check: rule.check,
    params,
    applies_to: {
      status_category: sprint ? [] : [...rule.applies_to.status_category],
      issue_type: sprint || rule.applies_to.issue_type === null ? null : rule.applies_to.issue_type.map((type) => boardSpelling(board.issueTypes, type) ?? boardText(type)),
    },
    severity: rule.severity,
  };
}
