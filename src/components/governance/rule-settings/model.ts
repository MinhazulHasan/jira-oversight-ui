import { readNumber } from "@/components/ui/number-field";
import { limitWords, listWords, unitWords } from "@/lib/api/custom-rules";
import {
  CATEGORY_LABELS,
  CROSS_RULE_WORDS,
  MISSING_FIELD_LABELS,
  RULE_PARAM_DECIMALS,
  withinDecimals,
  type AppliesTo,
  type CustomRuleDefinition,
  type MissingField,
  type ParamValue,
  type RuleCheck,
  type RuleParamUnit,
  type RuleSettings,
  type RuleSettingsChange,
  type RuleSettingsFieldChange,
  type RuleSettingsHistoryEntry,
  type RuleSettingsNumberParam,
  type RuleSettingsParam,
  type RuleSettingsRule,
  type Severity,
  type StatusCategory,
} from "@/lib/api/schemas";

export interface CustomDraft {
  title: string;
  description: string;
  check: string;
  choices: Readonly<Record<string, string | readonly string[]>>;
  categories: readonly StatusCategory[];
  /** null: every type but Epic. */
  issueTypes: readonly string[] | null;
}

/** One rule as the page edits it: on or off, the severity, and each threshold's field as typed; a custom rule's definition. */
export interface DraftRule {
  enabled: boolean;
  severity: Severity;
  /** By the threshold's name: the text in its field (a share as a whole percentage, "30"). */
  params: Readonly<Record<string, string>>;
  /** A board's own rule's definition; none for a catalogue rule. */
  custom?: CustomDraft;
}

export type Draft = Readonly<Record<string, DraftRule>>;

/** A rule added in the draft, not saved yet: a key of its own on the page, until the service gives it an id. */
export interface NewRule {
  key: string;
  rule: DraftRule & { custom: CustomDraft };
}

/** What the draft does beyond the rules' fields: the rules it adds, and the board's own rules it deletes. */
export interface DraftExtras {
  added: readonly NewRule[];
  deleted: readonly string[];
}

export const NO_EXTRAS: DraftExtras = { added: [], deleted: [] };

/** Whether a param is a number: a threshold, typed in its field. */
export const isNumberParam = (param: RuleSettingsParam): param is RuleSettingsNumberParam => param.kind === "number";

/** A rule's number params: what its inline fields edit. */
export const numberParams = (rule: Pick<RuleSettingsRule, "params">): RuleSettingsNumberParam[] => rule.params.filter(isNumberParam);

/* ------------------------------------------------------------ values --- */

type UnitHolder = { unit: RuleParamUnit | null };

/** A share is edited as a percentage; everything else as it travels. */
const scale = (param: UnitHolder) => (param.unit === "share" ? 100 : 1);

/** A threshold's value as its field shows it: 1.5 as "1.5", a share of 0.3 as "30". */
export function fieldText(param: UnitHolder, value: number): string {
  return String(Number((value * scale(param)).toFixed(RULE_PARAM_DECIMALS)));
}

/** A field's text as the threshold's value (a percentage back to a share); null when it is not a number. */
export function fieldValue(param: UnitHolder, text: string | undefined): number | null {
  const number = text === undefined ? null : readNumber(text);
  return number === null ? null : Number((number / scale(param)).toFixed(RULE_PARAM_DECIMALS + 2));
}

/** The field's own bounds and step: a share's as percentages. */
export function fieldBounds(param: Pick<RuleSettingsNumberParam, "unit" | "min" | "max" | "step">): { min: number; max: number; step: number } {
  const factor = scale(param);
  const fix = (value: number) => Number((value * factor).toFixed(RULE_PARAM_DECIMALS));
  return { min: fix(param.min), max: fix(param.max), step: fix(param.step) };
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

export function paramWords(param: UnitHolder, value: number, locale?: string): string {
  return param.unit === null ? plain(value, locale) : unitWords(param.unit, value, locale);
}

/* ------------------------------------------------------------- draft --- */

/** A custom rule's definition as the page edits it, from the rule as the board runs it. */
function customOf(rule: RuleSettingsRule): CustomDraft {
  return {
    title: rule.title,
    description: rule.description,
    check: rule.check,
    choices: Object.fromEntries(rule.params.filter((param) => !isNumberParam(param)).map((param) => [param.name, param.value as string | string[]])),
    categories: [...rule.applies_to.status_category],
    issueTypes: rule.applies_to.issue_type ? [...rule.applies_to.issue_type] : null,
  };
}

/** One rule as the board runs it, in the draft's terms. */
function draftRuleOf(rule: RuleSettingsRule): DraftRule {
  return {
    enabled: rule.enabled,
    severity: rule.severity,
    params: Object.fromEntries(numberParams(rule).map((param) => [param.name, fieldText(param, param.value)])),
    ...(rule.custom ? { custom: customOf(rule) } : {}),
  };
}

/** The board's settings as saved, in the draft's terms. */
export function draftOf(settings: Pick<RuleSettings, "rules">): Draft {
  return Object.fromEntries(settings.rules.map((rule) => [rule.rule_id, draftRuleOf(rule)]));
}

/** The catalogue's settings for a rule, in the draft's terms: what "Reset to default" sets. A custom rule's are its own. */
export function defaultsOf(rule: RuleSettingsRule): DraftRule {
  if (rule.custom) return draftRuleOf(rule);
  return {
    enabled: rule.default_enabled,
    severity: rule.default_severity,
    params: Object.fromEntries(numberParams(rule).map((param) => [param.name, fieldText(param, param.default)])),
  };
}

/** Whether two fields say the same: the same number however typed, or the same text. */
function sameField(param: RuleSettingsNumberParam, a: string | undefined, b: string | undefined): boolean {
  const left = fieldValue(param, a);
  const right = fieldValue(param, b);
  return left !== null && right !== null ? left === right : (a ?? "").trim() === (b ?? "").trim();
}

/** Whether a drafted rule is exactly the catalogue's. A custom rule has no catalogue to go back to: always. */
export function atDefaults(rule: RuleSettingsRule, draft: DraftRule | undefined): boolean {
  if (!draft || rule.custom) return true;
  return (
    draft.enabled === rule.default_enabled &&
    draft.severity === rule.default_severity &&
    numberParams(rule).every((param) => fieldValue(param, draft.params[param.name]) === param.default)
  );
}

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** What a custom rule looks at, as the history and a request say it. */
export const appliesOf = (custom: Pick<CustomDraft, "categories" | "issueTypes">): AppliesTo => ({
  status_category: [...custom.categories],
  issue_type: custom.issueTypes ? [...custom.issueTypes] : null,
});

/** One field the draft has changed: a rule's switch, its severity or one of its thresholds; a custom rule's definition. */
export interface FieldEdit {
  ruleId: string;
  /** enabled, severity, params.<name>; and title, description, applies_to. */
  field: string;
}

/** The fields of a custom rule's definition the draft changes: its name, description, what it looks at, its choices. */
function customEdits(ruleId: string, was: CustomDraft, now: CustomDraft): FieldEdit[] {
  return [
    ...(was.title !== now.title ? [{ ruleId, field: "title" }] : []),
    ...(was.description !== now.description ? [{ ruleId, field: "description" }] : []),
    ...(!sameValue(appliesOf(was), appliesOf(now)) ? [{ ruleId, field: "applies_to" }] : []),
    ...Object.keys(now.choices)
      .filter((name) => !sameValue(was.choices[name], now.choices[name]))
      .map((name) => ({ ruleId, field: `params.${name}` })),
  ];
}

export function editsOf(rules: readonly RuleSettingsRule[], base: Draft, draft: Draft, extras: DraftExtras = NO_EXTRAS): FieldEdit[] {
  const deleted = new Set(extras.deleted);
  return rules.flatMap((rule) => {
    const was = base[rule.rule_id];
    const now = draft[rule.rule_id];
    if (!was || !now || deleted.has(rule.rule_id)) return [];
    return [
      ...(was.enabled !== now.enabled ? [{ ruleId: rule.rule_id, field: "enabled" }] : []),
      ...(was.severity !== now.severity ? [{ ruleId: rule.rule_id, field: "severity" }] : []),
      ...(was.custom && now.custom ? customEdits(rule.rule_id, was.custom, now.custom).filter((edit) => !edit.field.startsWith("params.")) : []),
      ...rule.params
        .filter((param) =>
          isNumberParam(param)
            ? !sameField(param, was.params[param.name], now.params[param.name])
            : !sameValue(was.custom?.choices[param.name], now.custom?.choices[param.name]),
        )
        .map((param) => ({ ruleId: rule.rule_id, field: `params.${param.name}` })),
    ];
  });
}

/** How many changes the draft holds, as the bar counts them: each field, and each rule added or deleted. */
export function changeCount(edits: readonly FieldEdit[], extras: DraftExtras): number {
  return edits.length + extras.added.length + extras.deleted.length;
}

/** A drafted custom rule's params as a request sends them: its numbers from their fields, and its choices. */
function paramsOf(rule: RuleSettingsRule | null, check: RuleCheck | undefined, draft: DraftRule & { custom: CustomDraft }): Record<string, ParamValue> {
  const specs = rule ? rule.params : (check?.params ?? []);
  const params: Record<string, ParamValue> = {};
  for (const param of specs) {
    if (param.kind === "number") {
      const value = fieldValue(param, draft.params[param.name]);
      if (value !== null) params[param.name] = value;
    } else {
      const value = draft.custom.choices[param.name];
      if (value !== undefined) params[param.name] = Array.isArray(value) ? [...value] : (value as string);
    }
  }
  return params;
}

export function requestChanges(
  rules: readonly RuleSettingsRule[],
  base: Draft,
  draft: Draft,
  extras: DraftExtras = NO_EXTRAS,
  checks: readonly RuleCheck[] = [],
): RuleSettingsChange[] {
  const deleted = new Set(extras.deleted);
  const changes = rules.flatMap((rule): RuleSettingsChange[] => {
    const was = base[rule.rule_id];
    const now = draft[rule.rule_id];
    if (!was || !now) return [];
    if (deleted.has(rule.rule_id)) return rule.custom ? [{ op: "delete", rule_id: rule.rule_id }] : [];
    const params: Record<string, number> = {};
    for (const param of numberParams(rule)) {
      const value = fieldValue(param, now.params[param.name]);
      if (value !== null && !sameField(param, was.params[param.name], now.params[param.name])) params[param.name] = value;
    }
    const enabled = was.enabled !== now.enabled;
    const severity = was.severity !== now.severity;
    if (rule.custom && was.custom && now.custom) {
      const defined = customEdits(rule.rule_id, was.custom, now.custom);
      if (defined.length > 0) {
        const choices = Object.fromEntries(
          defined.filter((edit) => edit.field.startsWith("params.")).map((edit) => {
            const name = edit.field.slice("params.".length);
            const value = now.custom!.choices[name];
            return [name, Array.isArray(value) ? [...value] : value] as const;
          }),
        );
        const changed = { ...params, ...choices } as Record<string, ParamValue>;
        const fields = new Set(defined.map((edit) => edit.field));
        return [
          {
            op: "edit",
            rule_id: rule.rule_id,
            ...(fields.has("title") ? { title: now.custom.title } : {}),
            ...(fields.has("description") ? { description: now.custom.description || null } : {}),
            ...(Object.keys(changed).length > 0 ? { params: changed } : {}),
            ...(fields.has("applies_to") ? { applies_to: appliesOf(now.custom) } : {}),
          },
        ];
      }
    }
    if (!enabled && !severity && Object.keys(params).length === 0) return [];
    if (!rule.custom && atDefaults(rule, now) && !atDefaults(rule, was)) return [{ rule_id: rule.rule_id, reset: true }];
    return [
      {
        rule_id: rule.rule_id,
        ...(enabled ? { enabled: now.enabled } : {}),
        ...(severity ? { severity: now.severity } : {}),
        ...(Object.keys(params).length > 0 ? { params } : {}),
      },
    ];
  });
  const created = extras.added.map(({ rule }): RuleSettingsChange => {
    const custom = rule.custom;
    return {
      op: "create",
      rule: {
        title: custom.title,
        ...(custom.description.trim() ? { description: custom.description } : {}),
        check: custom.check,
        params: paramsOf(null, checks.find((check) => check.name === custom.check), rule),
        applies_to: appliesOf(custom),
        severity: rule.severity,
      },
    };
  });
  return [...changes, ...created];
}

/* -------------------------------------------------------- validation --- */

/** A field's place, as the page and the route's refusals name it: "R-EFF-01.params.threshold". */
export const fieldPath = (ruleId: string, field: string) => `${ruleId}.${field}`;

/** The element id of a field's control, from its place: what the page focuses to show a problem. */
export const fieldId = (path: string) => `setting-${path.replace(/[^A-Za-z0-9_-]/g, "-")}`;

/** The bounds of a threshold in words, as its field reads them: "from 0.1 to 10", "from 5% to 95%". */
function boundsWords(param: RuleSettingsNumberParam, locale?: string): string {
  return `from ${paramWords(param, param.min, locale)} to ${paramWords(param, param.max, locale)}`;
}

interface ProblemOptions {
  /** The settings the draft started from: a warning and its breach are checked only once the draft touches either. */
  base?: Draft;
  /** The fields the reader has left: an empty one is wrong only once left. */
  touched?: ReadonlySet<string>;
  locale?: string;
  /** The rules the draft adds and deletes: a rule marked for deletion holds nothing back. */
  extras?: DraftExtras;
}

/** A number param's problem in its field: empty (once left), not a number, outside its bounds, too many decimals. */
export function numberProblem(param: RuleSettingsNumberParam, text: string, touched: boolean, locale?: string): string | null {
  const value = fieldValue(param, text);
  if (text.trim() === "") return touched ? `Enter a value ${boundsWords(param, locale)}.` : null;
  if (value === null) return `Enter a number ${boundsWords(param, locale)}.`;
  if (value < param.min || value > param.max) return `Must be ${boundsWords(param, locale)}.`;
  if (!withinDecimals(value)) return `Use at most ${RULE_PARAM_DECIMALS} decimal places.`;
  return null;
}

export function fieldProblems(rules: readonly RuleSettingsRule[], draft: Draft, options: ProblemOptions = {}): Map<string, string> {
  const problems = new Map<string, string>();
  const { touched, locale } = options;
  for (const rule of rules) {
    const now = draft[rule.rule_id];
    if (!now) continue;
    for (const param of numberParams(rule)) {
      const path = fieldPath(rule.rule_id, `params.${param.name}`);
      const problem = numberProblem(param, now.params[param.name] ?? "", touched?.has(path) ?? false, locale);
      if (problem) problems.set(path, problem);
    }
  }
  return problems;
}

export function crossRuleProblems(rules: readonly RuleSettingsRule[], draft: Draft, options: ProblemOptions = {}): Map<string, string> {
  const problems = new Map<string, string>();
  const { base, locale } = options;
  const changed = base ? new Set(editsOf(rules, base, draft).map((edit) => edit.ruleId)) : null;
  const byId = new Map(rules.map((rule) => [rule.rule_id, rule]));
  for (const warning of rules) {
    const breach = warning.escalates_to ? byId.get(warning.escalates_to) : undefined;
    if (!breach || breach.check !== warning.check) continue;
    if (changed && !changed.has(warning.rule_id) && !changed.has(breach.rule_id)) continue;
    const ownParam = numberParams(warning).find((param) => param.name === "threshold");
    const theirParam = numberParams(breach).find((param) => param.name === "threshold");
    const own = draft[warning.rule_id];
    const theirs = draft[breach.rule_id];
    if (!ownParam || !theirParam || !own?.enabled || !theirs?.enabled) continue;
    const ownValue = fieldValue(ownParam, own.params.threshold);
    const theirValue = fieldValue(theirParam, theirs.params.threshold);
    if (ownValue === null || theirValue === null || ownValue < theirValue) continue;
    const moved = (id: string) => base !== undefined && !sameField(ownParam, base[id]?.params.threshold, draft[id]?.params.threshold);
    const onBreach = moved(breach.rule_id);
    const onWarning = moved(warning.rule_id) || !onBreach;
    // The words are the sample's and the service's too (CROSS_RULE_WORDS), so a refusal reads alike wherever it is caught.
    if (onWarning) {
      problems.set(fieldPath(warning.rule_id, "params.threshold"), CROSS_RULE_WORDS.onWarning(breach.rule_id, paramWords(theirParam, theirValue, locale)));
    }
    if (onBreach) {
      problems.set(fieldPath(breach.rule_id, "params.threshold"), CROSS_RULE_WORDS.onBreach(warning.rule_id, paramWords(ownParam, ownValue, locale)));
    }
  }
  return problems;
}

/** A rule's edit and its switch or severity in one draft: what the page says beside the rule. */
export const ONE_CHANGE_WORDS = "Save the edit first, then change its On/Off or severity.";

export function oneChangeProblems(rules: readonly RuleSettingsRule[], base: Draft, draft: Draft, extras: DraftExtras = NO_EXTRAS): Map<string, string> {
  const problems = new Map<string, string>();
  const deleted = new Set(extras.deleted);
  for (const rule of rules) {
    const was = base[rule.rule_id];
    const now = draft[rule.rule_id];
    if (!rule.custom || !was?.custom || !now?.custom || deleted.has(rule.rule_id)) continue;
    if (customEdits(rule.rule_id, was.custom, now.custom).length === 0) continue;
    if (was.enabled !== now.enabled || was.severity !== now.severity) problems.set(fieldPath(rule.rule_id, "enabled"), ONE_CHANGE_WORDS);
  }
  return problems;
}

export function draftProblems(rules: readonly RuleSettingsRule[], draft: Draft, options: ProblemOptions = {}): Map<string, string> {
  const problems = fieldProblems(rules, draft, options);
  for (const [path, message] of crossRuleProblems(rules, draft, options)) if (!problems.has(path)) problems.set(path, message);
  if (options.base) {
    for (const [path, message] of oneChangeProblems(rules, options.base, draft, options.extras)) if (!problems.has(path)) problems.set(path, message);
  }
  return problems;
}

export function blockingProblems(rules: readonly RuleSettingsRule[], base: Draft, draft: Draft, locale?: string, extras: DraftExtras = NO_EXTRAS): Map<string, string> {
  const edited = new Set(editsOf(rules, base, draft, extras).map((edit) => fieldPath(edit.ruleId, edit.field)));
  const every = new Set(rules.flatMap((rule) => numberParams(rule).map((param) => fieldPath(rule.rule_id, `params.${param.name}`))));
  const problems = new Map([...fieldProblems(rules, draft, { touched: every, locale })].filter(([path]) => edited.has(path)));
  for (const [path, message] of crossRuleProblems(rules, draft, { base, locale })) if (!problems.has(path)) problems.set(path, message);
  for (const [path, message] of oneChangeProblems(rules, base, draft, extras)) if (!problems.has(path)) problems.set(path, message);
  return problems;
}

/* ---------------------------------------------------------- history --- */

const isDefinition = (value: unknown): value is CustomRuleDefinition => typeof value === "object" && value !== null && !Array.isArray(value) && "check" in value;

export function undoChanges(entry: Pick<RuleSettingsHistoryEntry, "changes">): RuleSettingsChange[] {
  const byRule = new Map<string, RuleSettingsFieldChange[]>();
  for (const change of entry.changes) byRule.set(change.rule_id, [...(byRule.get(change.rule_id) ?? []), change]);
  return [...byRule].map(([ruleId, changes]): RuleSettingsChange => {
    const whole = changes.find((change) => change.field === "rule");
    if (whole) return whole.from === null ? { op: "delete", rule_id: ruleId } : { op: "restore", rule_id: ruleId };
    const back: { enabled?: boolean; severity?: Severity; params: Record<string, ParamValue> } = { params: {} };
    let defined = false;
    const edit: { title?: string; description?: string | null; applies_to?: AppliesTo } = {};
    for (const change of changes) {
      if (change.field === "enabled" && typeof change.from === "boolean") back.enabled = change.from;
      else if (change.field === "severity" && (change.from === "breach" || change.from === "warning")) back.severity = change.from;
      else if (change.field.startsWith("params.")) {
        const name = change.field.slice("params.".length);
        if (typeof change.from === "number") back.params[name] = change.from;
        else if (typeof change.from === "string" || Array.isArray(change.from)) {
          back.params[name] = Array.isArray(change.from) ? [...(change.from as readonly string[])] : (change.from as string);
          defined = true;
        }
      } else if (change.field === "title" && typeof change.from === "string") {
        edit.title = change.from;
        defined = true;
      } else if (change.field === "description" && (typeof change.from === "string" || change.from === null)) {
        edit.description = change.from;
        defined = true;
      } else if (change.field === "applies_to" && typeof change.from === "object" && change.from !== null && "status_category" in change.from) {
        edit.applies_to = change.from as AppliesTo;
        defined = true;
      }
    }
    const params = Object.keys(back.params).length > 0 ? { params: back.params } : {};
    if (defined) return { op: "edit", rule_id: ruleId, ...edit, ...params };
    const settings = { ...(back.enabled !== undefined ? { enabled: back.enabled } : {}), ...(back.severity !== undefined ? { severity: back.severity } : {}) };
    return { rule_id: ruleId, ...settings, ...(params as { params?: Record<string, number> }) };
  });
}

export const SEVERITY_WORDS: Record<Severity, string> = { breach: "Breach", warning: "Warning" };

/** The words a custom rule's own fields go by. */
const CUSTOM_FIELD_LABELS: Record<string, string> = {
  title: "Name",
  description: "Description",
  applies_to: "Applies to",
  rule: "Rule",
};

function fieldLabel(rules: readonly RuleSettingsRule[], ruleId: string, field: string): string | null {
  if (field === "enabled") return "On this board";
  if (field === "severity") return "Severity";
  const rule = rules.find((candidate) => candidate.rule_id === ruleId);
  if (CUSTOM_FIELD_LABELS[field]) return rule?.custom || !rule ? CUSTOM_FIELD_LABELS[field] : null;
  return rule?.params.find((param) => `params.${param.name}` === field)?.label ?? null;
}

/** "Bugs and Tasks · In progress", "All types · To do and In progress": what a custom rule looks at, in words. */
export function appliesWords(applies: AppliesTo, scope: "issue" | "sprint" = "issue"): string {
  if (scope === "sprint") return "The active sprint";
  const types = applies.issue_type === null ? "All types" : listWords(applies.issue_type);
  const categories = listWords(applies.status_category.map((category) => CATEGORY_LABELS[category]));
  return categories ? `${types} · ${categories}` : types;
}

/** A choice's value in words: statuses as a list, a stage or an evidence name by its label, a field by its word. */
export function choiceWords(param: Pick<RuleSettingsParam, "kind" | "options"> | undefined, value: unknown): string {
  const label = (item: string) => param?.options?.find((option) => option.value === item)?.label ?? item;
  if (Array.isArray(value)) return value.length > 0 ? listWords(value.map((item) => label(String(item)))) : "None";
  if (typeof value === "string") return param?.kind === "field" ? (MISSING_FIELD_LABELS[value as MissingField] ?? value) : label(value);
  return String(value ?? "");
}

/** A field and its values in words: "Effort ratio", "1.5×", "2×"; "On this board", "On", "Off"; "Name", the names. */
export function fieldWords(
  rules: readonly RuleSettingsRule[],
  change: Pick<RuleSettingsFieldChange, "rule_id" | "field"> & { from: unknown; to: unknown },
  locale?: string,
): { label: string; from: string; to: string } {
  const rule = rules.find((candidate) => candidate.rule_id === change.rule_id);
  const words = (value: unknown): string => {
    if (change.field === "enabled") return value === true ? "On" : "Off";
    if (change.field === "severity") return value === "breach" || value === "warning" ? SEVERITY_WORDS[value] : String(value);
    if (change.field === "title") return typeof value === "string" ? `“${value}”` : String(value);
    if (change.field === "description") return typeof value === "string" && value.trim() ? `“${value}”` : "None";
    if (change.field === "applies_to") return typeof value === "object" && value !== null ? appliesWords(value as AppliesTo, rule?.scope) : String(value);
    if (change.field === "rule") return isDefinition(value) ? `“${value.title}”` : "None";
    const name = change.field.slice("params.".length);
    const param = rule?.params.find((candidate) => candidate.name === name);
    if (typeof value === "number") return param && isNumberParam(param) ? paramWords(param, value, locale) : plain(value, locale);
    return choiceWords(param, value);
  };
  const label = fieldLabel(rules, change.rule_id, change.field) ?? change.field.slice("params.".length).replace(/_/g, " ");
  return { label, from: words(change.from), to: words(change.to) };
}

export function ruleChangeWords(change: Pick<RuleSettingsFieldChange, "from" | "to">, options: { undo?: boolean; restore?: boolean } = {}): string | null {
  const added = change.from === null && isDefinition(change.to);
  const gone = change.to === null && isDefinition(change.from);
  if (!added && !gone) return null;
  const title = (added ? change.to : change.from) as CustomRuleDefinition;
  const verb = options.undo ? (added ? "Brings back" : "Deletes") : added ? (options.restore ? "Brought back" : "Added") : "Deleted";
  return `${verb} rule “${title.title}”`;
}

/** A custom rule's definition in a line: its check, its settings and what it looks at ("Time in a status · Stays in “In Progress” for over 3 days · Bug · In progress · Breach"). */
export function definitionWords(definition: CustomRuleDefinition, checks: readonly RuleCheck[], locale?: string): string {
  const check = checks.find((candidate) => candidate.name === definition.check);
  const settings = settingsWords(definition.check, definition.params, check, locale);
  const scope = check?.scope ?? "issue";
  return [check?.label ?? definition.check.replace(/_/g, " "), settings, appliesWords(definition.applies_to, scope), SEVERITY_WORDS[definition.severity]]
    .filter(Boolean)
    .join(" · ");
}

export function settingsWords(check: string, params: Readonly<Record<string, ParamValue>>, spec?: RuleCheck, locale?: string): string {
  const number = (name: string) => Number(params[name]);
  const unit = (name: string) => spec?.params.find((param) => param.name === name)?.unit ?? null;
  const choice = (name: string) => choiceWords(spec?.params.find((param) => param.name === name), params[name]);
  const statuses = Array.isArray(params.statuses) ? listWords(params.statuses.map((status) => `“${status}”`), "or") : "";
  switch (check) {
    case "time_in_status_over":
      // "Stays in", never "In “In Progress”", which reads as a word typed twice.
      return `Stays in ${statuses} for over ${limitWords(number("hours"), locale)}`;
    case "open_longer_than":
      return `Open for over ${unitWords("days", number("days"), locale)}`;
    case "no_update_for":
      return `No change in Jira for ${unitWords("days", number("days"), locale)}`;
    case "missing_field":
      return params.field === "sprint" ? "In no sprint" : `No ${choice("field").toLowerCase()}`;
    case "estimate_after_start":
      return `Grace of ${paramWords({ unit: unit("grace_hours") ?? "hours" }, number("grace_hours"), locale)} after work starts`;
    case "effort_ratio_at_least":
      return `Effort ≥ ${paramWords({ unit: "ratio" }, number("threshold"), locale)} the estimate`;
    case "stuck_in_status":
      return `Longer in the status than ${number("pct")}% of finished work`;
    case "no_evidence_after_percentile":
      return `Longer in ${choice("stage").toLowerCase()} than ${number("pct")}% of finished work, with no ${choice("evidence").toLowerCase()}`;
    case "entered_stage_without_evidence":
      return `Reached ${choice("stage").toLowerCase()} with no ${choice("evidence").toLowerCase()}`;
    case "sprint_at_risk":
      return `≤ ${unitWords("days", number("days_left"), locale)} left and > ${paramWords({ unit: "share" }, number("not_started_share"), locale)} not started`;
    default:
      return "";
  }
}

export function placeWords(
  rules: readonly RuleSettingsRule[],
  path: string,
  added: readonly NewRule[] = [],
): { ruleId: string; title: string; label: string | null } | null {
  const [ruleId, ...field] = path.split(".");
  const rule = rules.find((candidate) => candidate.rule_id === ruleId);
  if (rule) return { ruleId, title: rule.title, label: fieldLabel(rules, ruleId, field.join(".")) };
  const fresh = added.find((candidate) => candidate.key === ruleId);
  return fresh ? { ruleId: "New", title: fresh.rule.custom.title, label: CUSTOM_FIELD_LABELS[field.join(".")] ?? null } : null;
}

/** "3 changes", "1 change". */
export function changesWord(count: number): string {
  return `${count} ${count === 1 ? "change" : "changes"}`;
}

/** The revision a history entry's change was undone in, when a later entry undid it. */
export function undoneIn(history: readonly RuleSettingsHistoryEntry[], entry: RuleSettingsHistoryEntry): number | null {
  return history.find((later) => later.undo_of === entry.change_id)?.revision ?? null;
}
