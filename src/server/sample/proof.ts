import type { ProofQuery } from "@/lib/api/params";
import {
  PROOF_AT,
  STAGES,
  TICKETS_MEASURE,
  type ApiErrorCode,
  type FindingIgnore,
  type PeopleProof,
  type ProofCredit,
  type ProofDetail,
  type ProofMeasure,
  type ProofMeasureKey,
  type ProofTicket,
  type ScorecardValue,
} from "@/lib/api/schemas";

import { effortThreshold, estimateGraceHours } from "./board-rules";
import { HOURS_PER_POINT, STATUS, isWork } from "./catalogue";
import { creditsOf, type Credit } from "./credit";
import { stageWords } from "./custom-rules";
import { meta, type Dataset } from "./dataset";
import type { IgnoreInfo } from "./ignores";
import { hasOpenOrResolved, openFindingsOf, rowSets, rowTickets, scorecards } from "./scorecard";
import { round4 } from "./stats";
import { personById } from "./team";
import { HOUR, iso } from "./time";
import type { Issue } from "./world";

export type ProofAnswer = { found: true; body: PeopleProof } | { found: false; status: 404 | 409; error: ApiErrorCode; message: string };

export const PROOF_NOT_ON_BOARD = "This person is not on this board.";
export const PROOF_NOT_MEASURABLE = "This board can't show that figure, so there are no tickets behind it.";

const NOBODY: ProofCredit = { person: null, basis: null, field: null };

const keyNumber = (key: string) => Number(key.slice(key.lastIndexOf("-") + 1));

/** Counted first, then the newest `at` first (none last), then by key: the contract's order. */
function inOrder(a: ProofTicket, b: ProofTicket): number {
  const at = (ticket: ProofTicket) => (ticket.at === null ? Number.NEGATIVE_INFINITY : Date.parse(ticket.at));
  return Number(b.counted) - Number(a.counted) || at(b) - at(a) || keyNumber(a.key) - keyNumber(b.key);
}

function ignoreOf(info: IgnoreInfo): FindingIgnore {
  return { scope: info.scope, rule_id: info.ruleId, reason: info.reason, by: info.by, at: iso(info.at) };
}

function creditOf(personId: string, basis: Credit["basis"], field: string | null): ProofCredit {
  const person = personById(personId);
  return person ? { person, basis, field: basis === "field" ? field : null } : NOBODY;
}

/** The measure's detail on a ticket: what it read off the ticket, raw, for the page to say in words. */
function detailOf(dataset: Dataset, key: ProofMeasureKey, issue: Issue, counted: boolean): ProofDetail | null {
  switch (key) {
    case "estimated_before_start":
      return {
        started_at: iso(issue.startedAt!),
        estimate_set_at: issue.estimateSetAt === null ? null : iso(issue.estimateSetAt),
        grace_hours: estimateGraceHours(dataset.rules),
      };
    case "time_logged":
      return { time_spent_s: issue.timeSpentS, subtask_time_spent_s: Math.max(0, issue.aggregateTimeSpentS - issue.timeSpentS) };
    case "within_estimate":
      return {
        logged_s: issue.timeSpentS,
        estimate_s: issue.storyPoints !== null && issue.storyPoints > 0 ? Math.round(issue.storyPoints * HOURS_PER_POINT * 3600) : null,
        ratio: round4(issue.effortRatio ?? 0),
        limit: effortThreshold(dataset.rules),
      };
    case "stuck_now": {
      const interval = issue.intervals.findLast((candidate) => candidate.leftAt === null) ?? null;
      const stuck = counted ? openFindingsOf(dataset, issue).find((finding) => finding.rule.id === "W-AGE-01") : undefined;
      return {
        status: issue.status,
        since: interval ? iso(interval.enteredAt) : null,
        hours: interval ? round4(Math.max(0, dataset.world.syncAt - interval.enteredAt) / HOUR) : null,
        threshold: stuck?.threshold ?? null,
      };
    }
    case "reopened":
      return { times: issue.reopenCount };
    case "skipped_stage": {
      const skipped = new Set(issue.skips.flatMap((skip) => skip.skipped));
      return { stages: STAGES.filter((stage) => skipped.has(stage)).map(stageWords) };
    }
    case "code_review":
      return { breach: hasOpenOrResolved(dataset, issue, "R-FLOW-01") };
    case "open_findings_per_10": {
      const open = openFindingsOf(dataset, issue);
      return { findings: open.length, rule_ids: [...new Set(open.map((finding) => finding.rule.id))].sort() };
    }
    default:
      return null;
  }
}

/** The tickets behind one figure, as GET /people/scorecard/tickets serves them: the very sets the scorecard's figures are the sizes of. */
export function proofView(dataset: Dataset, query: ProofQuery): ProofAnswer {
  const card = scorecards(dataset, query.days);
  const row = query.person === null ? null : card.byId.get(query.person);
  if (row === undefined) return { found: false, status: 404, error: "not_found", message: PROOF_NOT_ON_BOARD };
  const key = query.measure;
  const measure: ProofMeasure = key === "tickets" ? TICKETS_MEASURE : card.measures.find((candidate) => candidate.key === key)!;
  if (!measure.measurable) return { found: false, status: 409, error: "not_measurable", message: PROOF_NOT_MEASURABLE };

  const value: ScorecardValue =
    key === "tickets"
      ? { value: row ? row.tickets : card.board.tickets, numerator: null, denominator: null, enough: true, vs_board: null }
      : (row ? row.values : card.board.values)[key];
  const { period, sets } = rowSets(dataset, query.days, query.person);
  const credits = creditsOf(dataset);
  const personId = query.person;

  // For a person, their own part in the ticket; for the whole board, the first person it counts for.
  const creditFor = (issue: Issue): ProofCredit => {
    const credited = credits.get(issue.key) ?? [];
    const chosen = personId === null ? credited[0] : credited.find((credit) => credit.personId === personId);
    return chosen ? creditOf(chosen.personId, chosen.basis, chosen.field) : NOBODY;
  };
  const at = PROOF_AT[key];
  const ticketOf = (issue: Issue, counted: boolean, ignore: IgnoreInfo | null): ProofTicket => {
    const when = at === "done" ? issue.doneAt : at === "started" ? issue.startedAt : null;
    return {
      key: issue.key,
      summary: issue.summary,
      issue_type: issue.type,
      status: issue.status,
      status_category: STATUS[issue.status].category,
      counted,
      credit: creditFor(issue),
      at: when === null ? null : iso(when),
      detail: detailOf(dataset, key, issue, counted),
      ignore: ignore ? ignoreOf(ignore) : null,
      url: null,
    };
  };

  let tickets: ProofTicket[];
  let leftOut: ProofTicket[] = [];
  if (key === "tickets") {
    tickets = rowTickets(dataset, personId).filter(isWork).map((issue) => ticketOf(issue, true, null));
  } else {
    const set = sets[key];
    const counted = new Set(set.counted);
    tickets = set.all.map((issue) => ticketOf(issue, counted.has(issue), null));
    leftOut = set.leftOut.map(({ issue, ignore }) => ticketOf(issue, false, ignore));
  }
  tickets.sort(inOrder);
  leftOut.sort(inOrder);

  return {
    found: true,
    body: {
      meta: meta(dataset),
      period: { days: period.days, from: iso(period.from), to: iso(period.to) },
      measure: { ...measure, rule_ids: [...measure.rule_ids] },
      person: row ? { ...row.person } : null,
      value: { ...value },
      total: tickets.length,
      counted: tickets.filter((ticket) => ticket.counted).length,
      tickets,
      left_out: leftOut,
    },
  };
}
