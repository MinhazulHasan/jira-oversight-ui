// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { normalizeFindingsQuery } from "@/lib/api/params";
import {
  overviewSchema,
  peopleScorecardSchema,
  recordsCodeReview,
  ruleSettingsPreviewSchema,
  ruleSettingsSchema,
  rulesSchema,
  type RuleSettings,
  type RuleSettingsChange,
  type RuleSettingsPreview,
  type RuleSettingsSaveRequest,
} from "@/lib/api/schemas";

import { applyChanges, boardRules, catalogueParam, crossRuleProblems, thresholdText } from "../sample/board-rules";
import { RULES } from "../sample/catalogue";
import { buildDataset, sampleDataset, type Dataset } from "../sample/dataset";
import { linkWarnings, runEngine, type FindingRecord } from "../sample/engine";
import { findingsPage } from "../sample/findings";
import { issueTimeline } from "../sample/issues";
import { overview } from "../sample/overview";
import { previewView, saveView, settingsView } from "../sample/rule-settings";
import { rulesView } from "../sample/rules";
import { NOT_MEASURABLE_REASONS, scorecardView } from "../sample/scorecard";
import { boardSettings, resetSampleRuleSettings, revisionOf } from "../sample/settings-store";
import type { Issue } from "../sample/world";

/*
 * The sample's rule settings (JO-15), held to the service's semantics (the
 * spec, section 2): a finding is the condition on its ticket, not the
 * threshold, so a ticket over both the old and the new threshold stays the
 * same finding; what a change no longer raises closes as settings_changed,
 * never as cleared; only a severity change gives a rule new ids; and turning
 * a rule back on, or a threshold back, reopens the same findings.
 */

const NOW = Date.parse("2026-11-04T14:30:00Z");
const READER = { hash: "b".repeat(32), name: "Morgan Ellis" };

afterEach(() => resetSampleRuleSettings());

const openOf = (dataset: Dataset, ruleId: string) => dataset.engine.findings.filter((finding) => finding.rule.id === ruleId && finding.resolvedAt === null);

/** Saves on the sample's board, as the route would, and answers the board as it then stands. */
function save(changes: RuleSettingsChange[], extra: Partial<RuleSettingsSaveRequest> = {}, recheckMs = 0, wallClock = Date.now()): Dataset {
  const dataset = sampleDataset(NOW);
  const answer = saveView(dataset, { revision: dataset.revision, changes, ...extra }, READER, NOW, recheckMs, wallClock);
  if (!answer.ok) throw new Error(`refused: ${answer.status} ${JSON.stringify(answer.issues ?? answer.message)}`);
  return sampleDataset(NOW);
}

describe("the board's rules", () => {
  it("with no settings, are the catalogue's exactly: every finding as it always was", () => {
    const dataset = sampleDataset(NOW);
    expect(dataset.revision).toBe(0);
    expect(dataset.rules.map((rule) => rule.def.id)).toEqual(RULES.map((rule) => rule.id));
    expect(dataset.rules.every((rule) => rule.enabled && !rule.customised && rule.version === "0.1.0")).toBe(true);
    expect(dataset.engine.findings.map((finding) => finding.id)).toEqual(buildDataset(NOW).engine.findings.map((finding) => finding.id));
    expect(dataset.engine.findings.map((finding) => finding.id)).toEqual(runEngine(dataset.world).findings.map((finding) => finding.id));
  });

  it("take each threshold from the board, the catalogue's (or the check's own default) where it has none", () => {
    const [estimate] = RULES.filter((rule) => rule.id === "R-EST-02");
    expect(catalogueParam(estimate, "grace_hours")).toBe(1);
    const rules = boardRules(new Map([["W-SPR-01", { params: { days_left: 3, not_started_share: 0.4 } }]]));
    const sprint = rules.find((rule) => rule.def.id === "W-SPR-01")!;
    expect(sprint.def.threshold).toBe("≤ 3 days left, > 40% not started");
    expect(sprint.customised).toBe(true);
    expect(thresholdText({ check: "effort_ratio_at_least" }, { threshold: 2.25 })).toBe("2.25×");
    expect(thresholdText({ check: "estimate_after_start" }, { grace_hours: 1.5 })).toBe("1.5 h grace");
  });
});

describe("a threshold moved", () => {
  it("up: a ticket over both thresholds stays the same finding, first seen when it was; the rest close as settings_changed, never cleared", () => {
    const before = sampleDataset(NOW);
    const was = openOf(before, "R-EFF-01");
    const after = save([{ rule_id: "R-EFF-01", params: { threshold: 2 } }]);
    const now = openOf(after, "R-EFF-01");
    expect(now.length).toBeGreaterThan(0);
    expect(now.length).toBeLessThan(was.length);
    const earlier = new Map(was.map((finding) => [finding.id, finding]));
    for (const finding of now) {
      expect(earlier.get(finding.id)?.firstSeenAt, finding.id).toBe(finding.firstSeenAt);
      expect(finding.message).toContain("threshold 2×");
      expect(finding.threshold).toBe("2×");
    }
    const closed = was.filter((finding) => !now.some((kept) => kept.id === finding.id)).map((finding) => after.engine.byId.get(finding.id)!);
    expect(closed.length).toBe(was.length - now.length);
    expect(closed.every((finding) => finding.resolvedWhy === "settings_changed" && finding.resolvedAt === NOW)).toBe(true);

    // As the page reads them: the catalogue's threshold now the board's, and the closed findings saying why.
    const rule = rulesSchema.parse(rulesView(after)).rules.find((candidate) => candidate.rule_id === "R-EFF-01")!;
    expect(rule).toMatchObject({ threshold: "2×", enabled: true, customised: true, open: now.length, version: "0.1.0" });
    const resolved = findingsPage(after, normalizeFindingsQuery({ rule: ["R-EFF-01"], state: "resolved", page_size: 100 }));
    expect(resolved.items.filter((finding) => finding.resolved_why === "settings_changed").length).toBeGreaterThan(0);
    expect(issueTimeline(after, "DEMO-1")?.issue.effort_threshold).toBe(2);
  });

  it("down: tickets newly over it open, first seen at the re-check unless the rules saw them before", () => {
    const before = sampleDataset(NOW);
    const was = new Set(openOf(before, "R-EFF-01").map((finding) => finding.id));
    const after = save([{ rule_id: "R-EFF-01", params: { threshold: 1.2 } }]);
    const opened = openOf(after, "R-EFF-01").filter((finding) => !was.has(finding.id));
    expect(opened.length).toBeGreaterThan(0);
    for (const finding of opened) {
      const seen = before.engine.byId.get(finding.id);
      // A ticket the rules held before (since cleared) reopens as itself; any other is new at the re-check.
      expect(finding.firstSeenAt).toBe(seen ? seen.firstSeenAt : NOW);
    }
    // Every finding that was open stays open, as the same finding.
    expect([...was].every((id) => after.engine.byId.get(id)?.resolvedAt === null)).toBe(true);
  });

  it("back again: the findings it closed reopen as themselves", () => {
    const was = openOf(sampleDataset(NOW), "R-EFF-01");
    save([{ rule_id: "R-EFF-01", params: { threshold: 2 } }]);
    const after = save([{ rule_id: "R-EFF-01", reset: true }]);
    const now = openOf(after, "R-EFF-01");
    expect(now.map((finding) => finding.id).sort()).toEqual(was.map((finding) => finding.id).sort());
    const first = new Map(was.map((finding) => [finding.id, finding.firstSeenAt]));
    expect(now.every((finding) => first.get(finding.id) === finding.firstSeenAt)).toBe(true);
  });
});

describe("a rule turned off and on", () => {
  it("off: its open findings close as settings_changed and it holds none; on: the same findings reopen, first seen when they were", () => {
    const was = openOf(sampleDataset(NOW), "W-AGE-01");
    expect(was.length).toBeGreaterThan(0);
    const off = save([{ rule_id: "W-AGE-01", enabled: false }]);
    expect(openOf(off, "W-AGE-01")).toEqual([]);
    expect(was.every((finding) => off.engine.byId.get(finding.id)?.resolvedWhy === "settings_changed")).toBe(true);
    expect(rulesView(off).rules.find((rule) => rule.rule_id === "W-AGE-01")).toMatchObject({ enabled: false, customised: true, open: 0 });

    const on = save([{ rule_id: "W-AGE-01", enabled: true }]);
    const again = openOf(on, "W-AGE-01");
    expect(again.map((finding) => finding.id).sort()).toEqual(was.map((finding) => finding.id).sort());
    const first = new Map(was.map((finding) => [finding.id, finding.firstSeenAt]));
    expect(again.every((finding) => first.get(finding.id) === finding.firstSeenAt)).toBe(true);
    expect(rulesView(on).rules.find((rule) => rule.rule_id === "W-AGE-01")).toMatchObject({ enabled: true, customised: false });
  });
});

describe("what the other pages read of rules turned off", () => {
  const unmeasured = (dataset: Dataset) => {
    const answer = scorecardView(dataset, { days: 90, person: [] }, "on");
    if (!answer.found) throw new Error(answer.message);
    const card = peopleScorecardSchema.parse(answer.body);
    return { card, reasons: Object.fromEntries(card.measures.filter((measure) => !measure.measurable).map((measure) => [measure.key, measure.reason])) };
  };

  it("the Overview lists only the rules the board runs, as the service does", () => {
    const off = save([{ rule_id: "W-AGE-01", enabled: false }]);
    expect(overviewSchema.parse(overview(off)).by_rule.map((rule) => rule.rule_id)).toEqual(RULES.map((rule) => rule.id).filter((id) => id !== "W-AGE-01"));
    const on = save([{ rule_id: "W-AGE-01", enabled: true }]);
    expect(overview(on).by_rule.map((rule) => rule.rule_id)).toEqual(RULES.map((rule) => rule.id));
  });

  it("the scorecard holds no one to a measure whose rules are off, and says so: never a 0% for want of findings", () => {
    expect(unmeasured(sampleDataset(NOW)).reasons).toEqual({ code_review: NOT_MEASURABLE_REASONS.code_review });
    const off = save([
      { rule_id: "W-AGE-01", enabled: false },
      { rule_id: "R-FLOW-02", enabled: false },
      { rule_id: "R-FLOW-03", enabled: false },
      { rule_id: "R-EFF-01", enabled: false },
      { rule_id: "R-EST-02", enabled: false },
      // DEMO records no code review: with its rule off that stays the reason, and the caveat still says so.
      { rule_id: "R-FLOW-01", enabled: false },
    ]);
    const { card, reasons } = unmeasured(off);
    expect(reasons).toEqual({
      within_estimate: "Its rule is off on this board.",
      stuck_now: "Its rule is off on this board.",
      reopened: "Its rule is off on this board.",
      skipped_stage: "Its rule is off on this board.",
      code_review: NOT_MEASURABLE_REASONS.code_review,
    });
    for (const key of Object.keys(reasons)) expect(card.board.values[key as keyof typeof card.board.values].value).toBeNull();
    expect(card.board.values.estimated_before_start.value).not.toBeNull(); // R-EST-01 still runs
    expect(recordsCodeReview(card.measures)).toBe(false);
    const both = save([{ rule_id: "R-EST-01", enabled: false }]);
    expect(unmeasured(both).reasons.estimated_before_start).toBe("Its rules are off on this board.");
  });
});

describe("a severity changed", () => {
  it("supersedes the rule's open findings and opens new ids under its own version; changed back, the originals reopen", () => {
    const was = openOf(sampleDataset(NOW), "R-EST-02");
    expect(was.length).toBeGreaterThan(0);
    const breach = save([{ rule_id: "R-EST-02", severity: "breach" }]);
    const raised = openOf(breach, "R-EST-02");
    expect(raised.length).toBe(was.length);
    expect(raised.every((finding) => finding.ruleVersion === "0.1.0+breach" && finding.rule.severity === "breach")).toBe(true);
    expect(raised.some((finding) => was.some((old) => old.id === finding.id))).toBe(false);
    expect(was.every((finding) => breach.engine.byId.get(finding.id)?.resolvedWhy === "superseded")).toBe(true);
    expect(rulesView(breach).rules.find((rule) => rule.rule_id === "R-EST-02")).toMatchObject({ severity: "breach", version: "0.1.0", customised: true });

    const back = save([{ rule_id: "R-EST-02", severity: "warning" }]);
    const reopened = openOf(back, "R-EST-02");
    expect(reopened.map((finding) => finding.id).sort()).toEqual(was.map((finding) => finding.id).sort());
    expect(raised.every((finding) => back.engine.byId.get(finding.id)?.resolvedWhy === "superseded")).toBe(true);
  });

  it("links a warning to a breach only under the warning rule's own version", () => {
    const issue = { key: "DEMO-7" } as Issue;
    const record = (id: string, ruleId: string, kind: "rule" | "warning", version: string, firstSeenAt: number) =>
      ({ id, rule: { id: ruleId, kind, escalatesTo: kind === "warning" ? "R-EFF-01" : null }, ruleVersion: version, issue, firstSeenAt, warnedBefore: null }) as unknown as FindingRecord;
    const breach = record("b", "R-EFF-01", "rule", "0.1.0", 300);
    const findings = [breach, record("old", "W-EFF-01", "warning", "0.1.0", 100), record("new", "W-EFF-01", "warning", "0.1.0+breach", 200)];
    linkWarnings(findings, boardRules());
    expect(breach.warnedBefore?.findingId).toBe("old");
    linkWarnings(findings, boardRules(new Map([["W-EFF-01", { severity: "breach" }]])));
    expect(breach.warnedBefore?.findingId).toBe("new");
  });
});

describe("a preview", () => {
  it("works out what a change would do, writes nothing, and agrees with the save that follows", () => {
    const dataset = sampleDataset(NOW);
    const answer = previewView(dataset, { changes: [{ rule_id: "R-EFF-01", params: { threshold: 2 } }] }, NOW);
    if (!answer.ok) throw new Error("refused");
    const preview = answer.body as RuleSettingsPreview;
    expect(ruleSettingsPreviewSchema.parse(preview)).toStrictEqual(preview);
    const [impact] = preview.impact;
    expect(impact).toMatchObject({ rule_id: "R-EFF-01", measurable: true, open_now: openOf(dataset, "R-EFF-01").length, would_open: 0, note: null });
    expect(impact.would_close).toBeGreaterThan(0);
    expect(impact.examples.close.length).toBe(5);
    const numbers = impact.examples.close.map((key) => Number(key.split("-")[1]));
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
    // Nothing kept: the board is as it was, and its dataset the very one it had.
    expect(revisionOf(boardSettings())).toBe(0);
    expect(sampleDataset(NOW)).toBe(dataset);

    const after = save([{ rule_id: "R-EFF-01", params: { threshold: 2 } }]);
    expect(settingsView(after).apply.result).toEqual({ opened: 0, closed: impact.would_close });
  });

  it("notes a rule left on that cannot run on the board, and says nothing of one turned off", () => {
    const dataset = sampleDataset(NOW);
    const on = previewView(dataset, { changes: [{ rule_id: "W-REV-01", params: { pct: 80 } }] }, NOW);
    const off = previewView(dataset, { changes: [{ rule_id: "W-REV-01", enabled: false }] }, NOW);
    if (!on.ok || !off.ok) throw new Error("refused");
    expect((on.body as RuleSettingsPreview).impact[0]).toMatchObject({ measurable: false, open_now: 0, note: "Not measurable on this board, so this change has no effect until it can run." });
    expect((off.body as RuleSettingsPreview).impact[0]).toMatchObject({ measurable: false, note: null });
  });
});

describe("a save", () => {
  it("is refused when the board has moved on from its revision (409), or a change cannot be made (422), keeping nothing", () => {
    const dataset = sampleDataset(NOW);
    const refuse = (request: RuleSettingsSaveRequest) => {
      const answer = saveView(dataset, request, READER, NOW, 0);
      return answer.ok ? null : { status: answer.status, paths: answer.issues?.map((issue) => issue.path) ?? [] };
    };
    expect(refuse({ revision: 3, changes: [{ rule_id: "W-AGE-01", enabled: false }] })).toEqual({ status: 409, paths: [] });
    expect(refuse({ revision: 0, changes: [{ rule_id: "R-FLOW-02", params: { threshold: 2 } }] })).toEqual({ status: 422, paths: ["R-FLOW-02.params.threshold"] });
    expect(refuse({ revision: 0, changes: [{ rule_id: "R-EFF-01", params: { threshold: 1.5 } }] })).toEqual({ status: 422, paths: ["R-EFF-01.rule_id"] });
    expect(refuse({ revision: 0, changes: [{ rule_id: "R-ZZZ-99", enabled: false }] })).toEqual({ status: 422, paths: ["R-ZZZ-99.rule_id"] });
    expect(refuse({ revision: 0, changes: [{ rule_id: "W-EFF-01", params: { threshold: 1.6 } }] })).toEqual({ status: 422, paths: ["W-EFF-01.params.threshold"] });
    expect(refuse({ revision: 0, changes: [{ rule_id: "R-EFF-01", params: { threshold: 0.7 } }] })).toEqual({ status: 422, paths: ["R-EFF-01.params.threshold"] });
    expect(refuse({ revision: 0, changes: [{ rule_id: "W-AGE-01", enabled: false }], undo_of: "e".repeat(32) })).toEqual({ status: 422, paths: ["undo_of"] });
    expect(revisionOf(boardSettings())).toBe(0);
    // The warning off, the breach may go below where it was: the rule holds only while both run.
    expect(refuse({ revision: 0, changes: [{ rule_id: "W-EFF-01", enabled: false }, { rule_id: "R-EFF-01", params: { threshold: 0.7 } }] })).toBeNull();
  });

  it("records each change as the next revision, newest first: who, when, why and each field's values; an undo as one of its own", () => {
    save([{ rule_id: "R-EFF-01", params: { threshold: 2 } }], { reason: "Agreed with the team" });
    const second = save([{ rule_id: "W-AGE-01", enabled: false }, { rule_id: "W-SPR-01", params: { not_started_share: 0.4 } }]);
    const undone = settingsView(second).history[0];
    const after = save([{ rule_id: "W-AGE-01", enabled: true }, { rule_id: "W-SPR-01", params: { not_started_share: 0.3 } }], {
      undo_of: undone.change_id,
      reason: "Undo of revision 2",
    });
    const body = settingsView(after);
    expect(ruleSettingsSchema.parse(body)).toStrictEqual(body);
    expect(body).toMatchObject({ revision: 3, updated_by: "Morgan Ellis", updated_at: new Date(NOW).toISOString() });
    expect(body.history.map((entry) => entry.revision)).toEqual([3, 2, 1]);
    expect(body.history[2]).toMatchObject({ reason: "Agreed with the team", undo_of: null, by: READER });
    expect(body.history[2].changes).toEqual([{ rule_id: "R-EFF-01", field: "params.threshold", from: 1.5, to: 2 }]);
    expect(body.history[1].changes).toEqual([
      { rule_id: "W-AGE-01", field: "enabled", from: true, to: false },
      { rule_id: "W-SPR-01", field: "params.not_started_share", from: 0.3, to: 0.4 },
    ]);
    expect(body.history[0]).toMatchObject({ undo_of: undone.change_id, reason: "Undo of revision 2" });
    expect(body.rules.find((rule) => rule.rule_id === "W-AGE-01")).toMatchObject({ enabled: true, customised: false });
    expect(body.rules.find((rule) => rule.rule_id === "R-EFF-01")).toMatchObject({ customised: true, params: [expect.objectContaining({ value: 2, default: 1.5 })] });
  });

  it("re-checks the board in a moment: running until the sample's latency has passed, then applied with what it did", () => {
    const wall = 5_000_000;
    const after = save([{ rule_id: "W-AGE-01", enabled: false }], {}, 1_200, wall);
    const running: RuleSettings = settingsView(after, wall + 600);
    expect(running.apply).toMatchObject({ state: "running", applied_revision: 0, finished_at: null, result: null });
    expect(ruleSettingsSchema.safeParse(running).success).toBe(true);
    const applied = settingsView(after, wall + 1_200);
    expect(applied.apply).toMatchObject({ state: "applied", applied_revision: 1, result: { opened: 0, closed: openOf(buildDataset(NOW), "W-AGE-01").length } });
  });
});

describe("the sample's store", () => {
  it("keeps one dataset for each revision, and a reset takes the board back to the catalogue, as a fresh server starts", () => {
    const first = sampleDataset(NOW);
    expect(sampleDataset(NOW)).toBe(first);
    const after = save([{ rule_id: "W-AGE-01", enabled: false }]);
    expect(after).not.toBe(first);
    expect(sampleDataset(NOW)).toBe(after);
    resetSampleRuleSettings();
    const fresh = sampleDataset(NOW);
    expect(fresh.revision).toBe(0);
    expect(fresh.rules.every((rule) => rule.enabled && !rule.customised)).toBe(true);
    expect(settingsView(fresh).history).toEqual([]);
  });

  it("checks a change set as the service does: the cross-rule rule is said on the threshold the change moved", () => {
    const rules = boardRules();
    const moved = applyChanges(rules, [{ rule_id: "R-EFF-01", params: { threshold: 0.8 } }]);
    expect(moved.ok ? [] : moved.problems.map((problem) => problem.path)).toEqual(["R-EFF-01.params.threshold"]);
    const both = boardRules(new Map([["W-EFF-01", { params: { threshold: 1.5 } }]]));
    expect(crossRuleProblems(both).map((problem) => problem.path)).toEqual(["W-EFF-01.params.threshold"]);
  });
});
