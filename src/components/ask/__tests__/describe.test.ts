import { describe, expect, it } from "vitest";

import { ASK_DECLINES, askResponseSchema, type FactSet } from "@/lib/api/schemas";

import answeredJson from "../../../../docs/sample-responses/ask-answered.json";
import trendJson from "../../../../docs/sample-responses/ask-answered-trend.json";
import noDataJson from "../../../../docs/sample-responses/ask-no-data.json";
import notUnderstoodJson from "../../../../docs/sample-responses/ask-not-understood.json";
import notVerifiedJson from "../../../../docs/sample-responses/ask-not-verified.json";
import {
  describeParams,
  declineOf,
  indexCitations,
  missingEvidenceText,
  paramsText,
  readyDescription,
  rowLink,
  sameQuestion,
  targetKey,
  toolLabel,
} from "../describe";
import { nextQuestions, STARTERS } from "../suggestions";

const answered = askResponseSchema.parse(answeredJson);
const trend = askResponseSchema.parse(trendJson);
const noData = askResponseSchema.parse(noDataJson);
/** JO-09 judgement words, as an older service would still send them (since JO-11 the sample answers with figures). */
const judgement = { ...askResponseSchema.parse(notUnderstoodJson), message: ASK_DECLINES.judgement };
const teamLevel = { ...judgement, message: ASK_DECLINES.teamLevel };
const unknownMention = { ...judgement, message: ASK_DECLINES.unknownMention };
const comparisonOff = { ...judgement, message: ASK_DECLINES.comparisonOff };
const notVerified = askResponseSchema.parse(notVerifiedJson);

describe("the calls in words", () => {
  it("names every catalogue call plainly, and any new one from its name", () => {
    expect(toolLabel("oversight_hot_spots")).toBe("Hot spots");
    expect(toolLabel("oversight_effort_vs_estimate")).toBe("Effort against estimate");
    expect(toolLabel("oversight_list_findings")).toBe("Findings");
    expect(toolLabel("oversight_sprint_scope")).toBe("Sprint scope");
  });

  it("says the parameters the way a sentence would, ids kept exact", () => {
    expect(paramsText("oversight_hot_spots", { n: 5 })).toBe("top 5");
    expect(paramsText("oversight_trend", { metric: "median_effort_ratio", last_n: 12 })).toBe("median effort ratio · last 12 weeks");
    expect(paramsText("oversight_trend", { metric: "median_cycle_time_h", last_n: 12 })).toBe(
      "median cycle time (hours) · last 12 weeks",
    );
    expect(paramsText("oversight_effort_vs_estimate", { group_by: "epic", period: "30d" })).toBe("by epic · last 30 days");
    expect(paramsText("oversight_list_findings", noData.facts[0].params)).toBe(
      "rule R-FLOW-03 · open and resolved · last 7 days · up to 20",
    );
    expect(paramsText("oversight_top_issues", { metric: "status_age", n: 10, status_category: "indeterminate" })).toBe(
      "status age · in progress · top 10",
    );
    expect(describeParams("oversight_list_findings", { rule_id: "R-FLOW-01" })).toEqual([
      { key: "rule_id", lead: "rule", text: "R-FLOW-01", mono: true },
    ]);
    expect(paramsText("oversight_rule_status", {})).toBe("");
  });

  it("never puts the analyst's own query into words: a reader sees what was looked at, not code (SQA)", () => {
    expect(describeParams("oversight_query", { sql: "SELECT s.name FROM sprints s" })).toEqual([]);
    expect(paramsText("oversight_query", { sql: "SELECT 1", project: "DEMO" })).not.toMatch(/SELECT/);
  });

  it("says a comparison's order as it was asked for, never best or worst (JO-14)", () => {
    // Regression: the plan said "most first" for any order but fewest, so a rate asked for highest first, or closer
    // to the process first, read as a count's order.
    const compare = (measure: string, order: string) => paramsText("oversight_people_compare", { measure, days: 90, order });
    expect(compare("reopened", "most")).toBe("reopened · highest first · last 90 days");
    expect(compare("stuck_now", "fewest")).toBe("stuck now · lowest first · last 90 days");
    expect(compare("open_findings_per_10", "closer")).toBe("open findings per 10 · closer to the process first · last 90 days");
    expect(compare("overall", "closer")).toBe("every measure · closer to the process first · last 90 days");
    // A count, JO-09's ranking by one and the overall number of measures closer: most or fewest first, in the words of
    // the answer and its table's caption (the JO-14 review: "Open tickets, fewest first" over "lowest first" in one card).
    expect(paramsText("oversight_people_compare", { measure: "open_tickets", order: "most" })).toBe("open tickets · most first");
    expect(paramsText("oversight_people_compare", { measure: "open_tickets", order: "fewest" })).toBe("open tickets · fewest first");
    expect(paramsText("oversight_people_compare", { measure: "done_in_period", days: 30, order: "fewest" })).toBe("done in period · fewest first · last 30 days");
    expect(compare("overall", "fewest")).toBe("every measure · fewest first · last 90 days");
    expect(paramsText("oversight_people", { rank_by: "open_breaches", order: "fewest" })).toBe("by open breaches · fewest first");
    for (const order of ["most", "fewest", "closer"]) expect(paramsText("oversight_people_compare", { measure: "reopened", order })).not.toMatch(/best|worst/);
  });
});

describe("where a fact row leads", () => {
  const hotSpots = answered.facts[0];

  it("opens an epic's findings, an issue's page, a finding's evidence or a rule's findings", () => {
    expect(rowLink(hotSpots, hotSpots.rows[0])).toEqual({
      href: "/findings?epic=DEMO-704",
      label: "Open the findings in epic DEMO-704",
    });
    const effort = trend.facts[1];
    expect(rowLink(effort, effort.rows[6])?.href).toBe("/findings?epic=none");

    const findings: FactSet = {
      ...noData.facts[0],
      rows: [{ finding_id: "0b7b3b0f61c477e61699982f24892735", rule_id: "R-FLOW-03", issue_key: "DEMO-142", epic_key: "DEMO-4" }],
    };
    expect(rowLink(findings, findings.rows[0])?.href).toBe("/findings?finding=0b7b3b0f61c477e61699982f24892735");
    const issueOnly = { ...findings.rows[0], finding_id: null };
    expect(rowLink(findings, issueOnly)?.href).toBe("/issues/DEMO-142");

    const rules: FactSet = { ...findings, tool: "oversight_rule_status", columns: [{ key: "rule_id", label: "Rule", kind: "text" }], rows: [] };
    expect(rowLink(rules, { rule_id: "R-EST-01" })?.href).toBe("/findings?rule=R-EST-01");
  });

  it("opens a person's open findings from a row of the people view, and the unassigned tickets' from theirs", () => {
    const people: FactSet = {
      ...noData.facts[0],
      tool: "oversight_query",
      columns: [
        { key: "person_id", label: "Person id", kind: "text" },
        { key: "name", label: "Name", kind: "text" },
      ],
      rows: [],
    };
    expect(rowLink(people, { person_id: "p599114b761a6", name: "Carmen Ruiz" })).toEqual({
      href: "/findings?state=open&person=p599114b761a6",
      label: "Open the findings of Carmen Ruiz",
    });
    expect(rowLink(people, { person_id: null, name: "Unassigned" })?.href).toBe("/findings?state=open&person=unassigned");
    // Anything that is not a person id leads nowhere.
    expect(rowLink(people, { person_id: "acc-03", name: "Carmen Ruiz" })).toBeNull();
    // A finding's or an issue's row still opens the finding or the issue, whoever it is assigned to.
    const assigned: FactSet = { ...people, columns: [...people.columns, { key: "issue_key", label: "Issue", kind: "issue_key" }] };
    expect(rowLink(assigned, { person_id: "p599114b761a6", name: "Carmen Ruiz", issue_key: "DEMO-12" })?.href).toBe("/issues/DEMO-12");
  });

  it("offers nothing to open for a week of a trend", () => {
    const weeks = trend.facts[0];
    expect(rowLink(weeks, weeks.rows[0])).toBeNull();
  });
});

describe("citations", () => {
  it("tie a cell to its row, and a note or a parameter to its fact set", () => {
    expect(targetKey(answered.citations[1])).toBe("row:F1:0");
    expect(targetKey(trend.citations[5])).toBe("fact:F2:note");
  });

  it("are indexed by cell and by what they tie to, markers ascending", () => {
    const { byCell, byTarget } = indexCitations(answered.citations);
    expect(byCell.get("F1:0:open_breaches")?.map((citation) => citation.marker)).toEqual([2]);
    expect(byTarget.get("row:F1:0")?.map((citation) => citation.marker)).toEqual([1, 2, 3, 4]);
    expect(byTarget.get("row:F1:2")?.map((citation) => citation.marker)).toEqual([7, 8]);
  });
});

describe("outcomes", () => {
  it("tell the declines about people apart by the contract's exact words, and from a question not understood", () => {
    expect(declineOf(teamLevel)).toBe("team_level");
    expect(declineOf(judgement)).toBe("judgement");
    expect(declineOf(unknownMention)).toBe("unknown_mention");
    expect(declineOf(comparisonOff)).toBe("comparison_off");
    expect(ASK_DECLINES.comparisonOff).toBe("Comparing people side by side is turned off. Ask about one person at a time instead.");
    expect(declineOf({ outcome: "not_understood", message: "That question can't be answered from the Jira data." })).toBeNull();
    expect(declineOf({ outcome: "not_understood", message: `${ASK_DECLINES.teamLevel} Or ask a colleague.` })).toBeNull();
    expect(declineOf({ ...teamLevel, outcome: "no_data" })).toBeNull();
  });

  it("name the missing evidence in words", () => {
    expect(missingEvidenceText(["code_review"])).toBe("code review");
    expect(missingEvidenceText(["code_review", "dev_sign_off", "test_review"])).toBe("code review, dev sign off and test review");
  });

  it("say what the toast adds for each outcome", () => {
    // An answer is on the page: the toast says it is ready, and no more (SQA: "8 figures, each tied to its row" went).
    expect(readyDescription(answered)).toBeUndefined();
    expect(readyDescription(teamLevel)).toBe("Ask answers at team level.");
    expect(readyDescription(judgement)).toBe("Ask shows facts about people, not judgements.");
    expect(readyDescription(unknownMention)).toBe("That person has no tickets on this board.");
    expect(readyDescription(comparisonOff)).toBe("Comparing people is off. Ask about one person.");
    expect(readyDescription(notVerified)).toMatch(/Only the facts are shown/);
    expect(readyDescription(noData)).toBe("Nothing matched.");
    // People mentioned who hold no tickets: the sentence is the whole answer, so the toast says it.
    const noTickets = { ...noData, answer: "Noor Haddad has no tickets on this board.", facts: [], plan: [] };
    expect(readyDescription(noTickets)).toBe("Noor Haddad has no tickets on this board.");
  });

});

describe("questions", () => {
  it("compare as a reader would, case and spacing aside", () => {
    expect(sameQuestion("  Where do tickets   get stuck most? ", "where do tickets get stuck most?")).toBe(true);
    expect(sameQuestion("Where do tickets get stuck?", "Where do tickets get stuck most?")).toBe(false);
  });

  it("offer the service's suggestions first, never the question just asked or a repeat", () => {
    expect(nextQuestions(STARTERS[0].question)).toEqual([STARTERS[1].question, STARTERS[2].question, STARTERS[3].question]);
    expect(nextQuestions("x", ["Which tickets have been reopened after Done?", STARTERS[0].question], 3)).toEqual([
      "Which tickets have been reopened after Done?",
      STARTERS[0].question,
      STARTERS[1].question,
    ]);
  });
});
