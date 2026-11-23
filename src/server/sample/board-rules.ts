import { customRuleProblems, paramProblem, titleProblem, type CustomRuleInput } from "@/lib/api/custom-rules";
import {
  CROSS_RULE_WORDS,
  CUSTOM_RULE_LIMIT,
  CUSTOM_RULE_WORDS,
  isSettingChange,
  RULE_PARAM_REGISTRY,
  type ParamValue,
  type RuleParamSpec,
  type RuleSettingsChange,
  type RuleSettingsFieldChange,
  type Severity,
} from "@/lib/api/schemas";

import { RULES, RULES_VERSION, type RuleDef } from "./catalogue";
import {
  customRuleBoard,
  customRuleDef,
  customRuleId,
  customVersion,
  definitionOf,
  newCheckThreshold,
  type BoardOptions,
  type CustomRuleRecord,
} from "./custom-rules";

/*
 * A board's rules as its settings make them (JO-15), for the sample: the
 * sample's mirror of the service's oversight/rules/settings.py. The catalogue
 * (rules.yaml, sample/catalogue.ts) is every board's default; a board keeps
 * only what differs from it, per rule: on or off, the severity, and the
 * thresholds the contract's registry lets an admin change. Since JO-20 a
 * board also keeps rules of its own (custom-rules.ts), after the catalogue's:
 * each with its check, params and scope as it was added or last edited, on or
 * off and its severity kept as a catalogue rule's are. Pure functions: the
 * settings themselves live in settings-store.ts.
 */

/** What a board keeps for one rule: only the fields that differ from the catalogue (a custom rule: from how it was added). */
export interface RuleOverride {
  enabled?: boolean;
  severity?: Severity;
  params?: Readonly<Record<string, number>>;
}

export type BoardOverrides = ReadonlyMap<string, RuleOverride>;
export const NO_OVERRIDES: BoardOverrides = new Map();

/** One rule as a board runs it: a catalogue rule, or (JO-20) one of the board's own. */
export interface BoardRule {
  /** The rule as the board reports it: the catalogue's, with the board's severity and threshold in words. */
  def: RuleDef;
  /** The catalogue's rule; a custom rule's own as it was added or last edited, at the severity it was added with. */
  catalogue: RuleDef;
  enabled: boolean;
  /**
   * Its findings' rule version: the catalogue's while the severity is the catalogue's, else "0.1.0+breach", so a
   * severity change alone gives the rule new finding ids; on or off and thresholds never do. A custom rule's is the
   * revision that added it, `c3` (`c3+warning` at another severity than it was added with).
   */
  version: string;
  /** Every number param's value on the board: a catalogue rule's editable thresholds, a custom rule's numbers. */
  params: Readonly<Record<string, number>>;
  customised: boolean;
  /** A board's own rule (JO-20), as the board keeps it; null for a catalogue rule. */
  custom: CustomRuleRecord | null;
}

/** The thresholds a board may change for a catalogue rule, by its check (none for most). */
export function editableParams(rule: RuleDef): readonly RuleParamSpec[] {
  return RULE_PARAM_REGISTRY[rule.check] ?? [];
}

/** A threshold's catalogue value: rules.yaml's, else the check's own default. Finding identity is built from it. */
export function catalogueParam(rule: RuleDef, name: string): number {
  const set = rule.params[name];
  if (typeof set === "number") return set;
  const fallback = editableParams(rule).find((spec) => spec.name === name)?.fallback;
  if (typeof fallback !== "number") throw new Error(`${rule.id} has no value for ${name}`);
  return fallback;
}

/** 1 -> "1", 1.5 -> "1.5", 30.000000000000004 -> "30": a number as the service's `:g` writes it. */
export function numberWords(value: number): string {
  return String(Number(value.toPrecision(6)));
}

/**
 * A rule's threshold in words, with its check's defaults, as the service's GET /rules writes it; null when it has
 * none. The four checks JO-20 added read as their limits do ("Over 3 days in In Progress", "Open over 30 days").
 */
export function thresholdText(rule: Pick<RuleDef, "check">, params: Readonly<Record<string, number | string | readonly string[]>>): string | null {
  const fresh = newCheckThreshold(rule.check, params);
  if (fresh !== null) return fresh;
  const number = (name: string) => Number(params[name]);
  switch (rule.check) {
    case "estimate_after_start":
      return `${numberWords(number("grace_hours"))} h grace`;
    case "effort_ratio_at_least":
      return `${numberWords(number("threshold"))}×`;
    // In plain words (SQA: "p90 of time in the status" read as jargon); the service's GET /rules is asked for the same.
    case "stuck_in_status":
      return `Slower than ${numberWords(number("pct"))}% of finished work in the status`;
    case "no_evidence_after_percentile":
      return `Slower than ${numberWords(number("pct"))}% of finished work in ${String(params.stage).replace(/_/g, " ")}`;
    case "sprint_at_risk": {
      const days = number("days_left");
      return `≤ ${numberWords(days)} ${days === 1 ? "day" : "days"} left, > ${numberWords(number("not_started_share") * 100)}% not started`;
    }
    default:
      return null;
  }
}

/** One catalogue rule under a board's override (none: the catalogue's rule as it is). */
export function boardRule(catalogue: RuleDef, override: RuleOverride | undefined): BoardRule {
  const params: Record<string, number> = {};
  for (const spec of editableParams(catalogue)) params[spec.name] = override?.params?.[spec.name] ?? catalogueParam(catalogue, spec.name);
  const severity = override?.severity ?? catalogue.severity;
  const enabled = override?.enabled ?? true;
  const customised =
    enabled !== true || severity !== catalogue.severity || Object.entries(params).some(([name, value]) => value !== catalogueParam(catalogue, name));
  return {
    def: { ...catalogue, severity, threshold: thresholdText(catalogue, { ...catalogue.params, ...params }) },
    catalogue,
    enabled,
    version: severity === catalogue.severity ? RULES_VERSION : `${RULES_VERSION}+${severity}`,
    params,
    customised,
    custom: null,
  };
}

/** A custom rule's number params, by name. */
function numbersOf(params: Readonly<Record<string, ParamValue>>): Record<string, number> {
  return Object.fromEntries(Object.entries(params).filter((entry): entry is [string, number] => typeof entry[1] === "number"));
}

/** One of the board's own rules (JO-20) under its override: on or off, and the severity the board reports it at. */
export function customBoardRule(record: CustomRuleRecord, override: RuleOverride | undefined): BoardRule {
  const severity = override?.severity ?? record.severity;
  const threshold = thresholdText(record, record.params);
  return {
    def: customRuleDef(record, severity, threshold),
    catalogue: customRuleDef(record, record.severity, threshold),
    enabled: override?.enabled ?? true,
    version: customVersion(record, severity),
    params: numbersOf(record.params),
    customised: false,
    custom: record,
  };
}

/** Every rule a board runs, in order: the catalogue's, then (JO-20) its own that stand, oldest first. */
export function boardRules(overrides: BoardOverrides = NO_OVERRIDES, custom: readonly CustomRuleRecord[] = []): BoardRule[] {
  return [
    ...RULES.map((rule) => boardRule(rule, overrides.get(rule.id))),
    ...custom.filter((record) => record.deletedAt === null).map((record) => customBoardRule(record, overrides.get(record.id))),
  ];
}

/** A board's rules by id. */
export function rulesById(rules: readonly BoardRule[]): ReadonlyMap<string, BoardRule> {
  return new Map(rules.map((rule) => [rule.def.id, rule]));
}

/** One threshold of one rule on the board (the catalogue's for a rule the board does not know). */
function boardParam(rules: readonly BoardRule[], ruleId: string, name: string): number {
  const rule = rules.find((candidate) => candidate.def.id === ruleId);
  return rule?.params[name] ?? catalogueParam(RULES.find((candidate) => candidate.id === ruleId)!, name);
}

/** R-EFF-01's threshold on the board: what an effort ratio is drawn and judged against (the ticket page, the scorecard, Ask). */
export function effortThreshold(rules: readonly BoardRule[]): number {
  return boardParam(rules, "R-EFF-01", "threshold");
}

/** R-EST-02's grace on the board, in hours: how long after work starts an estimate still counts as before it. */
export function estimateGraceHours(rules: readonly BoardRule[]): number {
  return boardParam(rules, "R-EST-02", "grace_hours");
}

/**
 * What a board keeps for a rule set as `wanted`: only the fields that differ from the catalogue (undefined for none).
 * A custom rule's numbers live in its own definition, so only its switch and severity are kept here.
 */
function overrideFor(rule: BoardRule, wanted: { enabled: boolean; severity: Severity; params: Readonly<Record<string, number>> }): RuleOverride | undefined {
  const base = rule.custom ? rule.custom.severity : rule.catalogue.severity;
  const params = rule.custom ? {} : Object.fromEntries(Object.entries(wanted.params).filter(([name, value]) => value !== catalogueParam(rule.catalogue, name)));
  const override: RuleOverride = {
    ...(wanted.enabled !== true ? { enabled: wanted.enabled } : {}),
    ...(wanted.severity !== base ? { severity: wanted.severity } : {}),
    ...(Object.keys(params).length > 0 ? { params } : {}),
  };
  return Object.keys(override).length > 0 ? override : undefined;
}

/** A problem with a change set, at "RULE-ID.field" (or "new-0.title" for a new rule, or a field of the request), in plain words. */
export interface SettingsProblem {
  path: string;
  message: string;
}

/**
 * What a change set reads beyond the board's rules (JO-20): the board's own rules as they stand, deleted ones too
 * (an undo brings one back), what a custom rule may name there, and the moment, the reader and the revision the
 * change would make; and the next free number of a custom rule's id of each kind, across every board.
 */
export interface ChangeContext {
  options: BoardOptions;
  custom: readonly CustomRuleRecord[];
  /** The board's overrides as they stand: a deleted custom rule's are kept, for an undo to bring back with it. */
  overrides: BoardOverrides;
  at: number;
  by: string;
  revision: number;
  nextNumber: (letter: "R" | "W") => number;
}

export type Applied =
  | { ok: true; overrides: BoardOverrides; custom: CustomRuleRecord[]; created: string[] }
  | { ok: false; problems: SettingsProblem[] };

const sameValue = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A custom rule's definition as the shared check reads it. */
function inputOf(record: CustomRuleRecord): CustomRuleInput {
  return {
    title: record.title,
    description: record.description,
    check: record.check,
    params: record.params,
    applies_to: { status_category: record.appliesTo.statusCategory, issue_type: record.appliesTo.issueType },
    severity: record.severity,
  };
}

/**
 * Whether a set of changes may be made to a board as it is (the service's
 * validation, beyond what the request's schema already checked): every rule
 * is the board's, every threshold one of its rule's, every change changes
 * something, and a warning that escalates to a breach of the same check keeps
 * its threshold strictly below the breach's while both run. A new rule (JO-20)
 * is checked against the board's checks and names, as the page checks it, and
 * given its id; an edit, a delete and a restore are for the board's own rules
 * alone, and a board holds at most 50 of them. The new overrides and custom
 * rules when it may.
 */
export function applyChanges(rules: readonly BoardRule[], changes: readonly RuleSettingsChange[], context?: ChangeContext): Applied {
  const current = rulesById(rules);
  const problems: SettingsProblem[] = [];
  const next = new Map<string, RuleOverride>();
  for (const rule of rules) {
    const kept = overrideFor(rule, { enabled: rule.enabled, severity: rule.def.severity, params: rule.params });
    if (kept) next.set(rule.def.id, kept);
  }
  // A deleted custom rule's switch and severity stay with it, for an undo to bring it back as it was.
  for (const [id, override] of context?.overrides ?? NO_OVERRIDES) if (!current.has(id)) next.set(id, override);
  const records = (context?.custom ?? []).map((record) => ({ ...record }));
  const recordOf = new Map(records.map((record) => [record.id, record]));
  const created: string[] = [];
  const createTitles = changes.flatMap((change) => ("rule" in change ? [change.rule.title] : []));
  const board = context ? customRuleBoard(context.options, rules) : null;
  const checkParam = (check: string, name: string) => (board?.checks.find((candidate) => candidate.name === check)?.params ?? []).find((param) => param.name === name);
  const taken = { R: 0, W: 0 };
  let creates = 0;

  for (const change of changes) {
    if (isSettingChange(change)) {
      const rule = current.get(change.rule_id);
      if (!rule) {
        problems.push({ path: `${change.rule_id}.rule_id`, message: "There is no such rule on this board." });
        continue;
      }
      if (rule.custom && change.reset) {
        problems.push({ path: `${change.rule_id}.reset`, message: "A custom rule has no catalogue settings to go back to." });
        continue;
      }
      const editable = new Set(rule.custom ? Object.keys(rule.params) : editableParams(rule.catalogue).map((spec) => spec.name));
      const unknown = Object.keys(change.params ?? {}).filter((name) => !editable.has(name));
      for (const name of unknown) problems.push({ path: `${change.rule_id}.params.${name}`, message: `${rule.def.id} has no threshold called ${name} that can be changed.` });
      if (unknown.length > 0) continue;
      if (rule.custom) {
        const found = Object.entries(change.params ?? {}).flatMap(([name, value]) => {
          const spec = checkParam(rule.custom!.check, name);
          const problem = spec ? paramProblem(spec, value) : null;
          return problem ? [{ path: `${change.rule_id}.params.${name}`, message: problem }] : [];
        });
        if (found.length > 0) {
          problems.push(...found);
          continue;
        }
      }
      const wanted = change.reset
        ? { enabled: true, severity: rule.catalogue.severity, params: Object.fromEntries([...editable].map((name) => [name, catalogueParam(rule.catalogue, name)])) }
        : { enabled: change.enabled ?? rule.enabled, severity: change.severity ?? rule.def.severity, params: { ...rule.params, ...change.params } };
      const same = wanted.enabled === rule.enabled && wanted.severity === rule.def.severity && Object.entries(wanted.params).every(([name, value]) => value === rule.params[name]);
      if (same) {
        problems.push({ path: `${change.rule_id}.${change.reset ? "reset" : "rule_id"}`, message: `This changes nothing: ${rule.def.id} already runs so on this board.` });
        continue;
      }
      if (rule.custom) {
        const record = recordOf.get(rule.def.id)!;
        if (change.params) Object.assign(record, { params: { ...record.params, ...change.params }, updatedAt: context?.at ?? record.updatedAt });
      }
      const override = overrideFor(rule, wanted);
      if (override) next.set(rule.def.id, override);
      else next.delete(rule.def.id);
      continue;
    }

    if (!context || !board) {
      problems.push({ path: "(settings)", message: "Custom rules cannot be changed here." });
      continue;
    }

    if (change.op === "create") {
      const index = creates;
      creates += 1;
      const spec = change.rule;
      const input: CustomRuleInput = { ...spec, description: spec.description ?? null };
      const others = createTitles.filter((_, position) => position !== index);
      const found = customRuleProblems(input, board, { others });
      if (found.length > 0) {
        problems.push(...found.map((problem) => ({ path: `new-${index}.${problem.field}`, message: problem.message })));
        continue;
      }
      const letter = spec.severity === "breach" ? "R" : "W";
      const id = customRuleId(spec.severity, context.nextNumber(letter) + taken[letter]);
      taken[letter] += 1;
      const record: CustomRuleRecord = {
        id,
        title: spec.title,
        description: spec.description ?? null,
        kind: spec.severity === "breach" ? "rule" : "warning",
        severity: spec.severity,
        check: spec.check,
        params: spec.params,
        appliesTo: { statusCategory: spec.applies_to.status_category, issueType: spec.applies_to.issue_type },
        createdAt: context.at,
        createdRevision: context.revision,
        createdBy: context.by,
        updatedAt: context.at,
        deletedAt: null,
      };
      records.push(record);
      recordOf.set(id, record);
      created.push(id);
      continue;
    }

    const rule = current.get(change.rule_id);
    const record = recordOf.get(change.rule_id);
    if (change.op === "restore") {
      if (!record || record.deletedAt === null) {
        problems.push({ path: change.rule_id, message: `There is no deleted rule ${change.rule_id} on this board to bring back.` });
        continue;
      }
      const clash = titleProblem(record.title, board, { others: createTitles });
      if (clash) {
        problems.push({ path: `${change.rule_id}.title`, message: clash });
        continue;
      }
      Object.assign(record, { deletedAt: null, updatedAt: context.at });
      continue;
    }
    if (!rule?.custom || !record) {
      const words = change.op === "delete" ? "Only a rule added to this board can be deleted. Turn this one off instead." : "Only a rule added to this board can be edited.";
      problems.push({ path: change.rule_id, message: rule ? words : "There is no such rule on this board." });
      continue;
    }
    if (change.op === "delete") {
      Object.assign(record, { deletedAt: context.at, updatedAt: context.at });
      continue;
    }

    // An edit: its definition as it would stand, checked as a new rule is, its own name no clash.
    const merged: CustomRuleInput = {
      ...inputOf(record),
      ...(change.title !== undefined ? { title: change.title } : {}),
      ...(change.description !== undefined ? { description: change.description } : {}),
      params: { ...record.params, ...change.params },
      ...(change.applies_to !== undefined ? { applies_to: change.applies_to } : {}),
    };
    const found = customRuleProblems(merged, board, { ruleId: record.id, others: createTitles });
    if (found.length > 0) {
      problems.push(...found.map((problem) => ({ path: `${change.rule_id}.${problem.field}`, message: problem.message })));
      continue;
    }
    // Its definition alone: its switch and severity are a setting change's, in a save of their own.
    if (sameValue(merged, inputOf(record))) {
      problems.push({ path: change.rule_id, message: `This changes nothing: ${rule.def.id} already runs so on this board.` });
      continue;
    }
    Object.assign(record, {
      title: merged.title,
      description: merged.description,
      params: merged.params,
      appliesTo: { statusCategory: merged.applies_to.status_category, issueType: merged.applies_to.issue_type },
      updatedAt: context.at,
    });
  }

  const standing = records.filter((record) => record.deletedAt === null).length;
  if (problems.length === 0 && standing > CUSTOM_RULE_LIMIT && standing > (context?.custom ?? []).filter((record) => record.deletedAt === null).length) {
    problems.push({ path: creates > 0 ? `new-${Math.max(0, creates - (standing - CUSTOM_RULE_LIMIT))}` : "(settings)", message: CUSTOM_RULE_WORDS.limit });
  }
  if (problems.length > 0) return { ok: false, problems };
  problems.push(...crossRuleProblems(boardRules(next, records), changes));
  return problems.length > 0 ? { ok: false, problems } : { ok: true, overrides: next, custom: records, created };
}

/**
 * The cross-rule rule: a warning that escalates to a breach rule with the same
 * check and a threshold (W-EFF-01 to R-EFF-01) fires strictly below it while
 * both run on the board. Said on the threshold the change set touched, or on
 * the warning's when it touched neither.
 */
export function crossRuleProblems(rules: readonly BoardRule[], changes: readonly RuleSettingsChange[] = []): SettingsProblem[] {
  const byId = rulesById(rules);
  const touched = new Set(changes.flatMap((change) => ("rule_id" in change ? [change.rule_id] : [])));
  const problems: SettingsProblem[] = [];
  for (const warning of rules) {
    const breach = warning.catalogue.escalatesTo ? byId.get(warning.catalogue.escalatesTo) : undefined;
    if (!breach || breach.catalogue.check !== warning.catalogue.check) continue;
    if (!("threshold" in warning.params) || !("threshold" in breach.params) || !warning.enabled || !breach.enabled) continue;
    if (warning.params.threshold < breach.params.threshold) continue;
    const onBreach = touched.has(breach.def.id);
    const onWarning = touched.has(warning.def.id) || !onBreach;
    // In the words the page says it in itself (CROSS_RULE_WORDS), the threshold an effort ratio, in ×.
    if (onWarning) {
      problems.push({
        path: `${warning.def.id}.params.threshold`,
        message: CROSS_RULE_WORDS.onWarning(breach.def.id, `${numberWords(breach.params.threshold)}×`),
      });
    }
    if (onBreach) {
      problems.push({
        path: `${breach.def.id}.params.threshold`,
        message: CROSS_RULE_WORDS.onBreach(warning.def.id, `${numberWords(warning.params.threshold)}×`),
      });
    }
  }
  return problems;
}

/**
 * Each field a change set moved, as the history records it: the values the board ran before and after. A custom
 * rule added, deleted or brought back (JO-20) is one `rule` field with its definition; an edit names each of its
 * fields that moved (title, description, what it looks at, each param), after its switch and its severity.
 */
export function fieldChanges(before: readonly BoardRule[], after: readonly BoardRule[]): RuleSettingsFieldChange[] {
  const then = rulesById(before);
  const now = rulesById(after);
  const lines = after.flatMap((rule): RuleSettingsFieldChange[] => {
    const id = rule.def.id;
    const old = then.get(id);
    if (!old) return rule.custom ? [{ rule_id: id, field: "rule", from: null, to: definitionOf(rule.custom, rule.def.severity) }] : [];
    const switched: RuleSettingsFieldChange[] = [
      ...(old.enabled !== rule.enabled ? [{ rule_id: id, field: "enabled", from: old.enabled, to: rule.enabled }] : []),
      ...(old.def.severity !== rule.def.severity ? [{ rule_id: id, field: "severity", from: old.def.severity, to: rule.def.severity }] : []),
    ];
    if (!rule.custom || !old.custom) {
      return [
        ...switched,
        ...Object.entries(rule.params)
          .filter(([name, value]) => old.params[name] !== value)
          .map(([name, value]) => ({ rule_id: id, field: `params.${name}`, from: old.params[name], to: value })),
      ];
    }
    const was = old.custom;
    const is = rule.custom;
    const appliesOf = (record: CustomRuleRecord) => ({ status_category: [...record.appliesTo.statusCategory], issue_type: record.appliesTo.issueType ? [...record.appliesTo.issueType] : null });
    return [
      ...switched,
      ...(was.title !== is.title ? [{ rule_id: id, field: "title", from: was.title, to: is.title }] : []),
      ...(was.description !== is.description ? [{ rule_id: id, field: "description", from: was.description, to: is.description }] : []),
      ...(!sameValue(appliesOf(was), appliesOf(is)) ? [{ rule_id: id, field: "applies_to", from: appliesOf(was), to: appliesOf(is) }] : []),
      ...Object.entries(is.params)
        .filter(([name, value]) => !sameValue(was.params[name], value))
        .map(([name, value]) => ({ rule_id: id, field: `params.${name}`, from: was.params[name], to: value })),
    ];
  });
  const deleted = before.flatMap((rule): RuleSettingsFieldChange[] =>
    rule.custom && !now.has(rule.def.id) ? [{ rule_id: rule.def.id, field: "rule", from: definitionOf(rule.custom, rule.def.severity), to: null }] : [],
  );
  return [...lines, ...deleted];
}

/**
 * A canonical key for a board's settings: equal settings share it (an undo back to the catalogue is the catalogue).
 * A custom rule's whole definition is in it, its name too, which its findings carry.
 */
export function settingsKey(overrides: BoardOverrides, custom: readonly CustomRuleRecord[] = []): string {
  return JSON.stringify([
    [...overrides.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([id, override]) => [id, override.enabled ?? null, override.severity ?? null, Object.entries(override.params ?? {}).sort()]),
    custom
      .filter((record) => record.deletedAt === null)
      .map((record) => [record.id, record.title, record.description, record.severity, record.check, record.params, record.appliesTo, record.createdRevision]),
  ]);
}

