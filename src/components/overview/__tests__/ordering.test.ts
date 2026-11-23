import { describe, expect, it } from "vitest";

import type { RuleSummary } from "@/lib/api/schemas";

import { rankRules } from "../rule-findings";
import { openSentence, orderStatuses, type StatusCount } from "../status-mix";
import { trendSummary } from "../trends";
import { overviewFixture } from "./fixture";

const options = "en-GB";

function rule(rule_id: string, open: number, measurable = true): RuleSummary {
  return {
    rule_id,
    title: rule_id,
    severity: "breach",
    kind: "rule",
    open,
    measurable,
    missing_evidence: measurable ? [] : ["code_review"],
  };
}

describe("rankRules", () => {
  it("puts the most open findings first, keeps catalogue order on ties, and the unmeasurable last", () => {
    const ranked = rankRules([rule("R-A-01", 3), rule("R-B-01", 0, false), rule("R-C-01", 9), rule("R-D-01", 3), rule("W-E-01", 0)]);
    expect(ranked.map((entry) => entry.rule_id)).toEqual(["R-C-01", "R-A-01", "R-D-01", "W-E-01", "R-B-01"]);
  });
});

describe("where work sits", () => {
  const status = (name: string, category: StatusCount["status_category"], stage: StatusCount["stage"], count: number): StatusCount => ({
    status: name,
    status_category: category,
    stage,
    count,
  });

  it("orders not started, in progress, done, then by James's stages, with an unmapped status last in its group", () => {
    const ordered = orderStatuses([
      status("Done", "done", "done", 10),
      status("Blocked", "indeterminate", null, 1),
      status("In Review", "indeterminate", "code_review", 2),
      status("In Progress", "indeterminate", "development", 3),
      status("To Do", "new", "backlog", 4),
    ]);
    expect(ordered.map((entry) => entry.status)).toEqual(["To Do", "In Progress", "In Review", "Blocked", "Done"]);
  });

  it("says how much is open and how it splits", () => {
    expect(openSentence(overviewFixture().status_mix, options)).toBe("68 of 1,136 issues are open: 39 not started, 29 in progress.");
    expect(openSentence([status("To Do", "new", "backlog", 1)], options)).toBe("1 of 1 issue is open: 1 not started.");
    expect(openSentence([status("Done", "done", "done", 1200)], options)).toBe("All 1,200 issues are done.");
  });
});

describe("trendSummary", () => {
  it("reads the latest week against the one before, the range, and the threshold", () => {
    const { median_effort_ratio: ratio } = overviewFixture().trend_cards;
    expect(trendSummary(ratio, options, 1.5)).toBe(
      "Median effort ratio was 1.27× in the week of 2 Nov 2026 to date, down from 1.38× the week before. " +
        "Over 12 weeks it ranged from 0.95× to 1.62×. The breach threshold is 1.50×; 1 week reached it.",
    );
  });

  it("says when the latest week has nothing finished yet, and when nothing was finished at all", () => {
    const { reopen_rate: reopen } = overviewFixture().trend_cards;
    const quiet = { ...reopen, current: null, points: reopen.points.map((point, index, all) => (index === all.length - 1 ? { ...point, value: null } : point)) };
    expect(trendSummary(quiet, options)).toMatch(/^Reopen rate: nothing was finished in the week of 2 Nov 2026 so far\./);
    const none = { ...reopen, current: null, previous: null, points: reopen.points.map((point) => ({ ...point, value: null })) };
    expect(trendSummary(none, options)).toBe("Reopen rate: nothing was finished in these 12 weeks.");
  });
});
