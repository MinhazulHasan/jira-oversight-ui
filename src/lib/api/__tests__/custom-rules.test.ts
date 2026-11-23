import { describe, expect, it } from "vitest";

import settingsJson from "../../../../docs/sample-responses/rule-settings.json";
import { boardSpelling, canonicalRule, customRuleProblems, limitWords, type CustomRuleBoard, type CustomRuleInput } from "../custom-rules";
import {
  boardText,
  CHECK_REGISTRY,
  CHECKS_BY_NAME,
  CUSTOM_RULE_WORDS,
  nameKey,
  plainText,
  RULE_ID_IN_TEXT,
  RULE_ID_PATTERN,
  RULE_PARAM_BOUNDS,
  RULE_PARAM_REGISTRY,
  ruleDraftRequestSchema,
  ruleDraftSchema,
  ruleSchema,
  ruleSettingsFieldChangeSchema,
  ruleSettingsPreviewRequestSchema,
  ruleSettingsSaveRequestSchema,
  ruleSettingsSchema,
} from "../schemas";

/*
 * The contract's side of custom rules (JO-20): the check registry the form is
 * built from, the widened rule id, each change a request may carry (create,
 * edit, delete, restore) checked and rebuilt before anything is forwarded, the
 * history's new fields, the settings' new parts (and a service still sending
 * JO-15's shapes for the catalogue's params), the draft's request and answer,
 * and the one check every side holds a custom rule to.
 */

const settings = ruleSettingsSchema.parse(settingsJson);
const board: CustomRuleBoard = { checks: settings.checks, issueTypes: settings.issue_types, rules: settings.rules };

const NEW_RULE = {
  title: "Bugs in progress over 3 days",
  check: "time_in_status_over",
  params: { statuses: ["In Progress"], hours: 72 },
  applies_to: { status_category: ["indeterminate"], issue_type: ["Bug"] },
  severity: "breach",
};

const preview = (changes: unknown[]) => ruleSettingsPreviewRequestSchema.safeParse({ changes });
const problems = (changes: unknown[]) => {
  const parsed = preview(changes);
  // Each problem at its place in the changes ("0.rule.title" for changes[0].rule.title).
  return parsed.success ? [] : parsed.error.issues.map((issue) => `${issue.path.slice(1).join(".")}: ${issue.message}`);
};

describe("the check registry", () => {
  it("holds every check a custom rule may use, each named in a few plain words and summed up in one short line", () => {
    expect(CHECK_REGISTRY.map((check) => check.name)).toEqual([
      "time_in_status_over",
      "open_longer_than",
      "no_update_for",
      "missing_field",
      "missing_estimate",
      "estimate_after_start",
      "effort_ratio_at_least",
      "entered_stage_without_evidence",
      "skipped_stage",
      "reopened",
      "in_progress_unassigned",
      "stuck_in_status",
      "no_evidence_after_percentile",
      "unestimated_in_active_sprint",
      "sprint_at_risk",
    ]);
    for (const check of CHECK_REGISTRY) {
      const words = check.label.split(/\s+/).length;
      expect(words, check.name).toBeGreaterThanOrEqual(2);
      expect(words, check.name).toBeLessThanOrEqual(5);
      expect(check.summary.length, check.name).toBeLessThanOrEqual(90);
      expect(check.defaultCategories.every((category) => check.categories.includes(category)), check.name).toBe(true);
    }
    expect(CHECKS_BY_NAME.get("sprint_at_risk")).toMatchObject({ scope: "sprint", categories: [], defaultCategories: [] });
  });

  it("reuses JO-15's thresholds, names and bounds alike, so a threshold means one thing on either kind of rule", () => {
    for (const [check, specs] of Object.entries(RULE_PARAM_REGISTRY)) {
      for (const spec of specs) {
        const param = CHECKS_BY_NAME.get(check)!.params.find((candidate) => candidate.name === spec.name)!;
        expect([param.kind, param.unit, param.min, param.max, param.step], `${check}.${spec.name}`).toEqual(["number", spec.unit, spec.min, spec.max, spec.step]);
      }
    }
    // The four new checks' numbers, with the bounds the spec sets.
    expect(CHECKS_BY_NAME.get("time_in_status_over")!.params.map((param) => [param.name, param.kind, param.min, param.max])).toEqual([
      ["statuses", "statuses", null, null],
      ["hours", "number", 1, 8760],
    ]);
    expect(CHECKS_BY_NAME.get("open_longer_than")!.params[0]).toMatchObject({ name: "days", min: 1, max: 3650 });
    expect(CHECKS_BY_NAME.get("no_update_for")!.params[0]).toMatchObject({ name: "days", min: 1, max: 365 });
    expect(CHECKS_BY_NAME.get("missing_field")!.params[0]).toMatchObject({ name: "field", kind: "field" });
    // A name the checks share holds the widest of their bounds where no check is known (a setting change).
    expect(RULE_PARAM_BOUNDS.get("days")).toEqual({ min: 1, max: 3650 });
    expect(RULE_PARAM_BOUNDS.get("hours")).toEqual({ min: 1, max: 8760 });
  });
});

describe("a rule's id", () => {
  it("is the catalogue's, or a board's own with two or three digits", () => {
    for (const id of ["R-EFF-01", "W-AGE-01", "R-CUS-01", "W-CUS-12", "R-CUS-999"]) expect(RULE_ID_PATTERN.test(id), id).toBe(true);
    for (const id of ["R-CUS-1", "R-CUS-1000", "X-CUS-01", "r-cus-01", "R-CUS01"]) expect(RULE_ID_PATTERN.test(id), id).toBe(false);
    expect("W-CUS-101 fired more than R-EFF-01.".match(RULE_ID_IN_TEXT)).toEqual(["W-CUS-101", "R-EFF-01"]);
  });
});

describe("a change's request", () => {
  it("takes a new rule, checked against its check and rebuilt: plain text, statuses trimmed, a blank description left out", () => {
    const parsed = preview([{ op: "create", rule: { ...NEW_RULE, title: "  Bugs\nin progress  over 3 days ", description: "   ", params: { statuses: [" In Progress "], hours: 72 } } }]);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.changes).toEqual([{ op: "create", rule: { ...NEW_RULE, title: "Bugs in progress over 3 days" } }]);
  });

  it("says each problem with a new rule at its field", () => {
    expect(problems([{ op: "create", rule: { ...NEW_RULE, title: "ab" } }])).toEqual([`0.rule.title: ${CUSTOM_RULE_WORDS.title}`]);
    expect(problems([{ op: "create", rule: { ...NEW_RULE, check: "weather" } }])).toEqual([`0.rule.check: ${CUSTOM_RULE_WORDS.check}`]);
    expect(problems([{ op: "create", rule: { ...NEW_RULE, params: { statuses: [], hours: 0 } } }])).toEqual([
      `0.rule.params.statuses: ${CUSTOM_RULE_WORDS.statuses}`,
      "0.rule.params.hours: Must be from 1 to 8760.",
    ]);
    expect(problems([{ op: "create", rule: { ...NEW_RULE, params: { ...NEW_RULE.params, days: 3 } } }])).toEqual(["0.rule.params.days: Is not a setting of this check."]);
    expect(problems([{ op: "create", rule: { ...NEW_RULE, applies_to: { status_category: [], issue_type: null } } }])).toEqual([
      `0.rule.applies_to.status_category: ${CUSTOM_RULE_WORDS.categories}`,
    ]);
    expect(problems([{ op: "create", rule: { ...NEW_RULE, applies_to: { status_category: ["done"], issue_type: null } } }])).toEqual([
      "0.rule.applies_to.status_category: This check looks only at To do, In progress work.",
    ]);
    expect(problems([{ op: "create", rule: { ...NEW_RULE, description: "x".repeat(301) } }])).toEqual([`0.rule.description: ${CUSTOM_RULE_WORDS.description}`]);
    const sprint = { ...NEW_RULE, check: "sprint_at_risk", params: { days_left: 2, not_started_share: 0.3 } };
    expect(problems([{ op: "create", rule: sprint }])).toEqual([`0.rule.applies_to: ${CUSTOM_RULE_WORDS.sprintScope}`]);
    expect(problems([{ op: "create", rule: { ...sprint, applies_to: { status_category: [], issue_type: null } } }])).toEqual([]);
    expect(problems([{ op: "create", rule: { ...NEW_RULE, check: "missing_field", params: { field: "colour" } } }])).toEqual([`0.rule.params.field: ${CUSTOM_RULE_WORDS.field}`]);
  });

  it("takes an edit of a custom rule's definition, a delete and a restore; its switch and severity as any rule's; refuses any other op", () => {
    const parsed = preview([
      { op: "edit", rule_id: "R-CUS-01", title: " Bugs in review ", params: { hours: 96, statuses: ["Code Review"] } },
      { op: "delete", rule_id: "W-CUS-02" },
      { op: "restore", rule_id: "R-CUS-03" },
      { rule_id: "R-CUS-04", severity: "warning", params: { days: 40 } },
    ]);
    expect(parsed.data?.changes).toEqual([
      { op: "edit", rule_id: "R-CUS-01", title: "Bugs in review", params: { hours: 96, statuses: ["Code Review"] } },
      { op: "delete", rule_id: "W-CUS-02" },
      { op: "restore", rule_id: "R-CUS-03" },
      { rule_id: "R-CUS-04", severity: "warning", params: { days: 40 } },
    ]);
    expect(problems([{ op: "edit", rule_id: "R-CUS-01" }])).toEqual(["0: This change names nothing to change."]);
    // An edit is the definition alone, as the service takes it: the switch and the severity are a setting change's.
    expect(problems([{ op: "edit", rule_id: "R-CUS-01", title: "Bugs in review", enabled: false }])).toEqual(['0: Unrecognized key: "enabled"']);
    // Its check never changes: delete it and add another.
    expect(problems([{ op: "edit", rule_id: "R-CUS-01", check: "reopened" }])).toEqual(['0: Unrecognized key: "check"', "0: This change names nothing to change."]);
    expect(problems([{ op: "edit", rule_id: "R-CUS-01", params: { colour: "red" } }])).toEqual(["0.params.colour: Is not a setting a rule has."]);
    expect(problems([{ op: "launch", rule_id: "R-CUS-01" }])).toEqual(["0.op: Is not a change this endpoint takes: create, edit, delete or restore."]);
    expect(problems([{ op: "delete", rule_id: "R-CUS-1" }])).toEqual([expect.stringMatching(/^0\.rule_id: /)]);
  });

  it("keeps a name as the service does: nothing unseen in it, look-alike forms as their plain ones, something to read", () => {
    // A zero-width space, a joiner, a soft hyphen, a byte order mark, a Hangul filler, a blank braille cell: blank names.
    for (const blank of ["​​​", "‌‍⁠", "­­­", "﻿﻿﻿", "ㅤㅤㅤ", "⠀⠀⠀"]) {
      expect(problems([{ op: "create", rule: { ...NEW_RULE, title: blank } }]), JSON.stringify(blank)).toEqual([`0.rule.title: ${CUSTOM_RULE_WORDS.title}`]);
    }
    // Three characters, none of them a letter or a figure: nothing to read.
    expect(problems([{ op: "create", rule: { ...NEW_RULE, title: "!!!" } }])).toEqual([`0.rule.title: ${CUSTOM_RULE_WORDS.titleLetters}`]);
    expect(problems([{ op: "edit", rule_id: "R-CUS-01", title: "— — —" }])).toEqual([`0.title: ${CUSTOM_RULE_WORDS.titleLetters}`]);
    // Forwarded as the name it reads as: the unseen taken out, a fullwidth letter as its plain one.
    const parsed = preview([{ op: "create", rule: { ...NEW_RULE, title: "Ｂugs​ in progress­ over 3 days️" } }]);
    expect(parsed.data?.changes).toEqual([{ op: "create", rule: NEW_RULE }]);
  });

  it("never takes two new rules whose names only look different for two names", () => {
    const look = (title: string) => ({ op: "create", rule: { ...NEW_RULE, title } });
    expect(problems([look("Stuck in a status"), look("Ｓtuck in a status")])).toEqual(["1.rule.title: Two new rules have this name."]);
    expect(problems([look("Stuck in a status"), look("Stuck​ in a status")])).toEqual(["1.rule.title: Two new rules have this name."]);
    // As the service's casefold compares them: "ß" is "ss".
    expect(problems([look("Straße work too long"), look("STRASSE WORK TOO LONG")])).toEqual(["1.rule.title: Two new rules have this name."]);
  });

  it("holds one change per rule, two new rules never with one name, said beside whatever else is wrong", () => {
    expect(
      problems([
        { rule_id: "R-CUS-01", enabled: false },
        { op: "delete", rule_id: "R-CUS-01" },
        { op: "create", rule: NEW_RULE },
        { op: "create", rule: { ...NEW_RULE, title: "BUGS IN PROGRESS OVER 3 DAYS", params: { statuses: [], hours: 72 } } },
      ]),
    ).toEqual([
      "1.rule_id: Is named twice: one change per rule.",
      `3.rule.params.statuses: ${CUSTOM_RULE_WORDS.statuses}`,
      "3.rule.title: Two new rules have this name.",
    ]);
    expect(ruleSettingsSaveRequestSchema.safeParse({ revision: 0, changes: [{ op: "create", rule: NEW_RULE }] }).success).toBe(true);
  });
});

describe("the history's fields", () => {
  const field = (change: Record<string, unknown>) => ruleSettingsFieldChangeSchema.safeParse({ rule_id: "R-CUS-01", ...change });
  const definition = { ...NEW_RULE, description: null };

  it("records a custom rule added, deleted or brought back as one field, with its definition on one side", () => {
    expect(field({ field: "rule", from: null, to: definition }).success).toBe(true);
    expect(field({ field: "rule", from: definition, to: null }).success).toBe(true);
    expect(field({ field: "rule", from: null, to: null }).success).toBe(false);
    expect(field({ field: "rule", from: definition, to: definition }).success).toBe(false);
  });

  it("records an edit's own fields: the title, the description, what it looks at, and a param of any kind", () => {
    expect(field({ field: "title", from: "a b c", to: "a b d" }).success).toBe(true);
    expect(field({ field: "description", from: null, to: "Why" }).success).toBe(true);
    expect(field({ field: "applies_to", from: definition.applies_to, to: { status_category: ["new"], issue_type: null } }).success).toBe(true);
    expect(field({ field: "params.statuses", from: ["In Progress"], to: ["In Progress", "To Do"] }).success).toBe(true);
    expect(field({ field: "params.field", from: "epic", to: "sprint" }).success).toBe(true);
    expect(field({ field: "params.statuses", from: ["In Progress"], to: ["In Progress"] }).success).toBe(false);
    expect(field({ field: "applies_to", from: "all", to: "some" }).success).toBe(false);
  });
});

describe("the settings' answer", () => {
  it("parses the documented settings exactly, with the checks a custom rule may use and DEMO's own options", () => {
    expect(ruleSettingsSchema.parse(settingsJson)).toStrictEqual(settingsJson);
    expect(settings.checks.find((check) => check.name === "time_in_status_over")?.params[0].options?.map((option) => [option.value, option.category])).toEqual([
      ["To Do", "new"],
      ["In Progress", "indeterminate"],
      ["Done", "done"],
    ]);
    expect(settings.checks.filter((check) => !check.measurable).map((check) => check.name)).toEqual(["entered_stage_without_evidence", "no_evidence_after_percentile"]);
    expect([settings.custom_limit, settings.custom_count, settings.ai_draft]).toEqual([50, 0, { available: true, reason: null }]);
    expect(settings.rules.every((rule) => !rule.custom && rule.created_at === null)).toBe(true);
  });

  it("reads a service that sends the catalogue's params as JO-15 did (no kind, no options), and a rule without when it was added", () => {
    const body = structuredClone(settingsJson) as { rules: Record<string, unknown>[] };
    for (const rule of body.rules) {
      delete rule.created_at;
      delete rule.created_by;
      for (const param of rule.params as Record<string, unknown>[]) {
        delete param.kind;
        delete param.options;
      }
    }
    const parsed = ruleSettingsSchema.parse(body);
    expect(parsed.rules.find((rule) => rule.rule_id === "R-EFF-01")?.params[0]).toMatchObject({ kind: "number", options: null, value: 1.5 });
    expect(parsed.rules[0].created_at).toBeNull();
  });

  it("reads a custom rule: every param of its check, its choices with their options; it is never held to be customised", () => {
    const custom = {
      ...settings.rules[0],
      rule_id: "R-CUS-01",
      check: "time_in_status_over",
      check_label: "Time in a status",
      custom: true,
      customised: false,
      default_severity: "warning",
      params: [
        { name: "statuses", label: "Statuses", kind: "statuses", unit: null, value: ["In Progress"], default: ["In Progress"], min: null, max: null, step: null, options: [{ value: "In Progress", label: "In Progress", category: "indeterminate" }] },
        { name: "hours", label: "Time in the status", kind: "number", unit: "hours", value: 72, default: 72, min: 1, max: 8760, step: 1, options: null },
      ],
      created_at: "2026-11-04T14:30:00.000Z",
      created_by: "Morgan Ellis",
    };
    const parsed = ruleSettingsSchema.parse({ ...settingsJson, rules: [...settingsJson.rules, custom], custom_count: 1 });
    expect(parsed.rules.at(-1)).toMatchObject({ custom: true, created_by: "Morgan Ellis", params: [{ kind: "statuses" }, { kind: "number" }] });
  });

  it("reads GET /rules from a service that does not yet say which rules are custom", () => {
    expect(ruleSchema.parse({ ...ruleSchema.parse(JSON.parse(JSON.stringify({ rule_id: "R-EFF-01", title: "t", description: "", kind: "rule", severity: "breach", version: "0.1.0", threshold: null, needs: [], measurable: true, missing_evidence: [], open: 0, escalates_to: null, enabled: true, customised: false }))) })).toMatchObject({
      custom: false,
      check_label: null,
    });
  });
});

describe("an AI draft", () => {
  it("is asked for with plain text of 3 to 500 characters", () => {
    expect(ruleDraftRequestSchema.parse({ text: "  Bugs\tin review\nfor 3 days " })).toEqual({ text: "Bugs in review for 3 days" });
    for (const text of ["ab", " \n ", "x".repeat(501)]) expect(ruleDraftRequestSchema.safeParse({ text }).success, JSON.stringify(text)).toBe(false);
    expect(ruleDraftRequestSchema.safeParse({ text: "Bugs over 3 days", level: "people" }).success).toBe(false);
  });

  it("answers a draft exactly with the drafted outcome, and problems only with a draft", () => {
    const meta = settings.meta;
    const drafted = { meta, project: "DEMO", outcome: "drafted", draft: { ...NEW_RULE, description: null }, explanation: "Flags bugs.", note: null, problems: [] };
    expect(ruleDraftSchema.safeParse(drafted).success).toBe(true);
    expect(ruleDraftSchema.safeParse({ ...drafted, draft: null }).success).toBe(false);
    const none = { meta, project: "DEMO", outcome: "not_supported", draft: null, explanation: null, note: "No check can test that.", problems: [] };
    expect(ruleDraftSchema.safeParse(none).success).toBe(true);
    expect(ruleDraftSchema.safeParse({ ...none, problems: [{ field: "title", message: "x" }] }).success).toBe(false);
    for (const outcome of ["not_understood", "unavailable"]) expect(ruleDraftSchema.safeParse({ ...none, outcome }).success, outcome).toBe(true);
  });

  it("takes a draft the service could not put right as the model left it: a field it left out empty, a value no param holds dropped", () => {
    const halfDone = {
      meta: settings.meta,
      project: "DEMO",
      outcome: "drafted",
      draft: { title: null, description: null, check: null, params: { hours: true, statuses: ["In Progress"], deep: { x: 1 } }, applies_to: { status_category: [], issue_type: null }, severity: null },
      explanation: null,
      note: null,
      problems: [{ field: "title", message: "Give it a name of 3 to 80 characters." }],
    };
    expect(ruleDraftSchema.parse(halfDone).draft).toEqual({
      title: "",
      description: null,
      check: "",
      params: { statuses: ["In Progress"] },
      applies_to: { status_category: [], issue_type: null },
      severity: "breach",
    });
  });
});

describe("a custom rule on its board", () => {
  const rule = (change: Partial<CustomRuleInput> = {}): CustomRuleInput => ({
    title: "Bugs in progress over 3 days",
    description: null,
    check: "time_in_status_over",
    params: { statuses: ["In Progress"], hours: 72 },
    applies_to: { status_category: ["indeterminate"], issue_type: ["Bug"] },
    severity: "breach",
    ...change,
  });

  it("is held to the board's own names: its statuses, its issue types, a name no other rule has", () => {
    expect(customRuleProblems(rule(), board)).toEqual([]);
    expect(customRuleProblems(rule({ params: { statuses: ["Code Review"], hours: 72 } }), board)).toEqual([
      { field: "params.statuses", message: 'This board has no status called "Code Review".' },
    ]);
    expect(customRuleProblems(rule({ applies_to: { status_category: ["indeterminate"], issue_type: ["Story"] } }), board)).toEqual([
      { field: "applies_to.issue_type", message: 'This board has no issue type called "Story".' },
    ]);
    expect(customRuleProblems(rule({ title: "skipped A STAGE" }), board)).toEqual([{ field: "title", message: CUSTOM_RULE_WORDS.titleTaken }]);
    expect(customRuleProblems(rule(), board, { others: ["bugs in progress over 3 days"] })).toEqual([{ field: "title", message: CUSTOM_RULE_WORDS.titleTaken }]);
    // Its own name is no clash when it is edited.
    const named = { ...board, rules: [...board.rules, { rule_id: "R-CUS-01", title: "Bugs in progress over 3 days" }] };
    expect(customRuleProblems(rule(), named, { ruleId: "R-CUS-01" })).toEqual([]);
    // A stage the board does not map, an evidence name it does not have.
    expect(customRuleProblems(rule({ check: "entered_stage_without_evidence", params: { stage: "testing", evidence: "code_review" }, applies_to: { status_category: ["done"], issue_type: null } }), board)).toEqual([
      { field: "params.stage", message: CUSTOM_RULE_WORDS.stage },
    ]);
  });

  it("is kept in the board's own spelling and as plain text", () => {
    const kept = canonicalRule(rule({ title: " Bugs  in progress ", params: { statuses: ["in progress"], hours: 72 }, applies_to: { status_category: ["indeterminate"], issue_type: ["bug"] } }), board);
    expect(kept).toMatchObject({ title: "Bugs in progress", params: { statuses: ["In Progress"] }, applies_to: { issue_type: ["Bug"] } });
    expect(plainText("a\u0000b  \t c")).toBe("a b c");
    // A control character of either set reads as a space; what shows nothing goes; a compatibility form is its plain one.
    expect(plainText("a\u0085b​c­d‮e ﬁx Ａ  z")).toBe("a bcde fix A z");
    // A board's names are Jira's, compared as Jira wrote them: never made plain like a name an admin types.
    expect(boardText(" Ｑ&A\tReview ")).toBe("Ｑ&A Review");
    expect(boardSpelling(["Ｑ&A Review"], "ｑ&a review")).toBe("Ｑ&A Review");
  });

  it("is never named like another rule on the board by a name that only looks different", () => {
    // DEMO's catalogue has "Skipped a stage": in fullwidth letters, with a zero-width space or a soft hyphen, it is the same.
    for (const title of ["Ｓkipped a stage", "Skipped​ a stage", "Skip­ped a stage", "SKIPPED A STAGE"]) {
      expect(customRuleProblems(rule({ title }), board), JSON.stringify(title)).toEqual([{ field: "title", message: CUSTOM_RULE_WORDS.titleTaken }]);
    }
    expect(customRuleProblems(rule(), board, { others: ["Ｂugs in progress over 3 days"] })).toEqual([{ field: "title", message: CUSTOM_RULE_WORDS.titleTaken }]);
    expect(customRuleProblems(rule({ title: "​​​ab" }), board)).toEqual([{ field: "title", message: CUSTOM_RULE_WORDS.title }]);
    expect(customRuleProblems(rule({ title: "???" }), board)).toEqual([{ field: "title", message: CUSTOM_RULE_WORDS.titleLetters }]);
    expect(nameKey("Straße")).toBe(nameKey("STRASSE"));
  });

  it("says a limit of hours as a reader would: in days from two days", () => {
    expect([limitWords(72, "en-GB"), limitWords(36, "en-GB"), limitWords(60, "en-GB"), limitWords(24, "en-GB")]).toEqual(["3 days", "36 h", "2.5 days", "24 h"]);
  });
});
