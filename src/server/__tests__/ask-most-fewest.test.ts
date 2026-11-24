// @vitest-environment node
import { describe, expect, it } from "vitest";

import { ASK_DECLINES, askResponseSchema, type AskResponse, type FactSet } from "@/lib/api/schemas";

import { askSample } from "../sample/ask";
import { orderIn } from "../sample/ask/match";
import { LAST_RESORT } from "../sample/ask/people";
import { compareOrder, effectiveOrder, orderFor, orderWords, overallOrder, type CompareOrder } from "../sample/ask/scorecard";
import { buildDataset } from "../sample/dataset";
import { scorecards } from "../sample/scorecard";
import { personIdFor } from "../sample/team";
import { verify } from "../sample/verify";

/** Ask honours "most" and "fewest" in people comparisons, in sample mode, as */

const dataset = buildDataset(Date.parse("2026-11-04T14:30:00Z"));
const ADA = personIdFor("acc-01");
const CARMEN = personIdFor("acc-03");
const WHOM: Record<"" | "one" | "two", string[]> = { "": [], one: [ADA], two: [ADA, CARMEN] };
const COMPARE = "oversight_people_compare";
const SCORECARD = "oversight_person_scorecard";
/** The people view's raw-count ranking, which the sample reads with a query, as the analyst would. */
const RANKING = "oversight_query";
const COUNTS = ["open_tickets", "in_progress", "done_in_period"];

const ask = (question: string, mentions: string[] = []): AskResponse => {
  const response = askSample(dataset, question, 0, { level: "people", mentions, comparison: "on" });
  expect(askResponseSchema.parse(response)).toEqual(response);
  return response;
};

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** The first sentence's opening: "{Label}, last {days} days, {order}: " (no period for a figure of now). */
const first = (label: string, said: string, days: number | null = 90) => new RegExp(`^${escaped(`${label}${days ? `, last ${days} days` : ""}, ${said}: `)}`);
const OVERALL_FIRST = (said: string) => new RegExp(`^${escaped(`Measures closer to the process than the board, last 90 days, ${said}: `)}`);

type Row = [question: string, who: keyof typeof WHOM, tool: string, measure: string | null, order: CompareOrder | null, days: number | null, n: number | null, opening: RegExp];

/** The service's QUESTIONS (tests/test_most_fewest.py), question for question. */
const QUESTIONS: Row[] = [
  // The check's two cases.
  ["Who has the most reopened tickets?", "", COMPARE, "reopened", "most", 90, null, first("Reopened after Done", "highest first")],
  ["Who has the fewest tickets stuck in a status?", "", COMPARE, "stuck_now", "fewest", 90, null, first("Open tickets stuck in a status", "lowest first", null)],
  // Rates, most first.
  ["Whose tickets are reopened the most?", "", COMPARE, "reopened", "most", 90, null, first("Reopened after Done", "highest first")],
  ["Who has the highest reopen rate this month?", "", COMPARE, "reopened", "most", 30, null, first("Reopened after Done", "highest first", 30)],
  ["Whose tickets get stuck the most?", "", COMPARE, "stuck_now", "most", 90, null, first("Open tickets stuck in a status", "highest first", null)],
  ["Who skips stages the most?", "", COMPARE, "skipped_stage", "most", 90, null, first("Skipped a stage", "highest first")],
  ["Top 3 people by tickets that skipped a stage", "", COMPARE, "skipped_stage", "most", 90, 3, first("Skipped a stage", "highest first")],
  ["Who estimates before starting the most?", "", COMPARE, "estimated_before_start", "most", 90, null, first("Estimated before work started", "highest first")],
  ["Who logged the most hours in the last 6 months?", "", COMPARE, "time_logged", "most", 180, null, first("Time logged on done work", "highest first", 180)],
  ["Who stays within the effort limit the most?", "", COMPARE, "within_estimate", "most", 90, null, first("Done within the effort limit", "highest first")],
  ["Who has the most code review recorded?", "", COMPARE, "code_review", "most", 90, null, /^Not measurable on this board: Code review recorded\./],
  // Rates, fewest first.
  ["Who has the lowest share of reopened work?", "", COMPARE, "reopened", "fewest", 90, null, first("Reopened after Done", "lowest first")],
  ["Who skips the fewest stages?", "", COMPARE, "skipped_stage", "fewest", 90, null, first("Skipped a stage", "lowest first")],
  ["Who has the lowest share of work estimated before it started?", "", COMPARE, "estimated_before_start", "fewest", 90, null, first("Estimated before work started", "lowest first")],
  ["Who logs the least time?", "", COMPARE, "time_logged", "fewest", 90, null, first("Time logged on done work", "lowest first")],
  ["Bottom 3 people by time logged", "", COMPARE, "time_logged", "fewest", 90, 3, first("Time logged on done work", "lowest first")],
  ["From lowest to highest, rank everyone by time logged", "", COMPARE, "time_logged", "fewest", 90, null, first("Time logged on done work", "lowest first")],
  // A rate named the other way round: the most overruns are the lowest share within the limit, and so on.
  ["Who overruns the most?", "", COMPARE, "within_estimate", "fewest", 90, null, first("Done within the effort limit", "lowest first")],
  ["Who goes over the effort limit the least?", "", COMPARE, "within_estimate", "most", 90, null, first("Done within the effort limit", "highest first")],
  ["Who has the most work without an estimate?", "", COMPARE, "estimated_before_start", "fewest", 90, null, first("Estimated before work started", "lowest first")],
  ["Who has the most unestimated work?", "", COMPARE, "estimated_before_start", "fewest", 90, null, first("Estimated before work started", "lowest first")],
  ["Who has the highest effort ratio?", "", COMPARE, "within_estimate", "fewest", 90, null, first("Done within the effort limit", "lowest first")],
  ["Who has the lowest effort ratio?", "", COMPARE, "within_estimate", "most", 90, null, first("Done within the effort limit", "highest first")],
  // Done, closed or in progress beside a rate name the tickets the rate is of: the rate is the figure (the review).
  ["Who has the most tickets reopened after Done?", "", COMPARE, "reopened", "most", 90, null, first("Reopened after Done", "highest first")],
  ["Who has the most time logged on done work?", "", COMPARE, "time_logged", "most", 90, null, first("Time logged on done work", "highest first")],
  ["Who completed the most tickets without logging time?", "", COMPARE, "time_logged", "fewest", 90, null, first("Time logged on done work", "lowest first")],
  ["Who has the most tickets closed without code review?", "", COMPARE, "code_review", "fewest", 90, null, /^Not measurable on this board: Code review recorded\./],
  ["Who has the most done tickets that skipped a stage?", "", COMPARE, "skipped_stage", "most", 90, null, first("Skipped a stage", "highest first")],
  ["Who has the most stuck tickets in progress?", "", COMPARE, "stuck_now", "most", 90, null, first("Open tickets stuck in a status", "highest first", null)],
  ["Top 3 people with the fewest reopened tickets", "", COMPARE, "reopened", "fewest", 90, 3, first("Reopened after Done", "lowest first")],
  ["Top 5 people who log the least time", "", COMPARE, "time_logged", "fewest", 90, 5, first("Time logged on done work", "lowest first")],
  ["Who has the most reopened tickets and the fewest stuck?", "", COMPARE, "stuck_now", "fewest", 90, null, first("Open tickets stuck in a status", "lowest first", null)],
  ["Who has the least reopened tickets but the most stuck?", "", COMPARE, "stuck_now", "most", 90, null, first("Open tickets stuck in a status", "highest first", null)],
  ["Which 3 people have the most stuck tickets?", "", COMPARE, "stuck_now", "most", 90, 3, first("Open tickets stuck in a status", "highest first", null)],
  ["Who is at the bottom for estimates?", "", COMPARE, "estimated_before_start", "fewest", 90, null, first("Estimated before work started", "lowest first")],
  ["Who is at the top for reopened tickets?", "", COMPARE, "reopened", "most", 90, null, first("Reopened after Done", "highest first")],
  ["Who reopens the least work?", "", COMPARE, "reopened", "fewest", 90, null, first("Reopened after Done", "lowest first")],
  ["Who has the least work in progress?", "", COMPARE, "in_progress", "fewest", null, null, first("In progress now", "fewest first", null)],
  ["Who finished the least work this month?", "", COMPARE, "done_in_period", "fewest", 30, null, first("Done in the period", "fewest first", 30)],
  ["Who works the least hours?", "", COMPARE, "time_logged", "fewest", 90, null, first("Time logged on done work", "lowest first")],
  ["Who has capacity to review code?", "", COMPARE, "open_tickets", "fewest", null, null, first("Open tickets", "fewest first", null)],
  // Rates, no direction word: closer to the process first, as before.
  ["Rank everyone by reopened tickets", "", COMPARE, "reopened", "closer", 90, null, first("Reopened after Done", "closest to the process first")],
  ["Who has tickets stuck?", "", COMPARE, "stuck_now", "closer", 90, null, first("Open tickets stuck in a status", "closest to the process first", null)],
  ["Who is best at estimating before they start?", "", COMPARE, "estimated_before_start", "closer", 90, null, first("Estimated before work started", "closest to the process first")],
  // The other side of the process (the review): further from it first, and the least of that closer first.
  ["Who is worst for reopened work?", "", COMPARE, "reopened", "most", 90, null, first("Reopened after Done", "highest first")],
  ["Who has the worst reopen rate?", "", COMPARE, "reopened", "most", 90, null, first("Reopened after Done", "highest first")],
  ["Who is worst at estimating?", "", COMPARE, "estimated_before_start", "fewest", 90, null, first("Estimated before work started", "lowest first")],
  ["Whose estimates are weakest?", "", COMPARE, "estimated_before_start", "fewest", 90, null, first("Estimated before work started", "lowest first")],
  ["Who has the least trouble with estimates?", "", COMPARE, "estimated_before_start", "closer", 90, null, first("Estimated before work started", "closest to the process first")],
  ["Who has the most trouble with estimates?", "", COMPARE, "estimated_before_start", "fewest", 90, null, first("Estimated before work started", "lowest first")],
  ["Who has the fewest problems logging time?", "", COMPARE, "time_logged", "closer", 90, null, first("Time logged on done work", "closest to the process first")],
  ["Who has the most problems logging time?", "", COMPARE, "time_logged", "fewest", 90, null, first("Time logged on done work", "lowest first")],
  ["Who has the worst effort ratio?", "", COMPARE, "within_estimate", "fewest", 90, null, first("Done within the effort limit", "lowest first")],
  // The ratio.
  ["Who has the lowest open findings per 10 open tickets?", "", COMPARE, "open_findings_per_10", "fewest", 90, null, first("Open findings per 10 open tickets", "lowest first", null)],
  ["Who has the most findings per 10 tickets?", "", COMPARE, "open_findings_per_10", "most", 90, null, first("Open findings per 10 open tickets", "highest first", null)],
  ["Top 3 people by findings per 10 tickets", "", COMPARE, "open_findings_per_10", "most", 90, 3, first("Open findings per 10 open tickets", "highest first", null)],
  ["Rank everyone by open findings per 10 open tickets", "", COMPARE, "open_findings_per_10", "closer", 90, null, first("Open findings per 10 open tickets", "closest to the process first", null)],
  ["Who has the worst open findings?", "", COMPARE, "open_findings_per_10", "most", 90, null, first("Open findings per 10 open tickets", "highest first", null)],
  // Counts: most first, or fewest first (a count has no closer side).
  ["Who has the biggest backlog?", "", COMPARE, "open_tickets", "most", null, null, first("Open tickets", "most first", null)],
  ["Who has the smallest backlog?", "", COMPARE, "open_tickets", "fewest", null, null, first("Open tickets", "fewest first", null)],
  ["Who is the busiest?", "", COMPARE, "open_tickets", "most", null, null, first("Open tickets", "most first", null)],
  ["Who could take more work?", "", COMPARE, "open_tickets", "fewest", null, null, first("Open tickets", "fewest first", null)],
  ["Who has the most tickets in progress?", "", COMPARE, "in_progress", "most", null, null, first("In progress now", "most first", null)],
  ["Who has the fewest tickets in progress?", "", COMPARE, "in_progress", "fewest", null, null, first("In progress now", "fewest first", null)],
  ["Who finished the most work this month?", "", COMPARE, "done_in_period", "most", 30, null, first("Done in the period", "most first", 30)],
  ["Who closed the fewest tickets this quarter?", "", COMPARE, "done_in_period", "fewest", 90, null, first("Done in the period", "fewest first")],
  ["Bottom 3 people by open tickets", "", RANKING, null, "fewest", null, 3, /^.+ (?:has|have) the fewest open tickets/],
  ["Top 3 people with the fewest open breaches", "", RANKING, null, "fewest", null, 3, /^.+ (?:has|have) the fewest open breaches/],
  ["Top 3 busiest people", "", COMPARE, "open_tickets", "most", null, 3, first("Open tickets", "most first", null)],
  // The overall order: the most measures closer is closer first; the fewest, the exact reverse.
  ["Who follows the process most closely?", "", COMPARE, "overall", "closer", 90, null, OVERALL_FIRST("most first")],
  ["Who is best on the board?", "", COMPARE, "overall", "closer", 90, null, OVERALL_FIRST("most first")],
  ["Rank everyone", "", COMPARE, "overall", "closer", 90, null, OVERALL_FIRST("most first")],
  ["Who follows the process least?", "", COMPARE, "overall", "fewest", 90, null, OVERALL_FIRST("fewest first")],
  ["Which developer is least compliant?", "", COMPARE, "overall", "fewest", 90, null, OVERALL_FIRST("fewest first")],
  ["Who is the most compliant?", "", COMPARE, "overall", "closer", 90, null, OVERALL_FIRST("most first")],
  ["Who is struggling the least?", "", COMPARE, "overall", "closer", 90, null, OVERALL_FIRST("most first")],
  ["Who needs the least help?", "", COMPARE, "overall", "closer", 90, null, OVERALL_FIRST("most first")],
  ["Who needs less help?", "", COMPARE, "overall", "closer", 90, null, OVERALL_FIRST("most first")],
  ["Who is falling behind the least?", "", COMPARE, "overall", "closer", 90, null, OVERALL_FIRST("most first")],
  ["Who doesn't struggle?", "", COMPARE, "overall", "closer", 90, null, OVERALL_FIRST("most first")],
  ["Who is struggling the most?", "", COMPARE, "overall", "fewest", 90, null, OVERALL_FIRST("fewest first")],
  ["Who needs the most help?", "", COMPARE, "overall", "fewest", 90, null, OVERALL_FIRST("fewest first")],
  ["Who is falling behind the most?", "", COMPARE, "overall", "fewest", 90, null, OVERALL_FIRST("fewest first")],
  ["Who is the worst performer?", "", COMPARE, "overall", "fewest", 90, null, OVERALL_FIRST("fewest first")],
  ["Who is the slowest?", "", COMPARE, "overall", "fewest", 90, null, OVERALL_FIRST("fewest first")],
  ["Who are the top 3 slowest?", "", COMPARE, "overall", "fewest", 90, 3, OVERALL_FIRST("fewest first")],
  ["Who is furthest from the process?", "", COMPARE, "overall", "fewest", 90, null, OVERALL_FIRST("fewest first")],
  ["Who deviates most from the process?", "", COMPARE, "overall", "fewest", 90, null, OVERALL_FIRST("fewest first")],
  ["Who is not pulling their weight?", "", COMPARE, "overall", "fewest", 90, null, OVERALL_FIRST("fewest first")],
  ["Who is careless with estimates?", "", COMPARE, "estimated_before_start", "fewest", 90, null, first("Estimated before work started", "lowest first")],
  // Two people side by side.
  ["Who has more reopened tickets, @Ada Brooks or @Carmen Ruiz?", "two", COMPARE, "reopened", "most", 90, null, first("Reopened after Done", "highest first")],
  ["Which of @Ada Brooks and @Carmen Ruiz has fewer stuck tickets?", "two", COMPARE, "stuck_now", "fewest", 90, null, first("Open tickets stuck in a status", "lowest first", null)],
  ["Who logs less time, @Ada Brooks or @Carmen Ruiz?", "two", COMPARE, "time_logged", "fewest", 90, null, first("Time logged on done work", "lowest first")],
  ["Time logged by @Ada Brooks and @Carmen Ruiz", "two", COMPARE, "time_logged", "closer", 90, null, first("Time logged on done work", "closest to the process first")],
  ["Who closed more tickets this month, @Ada Brooks or @Carmen Ruiz?", "two", COMPARE, "done_in_period", "most", 30, null, first("Done in the period", "most first", 30)],
  // A measure named with a word that ranks, compares or evaluates: that measure, in the order asked (the review).
  ["Rank @Ada Brooks and @Carmen Ruiz by reopened tickets, highest first", "two", COMPARE, "reopened", "most", 90, null, first("Reopened after Done", "highest first")],
  ["Who is worse on reopened tickets, @Ada Brooks or @Carmen Ruiz?", "two", COMPARE, "reopened", "most", 90, null, first("Reopened after Done", "highest first")],
  // One person: their scorecard, each measure next to the board (one person is in no order).
  ["Does @Ada Brooks have the most reopened tickets?", "one", SCORECARD, null, null, 90, null, /^Ada Brooks, last 90 days, next to the board/],
  ["Is @Ada Brooks the lowest on time logged?", "one", SCORECARD, null, null, 90, null, /^Ada Brooks, last 90 days, next to the board/],
];

/** The people in a comparison's facts in the order asked: those compared by their figure, those on too few tickets after them. */
function expectInTheOrderAsked(fact: FactSet, order: CompareOrder) {
  const people = fact.rows.filter((row) => row.person_id !== null);
  const measure = String(fact.params.measure);
  if (measure === "overall") {
    const compared = people.filter((row) => Number(row.compared) > 0).map((row) => Number(row.closer));
    expect(compared).toEqual([...compared].sort((a, b) => (order === "fewest" ? a - b : b - a)));
    expect(people.slice(0, compared.length).every((row) => Number(row.compared) > 0)).toBe(true);
    return;
  }
  const counted = COUNTS.includes(measure);
  const enough = people.filter((row) => counted || (row.enough === true && row.value !== null));
  expect(people.slice(0, enough.length)).toEqual(enough); // too few tickets: last, whatever the order
  const values = enough.map((row) => Number(row.value));
  const direction = scorecards(dataset, 90).measures.find((candidate) => candidate.key === measure)!.direction;
  const highest = order === "closer" ? direction === "higher_is_closer" : order === "most";
  expect(values, `${measure} ${order}`).toEqual([...values].sort((a, b) => (highest ? b - a : a - b)));
}

describe("most and fewest in people comparisons (JO-14)", () => {
  it("has at least forty questions, each once, of every kind", () => {
    expect(QUESTIONS.length).toBeGreaterThanOrEqual(90); // 54 at and the review's questions since
    expect(new Set(QUESTIONS.map(([question]) => question)).size).toBe(QUESTIONS.length);
    expect(new Set(QUESTIONS.map((row) => row[4]))).toEqual(new Set(["most", "fewest", "closer", null]));
    expect(new Set(QUESTIONS.map((row) => row[1]))).toEqual(new Set(["", "one", "two"]));
    const kinds = new Set(QUESTIONS.flatMap(([, , , measure]) => scorecards(dataset, 90).measures.filter((candidate) => candidate.key === measure).map((candidate) => candidate.kind)));
    expect(kinds).toEqual(new Set(["rate", "ratio", "count"]));
  });

  it.each(QUESTIONS)("%s: the measure, the order asked and a first sentence that says it", (question, who, tool, measure, order, days, n, opening) => {
    const response = ask(question, WHOM[who]);
    expect([response.outcome, response.message], question).toEqual(["answered", null]);
    expect(verify(response.answer!, response.facts, response.plan).problems).toEqual([]);
    expect(response.answer, question).toMatch(opening);
    // It reports the order: it never calls anyone the best or the worst.
    expect(response.answer).not.toMatch(/\b(?:best|worst)\b/i);
    const [step] = response.plan;
    expect(step.tool, question).toBe(tool);
    if (tool === RANKING) {
      expect(String(step.params.sql)).toMatch(/ORDER BY open_\w+ ASC/);
      return;
    }
    if (tool === SCORECARD) {
      expect(step.params).toEqual({ project: "DEMO", person_ids: [ADA], days });
      return;
    }
    // The plan and the facts carry the order used, as the service records it.
    expect([step.params.measure, step.params.order, step.params.days ?? null, step.params.n ?? null], question).toEqual([measure, order, days, n]);
    if (who === "two") expect(step.params.person_ids).toEqual([ADA, CARMEN]);
    const [fact] = response.facts;
    if (!fact.rows.some((row) => row.person_id !== null)) return; // not measurable on this board: no one to order
    expectInTheOrderAsked(fact, order!);
    // The answer names the people compared in the facts' order.
    const sentence = response.answer!.split("\n\n")[0];
    const named = fact.rows
      .filter((row) => row.person_id !== null && (measure === "overall" ? Number(row.compared) > 0 : COUNTS.includes(measure!) || (row.enough === true && row.value !== null)))
      .map((row) => String(row.name));
    const places = named.map((name) => sentence.indexOf(name));
    expect(named.length).toBeGreaterThan(0);
    expect(places.every((place) => place >= 0) && places.every((place, index) => index === 0 || place > places[index - 1]), sentence).toBe(true);
  });

  it("answers the JO-12 check's two cases: the most reopened highest first, the fewest stuck lowest first", () => {
    const most = ask("Who has the most reopened tickets?");
    const reopened = most.facts[0].rows.filter((row) => row.person_id !== null && row.enough === true);
    expect(Number(reopened[0].value)).toBe(Math.max(...reopened.map((row) => Number(row.value))));
    expect(most.answer).toMatch(new RegExp(`^Reopened after Done, last 90 days, highest first: ${escaped(String(reopened[0].name))} ${reopened[0].value}%`));
    const fewest = ask("Who has the fewest tickets stuck in a status?");
    const stuck = fewest.facts[0].rows.filter((row) => row.person_id !== null && row.enough === true);
    expect(Number(stuck[0].value)).toBe(Math.min(...stuck.map((row) => Number(row.value))));
    expect(fewest.answer).toMatch(new RegExp(`^Open tickets stuck in a status, lowest first: ${escaped(String(stuck[0].name))} ${stuck[0].value}%`));
  });

  it.each([
    ["Who has the most reopened tickets?", "Rank everyone by reopened tickets"],
    ["Who has the lowest open findings per 10 open tickets?", "Rank everyone by open findings per 10 open tickets"],
    ["Who follows the process least?", "Who follows the process most closely?"],
  ])("changes only the order for %s: the figures, the marks, the board and the caveat are as before", (asked, closer) => {
    const [one, other] = [ask(asked), ask(closer)];
    const key = (row: FactSet["rows"][number]) => String(row.person_id ?? row.name);
    const sorted = (rows: FactSet["rows"]) => [...rows].sort((a, b) => key(a).localeCompare(key(b)));
    expect(sorted(one.facts[0].rows)).toEqual(sorted(other.facts[0].rows));
    expect(one.answer!.split("\n\n").at(-1)).toBe(other.answer!.split("\n\n").at(-1));
    expect(one.answer!.split("\n\n").at(-1)).toMatch(/^Figures from Jira over the last 90 days/);
  });

  it("reads the direction words as the service does", () => {
    const cases: [string, ReturnType<typeof orderIn>][] = [
      ["Who has the most reopened tickets?", "most"],
      ["Who has the highest skip rate?", "most"],
      ["Top 5 by time logged", "most"],
      ["Top 3 people with the fewest reopened tickets", "fewest"],
      ["Bottom 3 people with the most stuck tickets", "most"],
      ["Who is at the top for reopened tickets?", "most"],
      ["Who is at the bottom for estimates?", "fewest"],
      ["Who has more stuck tickets?", "most"],
      ["Who has the fewest stuck tickets?", "fewest"],
      ["Who logs the least time?", "fewest"],
      ["Bottom 3 by estimates", "fewest"],
      ["Who has lower findings per 10?", "fewest"],
      ["From most to least, rank by reopened", "most"],
      ["From least to most, rank by reopened", "fewest"],
      ["Who follows the process most closely?", null],
      ["Who has at least one reopened ticket?", null],
      ["Who has at most two stuck tickets?", null],
      ["Rank everyone by reopened", null],
      ["Who is best?", null],
    ];
    for (const [question, order] of cases) expect(orderIn(question), question).toBe(order);
    expect(orderFor("Who overruns the most?", "within_estimate")).toBe("fewest");
    expect(orderFor("Who doesn't go over the estimate the most?", "within_estimate")).toBe("most");
    expect(orderFor("Who has the most tickets without time logged?", "time_logged")).toBe("fewest");
    expect(orderFor("Who has the most reopened tickets?", "reopened")).toBe("most");
    // Asked both ways: the word nearest the measure; a range: its first word.
    expect(orderFor("Who has the most reopened tickets and the fewest stuck?", "stuck_now")).toBe("fewest");
    expect(orderFor("Who has the most reopened tickets and the fewest stuck?", "reopened")).toBe("most");
    expect(orderFor("From most to least, rank by reopened", "reopened")).toBe("most");
    // The other side of the process: further from it first, the least of it closer first, a negation not further.
    expect(orderFor("Who struggles the most?", "overall")).toBe("fewest");
    expect(orderFor("Who struggles the least?", "overall")).toBe("closer");
    expect(orderFor("Who never needs help?", "overall")).toBeNull();
    expect(orderFor("Who is worst at logging time?", "time_logged")).toBe("fewest");
    expect(orderFor("Who has the worst stuck rate?", "stuck_now")).toBe("most");
    expect(orderFor("Who has the most unestimated work?", "estimated_before_start")).toBe("fewest");
    expect(orderFor("Who has the highest effort ratio?", "within_estimate")).toBe("fewest");
  });

  it("records the order used, and words it in plain words", () => {
    expect(effectiveOrder("open_tickets", "closer")).toBe("most");
    expect(effectiveOrder("overall", "most")).toBe("closer");
    expect(effectiveOrder("overall", "fewest")).toBe("fewest");
    expect(effectiveOrder("reopened", "most")).toBe("most");
    expect((["closer", "most", "fewest"] as const).map((order) => orderWords("reopened", order))).toEqual(["closest to the process first", "highest first", "lowest first"]);
    expect((["closer", "most", "fewest"] as const).map((order) => orderWords("open_tickets", order))).toEqual(["most first", "most first", "fewest first"]);
    expect((["closer", "most", "fewest"] as const).map((order) => orderWords("overall", order))).toEqual(["most first", "most first", "fewest first"]);
  });

  it("puts everyone in each order, too few tickets last whichever way", () => {
    const set = scorecards(dataset, 90);
    for (const key of ["reopened", "estimated_before_start", "open_findings_per_10", "open_tickets"] as const) {
      const measure = set.measures.find((candidate) => candidate.key === key)!;
      for (const order of ["closer", "most", "fewest"] as const) {
        const ordered = compareOrder(measure, set.holders, order);
        const counted = measure.kind === "count";
        const enough = ordered.filter((row) => counted || (row.values[key].enough && row.values[key].value !== null));
        expect(ordered.slice(0, enough.length)).toEqual(enough);
        const values = enough.map((row) => Number(row.values[key].value));
        const used = counted && order === "closer" ? "most" : order;
        const highest = used === "closer" ? measure.direction === "higher_is_closer" : used === "most";
        expect(values, `${key} ${order}`).toEqual([...values].sort((a, b) => (highest ? b - a : a - b)));
      }
    }
    // Overall, fewest is the exact reverse of the closer order for those compared; those compared on none stay last.
    const closer = overallOrder(set.measures, set.holders).filter((entry) => entry.compared > 0).map((entry) => entry.row.person.id);
    const fewest = overallOrder(set.measures, set.holders, "fewest");
    const reversed = fewest.filter((entry) => entry.compared > 0).map((entry) => entry.row.person.id);
    const none = fewest.findIndex((entry) => entry.compared === 0);
    expect(none === -1 || fewest.slice(none).every((entry) => entry.compared === 0)).toBe(true);
    const closerCounts = overallOrder(set.measures, set.holders).filter((entry) => entry.compared > 0).map((entry) => entry.closer);
    expect(fewest.filter((entry) => entry.compared > 0).map((entry) => entry.closer)).toEqual([...closerCounts].reverse());
    expect(new Set(reversed)).toEqual(new Set(closer));
  });

  it.each([
    ["Who makes the most mistakes?", "fewest"],
    ["Who has the most trouble?", "fewest"],
    ["Who makes the fewest mistakes?", "closer"],
    ["Who writes the most comments?", "closer"],
  ] as const)("keeps the side of the process asked about in the last resort: %s is %s", (question, order) => {
    const response = ask(question);
    expect(response.outcome).toBe("answered");
    expect(response.answer!.startsWith(LAST_RESORT.overall), response.answer!).toBe(true);
    expect(response.plan[0].params.order).toBe(order);
    expectInTheOrderAsked(response.facts[0], order);
    expect(response.answer).not.toMatch(/(?:best|worst)/i);
  });

  it.each(["Who has lower findings per 10?", "Who has higher findings per 10?", "Who has lower findings rate?", "Who has the highest findings per 10?", "Who has fewer findings per 10 tickets?"])(
    "with comparison off never takes a direction word for a name: %s",
    (question) => {
      // Regression (the review): "No one called Lower is on this board.", an untrue turn-away.
      const response = askSample(dataset, question, 0, { level: "people", mentions: [], comparison: "off" });
      expect([response.outcome, response.message]).toEqual(["not_understood", ASK_DECLINES.comparisonOff]);
    },
  );
});
