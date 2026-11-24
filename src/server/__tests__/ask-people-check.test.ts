// @vitest-environment node
import { describe, expect, it } from "vitest";

import { askResponseSchema, noTicketsSentence, SCORECARD_SENTENCES, type AskResponse, type Person } from "@/lib/api/schemas";

import { askSample, PEOPLE_HELP_MESSAGE } from "../sample/ask";
import { ambiguousFirstNameMessage, boardPeopleFacts, boardPeoplePieces, looselyNamed } from "../sample/ask/people";
import { buildDataset } from "../sample/dataset";
import { verify } from "../sample/verify";
import { boardPeople, directoryPeople } from "../sample/people";
import { scorecards } from "../sample/scorecard";
import { personIdFor } from "../sample/team";

const dataset = buildDataset(Date.parse("2026-11-04T14:30:00Z"));
const ADA = personIdFor("acc-01");
const NOT_UNDERSTOOD = "That question can't be answered from the Jira data; try one of the suggestions.";
const at = (question: string, mentions: string[] = [], comparison: "on" | "off" = "on"): AskResponse => {
  const response = askSample(dataset, question, 0, { level: "people", mentions, comparison });
  expect(askResponseSchema.parse(response)).toEqual(response);
  return response;
};
const tools = (response: AskResponse) => response.plan.map((step) => ({ tool: step.tool, ...step.params, project: undefined }));
const holders = () => boardPeople(dataset).map((person) => person.name).sort((a, b) => a.localeCompare(b));
const members = () => {
  const held = new Set(boardPeople(dataset).map((person) => person.id));
  return directoryPeople(dataset).filter((person) => !held.has(person.id)).map((person) => person.name);
};

describe("Ask in sample mode, the JO-11 check's findings", () => {
  it.each([
    // Who struggles, needs help or falls behind: the other side of the process, further from it first (the review).
    ["Which developers are struggling?", [{ tool: "oversight_people_compare", measure: "overall", days: 90, order: "fewest" }]],
    ["Who needs help?", [{ tool: "oversight_people_compare", measure: "overall", days: 90, order: "fewest" }]],
    ["Who is falling behind?", [{ tool: "oversight_people_compare", measure: "overall", days: 90, order: "fewest" }]],
    ["Which people are behind?", [{ tool: "oversight_people_compare", measure: "overall", days: 90, order: "fewest" }]],
    ["Who is the MVP?", [{ tool: "oversight_people_compare", measure: "overall", days: 90, order: "closer" }]],
    ["Who is overloaded?", [{ tool: "oversight_people_compare", measure: "open_tickets", order: "most" }]],
    ["Who is idle?", [{ tool: "oversight_people_compare", measure: "in_progress", order: "fewest" }, { tool: "oversight_board_people", holding: "none" }]],
    ["Who has nothing to do?", [{ tool: "oversight_people_compare", measure: "open_tickets", order: "fewest" }, { tool: "oversight_board_people", holding: "none" }]],
    ["Who contributes least?", [{ tool: "oversight_people_compare", measure: "done_in_period", days: 90, order: "fewest" }]],
    ["List the members of this board", [{ tool: "oversight_board_people", holding: "any" }]],
    ["Who is on this board?", [{ tool: "oversight_board_people", holding: "any" }]],
    ["Who has no tickets?", [{ tool: "oversight_board_people", holding: "none" }]],
  ])("answers %s from the figures, never with the help", (question, plan) => {
    const response = at(question);
    expect([response.outcome, response.message], question).toEqual(["answered", null]);
    expect(response.answer).not.toContain(PEOPLE_HELP_MESSAGE);
    expect(tools(response)).toEqual(plan.map((step) => ({ ...step, project: undefined })));
    expect(verify(response.answer!, response.facts, response.plan).problems).toEqual([]);
    expect(response.people.length).toBeGreaterThan(0);
  });

  it("names everyone on the board, its members with no tickets too, and only those members when asked who has none", () => {
    const everyone = at("Who is on this board?");
    const names = [...holders(), ...members()];
    expect(everyone.facts[0].rows.map((row) => row.name)).toEqual(names);
    // Each name once: the people who hold its tickets, then how many members hold none, and who.
    expect(everyone.answer).toBe(
      `${names.length} people are on this board: ${holders().slice(0, -1).join(", ")} and ${holders().at(-1)}, ` +
        `and ${members().length} members who hold none of its tickets: ${members().slice(0, -1).join(", ")} and ${members().at(-1)}.`,
    );
    expect(everyone.people.map((person) => person.name)).toEqual(names);
    const none = at("Who has no tickets?");
    expect(none.answer).toBe(noTicketsSentence(members()));
    expect(none.facts[0].rows.every((row) => row.tickets === 0)).toBe(true);
  });

  it("says everyone holds a ticket where no member is without one, as the service says it", () => {
    const none = boardPeopleFacts(dataset, "F2", "none");
    expect(boardPeoplePieces({ ...none, rows: [] })).toEqual(["Everyone on this board holds at least one of its tickets."]);
  });

  it("reads a first name typed in lower case where a name stands, as that person", () => {
    const ada = boardPeople(dataset).find((person) => person.id === ADA)!;
    const doing = at("how is ada doing?");
    expect(doing.outcome).toBe("answered");
    expect(doing.plan).toEqual([{ tool: "oversight_person_scorecard", params: { project: "DEMO", person_ids: [ADA], days: 90 } }]);
    expect(doing.answer).toMatch(/^Ada Brooks, last 90 days, next to the board/);
    expect(doing.people).toEqual([ada]);
    const working = at("what is ada working on?");
    expect([working.plan[0].tool, working.people]).toEqual(["oversight_query", [ada]]);
    const backlog = at("ada's backlog?");
    expect(backlog.plan[0]).toMatchObject({ tool: "oversight_person_tickets", params: { person: ADA, state: "open" } });
    // No name stands where "will" does, and the question asks nothing of anyone: the true message.
    expect([at("when will the sprint end?").outcome, at("when will the sprint end?").message]).toEqual(["not_understood", NOT_UNDERSTOOD]);
  });

  it("finds a lower-case first name only where a name stands, and asks for @ when two people share it", () => {
    const person = (name: string, n: number): Person => ({ id: `p${n.toString(16).padStart(12, "0")}`, name, avatar: null });
    const board = [person("Ada Brooks", 1), person("Ada Lane", 2), person("Will Ash", 3), person("Dev Malhotra", 4)];
    expect(looselyNamed("how is ada doing?", board)).toEqual([{ first: "Ada", people: board.slice(0, 2) }]);
    expect(looselyNamed("what's dev working on?", board)).toEqual([{ first: "Dev", people: [board[3]] }]);
    expect(looselyNamed("when will the sprint end?", board)).toEqual([]);
    expect(looselyNamed("when will dev finish the work?", board)).toEqual([]);
    expect(ambiguousFirstNameMessage("Ada", ["Ada Brooks", "Ada Lane"])).toBe("Ada could be Ada Brooks or Ada Lane. Type @ and pick the one you mean.");
  });

  it("counts a backlog as one figure, whichever way it is asked", () => {
    const biggest = at("Who has the biggest backlog?");
    const ada = biggest.facts[0].rows.find((row) => row.person_id === ADA)!;
    const backlog = at("What is @Ada Brooks's backlog?", [ADA]);
    expect(ada.value).toBe(backlog.facts[0].rows.length);
    expect(biggest.answer).toContain(`Ada Brooks ${String(ada.value)}`);
    expect(backlog.answer).toMatch(new RegExp(`^Ada Brooks has ${String(ada.value)} open tickets?`));
    expect(scorecards(dataset, 90).byId.get(ADA)!.values.open_tickets.value).toBe(ada.value);
  });

  it("answers a question about the least with the least first", () => {
    const done = at("Who has the fewest done tickets this month?");
    const values = done.facts[0].rows.filter((row) => row.person_id !== null).map((row) => Number(row.value));
    expect(values).toEqual([...values].sort((a, b) => a - b));
    expect(done.answer).toMatch(/^Done in the period, last 30 days, fewest first: /);
    const nothing = at("Who has nothing to do?");
    expect(nothing.answer).toMatch(/^Open tickets, fewest first: .+\. The whole board: \d+\. /);
    expect(nothing.answer!.endsWith(noTicketsSentence(members()))).toBe(true);
    const breaches = at("Who has the fewest open breaches?");
    expect(breaches.answer).toMatch(/ the fewest open breaches[:,] \d+/);
    expect(breaches.answer).not.toMatch(/\bmost\b/);
  });

  it("says a count of now once, with no period and no caveat", () => {
    const response = at("Who has the most tickets in progress?");
    const [facts] = response.facts;
    expect(facts.note).not.toContain("now now");
    // The measure named mid-sentence in lower case.
    expect(facts.note).toContain("by in progress now, most first");
    expect(response.plan[0].params.days).toBeUndefined();
    expect(response.answer).toMatch(/^In progress now, most first: /);
    expect(response.answer).not.toMatch(/last 90 days|Figures from Jira over/);
    // A count over a period keeps its period, and the caveat last.
    const done = at("Who finished the most work this month?");
    expect(done.answer!.split("\n\n").at(-1)).toMatch(/^Figures from Jira over the last 30 days/);
  });

  it("carries n in a comparison only for a question's top N", () => {
    expect(at("Who is best on the board? Rank the others").plan[0].params.n).toBeUndefined();
    const top = at("Rank the top 3 developers");
    expect(top.plan[0].params.n).toBe(3);
    expect(top.facts[0].rows.filter((row) => row.person_id !== null)).toHaveLength(3);
    expect(at("Rank the top 3 developers", [], "off").message).toBe(SCORECARD_SENTENCES.comparisonOff);
  });
});
