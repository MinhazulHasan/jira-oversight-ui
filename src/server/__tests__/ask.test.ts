// @vitest-environment node
import { describe, expect, it } from "vitest";

import { normalizeFindingsQuery } from "@/lib/api/params";
import { segmentAnswer } from "@/lib/api/citations";
import {
  ASK_DECLINES,
  ASK_MAX_LENGTH,
  askResponseSchema,
  SCORECARD_SENTENCES,
  scorecardCaveat,
  type AskResponse,
  type FactCell,
  type FactSet,
  type ScorecardDays,
} from "@/lib/api/schemas";

import { askSample, NOT_VERIFIED_MESSAGE, PEOPLE_HELP_MESSAGE, type AskOptions } from "../sample/ask";
import { ambiguousNameMessage, typedPeople, verifiedPeople } from "../sample/ask/people";
import { SCRIPTS, SUGGESTED_QUESTIONS } from "../sample/ask/scripts";
import { buildDataset } from "../sample/dataset";
import { findingsPage } from "../sample/findings";
import { briefing } from "../sample/insights";
import { boardPeople, directoryPeople, peopleView } from "../sample/people";
import { scorecards } from "../sample/scorecard";
import { personIdFor } from "../sample/team";
import { displayForms, KEY, verify } from "../sample/verify";

/*
 * Planning.md principle 3: numbers come from code. Every number, issue key and
 * date in a sample answer must be in the facts it was written from, every one
 * must be cited, and every citation must point at a cell that holds it.
 */

const NOW = Date.parse("2026-11-04T14:30:00Z");

const OUTCOMES: [question: string, outcome: AskResponse["outcome"], tool: string | null][] = [
  ["Where do tickets get stuck most?", "answered", "oversight_time_in_status"],
  ["Which epics have the most open breaches?", "answered", "oversight_hot_spots"],
  ["How much work was estimated before it started?", "answered", "oversight_coverage"],
  ["Which tickets went straight from To Do to Done this month?", "answered", "oversight_list_findings"],
  ["How is effort against estimate trending?", "answered", "oversight_trend"],
  ["Which rules can't be measured in Jira today?", "answered", "oversight_rule_status"],
  ["Which open tickets have burned the most of their estimate?", "answered", "oversight_top_issues"],
  ["Which tickets have been reopened after Done?", "answered", "oversight_list_findings"],
  ["What happened to DEMO-1?", "answered", "oversight_issue_timeline"],
  ["What is the median cycle time this quarter?", "not_verified", "oversight_trend"],
  ["Which tickets reached testing without code review?", "not_measurable", "oversight_list_findings"],
  ["Which tickets were reopened this week?", "no_data", "oversight_list_findings"],
  ["What happened to DEMO-99999?", "no_data", "oversight_issue_timeline"],
  ["Who is the slowest developer?", "not_understood", null],
  ["Which engineer logs the most hours?", "not_understood", null],
  ["Rank the people on the team by cycle time", "not_understood", null],
  ["What will the weather be like in London tomorrow?", "not_understood", null],
  ["", "not_understood", null],
  ["  ", "not_understood", null],
];

const WHOLE_KEY = /^[A-Z][A-Z0-9_]+-\d+$/;

/** The value a citation's cell holds, or what a pseudo-column stands for. */
function cellOf(fact: FactSet, row: number, column: string): FactCell | undefined {
  return row >= 0 ? fact.rows[row]?.[column] : undefined;
}

function expectPrincipleThree(response: AskResponse): void {
  const answer = response.answer!;
  const check = verify(answer, response.facts, response.plan);
  expect(check.problems, answer).toEqual([]);

  // Every verified value is cited, in text order, with the exact text the validator read.
  let from = 0;
  const cited = response.citations.map((citation, index) => {
    expect(citation.marker).toBe(index + 1);
    const at = answer.indexOf(citation.text, from);
    expect(at, `${citation.text} in ${answer}`).toBeGreaterThanOrEqual(0);
    from = at + citation.text.length;
    return `${at}:${citation.text}`;
  });
  expect(cited).toEqual(check.bindings.map((binding) => `${binding.start}:${binding.text}`));

  // The page's segmenter puts every marker exactly where the validator read the value.
  let offset = 0;
  const segmented = segmentAnswer(answer, response.citations).flatMap((segment) => {
    const at = offset;
    offset += segment.text.length;
    return segment.kind === "cite" ? [`${at}:${segment.text}`] : [];
  });
  expect(segmented).toEqual(cited);

  // And each citation points at a cell that really holds it.
  for (const citation of response.citations) {
    const fact = response.facts.find((candidate) => candidate.ref === citation.fact_ref);
    expect(fact, citation.fact_ref).toBeDefined();
    if (citation.row_index === -1) {
      if (citation.column === "note") expect(fact!.note).toContain(citation.text);
      else if (citation.column === "row_count") expect(displayForms(fact!.rows.length, "count")).toContain(citation.text.replace(/,/g, ""));
      else expect(["params", "as_of"]).toContain(citation.column);
      continue;
    }
    const value = cellOf(fact!, citation.row_index, citation.column);
    const kind = fact!.columns.find((column) => column.key === citation.column)?.kind;
    if (WHOLE_KEY.test(citation.text)) {
      expect(value).toBe(citation.text);
    } else if (kind === "date") {
      expect(typeof value).toBe("string");
    } else if (kind === "text" && typeof value === "string") {
      // A figure as code wrote it in a text cell ("72% · 18 of 25", a scorecard's shown figure): trusted text, as a note is.
      expect(value, `${citation.text} from ${citation.column}`).toContain(citation.text);
    } else {
      expect(displayForms(value, kind ?? "number"), `${citation.text} from ${citation.column}`).toContain(
        citation.text.replace(/,/g, ""),
      );
    }
  }
}

describe("Ask in sample mode", () => {
  const dataset = buildDataset(NOW);

  it.each(OUTCOMES)("answers %j with %s", (question, outcome, tool) => {
    const response = askSample(dataset, question, 0);
    expect(askResponseSchema.parse(response)).toEqual(response);
    expect(response.outcome).toBe(outcome);
    expect(response.plan[0]?.tool ?? null).toBe(tool);
    expect(response.question).toBe(question.trim());
    expect(response.model).toBeNull();

    switch (outcome) {
      case "answered":
        expect(response.answer).toBeTruthy();
        expect(response.message).toBeNull();
        expect(response.facts.length).toBeGreaterThan(0);
        expectPrincipleThree(response);
        break;
      case "not_verified":
        expect(response.answer).toBeNull();
        expect(response.citations).toEqual([]);
        expect(response.facts.length).toBeGreaterThan(0);
        expect(response.message).toBe(NOT_VERIFIED_MESSAGE);
        break;
      case "no_data":
        expect(response.answer).toBeNull();
        expect(response.facts.length).toBeGreaterThan(0);
        expect(response.facts.every((fact) => fact.rows.length === 0)).toBe(true);
        expect(response.message).toMatch(/Looked at/);
        break;
      case "not_measurable":
        expect(response.answer).toBeNull();
        expect(response.facts).toEqual([]);
        expect(response.missing_evidence).toEqual(["code_review"]);
        expect(response.message).toMatch(/itself a finding/);
        break;
      case "not_understood":
        expect(response.answer).toBeNull();
        expect(response.facts).toEqual([]);
        expect(response.plan).toEqual([]);
        expect(response.message).toBeTruthy();
        expect(response.suggestions.length).toBeGreaterThan(0);
        break;
    }
  });

  it("covers all five outcomes", () => {
    expect(new Set(OUTCOMES.map(([, outcome]) => outcome))).toEqual(
      new Set(["answered", "not_understood", "no_data", "not_measurable", "not_verified"]),
    );
  });

  it("keeps every number and key of every suggested question's answer in its facts", () => {
    for (const question of SUGGESTED_QUESTIONS) {
      const response = askSample(dataset, question, 0);
      if (response.outcome === "answered") expectPrincipleThree(response);
    }
  });

  it("holds to principle 3 on other days too", () => {
    for (const at of ["2026-11-09T09:00:00Z", "2027-01-15T12:00:00Z", "2026-07-01T08:00:00Z"]) {
      const other = buildDataset(Date.parse(at));
      for (const question of SUGGESTED_QUESTIONS) {
        const response = askSample(other, question, 0);
        if (response.outcome === "answered") expectPrincipleThree(response);
      }
    }
  });

  it("withholds the cycle-time answer because its drafts quote figures the facts do not hold", () => {
    const script = SCRIPTS.find((candidate) => candidate.id === "cycle-time-quarter")!;
    const result = script.run(dataset, script.question);
    expect(result.outcome).toBe("not_verified");
    if (result.outcome !== "not_verified") return;
    expect(result.drafts).toHaveLength(2);
    for (const draft of result.drafts) {
      const check = verify(draft, result.facts, result.facts.map((fact) => ({ tool: fact.tool, params: fact.params })));
      expect(check.ok, draft).toBe(false);
      expect(check.problems.every((problem) => problem.startsWith("unverified number"))).toBe(true);
    }
  });

  it("declines questions about people at team level, however they are put, in the contract's words", () => {
    for (const question of [
      "Who is the slowest developer?",
      "who closes the most tickets",
      "Which developers log the least time?",
      "show me each person's cycle time",
      "Who worked on DEMO-1?",
      "Who has the most open breaches?",
      "What are @Carmen Ruiz's open findings?",
      "What are carmen ruiz's open findings?",
      "Is Élif Aydın over her estimates?",
      // A member who holds no ticket is someone too: the board's figures would read as theirs.
      "How many open breaches does Noor Haddad have?",
      "how many tickets does tomas ferreira have",
    ]) {
      const response = askSample(dataset, question, 0);
      expect(response.outcome, question).toBe("not_understood");
      expect(response.message, question).toBe(ASK_DECLINES.teamLevel);
      expect([response.facts, response.plan, response.people], question).toEqual([[], [], []]);
    }
    // Team level is the default: a question is answered about people only when the route says so.
    expect(askSample(dataset, "Who has the most open breaches?", 0, { level: "team", mentions: [] }).message).toBe(ASK_DECLINES.teamLevel);
  });

  it("names no one at team level, in any answer", () => {
    for (const question of SUGGESTED_QUESTIONS) expect(askSample(dataset, question, 0).people, question).toEqual([]);
  });

  it("forgives other wording, upper case and typos", () => {
    const tool = (question: string) => askSample(dataset, question, 0).plan[0]?.tool;
    expect(tool("where does work get stuck")).toBe("oversight_time_in_status");
    expect(tool("WHERE DO TICKETS GET STUCK MOST")).toBe("oversight_time_in_status");
    expect(tool("where do tikets get stuk the most?")).toBe("oversight_time_in_status");
    expect(tool("Where are the hot spots?")).toBe("oversight_hot_spots");
    expect(tool("which tickets skipped in progress")).toBe("oversight_list_findings");
    expect(tool("Is effort running over the estimates?")).toBe("oversight_trend");
    expect(tool("what can't jira measure")).toBe("oversight_rule_status");
    expect(tool("tell me about demo-12")).toBe("oversight_issue_timeline");
  });

  it("declines a question longer than a question can be", () => {
    const response = askSample(dataset, "x".repeat(ASK_MAX_LENGTH + 1), 0);
    expect(response.outcome).toBe("not_understood");
    expect(response.message).toMatch(/500 characters/);
  });

  it("reports the latency it was given and dates the answer by the sample clock", () => {
    const response = askSample(dataset, "Where do tickets get stuck most?", 900);
    expect(response.latency_ms).toBe(900);
    expect(response.asked_at).toBe("2026-11-04T14:30:00.000Z");
    expect(response.qa_id).toMatch(/^[0-9a-f]{32}$/);
    expect(askSample(dataset, "Where do tickets get stuck most?", 0).qa_id).toBe(response.qa_id);
  });
});

describe("the weekly briefing", () => {
  for (const at of ["2026-11-04T14:30:00Z", "2026-11-09T09:00:00Z", "2027-01-15T12:00:00Z"]) {
    it(`quotes only its candidates' figures and keys (${at})`, () => {
      const { insights, text, facts } = briefing(buildDataset(Date.parse(at)));
      expect(insights.verified).toBe(true);
      expect(verify(text, facts, null).problems).toEqual([]);
      expect(text.split(/\s+/).length).toBeLessThanOrEqual(200);
      expect(insights.sentences.length).toBeGreaterThan(0);
      expect(insights.sentences.length).toBeLessThanOrEqual(5);
      const ids = new Set(insights.candidates.map((candidate) => candidate.id));
      for (const sentence of insights.sentences) {
        expect(sentence.candidate_ids.length).toBeGreaterThan(0);
        for (const id of sentence.candidate_ids) expect(ids.has(id)).toBe(true);
        for (const key of sentence.text.replace(/\b[RW]-[A-Z]+-\d{2}\b/g, "").match(KEY) ?? []) {
          expect(sentence.issue_keys).toContain(key);
        }
      }
    });
  }
});

describe("Ask in sample mode, at people level (an admin, or sign-in off)", () => {
  const dataset = buildDataset(NOW);
  const CARMEN = personIdFor("acc-03");
  const ADA = personIdFor("acc-01");
  const HANA = personIdFor("acc-08");
  const at = (question: string, mentions: string[] = []): AskResponse => {
    const options: AskOptions = { level: "people", mentions };
    const response = askSample(dataset, question, 0, options);
    expect(askResponseSchema.parse(response)).toEqual(response);
    return response;
  };
  const person = (id: string) => boardPeople(dataset).find((candidate) => candidate.id === id)!;
  const rows = peopleView(dataset).people.filter((row) => row.person !== null);

  it("names who has the most open breaches, from the people view, and lists the people it names in order", () => {
    const response = at("Who has the most open breaches?");
    expect(response.outcome).toBe("answered");
    expectPrincipleThree(response);
    const [lead, second, third] = rows;
    const nobody = peopleView(dataset).people.find((row) => row.person === null)!;
    // The work nobody holds after the ranking, never in it (JO-12, G5).
    expect(response.answer).toBe(
      `${lead.person!.name} has the most open breaches, ${lead.open_breaches}, with ${lead.open_warnings} open warnings on ${lead.tickets_with_findings} tickets with findings. ` +
        `Next come ${second.person!.name} with ${second.open_breaches} and ${third.person!.name} with ${third.open_breaches}. ` +
        `Unassigned: ${nobody.open_breaches} open breaches. Findings follow the ticket's current assignee.`,
    );
    expect(response.people).toEqual([lead.person, second.person, third.person]);
    const [facts] = response.facts;
    expect(facts.tool).toBe("oversight_query");
    expect(facts.columns.map((column) => column.key)).toEqual(["person_id", "name", "tickets", "open_tickets", "open_breaches", "open_warnings", "tickets_with_findings"]);
    expect(String(facts.params.sql)).toMatch(/^SELECT .* FROM people WHERE person_id IS NOT NULL ORDER BY open_breaches DESC/);
  });

  it("ranks by open warnings when that is what is asked", () => {
    const response = at("who has the most open warnings");
    const lead = [...rows].sort((a, b) => b.open_warnings - a.open_warnings || b.open_breaches - a.open_breaches)[0];
    expect(response.answer).toMatch(new RegExp(`^${lead.person!.name} has the most open warnings, ${lead.open_warnings},`));
    expect(response.people[0]).toEqual(lead.person);
    expectPrincipleThree(response);
  });

  it("gives one mentioned person's open findings: their counts, and the newest, all on their tickets", () => {
    const carmen = person(CARMEN);
    const row = rows.find((candidate) => candidate.person?.id === CARMEN)!;
    const response = at("What are @Carmen Ruiz's open findings?", [CARMEN]);
    expect(response.outcome).toBe("answered");
    expectPrincipleThree(response);
    expect(response.answer).toMatch(
      new RegExp(`^Carmen Ruiz has ${row.open_breaches} open breaches and ${row.open_warnings} open warnings, on ${row.tickets_with_findings} tickets\\. The newest are on DEMO-\\d+`),
    );
    expect(response.people).toEqual([carmen]);
    const [, list] = response.facts;
    // Exactly the findings the Findings page lists for her, newest first.
    const page = findingsPage(dataset, normalizeFindingsQuery({ person: [CARMEN], state: "open", page_size: 20 }));
    expect(list.rows.map((item) => item.finding_id)).toEqual(page.items.map((item) => item.finding_id));
    expect(list.truncated).toBe(page.total > 20);
    expect(String(list.params.sql)).toContain(`assignee_id = '${CARMEN}' AND state = 'open'`);
  });

  it("narrows one person's findings to breaches or warnings", () => {
    const row = rows.find((candidate) => candidate.person?.id === ADA)!;
    const breaches = at("@Ada Brooks's open breaches", [ADA]);
    expect(breaches.answer).toMatch(new RegExp(`^Ada Brooks has ${row.open_breaches} open breaches\\.`));
    expect(breaches.facts[1].rows.every((item) => item.severity === "breach")).toBe(true);
    const warnings = at("@Ada Brooks's open warnings", [ADA]);
    expect(warnings.answer).toMatch(new RegExp(`^Ada Brooks has ${row.open_warnings} open warnings\\.`));
    expect(warnings.facts[1].rows.every((item) => item.severity === "warning")).toBe(true);
    for (const response of [breaches, warnings]) expectPrincipleThree(response);
  });

  it("says what one mentioned person is working on: their tickets in progress", () => {
    const response = at("What is @Hana Mori working on?", [HANA]);
    expect(response.outcome).toBe("answered");
    expectPrincipleThree(response);
    const [facts] = response.facts;
    const expected = dataset.world.issues.filter(
      (issue) => issue.status === "In Progress" && issue.type !== "Epic" && issue.assigneeAccountId === "acc-08",
    );
    expect(facts.rows.map((row) => row.issue_key).sort()).toEqual(expected.map((issue) => issue.key).sort());
    expect(response.answer).toMatch(/^Hana Mori has (no tickets in progress\.|\d+ tickets? in progress)/);
    expect(response.people).toEqual([person(HANA)]);
  });

  it("sets several mentioned people side by side, most open breaches first", () => {
    const response = at("Open breaches and warnings for @Ada Brooks and @Carmen Ruiz", [ADA, CARMEN]);
    expect(response.outcome).toBe("answered");
    expectPrincipleThree(response);
    expect(response.people.map((named) => named.id)).toEqual([CARMEN, ADA]);
    expect(response.answer).toMatch(/^Carmen Ruiz has \d+ open breaches and \d+ open warnings; Ada Brooks has \d+ and \d+\. /);
  });

  /** Insults and character labels: an answer about people never holds one (the brief's list, checked on the answer). */
  const LABELS = /\b(lazy|laziest|lazier|useless|incompetent|careless|dishonest|insincere|stupid|idiot\w*|hopeless|worthless|pathetic|best|worst)\b/i;
  const paragraphs = (response: AskResponse) => response.answer!.split("\n\n");
  /** What DEMO cannot show: no code review in Jira. Skipped stages are measured, as the rules engine measures them (JO-12, G11). */
  const NOT_MEASURABLE = "Not measurable on this board: Code review recorded.";
  /** The code-built summary of one person's scorecard, as the contract writes it, from the sample's own figures. */
  const summaryOf = (id: string, days: ScorecardDays = 90, unmeasured = true): string => {
    const set = scorecards(dataset, days);
    const row = set.byId.get(id)!;
    const join = (labels: string[]) => (labels.length > 1 ? `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}` : labels[0]);
    const by = (mark: string | null) => set.measures.filter((measure) => measure.measurable && row.values[measure.key].vs_board === mark).map((measure) => measure.label);
    const tooFew = set.measures.filter((measure) => measure.measurable && measure.kind !== "count" && row.values[measure.key].vs_board === null).map((measure) => measure.label);
    const clauses = [
      by("closer").length ? `closer to the process on ${join(by("closer"))}` : null,
      by("further").length ? `further from it on ${join(by("further"))}` : null,
      by("level").length ? `level on ${join(by("level"))}` : null,
    ].filter(Boolean);
    const head = `${row.person.name}, last ${days} days, next to the board`;
    return (
      (clauses.length ? `${head}: ${clauses.join("; ")}.` : `${head}.`) +
      (tooFew.length ? ` Too few tickets to compare: ${join(tooFew)}.` : "") +
      (unmeasured ? ` ${NOT_MEASURABLE}` : "")
    );
  };

  it("answers a question that evaluates someone with their scorecard, built to the letter, never a refusal", () => {
    const carmen = person(CARMEN);
    for (const [question, mentions] of [
      ["Is @Carmen Ruiz doing well?", [CARMEN]],
      ["How is @Carmen Ruiz doing overall?", [CARMEN]],
      ["Does @Carmen Ruiz follow the agile process?", [CARMEN]],
      ["How productive is @Carmen Ruiz?", [CARMEN]],
      ["Rate @Carmen Ruiz's performance", [CARMEN]],
      ["Is @Carmen Ruiz sincere about the process?", [CARMEN]],
      ["Is @Carmen Ruiz doing badly?", [CARMEN]],
    ] as [string, string[]][]) {
      const response = at(question, mentions);
      expect(response.outcome, question).toBe("answered");
      expect(response.plan, question).toEqual([{ tool: "oversight_person_scorecard", params: { project: "DEMO", person_ids: [CARMEN], days: 90 } }]);
      expect(paragraphs(response), question).toEqual([summaryOf(CARMEN), scorecardCaveat(90, false)]);
      expect(response.people).toEqual([carmen]);
      expect(response.answer).not.toMatch(LABELS);
      expectPrincipleThree(response);
    }
    // The caveat names what the board does not record: here, code review.
    expect(scorecardCaveat(90, false)).toBe(
      "Figures from Jira over the last 90 days, next to the whole board, by each ticket's current assignee. Code review isn't recorded on this board, so reviewers' work doesn't show.",
    );
    expect(scorecardCaveat(30, true)).toBe("Figures from Jira over the last 30 days, next to the whole board, by each ticket's current assignee.");
    // The period a question names is the period read.
    const month = at("Is @Carmen Ruiz doing well over the last 30 days?", [CARMEN]);
    expect(month.plan[0].params.days).toBe(30);
    expect(paragraphs(month)).toEqual([summaryOf(CARMEN, 30), scorecardCaveat(30, false)]);
    expectPrincipleThree(month);
  });

  it("answers a personnel question with the figures, then leaves the decision to the admin", () => {
    for (const [question, mentions] of [
      ["Should we fire @Ada Brooks?", [ADA]],
      ["Is @Ada Brooks lazy?", [ADA]],
      ["Does @Ada Brooks deserve a promotion?", [ADA]],
      ["Can we trust @Ada Brooks with the release?", [ADA]],
      ["Is @Ada Brooks to blame for the overruns?", [ADA]],
      ["What is @Ada Brooks's attitude like?", [ADA]],
      ["How competent is @Ada Brooks?", [ADA]],
      ["Does @Ada Brooks have the skills?", [ADA]],
      ["Is @Ada Brooks reliable?", [ADA]],
      ["Should @Ada Brooks get a reward?", [ADA]],
      ["Should we sack @Ada Brooks?", [ADA]],
    ] as [string, string[]][]) {
      const response = at(question, mentions);
      expect(response.outcome, question).toBe("answered");
      expect(paragraphs(response), question).toEqual([summaryOf(ADA), SCORECARD_SENTENCES.decision, scorecardCaveat(90, false)]);
      expect(response.answer).not.toMatch(LABELS);
      expectPrincipleThree(response);
    }
    // With no one named: everyone in order, then the same sentence.
    const who = at("Who deserves a promotion?");
    expect(who.plan[0].tool).toBe("oversight_people_compare");
    expect(paragraphs(who).slice(-2)).toEqual([SCORECARD_SENTENCES.decision, scorecardCaveat(90, false)]);
    expectPrincipleThree(who);
  });

  it("sets several people's scorecards side by side, unless an organisation has turned comparison off", () => {
    const response = at("How are @Ada Brooks and @Carmen Ruiz doing?", [ADA, CARMEN]);
    expect(response.outcome).toBe("answered");
    expect(response.plan).toEqual([{ tool: "oversight_person_scorecard", params: { project: "DEMO", person_ids: [ADA, CARMEN], days: 90 } }]);
    expect(paragraphs(response)).toEqual([summaryOf(ADA, 90, false), summaryOf(CARMEN, 90, false), NOT_MEASURABLE, scorecardCaveat(90, false)]);
    expect(response.people.map((named) => named.id)).toEqual([ADA, CARMEN]);
    expectPrincipleThree(response);
    const off = askSample(dataset, "How are @Ada Brooks and @Carmen Ruiz doing?", 0, { level: "people", mentions: [ADA, CARMEN], comparison: "off" });
    expect([off.outcome, off.message, off.facts, off.plan, off.people]).toEqual(["not_understood", SCORECARD_SENTENCES.comparisonOff, [], [], []]);
    // One person's scorecard is always there, comparison or not.
    const one = askSample(dataset, "Is @Ada Brooks doing well?", 0, { level: "people", mentions: [ADA], comparison: "off" });
    expect(one.outcome).toBe("answered");
    // Raw counts side by side stay as they were (JO-09), comparison or not.
    const counts = askSample(dataset, "Open breaches for @Ada Brooks and @Carmen Ruiz", 0, { level: "people", mentions: [ADA, CARMEN], comparison: "off" });
    expect(counts.plan[0].tool).toBe("oversight_query");
    // "Compare", "versus", "side by side" set their scorecards side by side (the JO-11 review: they gave raw counts),
    // and a count named keeps the raw counts, as the service reads them.
    for (const question of ["How do @Ada Brooks and @Carmen Ruiz compare?", "@Ada Brooks vs @Carmen Ruiz", "Compare @Ada Brooks and @Carmen Ruiz side by side"]) {
      expect(at(question, [ADA, CARMEN]).plan[0].tool, question).toBe("oversight_person_scorecard");
      const refused = askSample(dataset, question, 0, { level: "people", mentions: [ADA, CARMEN], comparison: "off" });
      expect(refused.message, question).toBe(SCORECARD_SENTENCES.comparisonOff);
    }
    expect(at("Compare @Ada Brooks and @Carmen Ruiz by open breaches", [ADA, CARMEN]).plan[0].tool).toBe("oversight_query");
  });

  it("orders everyone by how closely they follow the process when no one is named, never calling anyone best", () => {
    const set = scorecards(dataset, 90);
    // The slowest and the worst ask about the other side of the process: further from it first, the fewest measures
    // closer (the JO-14 review), and the answer still never says worst.
    const further = new Set(["Who is the slowest developer?", "Which user is the worst?"]);
    for (const question of ["Who is best on the board? Rank the others", "Who is the slowest developer?", "Who follows the process most closely?", "Rank everyone", "Which user is the worst?"]) {
      const response = at(question);
      const order = further.has(question) ? "fewest" : "closer";
      expect(response.outcome, question).toBe("answered");
      // n only for a question's "top N", as the service plans it (the JO-11 check: "up to 50" in the sample alone).
      // The plan carries the order (JO-14): with no direction word, closer to the process first.
      expect(response.plan, question).toEqual([{ tool: "oversight_people_compare", params: { project: "DEMO", measure: "overall", days: 90, order } }]);
      const [facts] = response.facts;
      const people = facts.rows.filter((row) => row.person_id !== null);
      expect(people).toHaveLength(set.holders.length);
      // Most measures closer to the process than the board first; ties by open findings per 10 open tickets.
      const closer = people.filter((row) => Number(row.compared) > 0).map((row) => Number(row.closer));
      expect(closer).toEqual([...closer].sort((a, b) => (order === "fewest" ? a - b : b - a)));
      // The overall order compares each person with the board measure by measure: no board row of its own.
      expect(facts.rows.every((row) => row.person_id !== null)).toBe(true);
      expect(paragraphs(response)[0]).toMatch(new RegExp(String.raw`^Measures closer to the process than the board, last 90 days, ${order === "fewest" ? "fewest" : "most"} first: [^.]+ \d+ of \d+`));
      expect(response.answer).not.toMatch(LABELS);
      expect(response.people.map((named) => named.name)).toEqual(people.map((row) => row.name));
      expectPrincipleThree(response);
      const off = askSample(dataset, question, 0, { level: "people", mentions: [], comparison: "off" });
      expect([off.outcome, off.message]).toEqual(["not_understood", SCORECARD_SENTENCES.comparisonOff]);
    }
    // A measure the question names is the order: closer first, too few tickets last and said so. A ranking by the
    // raw count ("rank everyone by open findings") is the people view's (JO-09), as the service has it.
    expect(at("Rank everyone by open findings").plan[0].tool).toBe("oversight_query");
    const findings = at("Who is best on open findings?");
    expect(findings.plan[0].params.measure).toBe("open_findings_per_10");
    const ordered = findings.facts[0].rows.filter((row) => row.person_id !== null);
    const enough = ordered.filter((row) => row.enough === true).map((row) => Number(row.value));
    expect(enough).toEqual([...enough].sort((a, b) => a - b));
    expect(ordered.findIndex((row) => row.enough !== true)).toBeGreaterThanOrEqual(enough.length);
    // A figure of now: no period beside it (the JO-12 review), as the service says it.
    expect(findings.answer).toMatch(/^Open findings per 10 open tickets, closest to the process first: .+\. The whole board: \d+\.\d\. Too few tickets to compare: .+\.\n\n/);
    expect(findings.facts[0].rows.at(-1)).toMatchObject({ person_id: null, name: "Whole board" });
    expectPrincipleThree(findings);
    // Who holds the most of a raw count is still the people view's ranking (JO-09).
    expect(at("Who has the most open breaches?").plan[0].tool).toBe("oversight_query");
  });

  it("gives one person's backlog: their open tickets now", () => {
    const response = at("What is @Carmen Ruiz's backlog?", [CARMEN]);
    expect(response.outcome).toBe("answered");
    expect(response.plan).toEqual([{ tool: "oversight_person_tickets", params: { project: "DEMO", person: CARMEN, state: "open", n: 200 } }]);
    // Epics left out, as the scorecard's Open tickets leaves them out: the figure and the list its link opens agree.
    const expected = dataset.world.issues.filter((issue) => issue.status !== "Done" && issue.type !== "Epic" && issue.assigneeAccountId === "acc-03");
    expect(expected.length).toBe(scorecards(dataset, 90).byId.get(CARMEN)!.values.open_tickets.value);
    expect(response.facts[0].rows.map((row) => row.issue_key).sort()).toEqual(expected.map((issue) => issue.key).sort());
    expect(response.answer).toMatch(new RegExp(`^Carmen Ruiz has ${expected.length} open tickets`));
    expectPrincipleThree(response);
    for (const question of ["What does @Carmen Ruiz have to do?", "@Carmen Ruiz's open work"]) {
      expect(at(question, [CARMEN]).plan[0].tool, question).toBe("oversight_person_tickets");
    }
  });

  it("reads a name typed in full as that person, and asks for @ only when two people share it", () => {
    const typed = at("Is ada brooks doing well?");
    expect(typed.plan).toEqual([{ tool: "oversight_person_scorecard", params: { project: "DEMO", person_ids: [ADA], days: 90 } }]);
    expect(at("What are Carmen Ruiz's open findings?").plan[1]?.params.sql).toContain(`assignee_id = '${CARMEN}'`);
    // Accents folded: a member with no tickets, typed without hers, gets the sentence.
    const member = at("how many tickets does tomas ferreira have");
    expect([member.outcome, member.answer]).toEqual(["no_data", "Tomás Ferreira has no tickets on this board."]);
    // Two people on a board with one name: the admin picks with @.
    const twin = { id: "p0000000000aa", name: "Ada Brooks", avatar: null };
    const board = [...directoryPeople(dataset), twin];
    expect(typedPeople("Is Ada Brooks doing well?", board)).toEqual({ people: [], ambiguous: ["Ada Brooks"], ambiguousFirst: null });
    expect(typedPeople("Is Carmen Ruiz doing well?", board).people.map((found) => found.id)).toEqual([CARMEN]);
    expect(ambiguousNameMessage(["Ada Brooks"])).toBe("More than one person on this board is called Ada Brooks. Type @ and pick the one you mean.");
    expect(ambiguousNameMessage(["Ada Brooks", "Sam Lee"])).toBe("More than one person on this board is called Ada Brooks or Sam Lee. Type @ and pick the one you mean.");
    // Team level never reads names: still declined.
    expect(askSample(dataset, "Is Ada Brooks doing well?", 0).message).toBe(ASK_DECLINES.teamLevel);
  });

  it("says, before looking anything up, when someone mentioned has no tickets on the board", () => {
    for (const mentions of [["p000000000000"], [CARMEN, "p000000000000"]]) {
      const response = at("What is @Someone working on?", mentions);
      expect([response.outcome, response.message, response.plan, response.facts, response.people]).toEqual([
        "not_understood",
        ASK_DECLINES.unknownMention,
        [],
        [],
        [],
      ]);
    }
  });

  it("answers a question about people no figure answers per person with the overall comparison, or points to what it can where comparing is off", () => {
    for (const question of ["Show cycle time per person", "Who writes the most comments?"]) {
      // Never turned away (JO-12, G3/G4): the overall comparison, said so first.
      const answered = at(question);
      expect([answered.outcome, answered.plan[0].params.measure], question).toEqual(["answered", "overall"]);
      expect(paragraphs(answered)[0]).toBe("This answer uses the overall comparison: the number of measures on which each person is closer to the process than the whole board.");
      expectPrincipleThree(answered);
      const response = askSample(dataset, question, 0, { level: "people", mentions: [], comparison: "off" });
      expect(response.outcome, question).toBe("not_understood");
      expect(response.message, question).toBe(PEOPLE_HELP_MESSAGE);
      expect(response.suggestions).toContain("Who has the most open breaches?");
    }
    // It never says the Jira data cannot answer (the JO-11 review).
    expect(PEOPLE_HELP_MESSAGE).not.toMatch(/Jira data/);
  });

  it("still answers about the work, naming no one", () => {
    for (const question of SUGGESTED_QUESTIONS) {
      const response = at(question);
      expect(response.people, question).toEqual([]);
      if (response.outcome === "answered") expectPrincipleThree(response);
    }
  });

  it("holds to principle 3 on other days too", () => {
    for (const day of ["2026-11-09T09:00:00Z", "2027-01-15T12:00:00Z", "2026-07-01T08:00:00Z"]) {
      const other = buildDataset(Date.parse(day));
      for (const [question, mentions] of [
        ["Who has the most open breaches?", []],
        ["Who has the most open warnings?", []],
        ["What are @Carmen Ruiz's open findings?", [CARMEN]],
        ["What is @Carmen Ruiz working on?", [CARMEN]],
      ] as [string, string[]][]) {
        const response = askSample(other, question, 0, { level: "people", mentions });
        expect(response.outcome, `${day} ${question}`).toBe("answered");
        expectPrincipleThree(response);
      }
    }
  });

  it("shows an answer only when everyone it names is in its facts or among the mentions", () => {
    const board = boardPeople(dataset);
    const [facts] = at("Who has the most open breaches?").facts;
    const named = String(facts.rows[0].name);
    const outsider = board.find((candidate) => !facts.rows.some((row) => row.name === candidate.name))!;
    expect(verifiedPeople(`${named} leads.`, [facts], [], board)?.map((found) => found.name)).toEqual([named]);
    expect(verifiedPeople(`${named} leads, ahead of ${outsider.name}.`, [facts], [], board)).toBeNull();
    expect(verifiedPeople(`${outsider.name} leads.`, [facts], [outsider], board)?.map((found) => found.name)).toEqual([outsider.name]);
    // Whole words only: a name inside a longer word is no one.
    expect(verifiedPeople(`${named}son leads.`, [facts], [], board)).toEqual([]);
  });

  it("says in code, to the letter, that a member mentioned holds no tickets, with no model and nothing looked up", () => {
    const NOOR = personIdFor("acc-09");
    const TOMAS = personIdFor("acc-10");
    const YUKI = personIdFor("acc-11");
    for (const [mentions, sentence] of [
      [[NOOR], "Noor Haddad has no tickets on this board."],
      [[TOMAS, NOOR], "Tomás Ferreira and Noor Haddad have no tickets on this board."],
      [[YUKI, NOOR, TOMAS], "Yuki Tanabe, Noor Haddad and Tomás Ferreira have no tickets on this board."],
    ] as [string[], string][]) {
      // Even a judgement: the people asked about hold nothing to judge, and the sentence is a fact.
      for (const question of ["What is @them working on?", "Is @them lazy?"]) {
        const response = at(question, mentions);
        expect([response.outcome, response.answer, response.facts, response.plan, response.citations, response.model]).toEqual(["no_data", sentence, [], [], [], null]);
        expect(response.people.map((found) => found.id)).toEqual(mentions);
      }
    }
    // Mixed: the question is answered about the person who holds tickets, and the member gets the last paragraph.
    const mixed = at("What is @Carmen Ruiz and @Noor Haddad working on?", [NOOR, CARMEN]);
    expect(mixed.outcome).toBe("answered");
    expectPrincipleThree(mixed);
    const paragraphs = mixed.answer!.split("\n\n");
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]).toMatch(/^Carmen Ruiz has /);
    expect(paragraphs[1]).toBe("Noor Haddad has no tickets on this board.");
    // In the order the answer names them, not the order mentioned.
    expect(mixed.people.map((found) => found.id)).toEqual([CARMEN, NOOR]);
    expect(mixed.facts.flatMap((fact) => fact.rows.map((row) => row.name ?? null)).filter(Boolean)).not.toContain("Noor Haddad");
    // Team level is as it was: any mention is declined, whoever it names.
    expect(askSample(dataset, "What is @Noor Haddad working on?", 0, { level: "team", mentions: [NOOR] }).message).toBe(ASK_DECLINES.teamLevel);
  });

  it("gives the same question about other people its own reference", () => {
    expect(at("What is @Carmen Ruiz working on?", [CARMEN]).qa_id).not.toBe(at("What is @Carmen Ruiz working on?", [ADA]).qa_id);
    expect(at("Where do tickets get stuck most?").qa_id).toBe(askSample(dataset, "Where do tickets get stuck most?", 0).qa_id);
  });
});
