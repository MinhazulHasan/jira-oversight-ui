// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  peopleProofSchema,
  PROOF_MEASURE_KEYS,
  SCORECARD_DAYS,
  type PeopleProof,
  type ProofDetails,
  type ProofMeasureKey,
  type ProofTicket,
  type ScorecardDays,
} from "@/lib/api/schemas";

import { DEFAULT_BOARD } from "../sample/boards";
import { buildDataset, CATALOGUE_SETTINGS, type Dataset } from "../sample/dataset";
import type { IgnoreInfo, Ignores } from "../sample/ignores";
import { proofView } from "../sample/proof";
import { scorecards } from "../sample/scorecard";
import { MEMBERS, personIdFor } from "../sample/team";

const NOW = Date.parse("2026-11-04T14:30:00Z");
const dataset = buildDataset(NOW);
const CARMEN = personIdFor("acc-03");
const NOOR = personIdFor(MEMBERS[0].accountId);

function proof(days: ScorecardDays, measure: ProofMeasureKey, person: string | null, data: Dataset = dataset): PeopleProof {
  const answer = proofView(data, { days, measure, person });
  if (!answer.found) throw new Error(answer.message);
  // The schema holds the body to every invariant of the contract: a list that does not add up never parses.
  return peopleProofSchema.parse(answer.body);
}

const keyNumber = (key: string) => Number(key.slice(key.lastIndexOf("-") + 1));

function expectContractOrder(tickets: readonly ProofTicket[]) {
  for (let index = 1; index < tickets.length; index += 1) {
    const [before, after] = [tickets[index - 1], tickets[index]];
    if (before.counted !== after.counted) {
      expect(before.counted, after.key).toBe(true);
      continue;
    }
    const at = (ticket: ProofTicket) => (ticket.at === null ? Number.NEGATIVE_INFINITY : Date.parse(ticket.at));
    expect(at(before) > at(after) || (at(before) === at(after) && keyNumber(before.key) < keyNumber(after.key)), `${before.key} before ${after.key}`).toBe(true);
  }
}

describe("the proof is the scorecard's own sets", () => {
  for (const days of SCORECARD_DAYS) {
    it(`adds up, and carries the scorecard's value to the byte, for the board and everyone on it, every figure, last ${days} days`, () => {
      const card = scorecards(dataset, days);
      const rows: (string | null)[] = [null, ...card.byId.keys()];
      expect(rows.length).toBe(12);
      for (const person of rows) {
        for (const key of PROOF_MEASURE_KEYS) {
          const measure = card.measures.find((candidate) => candidate.key === key);
          if (measure && !measure.measurable) {
            expect(proofView(dataset, { days, measure: key, person })).toMatchObject({ found: false, status: 409, error: "not_measurable" });
            continue;
          }
          const body = proof(days, key, person);
          const row = person === null ? null : card.byId.get(person)!;
          const expected =
            key === "tickets"
              ? { value: row ? row.tickets : card.board.tickets, numerator: null, denominator: null, enough: true, vs_board: null }
              : (row ? row.values : card.board.values)[key];
          expect(body.value, `${person ?? "board"} ${key}`).toEqual(expected);
          expect(body.period).toEqual({ days, from: new Date(card.period.from).toISOString(), to: new Date(card.period.to).toISOString() });
          expect(body.person?.id ?? null).toBe(person);
          expect(body.left_out).toEqual([]);
          expectContractOrder(body.tickets);
        }
      }
    });
  }

  it("lists a person's tickets as the count under their name says, each counted, and the board's every work ticket", () => {
    const card = scorecards(dataset, 90);
    const carmen = proof(90, "tickets", CARMEN);
    expect(carmen.total).toBe(card.byId.get(CARMEN)!.tickets);
    expect(carmen.tickets.every((ticket) => ticket.counted && ticket.credit.person?.id === CARMEN)).toBe(true);
    const board = proof(90, "tickets", null);
    expect(board.total).toBe(1136);
    expect(new Set(board.tickets.map((ticket) => ticket.key)).size).toBe(1136);
    // On DEMO, who holds a ticket now is who it counts for; the work nobody holds counts for nobody.
    expect(board.tickets.filter((ticket) => ticket.credit.person === null).every((ticket) => ticket.credit.basis === null)).toBe(true);
  });

  it("gives a member who holds no tickets nothing behind any figure, never a zero shown as a figure", () => {
    for (const key of ["open_tickets", "stuck_now", "tickets"] as const) {
      const body = proof(90, key, NOOR);
      expect(body.total).toBe(0);
      expect(body.tickets).toEqual([]);
    }
    expect(proof(90, "stuck_now", NOOR).value.value).toBeNull();
    expect(proof(90, "tickets", NOOR).value.value).toBe(0);
  });

  it("refuses someone not on the board, and a figure the board cannot show", () => {
    expect(proofView(dataset, { days: 90, measure: "open_tickets", person: "p000000000000" })).toMatchObject({ found: false, status: 404, error: "not_found" });
    expect(proofView(dataset, { days: 90, measure: "code_review", person: null })).toMatchObject({ found: false, status: 409, error: "not_measurable" });
  });

  it("says each measure's detail as it read it off the ticket", () => {
    const stuck = proof(90, "stuck_now", null);
    expect(stuck.counted).toBeGreaterThan(0);
    for (const ticket of stuck.tickets) {
      const detail = ticket.detail as ProofDetails["stuck_now"];
      expect(detail.status).toBe(ticket.status);
      expect(detail.since).not.toBeNull();
      expect(detail.hours).toBeGreaterThan(0);
      if (ticket.counted) expect(detail.threshold).toMatch(/^p\d+ of (To Do|In Progress): [\d.]+ h$/);
      else expect(detail.threshold).toBeNull();
    }
    for (const ticket of proof(180, "reopened", null).tickets) expect(ticket.counted).toBe((ticket.detail as ProofDetails["reopened"]).times > 0);
    for (const ticket of proof(180, "skipped_stage", null).tickets) {
      const { stages } = ticket.detail as ProofDetails["skipped_stage"];
      expect(ticket.counted).toBe(stages.length > 0);
      for (const stage of stages) expect(["Backlog", "Estimate", "Development", "Code review", "Dev sign-off", "Testing", "Test review", "Test sign-off", "Done"]).toContain(stage);
    }
    for (const ticket of proof(90, "time_logged", null).tickets) {
      const detail = ticket.detail as ProofDetails["time_logged"];
      expect(ticket.counted).toBe(detail.time_spent_s + detail.subtask_time_spent_s > 0);
    }
    for (const ticket of proof(90, "within_estimate", null).tickets) {
      const detail = ticket.detail as ProofDetails["within_estimate"];
      expect(ticket.counted).toBe(detail.ratio < detail.limit);
      expect(detail.estimate_s).toBeGreaterThan(0);
    }
    for (const ticket of proof(90, "estimated_before_start", null).tickets) {
      const detail = ticket.detail as ProofDetails["estimated_before_start"];
      const inTime = detail.estimate_set_at !== null && Date.parse(detail.estimate_set_at) <= Date.parse(detail.started_at) + detail.grace_hours * 3_600_000;
      expect(ticket.counted).toBe(inTime);
      expect(ticket.at).toBe(detail.started_at);
    }
    const ratio = proof(90, "open_findings_per_10", null);
    expect(ratio.tickets.reduce((sum, ticket) => sum + (ticket.detail as ProofDetails["open_findings_per_10"]).findings, 0)).toBe(ratio.value.numerator);
  });
});

describe("ignored tickets", () => {
  /** Two of the board's stuck tickets: one ignored whole, one for W-AGE-01 alone. */
  const stuck = proof(90, "stuck_now", null).tickets.filter((ticket) => ticket.counted);
  const [whole, oneRule] = [stuck[0].key, stuck[1].key];
  const info = (key: string, ruleId: string | null): IgnoreInfo => ({
    id: `ignore-${key}`,
    scope: ruleId === null ? "ticket" : "finding",
    ruleId,
    reason: "Closed before the process change",
    by: "Morgan Ellis",
    at: NOW - 3_600_000,
  });
  const ignores: Ignores = {
    ticket: (key) => (key === whole ? info(whole, null) : null),
    covers: (key, rules) => (key === whole ? info(whole, null) : key === oneRule && [...rules].includes("W-AGE-01") ? info(oneRule, "W-AGE-01") : null),
  };
  const ignored = buildDataset(NOW, CATALOGUE_SETTINGS, DEFAULT_BOARD, ignores);

  it("leaves them out of a measure whose rules they cover, listed apart with who and why, and the figure follows", () => {
    const before = proof(90, "stuck_now", null);
    const after = proof(90, "stuck_now", null, ignored);
    expect(after.left_out.map((ticket) => ticket.key).sort()).toEqual([whole, oneRule].sort());
    for (const ticket of after.left_out) {
      expect(ticket.ignore).toMatchObject({ reason: "Closed before the process change", by: "Morgan Ellis" });
      expect(after.tickets.some((listed) => listed.key === ticket.key)).toBe(false);
    }
    expect(after.value.denominator).toBe(before.value.denominator! - 2);
    expect(after.value.numerator).toBe(before.value.numerator! - 2);
    expect(after.value).toEqual(scorecards(ignored, 90).board.values.stuck_now);
  });

  it("leaves the ratio's tickets out only for a whole ticket's ignore, and never moves a count", () => {
    const ratio = proof(90, "open_findings_per_10", null, ignored);
    expect(ratio.left_out.map((ticket) => ticket.key)).toEqual([whole]);
    expect(ratio.tickets.some((ticket) => ticket.key === oneRule)).toBe(true);
    const open = proof(90, "open_tickets", null, ignored);
    expect(open.value).toEqual(proof(90, "open_tickets", null).value);
    expect(open.left_out).toEqual([]);
    expect(open.tickets.find((ticket) => ticket.key === whole)?.ignore).toBeNull();
  });

  it("sets an ignore only on left-out rows, never on a row in the figure", () => {
    for (const measure of ["stuck_now", "open_findings_per_10", "open_tickets", "tickets"] as const) {
      const view = proof(90, measure, null, ignored);
      expect(view.tickets.every((ticket) => ticket.ignore === null)).toBe(true);
      expect(view.left_out.every((ticket) => ticket.ignore !== null)).toBe(true);
    }
  });
});
