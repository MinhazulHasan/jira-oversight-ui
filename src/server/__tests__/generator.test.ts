// @vitest-environment node
import { describe, expect, it } from "vitest";

import { normalizeFindingsQuery } from "@/lib/api/params";

import { hotSpots } from "../sample/aggregates";
import { askSample } from "../sample/ask";
import { SUGGESTED_QUESTIONS } from "../sample/ask/scripts";
import { baselineView } from "../sample/baseline";
import { NOT_MEASURABLE_RULES } from "../sample/catalogue";
import { buildDataset, type Dataset } from "../sample/dataset";
import { findingsPage } from "../sample/findings";
import { insightsView } from "../sample/insights";
import { issueTimeline } from "../sample/issues";
import { overview } from "../sample/overview";
import { rulesView } from "../sample/rules";
import { trendPoints } from "../sample/series";
import { TEAM } from "../sample/team";
import { DAY, WEEK } from "../sample/time";
import { workItems } from "../sample/world";

const NOW = Date.parse("2026-11-04T14:30:00Z");

/** Everything a reader can see, as one JSON string. */
function everything(dataset: Dataset): string {
  return JSON.stringify({
    overview: overview(dataset),
    findings: findingsPage(dataset, normalizeFindingsQuery({ state: "all", page_size: 100 })),
    issue: issueTimeline(dataset, "DEMO-1"),
    insights: insightsView(dataset),
    rules: rulesView(dataset),
    baseline: baselineView(dataset),
    ask: SUGGESTED_QUESTIONS.map((question) => askSample(dataset, question, 0)),
  });
}

describe("the sample generator", () => {
  it("gives the same output for the same SAMPLE_NOW", () => {
    expect(everything(buildDataset(NOW))).toBe(everything(buildDataset(NOW)));
  });

  it("ignores the seconds of SAMPLE_NOW, as the sync clock does", () => {
    expect(everything(buildDataset(NOW + 42_000))).toBe(everything(buildDataset(NOW)));
  });

  it("writes every timestamp as an offset from now: a week later, the whole project is a week later", () => {
    const now = buildDataset(NOW);
    const later = buildDataset(NOW + WEEK);
    expect(later.world.issues).toHaveLength(now.world.issues.length);
    now.world.issues.forEach((issue, index) => {
      const moved = later.world.issues[index];
      expect(moved.key).toBe(issue.key);
      expect(moved.summary).toBe(issue.summary);
      expect(moved.createdAt - issue.createdAt).toBe(WEEK);
      expect(moved.statusChanges.map((change) => change.at - WEEK)).toEqual(issue.statusChanges.map((change) => change.at));
      expect(moved.worklogs.map((log) => log.at - WEEK)).toEqual(issue.worklogs.map((log) => log.at));
      expect(moved.assigneeAccountId).toBe(issue.assigneeAccountId);
    });
    expect(later.engine.findings.map((finding) => finding.id)).toEqual(now.engine.findings.map((finding) => finding.id));
    expect(later.engine.findings.map((finding) => finding.firstSeenAt - WEEK)).toEqual(
      now.engine.findings.map((finding) => finding.firstSeenAt),
    );
  });

  it("puts nothing in the future", () => {
    const { world, engine } = buildDataset(NOW);
    const syncAt = world.syncAt;
    for (const issue of world.issues) {
      expect(issue.createdAt).toBeLessThanOrEqual(syncAt);
      for (const change of [...issue.statusChanges, ...issue.fieldChanges]) expect(change.at).toBeLessThanOrEqual(syncAt);
      for (const log of issue.worklogs) expect(log.at).toBeLessThanOrEqual(syncAt);
    }
    for (const finding of engine.findings) {
      expect(finding.firstSeenAt).toBeLessThan(NOW);
      expect(finding.lastSeenAt).toBeLessThan(NOW);
      if (finding.resolvedAt !== null) expect(finding.resolvedAt).toBeGreaterThan(finding.firstSeenAt);
    }
  });
});

describe("the sample story", () => {
  const dataset = buildDataset(NOW);
  const { world } = dataset;
  const work = workItems(world);
  const done = work.filter((issue) => issue.status === "Done");
  const share = (part: number, whole: number) => part / whole;

  it("is one project of about 1,150 issues in about 14 epics, on a three-status workflow", () => {
    expect(world.issues).toHaveLength(1150);
    expect(world.epics).toHaveLength(14);
    expect(new Set(world.issues.map((issue) => issue.type))).toEqual(new Set(["Task", "Bug", "Subtask", "Test", "Epic"]));
    expect(new Set(world.issues.map((issue) => issue.status))).toEqual(new Set(["To Do", "In Progress", "Done"]));
    expect(world.issues.every((issue) => /^DEMO-\d+$/.test(issue.key))).toBe(true);
  });

  it("sizes about two thirds of the work in story points and never uses original estimates", () => {
    expect(share(work.filter((issue) => issue.storyPoints !== null).length, work.length)).toBeGreaterThan(0.6);
    expect(share(work.filter((issue) => issue.storyPoints !== null).length, work.length)).toBeLessThan(0.72);
    expect(baselineView(dataset).figures.resolved.with_original_estimate.count).toBe(0);
  });

  it("has time logged on about 85% of finished work, all by one account", () => {
    const logged = share(done.filter((issue) => issue.timeSpentS > 0).length, done.length);
    expect(logged).toBeGreaterThan(0.8);
    expect(logged).toBeLessThan(0.9);
    expect(baselineView(dataset).figures.worklogs.authors).toBe(1);
  });

  it("sent about 16% of finished work straight from To Do to Done", () => {
    const straight = share(done.filter((issue) => issue.skips.length > 0).length, done.length);
    expect(straight).toBeGreaterThan(0.13);
    expect(straight).toBeLessThan(0.19);
  });

  it("skips stages less since the process change five weeks ago", () => {
    const before = done.filter((issue) => issue.doneAt! < world.processChangeAt && issue.doneAt! >= world.processChangeAt - 10 * WEEK);
    const after = done.filter((issue) => issue.doneAt! >= world.processChangeAt);
    const rate = (issues: typeof done) => share(issues.filter((issue) => issue.skips.length > 0).length, issues.length);
    expect(rate(after)).toBeLessThan(rate(before) / 2);
  });

  it("has two epics running further over their estimates every week, and they lead the hot spots", () => {
    const drifting = new Set(["Data import pipeline", "Integrations API"]);
    expect(
      hotSpots(dataset)
        .slice(0, 2)
        .map((spot) => spot.epicTitle),
    ).toEqual(expect.arrayContaining([...drifting]));
    const ratios = trendPoints(dataset, "median_effort_ratio").map((point) => point.value ?? 0);
    const early = ratios.slice(0, 6).reduce((sum, value) => sum + value, 0) / 6;
    const late = ratios.slice(8, 11).reduce((sum, value) => sum + value, 0) / 3;
    expect(late).toBeGreaterThan(early * 1.2);
  });

  it("has a sprint ending in about two days with about a third of it not started, and the warning says so", () => {
    const sprint = world.activeSprint;
    expect(sprint.end - NOW).toBeGreaterThan(1.5 * DAY);
    expect(sprint.end - NOW).toBeLessThan(2 * DAY);
    const notStarted = sprint.memberKeys.filter((key) => world.byKey.get(key)!.status === "To Do").length;
    expect(share(notStarted, sprint.memberKeys.length)).toBeGreaterThan(0.3);
    expect(dataset.engine.findings.some((finding) => finding.rule.id === "W-SPR-01" && finding.resolvedAt === null)).toBe(true);
  });

  it("opens and resolves findings for every measurable rule, and none for the two it cannot measure", () => {
    const byRule = new Map<string, { open: number; resolved: number }>();
    for (const finding of dataset.engine.findings) {
      const counts = byRule.get(finding.rule.id) ?? { open: 0, resolved: 0 };
      if (finding.resolvedAt === null) counts.open += 1;
      else counts.resolved += 1;
      byRule.set(finding.rule.id, counts);
    }
    for (const id of ["R-EST-01", "R-EST-02", "R-EFF-01", "R-FLOW-02", "R-FLOW-03", "R-HYG-01", "W-EFF-01", "W-AGE-01", "W-SPR-01", "W-EST-01"]) {
      expect(byRule.get(id)?.open ?? 0, id).toBeGreaterThan(0);
    }
    for (const id of ["R-EST-01", "R-HYG-01", "W-EFF-01", "W-AGE-01", "W-EST-01"]) {
      expect(byRule.get(id)?.resolved ?? 0, id).toBeGreaterThan(0);
    }
    expect(NOT_MEASURABLE_RULES).toEqual(["R-FLOW-01", "W-REV-01"]);
    for (const id of NOT_MEASURABLE_RULES) expect(byRule.has(id)).toBe(false);
  });

  it("words a stuck or unassigned ticket's finding as the service does: the status quoted, its durations in its units", () => {
    const span = String.raw`(\d+\.\d) (days|h)`;
    const stuck = new RegExp(String.raw`^In '(To Do|In Progress)' for ${span}; the project's p90 for '\1' is ${span}$`);
    const unassigned = new RegExp(String.raw`^In 'In Progress' with nobody assigned for ${span}$`);
    const said = (id: string, pattern: RegExp) => {
      const messages = dataset.engine.findings.filter((finding) => finding.rule.id === id).map((finding) => finding.message);
      expect(messages.length, id).toBeGreaterThan(0);
      for (const message of messages) {
        const match = pattern.exec(message);
        expect(match, message).not.toBeNull();
        // Each length in the unit the service picks for it.
        for (let at = id === "W-AGE-01" ? 2 : 1; at < match!.length; at += 2) {
          const value = Number(match![at]);
          expect(match![at + 1] === "days" ? value * 24 >= 47.9 : value < 48, message).toBe(true);
        }
      }
    };
    said("W-AGE-01", stuck);
    said("R-HYG-01", unassigned);
    expect(everything(dataset)).not.toMatch(/In In /);
  });

  it("links warnings to the breaches they foreshadowed", () => {
    const warned = dataset.engine.findings.filter((finding) => finding.warnedBefore !== null);
    expect(warned.length).toBeGreaterThan(0);
    for (const finding of warned) {
      const warning = dataset.engine.byId.get(finding.warnedBefore!.findingId)!;
      expect(warning.rule.escalatesTo).toBe(finding.rule.id);
      expect(warning.issue).toBe(finding.issue);
      expect(warning.firstSeenAt).toBeLessThanOrEqual(finding.firstSeenAt);
    }
    expect(new Set(warned.map((finding) => finding.warnedBefore!.ruleId))).toEqual(new Set(["W-EFF-01", "W-EST-01"]));
  });

  it("gives the work to eight fictional people, with a few tickets nobody has", () => {
    const holders = new Map<string | null, number>();
    for (const issue of world.issues) holders.set(issue.assigneeAccountId, (holders.get(issue.assigneeAccountId) ?? 0) + 1);
    expect(new Set([...holders.keys()].filter((key) => key !== null))).toEqual(new Set(TEAM.map((member) => member.accountId)));
    const nobody = holders.get(null) ?? 0;
    expect(nobody).toBeGreaterThan(5);
    expect(share(nobody, world.issues.length)).toBeLessThan(0.05);
    // The bigger shares hold more of the work.
    const tickets = (accountId: string) => holders.get(accountId) ?? 0;
    expect(tickets("acc-01") + tickets("acc-02")).toBeGreaterThan(tickets("acc-07") + tickets("acc-08"));
  });

  it("assigns each ticket as its own changelog and the rules tell it", () => {
    const hygiene = new Set(
      dataset.engine.findings.filter((finding) => finding.rule.id === "R-HYG-01" && finding.resolvedAt === null).map((finding) => finding.issue!.key),
    );
    for (const issue of world.issues) {
      const latest = issue.fieldChanges.findLast((change) => change.field === "assignee");
      // Picked up and assigned: someone has it; still In Progress with nobody assigned: no one does.
      if (latest?.to === "Assigned") expect(issue.assigneeAccountId, issue.key).not.toBeNull();
      if (hygiene.has(issue.key)) expect(issue.assigneeAccountId, issue.key).toBeNull();
      if (issue.status === "In Progress" && issue.assigneeAccountId === null) expect(hygiene.has(issue.key), issue.key).toBe(true);
      // Never given anyone: the backlog no sprint has planned, or work finished before anyone was assigned.
      if (issue.assigneeAccountId === null && !hygiene.has(issue.key)) {
        const planned = issue.sprintIds.includes(world.activeSprint.id);
        expect(issue.status === "To Do" ? !planned : issue.unassigned.length > 0 && latest === undefined, issue.key).toBe(true);
      }
    }
    expect(hygiene.size).toBeGreaterThan(0);
  });

  it("keeps DEMO-1 as the issue that shows the most: a late estimate, a reopen and an overrun", () => {
    // Its spell without an estimate ended before the rules started running, so it never became a finding.
    const rules = new Set((dataset.engine.byIssue.get("DEMO-1") ?? []).map((finding) => finding.rule.id));
    expect(rules).toEqual(new Set(["R-EST-02", "R-FLOW-03", "R-EFF-01"]));
  });
});
