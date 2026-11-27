// @vitest-environment node
import { describe, expect, it } from "vitest";

import { peopleScorecardSchema, recordsCodeReview, SCORECARD_DAYS, SCORECARD_MEASURES, type ScorecardValue } from "@/lib/api/schemas";

import { EFFORT_THRESHOLD, ESTIMATE_GRACE_HOURS, STATUS } from "../sample/catalogue";
import { buildDataset } from "../sample/dataset";
import { MIN_TICKETS, NOT_MEASURABLE_REASONS, scorecards, scorecardView, vsBoard } from "../sample/scorecard";
import { MEMBERS, personIdFor, personOf } from "../sample/team";
import { DAY, HOUR } from "../sample/time";
import type { Issue } from "../sample/world";

const dataset = buildDataset(Date.parse("2026-11-04T14:30:00Z"));
const CARMEN = personIdFor("acc-03");
const NOOR = personIdFor(MEMBERS[0].accountId);

function body(days: 30 | 90 | 180 = 90, person: string[] = [], comparison: "on" | "off" = "on") {
  const answer = scorecardView(dataset, { days, person }, comparison);
  if (!answer.found) throw new Error(answer.message);
  return peopleScorecardSchema.parse(answer.body);
}

/** A rate as the brief defines it: the whole percentage of a denominator, and the counts. */
const rate = (numerator: number, denominator: number) => ({
  value: denominator === 0 ? null : Math.round((100 * numerator) / denominator),
  numerator,
  denominator,
  enough: denominator >= 5,
});

describe("each measure, worked out again from the sample's tickets", () => {
  const to = dataset.world.syncAt;
  for (const days of SCORECARD_DAYS) {
    const from = to - days * DAY;
    const within = (at: number | null) => at !== null && at >= from && at <= to;
    const openFinding = (issue: Issue, rule: string) => (dataset.engine.byIssue.get(issue.key) ?? []).some((finding) => finding.resolvedAt === null && finding.rule.id === rule);

    for (const [who, tickets] of [
      ["Carmen Ruiz", dataset.world.issues.filter((issue) => personOf(issue)?.id === CARMEN)],
      ["the whole board", dataset.world.issues],
    ] as [string, Issue[]][]) {
      it(`${who}, last ${days} days`, () => {
        const card = body(days, [CARMEN]);
        const values = who === "the whole board" ? card.board.values : card.people[0].values;
        const issues = tickets.filter((issue) => issue.type !== "Epic");
        expect(who === "the whole board" ? card.board.tickets : card.people[0].tickets).toBe(issues.length);
        const open = issues.filter((issue) => STATUS[issue.status].category !== "done");
        const done = issues.filter((issue) => within(issue.doneAt));
        const started = issues.filter((issue) => within(issue.startedAt));
        const effort = done.filter((issue) => issue.effortRatio !== null && issue.timeSpentS > 0);
        const strip = ({ value, numerator, denominator, enough }: ScorecardValue) => ({ value, numerator, denominator, enough });

        expect(values.open_tickets.value).toBe(open.length);
        expect(values.in_progress.value).toBe(issues.filter((issue) => issue.status === "In Progress").length);
        expect(values.done_in_period.value).toBe(done.length);
        expect(strip(values.estimated_before_start)).toEqual(
          // Set no later than work started, within R-EST-02's grace, so the figure and its findings agree.
          rate(started.filter((issue) => issue.estimateSetAt !== null && issue.estimateSetAt <= issue.startedAt! + ESTIMATE_GRACE_HOURS * HOUR).length, started.length),
        );
        expect(strip(values.time_logged)).toEqual(rate(done.filter((issue) => issue.timeSpentS > 0 || issue.aggregateTimeSpentS > 0).length, done.length));
        // The effort limit is R-EFF-01's threshold as the rules hold it; R-EFF-01 breaches at it or over, so within is under it.
        expect(EFFORT_THRESHOLD).toBe(1.5);
        expect(strip(values.within_estimate)).toEqual(rate(effort.filter((issue) => issue.effortRatio! < EFFORT_THRESHOLD).length, effort.length));
        expect(strip(values.stuck_now)).toEqual(rate(open.filter((issue) => openFinding(issue, "W-AGE-01")).length, open.length));
        expect(strip(values.reopened)).toEqual(rate(done.filter((issue) => issue.reopenCount > 0).length, done.length));
        expect(strip(values.skipped_stage)).toEqual(rate(done.filter((issue) => issue.skips.length > 0).length, done.length));
        // The open findings on the open work, beside the open work: both sides count the same tickets.
        const findings = open.reduce((sum, issue) => sum + (dataset.engine.byIssue.get(issue.key) ?? []).filter((finding) => finding.resolvedAt === null).length, 0);
        expect(strip(values.open_findings_per_10)).toEqual({
          value: Math.round((100 * findings) / open.length) / 10,
          numerator: findings,
          denominator: open.length,
          enough: open.length >= 5,
        });
        // DEMO records no code review, so that measure holds nothing at all, never a zero.
        expect(values.code_review).toEqual({ value: null, numerator: null, denominator: null, enough: false, vs_board: null });
      });
    }
  }

  it("takes both edges of the period in, and nothing outside them", () => {
    const set = scorecards(dataset, 30);
    expect(set.period.to - set.period.from).toBe(30 * DAY);
    expect(set.period.to).toBe(dataset.world.syncAt);
  });
});

describe("enough, and where a figure stands next to the board", () => {
  const value = (amount: number | null, denominator: number): ScorecardValue => ({
    value: amount,
    numerator: amount === null ? null : Math.min(denominator, 1),
    denominator,
    enough: denominator >= MIN_TICKETS,
    vs_board: null,
  });
  const higher = SCORECARD_MEASURES.find((measure) => measure.key === "estimated_before_start")!;
  const lower = SCORECARD_MEASURES.find((measure) => measure.key === "reopened")!;
  const ratio = SCORECARD_MEASURES.find((measure) => measure.key === "open_findings_per_10")!;
  const count = SCORECARD_MEASURES.find((measure) => measure.key === "open_tickets")!;

  it("is five tickets, in one place", () => {
    expect(MIN_TICKETS).toBe(5);
    const all = SCORECARD_DAYS.flatMap((days) => {
      const set = scorecards(dataset, days);
      return [set.board.values, ...[...set.byId.values()].map((row) => row.values)].flatMap((values) =>
        SCORECARD_MEASURES.filter((measure) => measure.kind !== "count").map((measure) => values[measure.key]),
      );
    });
    for (const figure of all) {
      if (figure.denominator !== null) expect(figure.enough).toBe(figure.denominator >= 5);
      if (!figure.enough) expect(figure.vs_board).toBeNull();
    }
  });

  it("is level within 5 points of a rate (0.5 of the ratio), else closer or further by the measure's direction", () => {
    expect(vsBoard(higher, value(52, 20), value(47, 300))).toBe("level");
    expect(vsBoard(higher, value(53, 20), value(47, 300))).toBe("closer");
    expect(vsBoard(higher, value(41, 20), value(47, 300))).toBe("further");
    expect(vsBoard(lower, value(53, 20), value(47, 300))).toBe("further");
    expect(vsBoard(lower, value(41, 20), value(47, 300))).toBe("closer");
    expect(vsBoard(ratio, value(10.5, 20), value(10, 300))).toBe("level");
    expect(vsBoard(ratio, value(10.6, 20), value(10, 300))).toBe("further");
    expect(vsBoard(ratio, value(9.4, 20), value(10, 300))).toBe("closer");
  });

  it("never compares too few tickets on either side, or a count", () => {
    expect(vsBoard(higher, value(90, 4), value(47, 300))).toBeNull();
    expect(vsBoard(higher, value(90, 5), value(47, 300))).toBe("closer");
    expect(vsBoard(higher, value(90, 20), value(47, 4))).toBeNull();
    expect(vsBoard(higher, value(null, 0), value(47, 300))).toBeNull();
    expect(vsBoard(count, { ...value(12, 12), numerator: null, denominator: null, enough: true }, { ...value(76, 76), enough: true })).toBeNull();
  });
});

describe("the sample holds every state a page must draw", () => {
  const marks = new Set<string>();
  let tooFew = 0;
  for (const days of SCORECARD_DAYS) {
    for (const row of scorecards(dataset, days).withTickets) {
      for (const figure of Object.values(row.values)) {
        if (figure.vs_board) marks.add(figure.vs_board);
        if (figure.value !== null && !figure.enough && figure.denominator !== null) tooFew += 1;
      }
    }
  }

  it("closer, further, level, and too few tickets to compare", () => {
    expect([...marks].sort()).toEqual(["closer", "further", "level"]);
    expect(tooFew).toBeGreaterThan(0);
  });

  it("a measure the board cannot show, with its reason, and a member with no tickets", () => {
    const card = body(90, [NOOR]);
    // Skipped stages are measured where the rules engine measures R-FLOW-02, as on DEMO; code review is not.
    expect(card.measures.filter((measure) => !measure.measurable).map((measure) => [measure.key, measure.reason])).toEqual([
      ["code_review", NOT_MEASURABLE_REASONS.code_review],
    ]);
    expect(card.people[0]).toMatchObject({ tickets: 0 });
    expect(NOT_MEASURABLE_REASONS).toEqual({
      skipped_stage: "This board has no stages to skip.",
      code_review: "This board doesn't record code review in Jira.",
      time_logged: "No one logged time on this board in the period.",
      estimates: "This board has no estimates.",
      ruleOff: "Its rule is off on this board.",
      rulesOff: "Its rules are off on this board.",
    });
    // The caveat names code review as not recorded here (DEMO has no code-review evidence).
    expect(recordsCodeReview(card.measures)).toBe(false);
  });

  it("everyone with comparison on, the board's figures alone with it off", () => {
    expect(body().people.map((row) => row.person.id)).toEqual(scorecards(dataset, 90).withTickets.map((row) => row.person.id));
    expect(body(90, [], "off").people).toEqual([]);
    expect(scorecardView(dataset, { days: 90, person: [CARMEN, NOOR] }, "off")).toMatchObject({ found: false, status: 403, error: "comparison_off" });
  });
});
