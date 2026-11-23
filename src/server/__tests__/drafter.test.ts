// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { canonicalRule, customRuleProblems } from "@/lib/api/custom-rules";
import { ruleDraftSchema, type Stage, type StatusCategory } from "@/lib/api/schemas";

import { boardOptions, customRuleBoard, type BoardOptions } from "../sample/custom-rules";
import { buildDataset } from "../sample/dataset";
import { NOT_UNDERSTOOD_NOTE, scriptedDraft } from "../sample/drafter";
import { draftView } from "../sample/rule-settings";

import evalSet from "./fixtures/rule-drafts.json";

/*
 * The sample's AI draft (JO-20): the keyword script standing in for the model,
 * as the service's ScriptedProvider drafts in LLM_MODE=stub. Held first to the
 * service's own eval (tests/eval/rule_drafts.yaml in jira-oversight-sys, copied
 * here as fixtures/rule-drafts.json), case by case as the service's suite holds
 * its script, so the two scripts cannot drift apart; then to a table of
 * requests on DEMO's own names (To Do, In Progress and Done; Task, Bug,
 * Subtask, Test and Epic): the check each becomes, its key params, the
 * categories and issue types it looks at, how serious it is, its name and what
 * it flags.
 */

const NOW = Date.parse("2026-11-04T14:30:00Z");
const dataset = buildDataset(NOW);
const options = boardOptions(dataset.world);

interface EvalCase {
  id: string;
  request: string;
  outcome: "drafted" | "not_supported" | "not_understood";
  check?: string;
  params?: Record<string, unknown>;
  categories?: StatusCategory[];
  issue_types?: string[] | null;
  severity?: "breach" | "warning";
}

/** The eval's board: a team-managed project with review and QA statuses, and three issue types. */
const evalOptions: BoardOptions = {
  statuses: evalSet.board.statuses.map((status) => ({ name: status.name, category: status.category as StatusCategory })),
  issueTypes: evalSet.board.issue_types,
  stages: evalSet.board.stages as Stage[],
  evidence: evalSet.board.evidence,
  recordedEvidence: evalSet.board.recorded,
};
const evalBoard = customRuleBoard(evalOptions, dataset.rules);

/**
 * What a draft got wrong against its case, as the service's suite reads one (tests/test_rule_drafts.py `misses`): the
 * outcome, then for a draft the check, each key param, the categories, issue types and severity the case names, and
 * any problem a save would still find.
 */
function misses(want: EvalCase, text: string): string[] {
  const result = scriptedDraft(text, evalOptions);
  if (result.outcome !== want.outcome) return [`outcome ${result.outcome}, not ${want.outcome} (${result.note})`];
  if (want.outcome !== "drafted") return result.note ? [] : ["no note"];
  const draft = result.draft!;
  const found: string[] = [];
  if (draft.check !== want.check) found.push(`check ${draft.check}, not ${want.check}`);
  for (const [name, value] of Object.entries(want.params ?? {})) {
    if (JSON.stringify(draft.params[name]) !== JSON.stringify(value)) found.push(`params.${name} ${JSON.stringify(draft.params[name])}, not ${JSON.stringify(value)}`);
  }
  if (want.categories && JSON.stringify(draft.applies_to.status_category) !== JSON.stringify(want.categories)) {
    found.push(`categories ${JSON.stringify(draft.applies_to.status_category)}, not ${JSON.stringify(want.categories)}`);
  }
  if (want.issue_types !== undefined && JSON.stringify(draft.applies_to.issue_type) !== JSON.stringify(want.issue_types)) {
    found.push(`issue types ${JSON.stringify(draft.applies_to.issue_type)}, not ${JSON.stringify(want.issue_types)}`);
  }
  if (want.severity && draft.severity !== want.severity) found.push(`severity ${draft.severity}, not ${want.severity}`);
  const problems = customRuleProblems(canonicalRule(draft, evalBoard), evalBoard);
  if (problems.length > 0) found.push(`problems ${JSON.stringify(problems)}`);
  return found;
}

describe("the service's own eval, run against the sample's script", () => {
  it("is the service's set, whole", () => {
    expect(evalSet.cases).toHaveLength(22);
    expect(new Set(evalSet.cases.map((want) => want.id)).size).toBe(22);
  });

  for (const want of evalSet.cases as EvalCase[]) {
    it(`${want.id}: "${want.request}" is ${want.outcome === "drafted" ? want.check : want.outcome}`, () => {
      expect(misses(want, want.request)).toEqual([]);
    });
  }
});

interface Case {
  text: string;
  check: string;
  params?: Record<string, unknown>;
  categories?: StatusCategory[];
  types?: string[] | null;
  severity?: "breach" | "warning";
  title?: string;
  explanation?: string;
}

const DRAFTED: Case[] = [
  {
    text: "Bugs in progress for more than 3 days",
    check: "time_in_status_over",
    params: { statuses: ["In Progress"], hours: 72 },
    categories: ["indeterminate"],
    types: ["Bug"],
    title: "Bugs in progress too long",
    explanation: "Flags bugs that stay in progress for more than 3 days.",
  },
  { text: "Tickets sitting in To Do for over 2 weeks", check: "time_in_status_over", params: { statuses: ["To Do"], hours: 336 }, categories: ["new"], types: null },
  { text: "Tasks in progress longer than 36 hours, as an early warning", check: "time_in_status_over", params: { statuses: ["In Progress"], hours: 36 }, types: ["Task"], severity: "warning" },
  {
    text: "Bugs stuck in progress",
    check: "time_in_status_over",
    params: { statuses: ["In Progress"], hours: 72 },
    explanation: "Flags bugs that stay in progress for more than 3 days (the default limit).",
  },
  {
    text: "Tickets open for 30 days or more",
    check: "open_longer_than",
    params: { days: 30 },
    categories: ["new", "indeterminate"],
    types: null,
    title: "Tickets open too long",
    explanation: "Flags tickets still open more than 30 days after they were created.",
  },
  { text: "Bugs older than 6 weeks", check: "open_longer_than", params: { days: 42 }, types: ["Bug"] },
  {
    text: "Tickets with no update for 10 days",
    check: "no_update_for",
    params: { days: 10 },
    categories: ["indeterminate"],
    title: "Tickets with no recent update",
    explanation: "Flags tickets in progress with no change in Jira for more than 10 days.",
  },
  { text: "Tasks not updated in 2 weeks", check: "no_update_for", params: { days: 14 }, types: ["Task"] },
  { text: "Work that has not been updated in 10 days", check: "no_update_for", params: { days: 10 } },
  {
    text: "Untouched tickets",
    check: "no_update_for",
    params: { days: 7 },
    explanation: "Flags tickets in progress with no change in Jira for more than 7 days (the default limit).",
  },
  { text: "Bugs nobody has touched for 2 weeks", check: "no_update_for", params: { days: 14 }, types: ["Bug"] },
  {
    text: "Tickets in progress with no assignee",
    check: "missing_field",
    params: { field: "assignee" },
    categories: ["indeterminate"],
    title: "Tickets with no assignee",
    explanation: "Flags tickets in progress with no assignee.",
  },
  { text: "Unassigned bugs", check: "missing_field", params: { field: "assignee" }, types: ["Bug"] },
  { text: "Tickets with no epic", check: "missing_field", params: { field: "epic" }, types: null },
  { text: "Work in progress with no estimate", check: "missing_field", params: { field: "estimate" } },
  { text: "Tickets not in a sprint", check: "missing_field", params: { field: "sprint" }, title: "Tickets in no sprint" },
  { text: "Tests without an epic", check: "missing_field", params: { field: "epic" }, types: ["Test"] },
  { text: "Tasks missing an estimate", check: "missing_field", params: { field: "estimate" }, types: ["Task"] },
  {
    text: "Bugs that were reopened",
    check: "reopened",
    types: ["Bug"],
    categories: ["new", "indeterminate", "done"],
    explanation: "Flags bugs that left Done for another status.",
  },
  // The first rule that matches decides, in the service's order: a reopened ticket before a missing field.
  { text: "Reopened bugs with no assignee", check: "reopened", types: ["Bug"] },
  { text: "Warn me when a ticket skips a stage", check: "skipped_stage", severity: "warning" },
  {
    text: "Effort over the estimate by 2x",
    check: "effort_ratio_at_least",
    params: { threshold: 2 },
    categories: ["done"],
    title: "Tickets over the estimate",
    explanation: "Flags tickets already done whose logged time is at least 2 times the estimate.",
  },
  { text: "Tasks where effort runs 1.5 times over the estimate", check: "effort_ratio_at_least", params: { threshold: 1.5 }, types: ["Task"] },
];

/** A length of time in words, as people write one: read as the figure it names, never as the check's default. */
const IN_WORDS: [string, string, Record<string, number>][] = [
  ["Bugs nobody has touched for two weeks", "no_update_for", { days: 14 }],
  ["Tickets with no update for a week", "no_update_for", { days: 7 }],
  ["Tickets open for a couple of weeks", "open_longer_than", { days: 14 }],
  ["Bugs older than twelve days", "open_longer_than", { days: 12 }],
  ["Tasks in progress for more than a day", "time_in_status_over", { hours: 24 }],
  ["Tickets in To Do for three days", "time_in_status_over", { hours: 72 }],
  ["Bugs in progress for an hour", "time_in_status_over", { hours: 1 }],
];

/** What no check can do, and the check the note names as closest, as the service's script names it. */
const NOT_SUPPORTED = [
  ["What is the weather in London?", "Time in a status"],
  ["Tickets with an estimate that is too small", "Started without an estimate"],
  ["Who works on the most epics", "Time in a status"],
  // A status DEMO does not have is never swapped for one it has: the closest is time in a status.
  ["Bugs in Code Review for more than 3 days", "Time in a status"],
  ["Stories in Blocked for more than two days", "Time in a status"],
] as const;

describe("the sample's scripted drafter on DEMO", () => {
  for (const want of DRAFTED) {
    it(`drafts "${want.text}" as ${want.check}`, () => {
      const result = scriptedDraft(want.text, options);
      expect(result.outcome).toBe("drafted");
      const draft = result.draft!;
      expect(draft.check).toBe(want.check);
      if (want.params) expect(draft.params).toEqual(want.params);
      if (want.categories) expect(draft.applies_to.status_category).toEqual(want.categories);
      if (want.types !== undefined) expect(draft.applies_to.issue_type).toEqual(want.types);
      expect(draft.severity).toBe(want.severity ?? "breach");
      if (want.title) expect(draft.title).toBe(want.title);
      // The name never holds the limit: the row shows it, and an admin may change it.
      expect(draft.title).not.toMatch(/\d/);
      expect(draft.title.length).toBeGreaterThanOrEqual(3);
      expect(draft.title.length).toBeLessThanOrEqual(80);
      if (want.explanation) expect(result.explanation).toBe(want.explanation);
      expect(result.explanation).toMatch(/^Flags /);
    });
  }

  for (const [text, check, params] of IN_WORDS) {
    it(`reads the length of time in "${text}"`, () => {
      const result = scriptedDraft(text, options);
      expect(result.draft?.check).toBe(check);
      expect(result.draft?.params).toMatchObject(params);
      expect(result.explanation).not.toContain("default");
    });
  }

  it("says what the rule looks at as the form ticks it, and a limit the words did not give as the default", () => {
    // The check's own default categories, said as such: in progress only, not "not done".
    expect(scriptedDraft("Tickets with no epic", options).explanation).toBe("Flags tickets in progress with no epic.");
    // Every category the check may look at: nothing to say beside the check's own words.
    expect(scriptedDraft("Tickets with no update", options).draft?.applies_to.status_category).toEqual(["indeterminate"]);
    expect(scriptedDraft("Bugs older than a month", options).explanation).toBe("Flags bugs still open more than 30 days (the default limit) after they were created.");
  });

  for (const [text, closest] of NOT_SUPPORTED) {
    it(`says "${text}" cannot be built, naming the closest check`, () => {
      const result = scriptedDraft(text, options);
      expect(result).toMatchObject({ outcome: "not_supported", draft: null, explanation: null });
      expect(result.note).toBe(`None of the checks can do that. The closest is '${closest}'.`);
    });
  }

  it("asks for words to draft from when there are none, as the service does", () => {
    for (const text of ["???", "a b c", "12 34"]) {
      expect(scriptedDraft(text, options), text).toEqual({ outcome: "not_understood", draft: null, explanation: null, note: NOT_UNDERSTOOD_NOTE });
    }
  });

  it("answers as the service would: a draft checked as a save would check it, with what is still wrong at its field", () => {
    const fine = ruleDraftSchema.parse(draftView(dataset, { text: "Bugs in progress for more than 3 days" }));
    expect(fine).toMatchObject({ outcome: "drafted", problems: [], draft: { title: "Bugs in progress too long" } });
    // DEMO has no review status: not supported, rather than a rule with no status in it.
    const review = ruleDraftSchema.parse(draftView(dataset, { text: "Bugs in Code Review for more than 3 days" }));
    expect(review).toMatchObject({ outcome: "not_supported", draft: null, problems: [], note: "None of the checks can do that. The closest is 'Time in a status'." });
    // A limit out of the check's bounds: said at its field.
    const long = ruleDraftSchema.parse(draftView(dataset, { text: "Tickets open for 5000 days" }));
    expect(long.problems).toEqual([{ field: "params.days", message: "Must be from 1 day to 3,650 days." }]);
    const taken = ruleDraftSchema.parse(draftView(dataset, { text: "skip" }));
    expect(taken.draft?.title).toBe("Tickets that skipped a stage");
    expect(taken.problems).toEqual([]);
    const none = ruleDraftSchema.parse(draftView(dataset, { text: "What is the weather in London?" }));
    expect(none).toMatchObject({ outcome: "not_supported", draft: null, problems: [] });
  });

  it("cuts a name longer than the form takes at a word, as the service cuts one, with nothing added", () => {
    const long: BoardOptions = {
      ...options,
      statuses: [{ name: "Waiting for third party approval", category: "indeterminate" }],
      issueTypes: ["Customer escalation", "Regulatory change request"],
    };
    const result = scriptedDraft("Customer escalations and regulatory change requests in Waiting for third party approval for 3 days", long);
    const full = "Customer escalations and regulatory change requests in Waiting for third party approval too long";
    const title = result.draft!.title;
    expect(title.length).toBeLessThanOrEqual(80);
    expect(full.startsWith(title) && full[title.length] === " ").toBe(true);
    expect(title).not.toContain("…");
  });

  it('never takes an epic in "no epic" for the Epic issue type, nor a status inside another word', () => {
    expect(scriptedDraft("Bugs with no epic", options).draft?.applies_to.issue_type).toEqual(["Bug"]);
    expect(scriptedDraft("Epics open for 90 days", options).draft?.applies_to.issue_type).toEqual(["Epic"]);
    // "Done" is no status of "abandoned".
    expect(scriptedDraft("Abandoned tickets for 3 days", options).outcome).toBe("not_supported");
  });
});
