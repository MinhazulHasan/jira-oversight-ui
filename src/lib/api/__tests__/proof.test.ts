import { describe, expect, it } from "vitest";

import proofJson from "../../../../docs/sample-responses/people-scorecard-tickets.json";
import { normalizeProofQuery, parseProofQuery, proofSearchParams } from "../params";
import { API_ERROR_CODES, peopleProofSchema, proofProblems, TICKETS_MEASURE, type PeopleProof } from "../schemas";

const ADA = "pbc7fe62842ca";
const proof = peopleProofSchema.parse(proofJson);
const clone = (): PeopleProof => structuredClone(proof);
const issues = (body: unknown) => {
  const parsed = peopleProofSchema.safeParse(body);
  return parsed.success ? [] : parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
};

/** A count's proof: every ticket counted, the value their number. */
function asCount(body: PeopleProof): PeopleProof {
  const tickets = body.tickets.map((ticket) => ({ ...ticket, counted: true, detail: null }));
  return {
    ...body,
    measure: { ...body.measure, key: "open_tickets", label: "Open tickets", kind: "count", direction: "neutral", rule_ids: [] },
    value: { value: tickets.length, numerator: null, denominator: null, enough: true, vs_board: null },
    total: tickets.length,
    counted: tickets.length,
    tickets,
  };
}

describe("the proof's query", () => {
  it("is checked and rebuilt: the period, a measure (or tickets), and a person; no person is the whole board", () => {
    expect(parseProofQuery(new URLSearchParams("measure=stuck_now"))).toEqual({ ok: true, value: { days: 90, measure: "stuck_now", person: null } });
    expect(parseProofQuery(new URLSearchParams(`person=${ADA}&measure=tickets&days=30`))).toEqual({ ok: true, value: { days: 30, measure: "tickets", person: ADA } });
    expect(proofSearchParams({ days: 30, measure: "tickets", person: ADA }).toString()).toBe(`days=30&measure=tickets&person=${ADA}`);
    expect(proofSearchParams({ days: 90, measure: "open_findings_per_10" }).toString()).toBe("measure=open_findings_per_10");
    expect(normalizeProofQuery({ measure: "reopened", person: null })).toEqual({ days: 90, measure: "reopened", person: null });
  });

  it("refuses anything else: no measure, another name, a name twice, a bad period, measure or person", () => {
    const refused = (search: string) => {
      const parsed = parseProofQuery(new URLSearchParams(search));
      return parsed.ok ? [] : parsed.problems.map((problem) => problem.path);
    };
    expect(refused("")).toEqual(["measure"]);
    expect(refused("measure=velocity")).toEqual(["measure"]);
    expect(refused("measure=reopened&days=45")).toEqual(["days"]);
    expect(refused("measure=reopened&measure=stuck_now")).toEqual(["measure"]);
    expect(refused("measure=reopened&person=ada")).toEqual(["person"]);
    expect(refused(`measure=reopened&person=${ADA}&person=${ADA}`)).toEqual(["person"]);
    expect(refused("measure=reopened&project=DEMO")).toEqual(["project"]);
    expect(refused("measure=reopened&level=people")).toEqual(["level"]);
  });
});

describe("the proof's body", () => {
  it("takes the documented body exactly as it is, and names the not-measurable refusal among the codes", () => {
    expect(issues(proofJson)).toEqual([]);
    expect(proof).toStrictEqual(proofJson);
    expect(API_ERROR_CODES).toContain("not_measurable");
    expect(TICKETS_MEASURE).toEqual({ key: "tickets", label: "Tickets", kind: "count", direction: "neutral", rule_ids: [], measurable: true, reason: null });
  });

  it("refuses a rate whose list does not add up to its figure", () => {
    const short = clone();
    short.tickets.pop();
    expect(issues(short)).toContain("total: not the number of tickets listed");
    const miscounted = clone();
    miscounted.tickets[miscounted.tickets.length - 1].counted = true;
    expect(issues(miscounted)).toEqual(expect.arrayContaining(["counted: not the number of tickets counted"]));
    const other = clone();
    other.value = { ...other.value, numerator: other.value.numerator! + 1, value: Math.round((100 * (other.value.numerator! + 1)) / other.value.denominator!) };
    expect(issues(other)).toContain("value: a rate is its tickets counted over all its tickets");
  });

  it("holds a count, and the ticket count, to its tickets, every one counted", () => {
    expect(issues(asCount(clone()))).toEqual([]);
    const tickets = { ...asCount(clone()), measure: TICKETS_MEASURE };
    expect(issues(tickets)).toEqual([]);
    const notCounted = asCount(clone());
    notCounted.tickets[0].counted = false;
    notCounted.counted -= 1;
    expect(issues(notCounted)).toContain("value: a count is its tickets, every one counted");
    const detailed = asCount(clone());
    detailed.tickets[0].detail = { times: 2 };
    expect(issues(detailed)).toContain("tickets.0.detail: a count has no detail");
  });

  it("holds the ratio to the open findings on its tickets, each counted exactly when it has one", () => {
    const base = clone();
    const tickets = base.tickets.map((ticket, index) => ({ ...ticket, counted: index < 2, detail: { findings: index < 2 ? index + 1 : 0, rule_ids: index < 2 ? ["W-AGE-01"] : [] } }));
    const ratio: PeopleProof = {
      ...base,
      measure: { ...base.measure, key: "open_findings_per_10", label: "Open findings per 10 open tickets", kind: "ratio", rule_ids: ["W-AGE-01"] },
      value: { value: Math.round((100 * 3) / tickets.length) / 10, numerator: 3, denominator: tickets.length, enough: true, vs_board: null },
      counted: 2,
      tickets,
    };
    expect(issues(ratio)).toEqual([]);
    const wrongSum = structuredClone(ratio);
    wrongSum.tickets[0].detail = { findings: 4, rule_ids: ["W-AGE-01"] };
    expect(issues(wrongSum)).toContain("value.numerator: not the open findings on its tickets");
    const wrongCount = structuredClone(ratio);
    wrongCount.tickets[2].counted = true;
    wrongCount.counted = 3;
    expect(issues(wrongCount)).toContain("tickets.2.counted: counted exactly when it has open findings");
  });

  it("names every ticket once, leaves out only what an ignore leaves out, and counts each for the row's person", () => {
    const twice = clone();
    twice.left_out = [{ ...twice.tickets[0], counted: false, ignore: { scope: "ticket", rule_id: null, reason: null, by: "Morgan Ellis", at: "2026-11-04T10:00:00.000Z" } }];
    expect(issues(twice)).toContain("left_out.0.key: listed twice");
    const unexplained = clone();
    unexplained.left_out = [{ ...unexplained.tickets[0], key: "DEMO-99999", counted: false, ignore: null }];
    expect(issues(unexplained)).toContain("left_out.0.ignore: left out with no ignore");
    const someoneElse = clone();
    someoneElse.tickets[0].credit = { person: { id: ADA, name: "Ada Brooks", avatar: null }, basis: "assignee_now", field: null };
    expect(issues(someoneElse)).toContain("tickets.0.credit.person: counts for someone else");
  });

  it("says why a ticket counts in one consistent way: a field's name exactly with the field, nobody with no basis", () => {
    const field = clone();
    field.tickets[0].credit = { ...field.tickets[0].credit, basis: "field", field: null };
    expect(issues(field)).toContain("tickets.0.credit.field: a field's name exactly when the basis is the field");
    const board = { ...clone(), person: null, value: { ...proof.value, vs_board: null } };
    board.tickets[0].credit = { person: null, basis: "assignee_now", field: null };
    expect(issues(board)).toContain("tickets.0.credit.basis: a basis exactly when it counts for someone");
    const compared = { ...clone(), person: null };
    expect(issues(compared)).toContain("value.vs_board: compared where nothing is compared");
  });

  it("refuses a measure the board cannot show, a detail of another measure, and a Jira link that is not https", () => {
    const hidden = clone();
    hidden.measure = { ...hidden.measure, measurable: false, reason: "Its rule is off on this board." };
    expect(issues(hidden)).toContain("measure.measurable: a figure the board cannot show has no tickets behind it");
    const detail = clone();
    detail.tickets[0].detail = { times: 1 };
    expect(issues(detail)).toContain("tickets.0.detail: not the measure's detail");
    const link = clone();
    link.tickets[0].url = "http://example.atlassian.net/browse/DEMO-1";
    expect(issues(link).some((issue) => issue.startsWith("tickets.0.url"))).toBe(true);
  });

  it("drops fields the contract does not name, from each ticket and its detail", () => {
    const extra = clone() as unknown as { secret: string; tickets: Record<string, unknown>[] };
    extra.secret = "x";
    extra.tickets[0].assignee_email = "someone@example.com";
    (extra.tickets[0].detail as Record<string, unknown>).account_id = "557058:abc";
    const parsed = peopleProofSchema.parse(extra);
    expect(JSON.stringify(parsed)).not.toMatch(/example\.com|557058|secret/);
    expect(proofProblems(peopleProofSchema.parse(proofJson) as never)).toEqual([]);
  });
});
