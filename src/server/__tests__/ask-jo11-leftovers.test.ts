// @vitest-environment node
import { describe, expect, it } from "vitest";

import { askResponseSchema, SCORECARD_SENTENCES, type AskResponse, type FactSet } from "@/lib/api/schemas";

import { askSample, PEOPLE_HELP_MESSAGE } from "../sample/ask";
import { LAST_RESORT, noOneCalledMessage, unknownName } from "../sample/ask/people";
import { buildDataset } from "../sample/dataset";
import { directoryPeople, directoryView, peopleView, workPeople } from "../sample/people";
import { portfolioView } from "../sample/portfolio";
import { scorecards, scorecardView } from "../sample/scorecard";
import { verify } from "../sample/verify";

/*
 * What the JO-11 run left open (its final check, 12 Nov 2026), in sample
 * mode, as the service answers it (tests/test_jo11_leftovers.py):
 *
 * - G3/G4: never turn an admin away. The synonym table (the busiest, doing
 *   the most, the least, capacity, could take more work, idle), the overall
 *   comparison as the last resort with a sentence first saying so, and "No one
 *   called <Name> is on this board." for a typed name no one has; proved over
 *   the service's own 67 paraphrases, plan for plan.
 * - G5: one meaning of "open tickets": Epics left out everywhere, a "who"
 *   ranking ranks people only, and the work nobody holds is one sentence after.
 * - G8: "Who is on this board?" says each name once.
 * - G9: the comparison's notes name each column in lower-case words, never "X is X".
 * - G11: skipped stages are measured where the engine measures R-FLOW-02.
 */

const dataset = buildDataset(Date.parse("2026-11-04T14:30:00Z"));
const NOT_UNDERSTOOD = "That question can't be answered from the Jira data; try one of the suggestions.";

const ask = (question: string, mentions: string[] = [], comparison: "on" | "off" = "on"): AskResponse => {
  const response = askSample(dataset, question, 0, { level: "people", mentions, comparison });
  expect(askResponseSchema.parse(response)).toEqual(response);
  return response;
};
const planOf = (response: AskResponse) =>
  response.plan.map((step) => [step.tool, Object.fromEntries(Object.entries(step.params).filter(([key]) => key !== "project"))] as const);

/* ----------------------------------------------- G3/G4: never turn away -- */

type Plan = (readonly [string, Record<string, unknown>])[];
const MEMBERS = ["oversight_board_people", { holding: "none" }] as const;
const MOST: Plan = [["oversight_people_compare", { measure: "open_tickets", order: "most" }]];
const LEAST: Plan = [["oversight_people_compare", { measure: "open_tickets", order: "fewest" }], MEMBERS];
const IDLE: Plan = [["oversight_people_compare", { measure: "in_progress", order: "fewest" }], MEMBERS];
const ACTIVE: Plan = [["oversight_people_compare", { measure: "in_progress", order: "most" }]];
/** The last resort: the overall comparison as it stands, closer first, whatever direction word the question holds. */
const LAST: Plan = [["oversight_people_compare", { measure: "overall", days: 90, order: "closer" }]];
const doing = (days = 90): Plan => [...MOST, ["oversight_people_compare", { measure: "done_in_period", days, order: "most" }]];

/** The service's PARAPHRASES (tests/test_jo11_leftovers.py), question for question and plan for plan. */
const PARAPHRASES: [string, Plan][] = [
  // The busiest, the most work: open tickets, most first.
  ["Who is the busiest?", MOST], ["Who's the busiest person on the board?", MOST], ["Which developer is busiest?", MOST],
  ["Who is busy?", MOST], ["Who is the most busy?", MOST], ["Who has the most work?", MOST],
  ["Who has the most work on?", MOST], ["Who works the most?", MOST], ["Who is working the most?", MOST],
  ["Who has the most on their plate?", MOST], ["Who has the most going on?", MOST], ["Who has the most tasks?", MOST],
  ["Who has the most?", MOST], ["Which person has the most work right now?", MOST], ["Who carries the most work?", MOST],
  ["Who is the most loaded?", MOST], ["Who has the heaviest load?", MOST], ["Who is over capacity?", MOST],
  ["Who is swamped?", MOST],
  // Doing the most: open tickets and the work done in the period, most first.
  ["Who is doing the most?", doing()], ["Who does the most?", doing()], ["Who's doing the most work?", doing()],
  ["Which developer does the most?", doing()], ["Who did the most this month?", doing(30)],
  ["Who is doing the most on this board?", doing()],
  // The least, room for more: open tickets, fewest first, and the members who hold none.
  ["Who is doing the least?", LEAST], ["Who does the least?", LEAST], ["Who works the least?", LEAST],
  ["Who is working the least?", LEAST], ["Who is underworked?", LEAST], ["Who is under-worked?", LEAST],
  ["Who has capacity?", LEAST], ["Who has spare capacity?", LEAST], ["Who has free capacity?", LEAST],
  ["Who has the most capacity?", LEAST], ["Who has bandwidth?", LEAST], ["Who could take more work?", LEAST],
  ["Who can take on more?", LEAST], ["Who could take on extra work?", LEAST], ["Who could pick up more tickets?", LEAST],
  ["Which developer could handle more?", LEAST], ["Who has the lightest load?", LEAST],
  ["Who has the lightest workload?", LEAST], ["Who has the least work?", LEAST], ["Who has the least to do?", LEAST],
  ["Who has the least on their plate?", LEAST], ["Who is the least busy?", LEAST], ["Who is not busy?", LEAST],
  ["Who isn't busy?", LEAST], ["Who has nothing to do?", LEAST], ["Who is available?", LEAST],
  ["Who is free to take something?", LEAST], ["Who has room for more?", LEAST], ["Who is underused?", LEAST],
  ["Who has the least?", LEAST], ["Who is the quietest?", LEAST], ["Who is on the bench?", LEAST],
  ["Who is underutilised?", LEAST],
  // Idle: nothing in progress now, fewest first.
  ["Who is idle?", IDLE], ["Who has nothing in progress?", IDLE], ["Who is not working on anything?", IDLE],
  // The qualifier or the negation decides the order (the JO-12 review, the G4 class): no room left is the busiest; not
  // overloaded, the least loaded or light on work has room; not idle has work in progress.
  ["Who is at full capacity?", MOST], ["Who has reached capacity?", MOST], ["Who is near capacity?", MOST],
  ["Who has the least capacity?", MOST], ["Who has the least bandwidth?", MOST], ["Who has no bandwidth left?", MOST],
  ["Who isn't available?", MOST], ["Who is not available?", MOST], ["Who could not take more work?", MOST],
  ["Who can't take on more?", MOST], ["Who has no room for more?", MOST], ["Who is not underworked?", MOST],
  ["Who is overworked?", MOST], ["Who is the most overworked?", MOST], ["Who's flat out?", MOST],
  ["Who's maxed out?", MOST], ["Who's got the most on?", MOST], ["Who has the most on?", MOST],
  ["Who is not overloaded?", LEAST], ["Who isn't swamped?", LEAST], ["Who is the least loaded?", LEAST],
  ["Who has the fewest tasks?", LEAST], ["Who has spare time?", LEAST], ["Who has free time?", LEAST],
  ["Who has spare cycles?", LEAST], ["Who's light on work?", LEAST], ["Who's got the least on?", LEAST],
  ["Who has the least on?", LEAST],
  ["Who is not idle?", ACTIVE], ["Who is the least idle?", ACTIVE],
  // Nothing here places it: the overall comparison, with a sentence first saying so.
  ["Show cycle time per person", LAST], ["Who writes the most comments?", LAST],
  ["Who should own the next release?", LAST], ["Which person joined most recently?", LAST],
  ["Who works weekends?", LAST], ["Who is the team lead?", LAST],
];

describe("G3/G4: no admin is turned away", () => {
  it("has more than sixty paraphrases, each once", () => {
    expect(PARAPHRASES.length).toBeGreaterThanOrEqual(60);
    expect(new Set(PARAPHRASES.map(([question]) => question)).size).toBe(PARAPHRASES.length);
  });

  it.each(PARAPHRASES)("answers %s with the figure, in its order", (question, expected) => {
    const response = ask(question);
    expect([response.outcome, response.message], question).toEqual(["answered", null]);
    expect(planOf(response), question).toEqual(expected);
    expect(response.answer).not.toContain(PEOPLE_HELP_MESSAGE);
    expect(response.answer).not.toContain(NOT_UNDERSTOOD);
    expect(verify(response.answer!, response.facts, response.plan).problems).toEqual([]);
    if (expected === LAST) {
      expect(response.answer!.startsWith(`${LAST_RESORT.overall}\n\nMeasures closer to the process than the board`), question).toBe(true);
    } else {
      expect(response.answer!.startsWith("This answer uses"), question).toBe(false);
    }
    // Each ranking in its order: the facts sorted by the count (most or fewest first), the answer naming the people in
    // that order, and the tickets nobody holds after them, never among them.
    for (const fact of response.facts) {
      if (fact.tool !== "oversight_people_compare" || fact.params.measure === "overall") continue;
      const people = fact.rows.filter((row) => row.person_id !== null);
      const values = people.map((row) => Number(row.value));
      const fewest = fact.params.order === "fewest";
      expect(values, question).toEqual([...values].sort((a, b) => (fewest ? a - b : b - a)));
      const start = response.answer!.indexOf(`${String(people[0].label)}, `);
      const sentence = response.answer!.slice(start, response.answer!.indexOf("The whole board", start));
      const places = people.map((row) => sentence.indexOf(`${String(row.name)} ${String(row.value)}`));
      expect(places.every((place) => place >= 0), question).toBe(true);
      expect(places, question).toEqual([...places].sort((a, b) => a - b));
      if (sentence.includes("Unassigned:")) expect(sentence.indexOf("Unassigned:")).toBeGreaterThan(places.at(-1)!);
    }
  });

  it.each([
    ["how is ana doing?", "Ana"],
    ["Who is Zara?", "Zara"],
    ["What is zara's backlog?", "Zara"],
    ["Is Zoë doing well?", "Zoë"],
    ["what is olu working on?", "Olu"],
    ["Show me Priya's tickets", "Priya"],
  ])("says no one called the name is on the board: %s", (question, name) => {
    const response = ask(question);
    expect([response.outcome, response.message]).toEqual(["not_understood", noOneCalledMessage(name)]);
    expect([response.people, response.facts]).toEqual([[], []]);
  });

  it.each([
    "How is the sprint doing?",
    "how is brooks doing?",
    "How is DEMO doing?",
    "when will the sprint end?",
    "who is zara?",
    "How is velocity doing?",
    "What is the team's backlog?",
    "How is everyone doing?",
  ])("reads no name where none stands: %s", (question) => {
    expect(unknownName(question, directoryPeople(dataset), false)).toBeNull();
    expect(ask(question).message ?? "").not.toContain("No one called");
  });

  it("keeps the help where comparing people is off, and the comparison-off sentence for a ranking", () => {
    const help = ask("Show cycle time per person", [], "off");
    expect([help.outcome, help.message]).toEqual(["not_understood", PEOPLE_HELP_MESSAGE]);
    const one = ask("Who could take more work?", [], "off");
    expect([one.outcome, one.message]).toEqual(["not_understood", SCORECARD_SENTENCES.comparisonOff]);
  });

  it("answers the busiest and the least in the service's words, the work nobody holds after the ranking", () => {
    const busiest = ask("Who is the busiest?");
    expect(busiest.answer).toMatch(/^Open tickets, most first: .+\. Unassigned: \d+ open tickets?\. The whole board: \d+\.$/);
    const least = ask("Who could take more work?");
    expect(least.answer).toMatch(/^Open tickets, fewest first: .+\. Unassigned: \d+ open tickets?\. The whole board: \d+\. .+ (?:has|have) no tickets on this board\.$/);
    const done = ask("Who is doing the most?");
    expect(done.facts.map((fact) => fact.ref)).toEqual(["F1", "F2"]);
    expect(done.answer).toMatch(/The whole board: \d+\. Done in the period, last 90 days, most first: .+\. The whole board: \d+\.\n\nFigures from Jira over the last 90 days/);
  });
});

/* ------------------------------------------- G5: one meaning of open tickets -- */

const peopleRows = (fact: FactSet, figure: string) => fact.rows.filter((row) => row.person_id !== null).map((row) => [row.name, row[figure]]);

describe("the JO-12 review: each question answered with the figure it names, as the service answers it", () => {
  const person = (name: string) => peopleView(dataset).people.find((row) => row.person?.name === name)!;

  it.each([
    "Who's not logging hours?",
    "Who isn't booking their hours?",
    "Who logs the fewest hours?",
    "Who never logs time?",
    // Regression: "logged the most hours" got the overall comparison, while "has the most hours logged" got time
    // logged: one question, two answers by word order.
    "Who logged the most hours?",
    "Which developer logged the most hours?",
    "Who has the most hours logged?",
    "Who has logged the fewest hours?",
    "Who records the most hours?",
    "Who books the most hours?",
    // Regression (the JO-12 check): time tracked, recorded or booked, and hours worked, got the last resort or open
    // tickets (tests/test_jo11_leftovers.py asks the service the same).
    "Who tracks time?",
    "Who records their time?",
    "Who books time on their tickets?",
    "Who keeps track of their time?",
    "Who fills in their time?",
    "Who worked the most hours?",
    "Who spent the fewest hours?",
  ])("answers %s with time logged on done work", (question) => {
    const response = ask(question);
    expect(planOf(response).map(([, params]) => params.measure)).toEqual(["time_logged"]);
    expect(response.answer!.startsWith("Time logged on done work"), response.answer!).toBe(true);
  });

  it("gives an hours question one answer whatever its word order", () => {
    const [logged, held] = [ask("Who logged the most hours?"), ask("Who has the most hours logged?")];
    expect(logged.plan).toEqual(held.plan);
    expect(logged.answer).toBe(held.answer);
    expect(logged.answer!.startsWith(LAST_RESORT.overall)).toBe(false);
  });

  // The scorecard measures named about people a question mentions (the JO-12 check: two named people asked about time
  // logged, skipped stages or estimates got their open breaches; reopened or stuck, their open tickets; the time they
  // log on done work, their tickets done), as the service answers them (tests/test_jo11_leftovers.py).
  const NAMED_MEASURES = [
    ["Time logged by @Ada Brooks and @Carmen Ruiz", "time_logged"],
    ["Do @Ada Brooks and @Carmen Ruiz skip stages?", "skipped_stage"],
    ["Do @Ada Brooks and @Carmen Ruiz estimate before starting?", "estimated_before_start"],
    ["How often are @Ada Brooks and @Carmen Ruiz's tickets reopened?", "reopened"],
    ["How many of @Ada Brooks and @Carmen Ruiz's tickets are stuck?", "stuck_now"],
    ["How much time do @Ada Brooks and @Carmen Ruiz log on their done work?", "time_logged"],
    ["Do @Ada Brooks and @Carmen Ruiz go over their estimates?", "within_estimate"],
    ["How many hours did @Ada Brooks and @Carmen Ruiz log?", "time_logged"],
    ["Do @Ada Brooks and @Carmen Ruiz track time?", "time_logged"],
    ["Do @Ada Brooks and @Carmen Ruiz record their time?", "time_logged"],
    ["Do @Ada Brooks and @Carmen Ruiz book time on their tickets?", "time_logged"],
  ] as const;

  it.each(NAMED_MEASURES)("sets the people named side by side by the measure named: %s", (question, measure) => {
    const ids = [person("Ada Brooks").person!.id, person("Carmen Ruiz").person!.id];
    const response = ask(question, ids);
    expect([response.outcome, response.message], question).toEqual(["answered", null]);
    expect(planOf(response), question).toEqual([["oversight_people_compare", { measure, days: 90, order: "closer", person_ids: ids }]]);
    const [fact] = response.facts;
    expect(fact.rows.filter((row) => row.person_id !== null).map((row) => row.person_id).sort()).toEqual([...ids].sort());
    expect(fact.rows.filter((row) => row.person_id === null).map((row) => row.name)).toEqual(["Whole board"]);
    expect(response.answer!.startsWith(`${String(fact.rows[0].label)}, `), response.answer!).toBe(true);
    const first = response.answer!.split("\n\n")[0];
    for (const figure of ["open breaches", "open tickets:", "Done in the period"]) expect(first, question).not.toContain(figure);
    expect(verify(response.answer!, response.facts, response.plan).problems).toEqual([]);
  });

  it.each(NAMED_MEASURES.map(([question, measure]) => [question.replace(" and @Carmen Ruiz", ""), measure] as const))(
    "answers one person asked about a measure with their scorecard: %s",
    (question, measure) => {
      // Regression: "Does @Ada Brooks skip stages?" and "Time logged by @Ada Brooks" got her tickets or findings.
      const ada = person("Ada Brooks").person!.id;
      const response = ask(question, [ada]);
      expect([response.outcome, response.message], question).toEqual(["answered", null]);
      expect(planOf(response), question).toEqual([["oversight_person_scorecard", { person_ids: [ada], days: 90 }]]);
      expect(response.facts[0].rows.some((row) => row.measure === measure)).toBe(true);
      expect(response.answer!.startsWith("Ada Brooks, last 90 days, next to the board"), response.answer!).toBe(true);
    },
  );

  it("with comparison off, gives one person's scorecard for a measure and refuses two", () => {
    const [ada, carmen] = [person("Ada Brooks").person!.id, person("Carmen Ruiz").person!.id];
    const two = ask("Time logged by @Ada Brooks and @Carmen Ruiz", [ada, carmen], "off");
    expect([two.outcome, two.message]).toEqual(["not_understood", SCORECARD_SENTENCES.comparisonOff]);
    const one = ask("Time logged by @Ada Brooks", [ada], "off");
    expect([one.outcome, planOf(one).map(([tool]) => tool)]).toEqual(["answered", ["oversight_person_scorecard"]]);
  });

  it("sets two people side by side by the figure the question names, never their breaches for their tickets", () => {
    const [ada, dev, ben] = ["Ada Brooks", "Dev Malhotra", "Ben Okafor"].map(person);
    const ids = [ada.person!.id, dev.person!.id];
    const tickets = ask("Who has more open tickets, @Ada Brooks or @Dev Malhotra?", ids);
    const leader = ada.open_tickets >= dev.open_tickets ? ada : dev;
    expect(tickets.answer!.startsWith(`${leader.person!.name} has the most open tickets: ${leader.open_tickets}`)).toBe(true);
    expect(tickets.answer).not.toContain("open breaches");
    const progress = ask("Who has more in progress, @Ada Brooks or @Dev Malhotra?", ids);
    expect(planOf(progress)).toEqual([["oversight_people_compare", { measure: "in_progress", order: "most", person_ids: ids }]]);
    expect(progress.facts[0].rows.filter((row) => row.person_id !== null).map((row) => row.person_id).sort()).toEqual([...ids].sort());
    expect(progress.facts[0].rows.some((row) => row.name === "Unassigned")).toBe(false);
    const closed = ask("Who closed more tickets this month, @Ada Brooks or @Ben Okafor?", [ada.person!.id, ben.person!.id]);
    expect(planOf(closed)).toEqual([["oversight_people_compare", { measure: "done_in_period", days: 30, order: "most", person_ids: [ada.person!.id, ben.person!.id] }]]);
  });

  it("ranks findings as breaches and warnings together, and tickets with findings by that figure", () => {
    const people = peopleView(dataset).people.filter((row) => row.person !== null);
    const top = [...people].sort((a, b) => b.open_breaches + b.open_warnings - (a.open_breaches + a.open_warnings))[0];
    const response = ask("Who has the most findings?");
    expect(response.answer!.startsWith(`${top.person!.name} has the most open findings: ${top.open_breaches + top.open_warnings}`)).toBe(true);
    expect(response.facts[0].columns.map((column) => column.key)).toContain("open_findings");
    const withFindings = ask("Who has the most tickets with findings?");
    const leader = [...people].sort((a, b) => b.tickets_with_findings - a.tickets_with_findings)[0];
    expect(withFindings.answer!.startsWith(`${leader.person!.name} has the most tickets with findings: ${leader.tickets_with_findings}`)).toBe(true);
  });

  it("answers one person's ticket count with their tickets, never their findings", () => {
    for (const question of ["How many open tickets does @Ben Okafor have?", "How many tickets is @Ben Okafor holding?"]) {
      const ben = person("Ben Okafor");
      const response = ask(question, [ben.person!.id]);
      const [tool, params] = planOf(response)[0];
      expect([tool, params.person, params.state], question).toEqual(["oversight_person_tickets", ben.person!.id, "open"]);
      expect(response.answer, question).toContain(`${ben.open_tickets} open tickets`);
      expect(response.answer, question).not.toContain("open breaches");
    }
  });

  it("reads a surname alone as its one holder", () => {
    const ada = person("Ada Brooks");
    const response = ask("How is Brooks doing?");
    expect(response.outcome).toBe("answered");
    expect(response.people.map((who) => who.id)[0]).toBe(ada.person!.id);
  });

  it("counts open tickets and work in progress as the Overview and the Portfolio do", () => {
    const board = portfolioView([dataset]).boards[0];
    for (const [question, figure] of [
      ["How many open tickets are there?", board.open_tickets],
      ["How many tickets are in progress?", board.in_progress],
    ] as const) {
      const response = ask(question);
      expect(response.outcome, question).toBe("answered");
      expect(response.answer!.startsWith(`There are ${figure} `), question).toBe(true);
      const team = askSample(dataset, question, 0, { level: "team", mentions: [], comparison: "on" });
      expect(team.answer!.startsWith(`There are ${figure} `), question).toBe(true);
    }
  });

  it("says no period beside a rate of now", () => {
    const response = ask("Who has tickets stuck?");
    expect(response.answer!.startsWith("Open tickets stuck in a status, closest to the process first: ")).toBe(true);
  });
});

describe("G5: one meaning of open tickets", () => {
  it("counts a person's tickets alike in GET /people, the directory, the scorecard and every Ask ranking", () => {
    const rows = new Map(peopleView(dataset).people.flatMap((row) => (row.person ? [[row.person.id, row] as const] : [])));
    const directory = new Map(directoryView(dataset).people.map((entry) => [entry.person.id, entry.tickets]));
    const set = scorecards(dataset, 90);
    const ranked = ask("Who holds the most open tickets?").facts[0].rows;
    const backlog = ask("Who has the biggest backlog?").facts[0].rows;
    expect(rows.size).toBe(set.holders.length);
    for (const person of set.holders) {
      const id = person.person.id;
      const open = person.values.open_tickets.value;
      expect([rows.get(id)!.tickets, directory.get(id)]).toEqual([person.tickets, person.tickets]);
      expect(rows.get(id)!.open_tickets).toBe(open);
      expect(ranked.find((row) => row.person_id === id)!.open_tickets).toBe(open);
      expect(backlog.find((row) => row.person_id === id)!.value).toBe(open);
    }
    // The board's own figures add up: the people's and the tickets nobody holds make the board's.
    const nobody = peopleView(dataset).people.find((row) => row.person === null)!;
    const board = set.board.values.open_tickets.value!;
    expect([...rows.values()].reduce((sum, row) => sum + row.open_tickets, 0) + nobody.open_tickets).toBe(board);
    expect([...rows.values()].reduce((sum, row) => sum + row.tickets, 0) + nobody.tickets).toBe(set.board.tickets);
    const body = scorecardView(dataset, { days: 90, person: [] }, "on");
    expect(body.found && body.body.board.tickets).toBe(set.board.tickets);
  });

  it.each([
    ["Who holds the most open tickets?", "Who has the biggest backlog?", "most"],
    ["Who has the fewest open tickets?", "Who has the smallest backlog?", "fewest"],
  ])("gives one order for %s and %s, and never ranks Unassigned", (ranking, backlog, first) => {
    const byPeople = ask(ranking);
    const byBacklog = ask(backlog);
    const people = byPeople.facts[0].rows;
    expect(peopleRows(byPeople.facts[0], "open_tickets")).toEqual(peopleRows(byBacklog.facts[0], "value"));
    const [leader, figure] = peopleRows(byPeople.facts[0], "open_tickets")[0];
    const nobody = people.at(-1)!;
    expect([nobody.person_id, nobody.name]).toEqual([null, "Unassigned"]);
    // One leader ("<Name> has the most open tickets: 58, then ..."), or several level with them, as the service says them.
    const level = peopleRows(byPeople.facts[0], "open_tickets").filter(([, value]) => value === figure).length;
    expect(byPeople.answer!.startsWith(level === 1 ? `${String(leader)} has the ${first} open tickets: ${String(figure)}, then ` : `${String(leader)}`)).toBe(true);
    if (level > 1) expect(byPeople.answer).toContain(` have the ${first} open tickets, ${String(figure)} each`);
    expect(byBacklog.answer!.startsWith(`Open tickets, ${first} first: ${String(leader)} ${String(figure)}, `)).toBe(true);
    for (const body of [byPeople, byBacklog]) {
      expect(body.answer!.split("Unassigned").length - 1).toBe(1);
      expect(body.answer).toContain(`Unassigned: ${String(nobody.open_tickets)} open tickets.`);
      expect(body.answer!.indexOf(String(leader))).toBeLessThan(body.answer!.indexOf("Unassigned"));
    }
    expect(byPeople.facts[0].note).toContain(
      "ties by name; then one row for the tickets nobody holds (Unassigned), which is no one's and never ranked; a person's tickets are the board's work, Epics left out",
    );
  });

  it("says the work nobody holds after a ranking by breaches, then whose findings are whose", () => {
    const response = ask("Who has the most open breaches?");
    expect(response.answer).toMatch(/\. Unassigned: \d+ open breach(?:es)?\. Findings follow the ticket's current assignee\.$/);
    expect(response.facts[0].rows.at(-1)).toMatchObject({ person_id: null, name: "Unassigned" });
  });

  it("leaves Epics out of everyone's tickets, and counts the board's work alone", () => {
    const work = dataset.world.issues.filter((issue) => issue.type !== "Epic");
    expect(scorecards(dataset, 90).board.tickets).toBe(work.length);
    expect(peopleView(dataset).people.reduce((sum, row) => sum + row.tickets, 0)).toBe(work.length);
    expect(workPeople(dataset).length).toBe(scorecards(dataset, 90).holders.length);
  });
});

/* ------------------------------------------------ G8, G9, G11 -- */

describe("G8: who is on this board, each name once", () => {
  it("lists the holders, then how many members hold none, and who", () => {
    const response = ask("Who is on this board?");
    const facts = response.facts[0];
    const holders = facts.rows.filter((row) => row.tickets !== 0).map((row) => String(row.name));
    const members = facts.rows.filter((row) => row.tickets === 0).map((row) => String(row.name));
    expect(members.length).toBeGreaterThan(0);
    for (const name of [...holders, ...members]) expect(response.answer!.split(name).length - 1, name).toBe(1);
    expect(response.answer).toContain(`, and ${members.length} ${members.length === 1 ? "member who holds" : "members who hold"} none of its tickets: `);
    expect(facts.note).toBe(
      `everyone on this board, as the @ list shows them: the ${holders.length} people assigned its tickets now (tickets: the ones they hold, any status, ` +
        `Epics left out), then the ${members.length} ${members.length === 1 ? "member who holds" : "members who hold"} none, each by name; ${facts.rows.length} in all`,
    );
  });
});

describe("G9: the comparison's notes say what each column means", () => {
  it("never says X is X, and names columns in lower case mid-sentence", () => {
    const overall = ask("Who follows the process most closely?").facts[0];
    expect(overall.params.measure).toBe("overall");
    expect(overall.note).not.toMatch(/is Open findings|per 10 Open/);
    expect(overall.note!.endsWith(
      "; by each ticket's current assignee, Epics left out; the closer, further and level counts are the measures on which the person's figure stands " +
        "closer to the process than the board's, further from it, or level with it (within 5 points, 0.5 for the ratio); measures compared is their sum; " +
        "too few tickets counts the measures where either side rests on fewer than 5 tickets; open findings per 10 open tickets is the open breaches and " +
        "warnings on the person's open tickets for every 10 of those tickets, compared only when it rests on enough tickets",
    )).toBe(true);
    const labels = ["Closer to the process", "Further from the process", "Level with the board", "Measures compared", "Too few tickets", "Open findings",
      "Open tickets", "Enough tickets", "Next to the board", "Value", "Denominator", "Numerator", "Reopened after Done", "Skipped a stage", "In progress now"];
    for (const question of ["Who follows the process most closely?", "Who reopens the most work?", "Who skips stages the most?", "Who has the biggest backlog?"]) {
      for (const fact of ask(question).facts) {
        for (const label of labels) expect(fact.note, `${question}: ${label}`).not.toMatch(new RegExp(`(?<=[a-z,;] )${label}\\b`));
      }
    }
    expect(ask("Who reopens the most work?").facts[0].note).toMatch(/^everyone who holds a ticket, by reopened after Done over the last 90 days \(/);
    expect(ask("Who has the biggest backlog?").facts[0].note).toMatch(/^everyone who holds a ticket, by open tickets now, most first, ties by name, then the tickets nobody holds/);
  });
});

describe("G11: one truth per board", () => {
  it("measures skipped stages where the Overview lists open Skipped a stage findings, never code review", () => {
    const set = scorecards(dataset, 90);
    const measure = (key: string) => set.measures.find((candidate) => candidate.key === key)!;
    expect(measure("skipped_stage")).toMatchObject({ measurable: true, reason: null });
    expect(measure("code_review").measurable).toBe(false);
    expect(set.board.values.skipped_stage.denominator).toBeGreaterThan(0);
    const one = ask("How is @Ada Brooks doing?", [set.holders.find((row) => row.person.name === "Ada Brooks")!.person.id]);
    expect(one.answer).toContain("Not measurable on this board: Code review recorded.");
    expect(one.answer).not.toContain("Not measurable on this board: Skipped a stage");
    // As asked (JO-14): the most skipped, highest first.
    expect(ask("Who skips stages the most?").answer).toMatch(/^Skipped a stage, last 90 days, highest first: /);
  });
});
