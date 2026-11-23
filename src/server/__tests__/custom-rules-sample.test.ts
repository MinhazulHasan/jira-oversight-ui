// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { normalizeFindingsQuery } from "@/lib/api/params";
import {
  CHECK_REGISTRY,
  CUSTOM_RULE_LIMIT,
  CUSTOM_RULE_WORDS,
  overviewSchema,
  ruleSettingsPreviewSchema,
  ruleSettingsSchema,
  rulesSchema,
  type CustomRuleSpec,
  type RuleSettingsChange,
  type RuleSettingsPreview,
  type RuleSettingsSaveRequest,
} from "@/lib/api/schemas";

import { ruleStatusFacts } from "../sample/ask/tools";
import { sampleBoard } from "../sample/boards";
import { STATUS } from "../sample/catalogue";
import { boardChecks, boardOptions } from "../sample/custom-rules";
import { sampleDataset, type Dataset } from "../sample/dataset";
import type { FindingRecord } from "../sample/engine";
import { findingDetail, findingsPage } from "../sample/findings";
import { issueTimeline } from "../sample/issues";
import { overview } from "../sample/overview";
import { previewView, saveView, settingsView } from "../sample/rule-settings";
import { rulesView } from "../sample/rules";
import { boardSettings, resetSampleRuleSettings, revisionOf } from "../sample/settings-store";
import { DAY, HOUR, MINUTE } from "../sample/time";
import { workItems, type Issue } from "../sample/world";

/*
 * A board's own rules (JO-20) in the sample, held to the service's semantics
 * (the spec, sections 1 and 2): a rule added sees the board as of now, its
 * findings first seen when it was added; narrowing it or raising its limit
 * closes what it no longer raises as settings_changed, never cleared; only a
 * severity change gives it new ids; deleting it closes its findings as a rule
 * turned off does, and bringing it back reopens the same findings with their
 * first sighting; ids run across boards and are never given twice; and every
 * view that names a rule names it by its own title.
 */

const NOW = Date.parse("2026-11-04T14:30:00Z");
const READER = { hash: "b".repeat(32), name: "Morgan Ellis" };
const DEMO = sampleBoard("DEMO")!;
const MOB = sampleBoard("MOB")!;

afterEach(() => resetSampleRuleSettings());

const BUGS_IN_PROGRESS: CustomRuleSpec = {
  title: "Bugs in progress over 3 days",
  check: "time_in_status_over",
  params: { statuses: ["In Progress"], hours: 72 },
  applies_to: { status_category: ["indeterminate"], issue_type: ["Bug"] },
  severity: "breach",
};

const create = (rule: CustomRuleSpec = BUGS_IN_PROGRESS): RuleSettingsChange => ({ op: "create", rule });

/** Saves on a sample board, as the route would, at `at` on the board's clock; answers the board as it then stands. */
function save(changes: RuleSettingsChange[], options: { at?: number; board?: typeof DEMO; extra?: Partial<RuleSettingsSaveRequest> } = {}): Dataset {
  const board = options.board ?? DEMO;
  const dataset = sampleDataset(NOW, board);
  const answer = saveView(dataset, { revision: dataset.revision, changes, ...options.extra }, READER, options.at ?? NOW, 0, Date.now());
  if (!answer.ok) throw new Error(`refused: ${answer.status} ${JSON.stringify(answer.issues ?? answer.message)}`);
  ruleSettingsSchema.parse(answer.body);
  return sampleDataset(NOW, board);
}

function refusal(changes: RuleSettingsChange[], board = DEMO) {
  const dataset = sampleDataset(NOW, board);
  const answer = saveView(dataset, { revision: dataset.revision, changes }, READER, NOW, 0);
  if (answer.ok) throw new Error("saved, where a refusal was expected");
  return answer;
}

const findingsOf = (dataset: Dataset, ruleId: string) => dataset.engine.findings.filter((finding) => finding.rule.id === ruleId);
const openOf = (dataset: Dataset, ruleId: string) => findingsOf(dataset, ruleId).filter((finding) => finding.resolvedAt === null);
const byId = (findings: readonly FindingRecord[]) => new Map(findings.map((finding) => [finding.id, finding]));

/** Hours an issue has been in its status at the last sync. */
const ageInStatus = (dataset: Dataset, issue: Issue) => (dataset.world.syncAt - issue.intervals.at(-1)!.enteredAt) / HOUR;

describe("a custom rule added", () => {
  it("sees the board as of now: each bug in progress over 72 hours, first seen at the save, under the revision that added it", () => {
    const before = sampleDataset(NOW);
    const at = NOW - MINUTE;
    const after = save([create()], { at });
    const rule = after.rules.find((candidate) => candidate.def.id === "R-CUS-01")!;
    expect(rule.custom).toMatchObject({ createdRevision: 1, createdBy: "Morgan Ellis", severity: "breach", kind: "rule", deletedAt: null });
    expect(rule.version).toBe("c1");
    const expected = workItems(after.world)
      .filter((issue) => issue.type === "Bug" && issue.status === "In Progress" && ageInStatus(after, issue) > 72)
      .map((issue) => issue.key)
      .sort();
    const found = openOf(after, "R-CUS-01");
    expect(found.map((finding) => finding.issue!.key).sort()).toEqual(expected);
    expect(found.length).toBeGreaterThan(0);
    // First seen when it was added: never earlier, as a rule that had always been there would claim.
    expect(found.every((finding) => finding.firstSeenAt === at && finding.ruleVersion === "c1")).toBe(true);
    expect(found[0].message).toMatch(/^In 'In Progress' for \d+\.\d (days|h); the limit is 3 days$/);
    // Every other finding is as it was.
    expect(after.engine.findings.filter((finding) => finding.rule.id !== "R-CUS-01").map((finding) => finding.id).sort()).toEqual(
      before.engine.findings.map((finding) => finding.id).sort(),
    );
  });

  it("is recorded as one change of the history, the rule with its definition, and listed after the catalogue", () => {
    const after = save([create()]);
    const view = ruleSettingsSchema.parse(settingsView(after));
    expect(view.history[0].changes).toEqual([
      { rule_id: "R-CUS-01", field: "rule", from: null, to: { ...BUGS_IN_PROGRESS, description: null } },
    ]);
    const custom = view.rules.at(-1)!;
    expect(custom).toMatchObject({
      rule_id: "R-CUS-01",
      custom: true,
      check_label: "Time in a status",
      customised: false,
      default_severity: "breach",
      applies_to: { status_category: ["indeterminate"], issue_type: ["Bug"] },
      created_by: "Morgan Ellis",
    });
    expect(custom.params.map((param) => [param.name, param.kind, param.value])).toEqual([
      ["statuses", "statuses", ["In Progress"]],
      ["hours", "number", 72],
    ]);
    expect([view.custom_count, view.custom_limit]).toEqual([1, CUSTOM_RULE_LIMIT]);
  });
});

describe("a custom rule changed", () => {
  it("narrowed to other issue types: what it no longer raises closes as settings_changed, never cleared", () => {
    const added = save([create()]);
    const open = openOf(added, "R-CUS-01");
    const narrowed = save([{ op: "edit", rule_id: "R-CUS-01", applies_to: { status_category: ["indeterminate"], issue_type: ["Task"] } }]);
    const was = byId(findingsOf(narrowed, "R-CUS-01"));
    for (const finding of open) expect(was.get(finding.id)).toMatchObject({ resolvedWhy: "settings_changed" });
    expect(findingsOf(narrowed, "R-CUS-01").some((finding) => finding.resolvedWhy === "cleared")).toBe(false);
    const history = ruleSettingsSchema.parse(settingsView(narrowed)).history[0].changes;
    expect(history).toEqual([
      { rule_id: "R-CUS-01", field: "applies_to", from: BUGS_IN_PROGRESS.applies_to, to: { status_category: ["indeterminate"], issue_type: ["Task"] } },
    ]);
  });

  it("its limit raised: a ticket still over it stays the same finding, the rest close as settings_changed", () => {
    const added = save([create({ ...BUGS_IN_PROGRESS, applies_to: { status_category: ["indeterminate"], issue_type: null } })]);
    const open = openOf(added, "R-CUS-01");
    const raised = save([{ rule_id: "R-CUS-01", params: { hours: 400 } }]);
    const now = byId(findingsOf(raised, "R-CUS-01"));
    for (const finding of open) {
      const after = now.get(finding.id)!;
      const still = ageInStatus(raised, finding.issue!) > 400;
      expect(after.resolvedAt === null, finding.issue!.key).toBe(still);
      if (still) expect(after.firstSeenAt).toBe(finding.firstSeenAt);
      else expect(after.resolvedWhy).toBe("settings_changed");
    }
    expect(open.some((finding) => ageInStatus(raised, finding.issue!) <= 400)).toBe(true);
  });

  it("reported at another severity: its open findings are superseded and opened again under new ids", () => {
    const added = save([create()]);
    const open = openOf(added, "R-CUS-01");
    const refiled = save([{ rule_id: "R-CUS-01", severity: "warning" }]);
    expect(refiled.rules.find((rule) => rule.def.id === "R-CUS-01")?.version).toBe("c1+warning");
    const now = openOf(refiled, "R-CUS-01");
    expect(now).toHaveLength(open.length);
    expect(now.some((finding) => open.some((old) => old.id === finding.id))).toBe(false);
    expect(byId(findingsOf(refiled, "R-CUS-01")).get(open[0].id)?.resolvedWhy).toBe("superseded");
  });

  it("deleted: its open findings close as settings_changed; brought back, the same findings reopen with their first sighting", () => {
    const at = NOW - MINUTE;
    const added = save([create()], { at });
    const open = openOf(added, "R-CUS-01");
    const deleted = save([{ op: "delete", rule_id: "R-CUS-01" }]);
    expect(deleted.rules.some((rule) => rule.def.id === "R-CUS-01")).toBe(false);
    expect(findingsOf(deleted, "R-CUS-01").every((finding) => finding.resolvedWhy === "settings_changed")).toBe(true);
    const deleteEntry = ruleSettingsSchema.parse(settingsView(deleted)).history[0];
    expect(deleteEntry.changes).toEqual([{ rule_id: "R-CUS-01", field: "rule", from: { ...BUGS_IN_PROGRESS, description: null }, to: null }]);

    const restored = save([{ op: "restore", rule_id: "R-CUS-01" }], { extra: { undo_of: deleteEntry.change_id } });
    const back = openOf(restored, "R-CUS-01");
    expect(back.map((finding) => finding.id).sort()).toEqual(open.map((finding) => finding.id).sort());
    expect(back.every((finding) => finding.firstSeenAt === at)).toBe(true);
    expect(restored.rules.find((rule) => rule.def.id === "R-CUS-01")?.version).toBe("c1");
  });

  it("its definition edited: the history names each field, and its findings keep their ids", () => {
    save([create()]);
    const edited = save([{ op: "edit", rule_id: "R-CUS-01", title: "Bugs stuck in progress", description: "Agreed on Monday", params: { hours: 48 } }]);
    const changes = ruleSettingsSchema.parse(settingsView(edited)).history[0].changes;
    expect(changes).toEqual([
      { rule_id: "R-CUS-01", field: "title", from: "Bugs in progress over 3 days", to: "Bugs stuck in progress" },
      { rule_id: "R-CUS-01", field: "description", from: null, to: "Agreed on Monday" },
      { rule_id: "R-CUS-01", field: "params.hours", from: 72, to: 48 },
    ]);
    expect(edited.rules.find((rule) => rule.def.id === "R-CUS-01")?.version).toBe("c1");
  });
});

describe("custom rule ids", () => {
  it("run across every board by kind, R-CUS for a breach and W-CUS for a warning, and are never given twice", () => {
    save([create()]);
    save([create({ ...BUGS_IN_PROGRESS, title: "Mobile bugs over 3 days" })], { board: MOB });
    save([create({ ...BUGS_IN_PROGRESS, title: "Early bugs", severity: "warning" })]);
    expect(customIds(DEMO)).toEqual(["R-CUS-01", "W-CUS-01"]);
    expect(customIds(MOB)).toEqual(["R-CUS-02"]);
    save([{ op: "delete", rule_id: "R-CUS-01" }]);
    save([create({ ...BUGS_IN_PROGRESS, title: "Bugs again" })]);
    expect(customIds(DEMO)).toEqual(["W-CUS-01", "R-CUS-03"]);
  });

  function customIds(board: typeof DEMO) {
    return sampleDataset(NOW, board).rules.filter((rule) => rule.custom).map((rule) => rule.def.id);
  }
});

describe("what a custom rule may not be", () => {
  it("refused at its field, in the words the page uses, and nothing is saved", () => {
    const paths = (changes: RuleSettingsChange[]) => refusal(changes).issues?.map((issue) => `${issue.path}: ${issue.message}`);
    expect(paths([create({ ...BUGS_IN_PROGRESS, params: { statuses: ["Code Review"], hours: 72 } })])).toEqual([
      'new-0.params.statuses: This board has no status called "Code Review".',
    ]);
    expect(paths([create({ ...BUGS_IN_PROGRESS, title: "Skipped a stage" })])).toEqual([`new-0.title: ${CUSTOM_RULE_WORDS.titleTaken}`]);
    expect(paths([create({ ...BUGS_IN_PROGRESS, applies_to: { status_category: ["indeterminate"], issue_type: ["Story"] } })])).toEqual([
      'new-0.applies_to.issue_type: This board has no issue type called "Story".',
    ]);
    // The second of two new rules, at its own place: DEMO's workflow maps no testing stage.
    expect(paths([create(), create({ ...BUGS_IN_PROGRESS, check: "entered_stage_without_evidence", title: "Testing", params: { stage: "testing", evidence: "code_review" } })])).toEqual([
      `new-1.params.stage: ${CUSTOM_RULE_WORDS.stage}`,
    ]);
    expect(paths([{ op: "edit", rule_id: "R-EFF-01", title: "Effort" }])).toEqual(["R-EFF-01: Only a rule added to this board can be edited."]);
    expect(paths([{ op: "delete", rule_id: "R-EFF-01" }])).toEqual(["R-EFF-01: Only a rule added to this board can be deleted. Turn this one off instead."]);
    expect(paths([{ op: "restore", rule_id: "R-CUS-09" }])).toEqual(["R-CUS-09: There is no deleted rule R-CUS-09 on this board to bring back."]);
    expect(revisionOf(boardSettings())).toBe(0);
  });

  it("set back to a catalogue it does not have, or edited into a name another rule has", () => {
    save([create()]);
    expect(refusal([{ rule_id: "R-CUS-01", reset: true }]).issues).toEqual([{ path: "R-CUS-01.reset", message: "A custom rule has no catalogue settings to go back to." }]);
    expect(refusal([{ op: "edit", rule_id: "R-CUS-01", title: "Reopened after Done" }]).issues).toEqual([{ path: "R-CUS-01.title", message: CUSTOM_RULE_WORDS.titleTaken }]);
    expect(refusal([{ op: "edit", rule_id: "R-CUS-01", title: "Bugs in progress over 3 days" }]).issues).toEqual([
      { path: "R-CUS-01", message: "This changes nothing: R-CUS-01 already runs so on this board." },
    ]);
    expect(refusal([{ rule_id: "R-CUS-01", params: { hours: 9000 } }]).issues).toEqual([{ path: "R-CUS-01.params.hours", message: "Must be from 1 h to 8,760 h." }]);
  });

  it("named blank, or like another rule by a name that only looks different", () => {
    save([create()]);
    const titled = (title: string) => refusal([create({ ...BUGS_IN_PROGRESS, title })]).issues;
    expect(titled("​​​")).toEqual([{ path: "new-0.title", message: CUSTOM_RULE_WORDS.title }]);
    expect(titled("­!!")).toEqual([{ path: "new-0.title", message: CUSTOM_RULE_WORDS.title }]);
    expect(titled("***")).toEqual([{ path: "new-0.title", message: CUSTOM_RULE_WORDS.titleLetters }]);
    // "Ｓkipped a stage" is the catalogue's "Skipped a stage"; "Bugs in progress​ over 3 days" is R-CUS-01's name.
    expect(titled("Ｓkipped a stage")).toEqual([{ path: "new-0.title", message: CUSTOM_RULE_WORDS.titleTaken }]);
    expect(titled("Bugs in progress​ over 3 days")).toEqual([{ path: "new-0.title", message: CUSTOM_RULE_WORDS.titleTaken }]);
    expect(refusal([{ op: "edit", rule_id: "R-CUS-01", title: "Reopened after Don­e" }]).issues).toEqual([{ path: "R-CUS-01.title", message: CUSTOM_RULE_WORDS.titleTaken }]);
  });

  it(`one more than the ${CUSTOM_RULE_LIMIT} a board holds`, () => {
    const many = Array.from({ length: CUSTOM_RULE_LIMIT }, (_, index) => create({ ...BUGS_IN_PROGRESS, title: `Bugs over ${index + 1} days` }));
    save(many.slice(0, 40));
    save(many.slice(40));
    expect(sampleDataset(NOW).rules.filter((rule) => rule.custom)).toHaveLength(CUSTOM_RULE_LIMIT);
    expect(refusal([create({ ...BUGS_IN_PROGRESS, title: "One too many" })]).issues).toEqual([{ path: "new-0", message: CUSTOM_RULE_WORDS.limit }]);
    // A delete in the same change makes room.
    expect(() => save([{ op: "delete", rule_id: "R-CUS-01" }, create({ ...BUGS_IN_PROGRESS, title: "One in its place" })])).not.toThrow();
  });
});

describe("a preview", () => {
  it("of a new rule names it by the id it would be given and counts every finding it would raise now; nothing is saved", () => {
    const dataset = sampleDataset(NOW);
    const answer = previewView(dataset, { changes: [create()] }, NOW);
    expect(answer.ok).toBe(true);
    const body = ruleSettingsPreviewSchema.parse((answer as { body: RuleSettingsPreview }).body);
    expect(body.impact).toEqual([
      expect.objectContaining({ rule_id: "R-CUS-01", open_now: 0, would_close: 0, would_stay: 0, measurable: true, note: null }),
    ]);
    expect(body.impact[0].would_open).toBe(save([create()]) && openOf(sampleDataset(NOW), "R-CUS-01").length);
    expect(body.impact[0].examples.open.length).toBeGreaterThan(0);
  });

  it("of a deletion closes every open finding of the rule", () => {
    const added = save([create()]);
    const answer = previewView(added, { changes: [{ op: "delete", rule_id: "R-CUS-01" }] }, NOW) as { ok: true; body: RuleSettingsPreview };
    const open = openOf(added, "R-CUS-01").length;
    expect(answer.body.impact).toEqual([expect.objectContaining({ rule_id: "R-CUS-01", open_now: open, would_close: open, would_stay: 0, would_open: 0 })]);
  });

  it("of a rule whose evidence the board does not record: not measurable, said so, and it would raise nothing", () => {
    const answer = previewView(
      sampleDataset(NOW),
      {
        changes: [
          create({
            ...BUGS_IN_PROGRESS,
            title: "Long in development without review",
            check: "no_evidence_after_percentile",
            params: { stage: "development", evidence: "code_review", pct: 75 },
          }),
        ],
      },
      NOW,
    ) as { ok: true; body: RuleSettingsPreview };
    expect(answer.body.impact[0]).toMatchObject({ measurable: false, would_open: 0, note: expect.stringMatching(/Not measurable/) });
  });
});

describe("every check a custom rule may use", () => {
  const options = boardOptions(sampleDataset(NOW).world);
  const checks = boardChecks(options);

  it("can be added with its defaults, and runs (or, where DEMO records no evidence, is not measurable)", () => {
    const changes = CHECK_REGISTRY.map((check): RuleSettingsChange => {
      const spec = checks.find((candidate) => candidate.name === check.name)!;
      const params = Object.fromEntries(
        spec.params.map((param) => [param.name, param.kind === "statuses" ? ["In Progress"] : (param.default as number | string)]),
      );
      return create({
        title: `Check ${check.label}`,
        check: check.name,
        params,
        applies_to: { status_category: [...spec.default_categories], issue_type: null },
        severity: "warning",
      });
    });
    const after = save(changes);
    const custom = after.rules.filter((rule) => rule.custom);
    expect(custom).toHaveLength(CHECK_REGISTRY.length);
    const view = ruleSettingsSchema.parse(settingsView(after));
    for (const rule of view.rules.filter((candidate) => candidate.custom)) {
      const evidence = rule.check === "entered_stage_without_evidence" || rule.check === "no_evidence_after_percentile";
      expect(rule.measurable, rule.check).toBe(!evidence);
      if (evidence) expect(openOf(after, rule.rule_id), rule.check).toHaveLength(0);
    }
    // The checks DEMO can run each find something on its year of work, but for the sprint's, which looks at one sprint.
    for (const name of ["open_longer_than", "missing_field", "missing_estimate", "skipped_stage", "reopened", "unestimated_in_active_sprint"]) {
      const rule = view.rules.find((candidate) => candidate.check === name && candidate.custom)!;
      expect(openOf(after, rule.rule_id).length, name).toBeGreaterThan(0);
    }
  });

  it("open too long: every open ticket created longer ago than the limit, and no other", () => {
    const after = save([create({ ...BUGS_IN_PROGRESS, title: "Open over 60 days", check: "open_longer_than", params: { days: 60 }, applies_to: { status_category: ["new", "indeterminate"], issue_type: null } })]);
    const expected = workItems(after.world).filter((issue) => STATUS[issue.status].category !== "done" && after.world.syncAt - issue.createdAt > 60 * DAY);
    expect(openOf(after, "R-CUS-01").map((finding) => finding.issue!.key).sort()).toEqual(expected.map((issue) => issue.key).sort());
    expect(openOf(after, "R-CUS-01")[0]).toMatchObject({ evidenceKey: "open-too-long", message: expect.stringMatching(/^Open for \d+ days; the limit is 60 days$/) });
  });

  it("no updates: every open ticket nothing has changed on in Jira for longer than the limit", () => {
    const after = save([create({ ...BUGS_IN_PROGRESS, title: "Quiet for 14 days", check: "no_update_for", params: { days: 14 }, applies_to: { status_category: ["new", "indeterminate"], issue_type: null } })]);
    const quiet = (issue: Issue) => {
      const times = [issue.createdAt, ...issue.statusChanges.map((c) => c.at), ...issue.fieldChanges.map((c) => c.at), ...issue.worklogs.map((w) => w.at)];
      return after.world.syncAt - Math.max(...times.filter((time) => time <= after.world.syncAt)) > 14 * DAY;
    };
    const expected = workItems(after.world).filter((issue) => STATUS[issue.status].category !== "done" && quiet(issue));
    expect(openOf(after, "R-CUS-01").map((finding) => finding.issue!.key).sort()).toEqual(expected.map((issue) => issue.key).sort());
    expect(openOf(after, "R-CUS-01")[0].message).toMatch(/^No change in Jira for \d+ days; the limit is 14 days$/);
  });

  it("a missing field: no assignee, no estimate, no epic (a subtask's from its parent), not in a sprint", () => {
    const field = (name: string, categories: ("new" | "indeterminate")[] = ["indeterminate"]) =>
      create({ ...BUGS_IN_PROGRESS, title: `No ${name}`, check: "missing_field", params: { field: name }, applies_to: { status_category: categories, issue_type: null } });
    // Work in progress is always in a sprint on DEMO: the backlog is where tickets in no sprint are.
    const after = save([field("assignee"), field("estimate"), field("epic"), field("sprint", ["new", "indeterminate"])]);
    const inProgress = workItems(after.world).filter((issue) => STATUS[issue.status].category === "indeterminate");
    const open = workItems(after.world).filter((issue) => STATUS[issue.status].category !== "done");
    const epicOf = (issue: Issue) => issue.epicKey ?? (issue.parentKey ? after.world.byKey.get(issue.parentKey)?.epicKey : null) ?? null;
    const expected: Record<string, Issue[]> = {
      "R-CUS-01": inProgress.filter((issue) => issue.assigneeAccountId === null),
      "R-CUS-02": inProgress.filter((issue) => issue.storyPoints === null || issue.estimateSetAt === null || issue.estimateSetAt > after.world.syncAt),
      "R-CUS-03": inProgress.filter((issue) => epicOf(issue) === null),
      "R-CUS-04": open.filter((issue) => issue.sprintIds.length === 0),
    };
    for (const [id, issues] of Object.entries(expected)) {
      expect(openOf(after, id).map((finding) => finding.issue!.key).sort(), id).toEqual(issues.map((issue) => issue.key).sort());
      expect(issues.length, id).toBeGreaterThan(0);
    }
    expect(openOf(after, "R-CUS-04")[0]).toMatchObject({ evidenceKey: "missing-sprint", message: "Not in a sprint" });
  });
});

describe("a custom rule's title", () => {
  it("is what every view that names a rule says: the catalogue, findings and their filter, a finding, a ticket, the Overview, Ask", () => {
    const after = save([create()]);
    const rules = rulesSchema.parse(rulesView(after));
    expect(rules.rules.at(-1)).toMatchObject({ rule_id: "R-CUS-01", title: BUGS_IN_PROGRESS.title, custom: true, check_label: "Time in a status", version: "c1" });
    const page = findingsPage(after, normalizeFindingsQuery({ rule: ["R-CUS-01"] }));
    expect(page.facets.rules.at(-1)).toMatchObject({ value: "R-CUS-01", label: BUGS_IN_PROGRESS.title });
    expect(page.items.every((item) => item.rule_title === BUGS_IN_PROGRESS.title)).toBe(true);
    const finding = openOf(after, "R-CUS-01")[0];
    expect(findingDetail(after, finding.id)?.finding.rule_title).toBe(BUGS_IN_PROGRESS.title);
    expect(issueTimeline(after, finding.issue!.key)?.findings.find((item) => item.rule_id === "R-CUS-01")?.rule_title).toBe(BUGS_IN_PROGRESS.title);
    expect(overviewSchema.parse(overview(after)).by_rule.at(-1)).toMatchObject({ rule_id: "R-CUS-01", title: BUGS_IN_PROGRESS.title });
    expect(ruleStatusFacts(after, "F1").rows.at(-1)).toMatchObject({ rule_id: "R-CUS-01", title: BUGS_IN_PROGRESS.title, version: "c1" });
  });

  it("stays with its findings once the rule is deleted: the filter still offers it, by its title", () => {
    save([create()]);
    const deleted = save([{ op: "delete", rule_id: "R-CUS-01" }]);
    const page = findingsPage(deleted, normalizeFindingsQuery({ rule: ["R-CUS-01"], state: "resolved" }));
    expect(page.facets.rules.at(-1)).toMatchObject({ value: "R-CUS-01", label: BUGS_IN_PROGRESS.title });
    expect(page.items.every((item) => item.resolved_why === "settings_changed")).toBe(true);
  });
});
