import { describe, expect, it } from "vitest";

import {
  citationsByChange,
  effortVerdict,
  estimateHours,
  estimateTiming,
  fieldLabel,
  findingForFact,
  findingHref,
  reopenChanges,
  spellBefore,
  stageWords,
  weeklyTotals,
} from "../model";
import { DEMO_1, demo1With, PROCESS, SKIPPER } from "./fixtures";

describe("the issue model", () => {
  it("ties each fact to the open finding that fired on it", () => {
    expect(findingForFact(DEMO_1.findings, "effort")?.rule_id).toBe("R-EFF-01");
    expect(findingForFact(DEMO_1.findings, "estimateSet")?.rule_id).toBe("R-EST-02");
    expect(findingForFact(DEMO_1.findings, "reopens")?.rule_id).toBe("R-FLOW-03");
    expect(findingForFact(DEMO_1.findings, "estimate")).toBeNull();
  });

  it("prefers a breach to a warning, and ignores resolved findings", () => {
    const [breach] = DEMO_1.findings.filter((finding) => finding.rule_id === "R-EFF-01");
    const warning = { ...breach, finding_id: "f".repeat(32), rule_id: "W-EFF-01", severity: "warning" as const };
    expect(findingForFact([warning, breach], "effort")?.rule_id).toBe("R-EFF-01");
    const resolved = { ...breach, state: "resolved" as const, resolved_at: "2026-11-01T10:00:00.000Z" };
    expect(findingForFact([resolved], "effort")).toBeNull();
    expect(findingHref(breach.finding_id)).toBe(`/findings?finding=${breach.finding_id}`);
  });

  it("converts points at the process's hours a point, or reads the estimate back from the ratio", () => {
    expect(estimateHours(DEMO_1.issue, PROCESS.estimate.hours_per_point)).toBe(24);
    expect(estimateHours(DEMO_1.issue, null)).toBeCloseTo(24, 2);
    const unestimated = demo1With((data) => {
      data.issue.estimate_basis = "none";
      data.issue.story_points = null;
      data.issue.effort_ratio = null;
    });
    expect(estimateHours(unestimated.issue, 8)).toBeNull();
  });

  it("says whether the estimate came before or after work started, and by how much", () => {
    const late = estimateTiming(DEMO_1.issue);
    expect(late).toMatchObject({ kind: "after", setAt: "2025-11-17T11:34:00.000Z", startedAt: "2025-11-12T11:12:00.000Z" });
    expect(late.kind === "after" && late.hours).toBeCloseTo(120.3667, 3);
    expect(estimateTiming(SKIPPER.issue)).toEqual({ kind: "unstarted", setAt: "2025-11-10T09:12:00.000Z" });
    const early = demo1With((data) => {
      data.issue.estimate_set_at = "2025-11-10T09:12:00.000Z";
    });
    expect(estimateTiming(early.issue)).toMatchObject({ kind: "before", hours: 50 });
    const none = demo1With((data) => {
      data.issue.estimate_set_at = null;
    });
    expect(estimateTiming(none.issue)).toEqual({ kind: "none" });
  });

  it("reads the effort ratio against the threshold R-EFF-01 fires at", () => {
    expect(effortVerdict(1.8229, 1.5)).toBe("over");
    expect(effortVerdict(1.5, 1.5)).toBe("at");
    expect(effortVerdict(0.9, 1.5)).toBe("under");
    expect(effortVerdict(null, 1.5)).toBeNull();
  });

  it("finds the reopen and the spell each status change ended", () => {
    expect(reopenChanges(DEMO_1).map((change) => change.changelog_id)).toEqual(["310131"]);
    const reopen = DEMO_1.changes.find((change) => change.changelog_id === "310131");
    expect(reopen && spellBefore(DEMO_1, reopen)).toMatchObject({ status: "Done", hours: 171.1333 });
    const points = DEMO_1.changes.find((change) => change.field === "story_points");
    expect(points && spellBefore(DEMO_1, points)).toBeNull();
  });

  it("indexes the changelog entries each finding cites", () => {
    const cited = citationsByChange(DEMO_1.findings);
    expect(cited.get("310004")?.map((finding) => finding.rule_id)).toEqual(["R-EST-02"]);
    expect(cited.get("310037")?.map((finding) => finding.rule_id)).toEqual(["R-EST-02"]);
    expect(cited.get("310131")?.map((finding) => finding.rule_id)).toEqual(["R-FLOW-03"]);
    expect(cited.get("310135")?.map((finding) => finding.rule_id)).toEqual(["R-EFF-01"]);
    expect(cited.has("310008")).toBe(false);
  });

  it("names fields and stages in words", () => {
    expect(fieldLabel("story_points")).toBe("Story points");
    expect(fieldLabel("original_estimate")).toBe("Original estimate");
    expect(fieldLabel("fix_version")).toBe("Fix version");
    expect(stageWords("In Progress", "development")).toBe("Development stage");
    expect(stageWords("Done", "done")).toBeNull();
    expect(stageWords("Parked", null)).toBe("Not mapped to a stage");
  });

  it("keeps the calendar's rhythm in the weekly worklog totals", () => {
    expect(weeklyTotals(DEMO_1.worklogs)).toEqual(DEMO_1.worklogs);
    expect(
      weeklyTotals([
        { week: "2026-10-26", hours: 4 },
        { week: "2026-10-12", hours: 12.5 },
      ]),
    ).toEqual([
      { week: "2026-10-12", hours: 12.5 },
      { week: "2026-10-19", hours: 0 },
      { week: "2026-10-26", hours: 4 },
    ]);
    const sparse = [
      { week: "2026-01-05", hours: 1 },
      { week: "2026-10-26", hours: 2 },
    ];
    expect(weeklyTotals(sparse)).toEqual(sparse);
    expect(weeklyTotals([])).toEqual([]);
  });
});
