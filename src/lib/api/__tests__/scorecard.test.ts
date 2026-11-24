import { describe, expect, it } from "vitest";

import everyoneJson from "../../../../docs/sample-responses/people-scorecard.json";
import offJson from "../../../../docs/sample-responses/people-scorecard-off.json";
import personJson from "../../../../docs/sample-responses/people-scorecard-person.json";
import { normalizeScorecardQuery, parseScorecardQuery, scorecardSearchParams } from "../params";
import {
  API_ERROR_CODES,
  CODE_REVIEW_NOT_RECORDED,
  peopleScorecardSchema,
  recordsCodeReview,
  SCORECARD_MEASURES,
  SCORECARD_SENTENCES,
  scorecardCaveat,
  scorecardValueProblems,
  type PeopleScorecard,
} from "../schemas";

const everyone = everyoneJson as unknown as PeopleScorecard;
const clone = (): PeopleScorecard => structuredClone(everyone);
const issues = (body: unknown) => {
  const parsed = peopleScorecardSchema.safeParse(body);
  return parsed.success ? [] : parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
};

describe("the scorecard schema", () => {
  it("takes the documented bodies exactly as they are", () => {
    for (const body of [everyoneJson, personJson, offJson]) {
      expect(issues(body)).toEqual([]);
      expect(peopleScorecardSchema.parse(body)).toStrictEqual(body);
    }
  });

  it("names the eleven measures, keys, labels, kinds and directions exact, in the contract's order", () => {
    expect(SCORECARD_MEASURES.map((measure) => [measure.key, measure.label, measure.kind, measure.direction])).toEqual([
      ["open_tickets", "Open tickets", "count", "neutral"],
      ["in_progress", "In progress now", "count", "neutral"],
      ["done_in_period", "Done in the period", "count", "neutral"],
      ["estimated_before_start", "Estimated before work started", "rate", "higher_is_closer"],
      ["time_logged", "Time logged on done work", "rate", "higher_is_closer"],
      ["within_estimate", "Done within the effort limit", "rate", "higher_is_closer"],
      ["stuck_now", "Open tickets stuck in a status", "rate", "lower_is_closer"],
      ["reopened", "Reopened after Done", "rate", "lower_is_closer"],
      ["skipped_stage", "Skipped a stage", "rate", "lower_is_closer"],
      ["code_review", "Code review recorded", "rate", "higher_is_closer"],
      ["open_findings_per_10", "Open findings per 10 open tickets", "ratio", "lower_is_closer"],
    ]);
    const reordered = clone();
    reordered.measures.reverse();
    expect(issues(reordered)).toContain("measures: not the eleven measures in the contract's order");
    const short = clone();
    short.measures.pop();
    expect(issues(short).length).toBeGreaterThan(0);
    const flipped = clone();
    flipped.measures[3].direction = "lower_is_closer";
    expect(issues(flipped)).toContain("measures.3: kind or direction is not the contract's");
  });

  it("requires a value for every measure, and drops what the contract does not name", () => {
    const missing = clone() as unknown as { board: { values: Record<string, unknown> } };
    delete missing.board.values.reopened;
    expect(issues(missing).some((issue) => issue.startsWith("board.values.reopened"))).toBe(true);
    const extra = { ...clone(), secret: "x", people: clone().people.map((row) => ({ ...row, email: "someone@example.com" })) };
    const parsed = peopleScorecardSchema.parse(extra);
    expect(JSON.stringify(parsed)).not.toContain("example.com");
    expect("secret" in parsed).toBe(false);
  });

  it("holds each rate and ratio to its numerator and denominator, either rounding of a half", () => {
    const rate = { kind: "rate" as const, measurable: true };
    const ratio = { kind: "ratio" as const, measurable: true };
    const board = { value: 50, numerator: 50, denominator: 100, enough: true, vs_board: null };
    expect(scorecardValueProblems(rate, { value: 72, numerator: 18, denominator: 25, enough: true, vs_board: "closer" }, board)).toEqual([]);
    // 12.5%: half up (13) and half to even (12) are both the figure.
    expect(scorecardValueProblems(rate, { value: 13, numerator: 1, denominator: 8, enough: true, vs_board: "further" }, board)).toEqual([]);
    expect(scorecardValueProblems(rate, { value: 12, numerator: 1, denominator: 8, enough: true, vs_board: "further" }, board)).toEqual([]);
    expect(scorecardValueProblems(rate, { value: 15, numerator: 1, denominator: 8, enough: true, vs_board: "further" }, board)).toHaveLength(1);
    expect(scorecardValueProblems(rate, { value: 100, numerator: 9, denominator: 8, enough: true, vs_board: "closer" }, board)).toHaveLength(1);
    expect(scorecardValueProblems(ratio, { value: 135.5, numerator: 149, denominator: 11, enough: true, vs_board: "further" }, board)).toEqual([]);
    expect(scorecardValueProblems(ratio, { value: 135.7, numerator: 149, denominator: 11, enough: true, vs_board: "further" }, board)).toHaveLength(1);
  });

  it("never compares too few tickets, and always compares enough on both sides", () => {
    const rate = { kind: "rate" as const, measurable: true };
    const board = { value: 50, numerator: 50, denominator: 100, enough: true, vs_board: null };
    expect(scorecardValueProblems(rate, { value: 50, numerator: 2, denominator: 4, enough: false, vs_board: "level" }, board)).toEqual([
      "compared, with too few tickets on one side",
    ]);
    expect(scorecardValueProblems(rate, { value: 50, numerator: 2, denominator: 4, enough: false, vs_board: null }, board)).toEqual([]);
    expect(scorecardValueProblems(rate, { value: 60, numerator: 6, denominator: 10, enough: true, vs_board: null }, board)).toEqual([
      "not compared, with enough tickets on both sides",
    ]);
    // The board is compared with nothing.
    expect(scorecardValueProblems(rate, { ...board, vs_board: "level" }, null)).toEqual(["compared, with too few tickets on one side"]);
  });

  it("keeps a measure the board cannot show empty, never a zero, and a count on its own", () => {
    const off = { kind: "rate" as const, measurable: false };
    expect(scorecardValueProblems(off, { value: null, numerator: null, denominator: null, enough: false, vs_board: null }, null)).toEqual([]);
    expect(scorecardValueProblems(off, { value: 0, numerator: 0, denominator: 12, enough: true, vs_board: null }, null)).toEqual([
      "a measure the board cannot show holds a value",
    ]);
    const count = { kind: "count" as const, measurable: true };
    expect(scorecardValueProblems(count, { value: 11, numerator: null, denominator: null, enough: true, vs_board: null }, null)).toEqual([]);
    expect(scorecardValueProblems(count, { value: 11, numerator: 11, denominator: 12, enough: true, vs_board: "closer" }, null)).toHaveLength(2);
    const broken = clone();
    broken.people[0].values.code_review = { value: 0, numerator: 0, denominator: 3, enough: false, vs_board: null };
    expect(issues(broken)).toContain(`people.0.values.code_review: a measure the board cannot show holds a value`);
    const unexplained = clone();
    unexplained.measures[9].reason = null;
    expect(issues(unexplained)).toContain("measures.9.reason: a reason is given exactly when it is not measurable");
  });

  it("never names more than one person with comparison off, or anyone twice", () => {
    const off = clone();
    off.comparison = "off";
    expect(issues(off)).toContain("people: more than one person while comparison is off");
    const twice = clone();
    twice.people[1] = structuredClone(twice.people[0]);
    expect(issues(twice)).toContain("people.1.person: listed twice");
    const period = clone() as unknown as { period: { days: number } };
    period.period.days = 45;
    expect(issues(period).length).toBeGreaterThan(0);
  });

  it("carries the contract's sentences to the letter, and its error code", () => {
    expect(SCORECARD_SENTENCES).toEqual({
      comparisonOff: "Comparing people side by side is turned off. Ask about one person at a time instead.",
      decision: "The figures are above; the decision is yours.",
    });
    expect(scorecardCaveat(90, true)).toBe("Figures from Jira over the last 90 days, next to the whole board, by each ticket's current assignee.");
    expect(scorecardCaveat(180, false)).toBe(
      "Figures from Jira over the last 180 days, next to the whole board, by each ticket's current assignee. Code review isn't recorded on this board, so reviewers' work doesn't show.",
    );
    expect(API_ERROR_CODES).toContain("comparison_off");
  });

  it("says code review is not recorded only when that is why it cannot be shown, never for its rule turned off (JO-15)", () => {
    const codeReview = (measurable: boolean, reason: string | null) => [{ key: "code_review" as const, measurable, reason }];
    expect(CODE_REVIEW_NOT_RECORDED).toBe("This board doesn't record code review in Jira.");
    expect(recordsCodeReview(codeReview(true, null))).toBe(true);
    expect(recordsCodeReview(codeReview(false, "Its rule is off on this board."))).toBe(true);
    expect(recordsCodeReview(codeReview(false, CODE_REVIEW_NOT_RECORDED))).toBe(false);
    expect(recordsCodeReview([])).toBe(false);
  });
});

describe("the scorecard's parameters", () => {
  const ADA = "pbc7fe62842ca";
  const CARMEN = "p599114b761a6";

  it("default to 90 days and no one, and write the canonical form: the people in id order", () => {
    expect(normalizeScorecardQuery()).toEqual({ days: 90, person: [] });
    expect(scorecardSearchParams({ days: 90 }).toString()).toBe("");
    expect(scorecardSearchParams({ days: 30, person: [ADA, CARMEN] }).toString()).toBe(`days=30&person=${CARMEN}&person=${ADA}`);
  });

  it("take 30, 90 or 180 days and up to ten people by id, each once; anything else is refused, not guessed", () => {
    const parse = (query: string) => parseScorecardQuery(new URLSearchParams(query));
    expect(parse(`days=180&person=${ADA}`)).toEqual({ ok: true, value: { days: 180, person: [ADA] } });
    for (const query of ["days=45", "days=ninety", "days=90&days=30", `person=${ADA}&person=${ADA}`, "person=Ada", "colour=red", "level=people", "project=DEMO"]) {
      expect(parse(query).ok, query).toBe(false);
    }
    const ten = Array.from({ length: 10 }, (_, index) => `person=p${String(index).padStart(12, "0")}`).join("&");
    expect(parse(ten).ok).toBe(true);
    expect(parse(`${ten}&person=p00000000000a`).ok).toBe(false);
  });
});
