import { describe, expect, it } from "vitest";

import { SCORECARD_SENTENCES, scorecardCaveat, type AskResponse } from "@/lib/api/schemas";

import { askSample, PEOPLE_HELP_MESSAGE, PEOPLE_SUGGESTIONS } from "../sample/ask";
import { asksPersonnel, asksToEvaluate } from "../sample/ask/match";
import { ambiguousFirstNameMessage, typedPeople } from "../sample/ask/people";
import { daysIn } from "../sample/ask/scorecard";
import { buildDataset } from "../sample/dataset";
import { directoryPeople } from "../sample/people";
import { scorecards } from "../sample/scorecard";
import { personIdFor } from "../sample/team";
import { verify } from "../sample/verify";

const dataset = buildDataset(Date.parse("2026-11-04T14:30:00Z"));
const ADA = personIdFor("acc-01");
const CARMEN = personIdFor("acc-03");
const at = (question: string, mentions: string[] = [], comparison: "on" | "off" = "on"): AskResponse =>
  askSample(dataset, question, 0, { level: "people", mentions, comparison });
const compare = (measure: string, days = 90) => ({ tool: "oversight_people_compare", measure, days });
const planOf = (response: AskResponse) => response.plan.map((step) => ({ tool: step.tool, measure: step.params.measure, days: step.params.days }));

describe("Ask in sample mode answers every question about people from the figures (the JO-11 review)", () => {
  it.each([
    ["Who closed the most tickets this month?", compare("done_in_period", 30)],
    ["Who finished the most work last quarter?", compare("done_in_period")],
    // A count of now has no period (the check: "by In progress now now", "last 90 days").
    ["Who has the most tickets in progress?", { tool: "oversight_people_compare", measure: "in_progress", days: undefined }],
    ["Whose tickets get stuck the most?", compare("stuck_now")],
    ["Who has the most reopened tickets?", compare("reopened")],
    ["Who reopens the most work?", compare("reopened")],
    ["Who estimates before starting work?", compare("estimated_before_start")],
    ["Who logs the least time?", compare("time_logged")],
    ["Who logs their time?", compare("time_logged")],
    ["Who skips stages the most?", compare("skipped_stage")],
    ["Who is the most diligent person here?", compare("overall")],
    ["Who is the most careful with estimates?", compare("estimated_before_start")],
    ["Who is not pulling their weight?", compare("overall")],
    ["Who is the most efficient developer?", compare("overall")],
    ["Is anyone lazy?", compare("overall")],
    ["Should anybody be fired?", compare("overall")],
    ["Which dev is the best?", compare("overall")],
    ["Rank the team", compare("overall")],
    ["Is somebody underperforming?", compare("overall")],
    ["Best performer this sprint?", compare("overall", 30)],
    ["Which tester is worst?", compare("overall")],
    ["Who should we let go?", compare("overall")],
    ["Who should be demoted?", compare("overall")],
    ["Who should we dismiss?", compare("overall")],
    ["Which developer should we replace?", compare("overall")],
    ["Who should get a bonus?", compare("overall")],
    ["Who is useless?", compare("overall")],
    ["Who is careless with estimates?", compare("estimated_before_start")],
    ["Who is the most dishonest about logging time?", compare("time_logged")],
    ["Who reviews code best?", compare("code_review")],
    ["Rank people by code review and estimates", compare("estimated_before_start")],
  ])("%s", (question, expected) => {
    const response = at(question);
    expect(response.outcome, question).toBe("answered");
    expect(planOf(response)).toEqual([expected]);
    // Where comparing people is turned off, the organisation's refusal: never the help.
    expect(at(question, [], "off").message).toBe(SCORECARD_SENTENCES.comparisonOff);
  });

  it("answers one ticket's assignee, the biggest backlog and who is on the board", () => {
    const holder = at("Who is assigned DEMO-12?");
    expect(holder.plan.map((step) => step.tool)).toEqual(["oversight_ticket_assignee"]);
    const row = holder.facts[0].rows[0];
    expect(holder.answer).toBe(row.assignee_id ? `DEMO-12 (${String(row.status)}) is assigned to ${String(row.assignee)} now.` : `Nobody is assigned DEMO-12 (${String(row.status)}) now.`);
    const backlog = at("Who has the biggest backlog?");
    expect([backlog.outcome, backlog.plan[0].tool, backlog.plan[0].params.measure]).toEqual(["answered", "oversight_people_compare", "open_tickets"]);
    // The work nobody holds after the ranking, never in it.
    expect(backlog.answer).toMatch(/^Open tickets, most first: .+ \d+\. Unassigned: \d+ open tickets?\. The whole board: \d+\.$/);
    const board = at("Who is on this board?");
    expect([board.outcome, board.plan[0].tool]).toEqual(["answered", "oversight_board_people"]);
    // Each name once.
    expect(board.answer).toMatch(/^\d+ people are on this board: .+?(, and \d+ members? who holds? none of its tickets: .+)?\.$/);
  });

  it("keeps the help for what no figure answers per person where comparing people is off, in words that never blame the data", () => {
    // With comparing on, the overall comparison answers them, said so first.
    for (const question of ["Show cycle time per person", "Who writes the most comments?"]) {
      const response = at(question, [], "off");
      expect([response.outcome, response.message, response.suggestions], question).toEqual(["not_understood", PEOPLE_HELP_MESSAGE, PEOPLE_SUGGESTIONS]);
    }
    expect(PEOPLE_HELP_MESSAGE).not.toMatch(/Jira data/);
    expect(PEOPLE_SUGGESTIONS[0]).toBe("Who follows the process most closely?");
  });

  it("gives every common personnel wording the scorecard and the decision sentence", () => {
    for (const question of [
      "Should we let @Ada Brooks go?",
      "Should we demote @Ada Brooks?",
      "Should @Ada Brooks get a bonus?",
      "Should @Ada Brooks get a pay rise?",
      "Is @Ada Brooks useless?",
      "Is @Ada Brooks careless?",
      "Should @Ada Brooks be laid off?",
      "Should @Ada Brooks be made redundant?",
      "Write an appraisal of @Ada Brooks",
      "Should we dismiss @Ada Brooks?",
    ]) {
      const response = at(question, [ADA]);
      expect(response.plan.map((step) => step.tool), question).toEqual(["oversight_person_scorecard"]);
      expect(response.answer!.split("\n\n").slice(-2), question).toEqual([SCORECARD_SENTENCES.decision, scorecardCaveat(90, false, { source: "auto", field: "Programmer" })]);
    }
    for (const plain of ["Who replaced the estimate on DEMO-5?", "Who raised this ticket?", "Which tickets are in dev?"]) {
      expect(asksPersonnel(plain), plain).toBe(false);
    }
    expect(asksToEvaluate("Is anyone careful?")).toBe(true);
  });

  it("answers what someone finished in the period, as the scorecard counts it", () => {
    const month = scorecards(dataset, 30).byId.get(ADA)!.values.done_in_period.value;
    for (const question of ["How many tickets did @Ada Brooks finish this month?", "How many tickets has @Ada Brooks done in the last 30 days?"]) {
      const response = at(question, [ADA]);
      expect(response.plan, question).toEqual([{ tool: "oversight_person_tickets", params: { project: "DEMO", person: ADA, state: "done", days: 30, n: 200 } }]);
      expect(response.facts[0].rows).toHaveLength(Number(month));
      expect(response.answer, question).toMatch(new RegExp(`^Ada Brooks has ${month} tickets? done in the last 30 days`));
    }
    // Everyone by that count, most first, and the whole board's.
    const most = at("Who closed the most tickets this month?");
    const people = most.facts[0].rows.filter((row) => row.person_id !== null).map((row) => Number(row.value));
    expect(people).toEqual([...people].sort((a, b) => b - a));
    expect(most.answer).toMatch(/^Done in the period, last 30 days, most first: .+\. The whole board: \d+\.\n\n/);
    expect(most.facts[0].rows.every((row) => row.standing === null)).toBe(true);
  });

  it("reads a first name only one person on the board has as that person, and asks for @ naming them when two share it", () => {
    for (const question of ["Is Ada doing well?", "Is @Ada lazy?"]) {
      expect(at(question).plan, question).toEqual([{ tool: "oversight_person_scorecard", params: { project: "DEMO", person_ids: [ADA], days: 90 } }]);
    }
    const twin = { id: "p0000000000aa", name: "Ada Lane", avatar: null };
    const board = [...directoryPeople(dataset), twin];
    expect(typedPeople("Is Ada doing well?", board).ambiguousFirst).toEqual({ first: "Ada", names: ["Ada Brooks", "Ada Lane"] });
    expect(typedPeople("Ada is she doing well? is ada?", board).people).toEqual([]); // a sentence's start, and no capital
    expect(ambiguousFirstNameMessage("Ada", ["Ada Brooks", "Ada Lane"])).toBe("Ada could be Ada Brooks or Ada Lane. Type @ and pick the one you mean.");
  });

  it("reads the period and the measure from the same words as the service", () => {
    for (const [question, days] of [
      ["How is @Ada doing this sprint?", 30],
      ["How is @Ada doing this week?", 30],
      ["How is @Ada doing over a month?", 30],
      ["How is @Ada doing all time?", 180],
      ["How is @Ada doing since the start?", 180],
      ["How is @Ada doing over the last 26 weeks?", 180],
      ["How is @Ada doing over the last half year?", 180],
      ["How is @Ada doing overall?", 90],
    ] as const) {
      expect(daysIn(question), question).toBe(days);
    }
  });

  it("sends the overall rows' ratio with its counts, cites no figure in a label, and writes its notes in the reader's words", () => {
    const best = at("Who is best on the board? Rank the others");
    const set = scorecards(dataset, 90);
    for (const row of best.facts[0].rows) {
      const ratio = set.byId.get(String(row.person_id))!.values.open_findings_per_10;
      expect([row.open_findings_per_10, row.open_findings, row.open_tickets, row.enough]).toEqual([ratio.value, ratio.numerator, ratio.denominator, ratio.enough]);
    }
    const card = at("Is @Carmen Ruiz doing well?", [CARMEN]);
    expect(card.answer).toContain("Open findings per 10 open tickets");
    expect(card.citations.map((citation) => citation.text)).toEqual(["90", "90"]);
    expect(verify(card.answer!, card.facts, card.plan).bindings.map((binding) => binding.text)).toEqual(["90", "90"]);
    for (const response of [best, card]) {
      expect(response.facts[0].note).not.toMatch(/vs_board|open_findings_per_10|\d{4}-\d{2}-\d{2}/);
      expect(response.facts[0].note).toContain("(6 Aug 2026 to 4 Nov 2026)");
    }
  });
});
