import {
  PERSON_CARD_TICKETS,
  type PersonCard,
  type PersonCardBoard,
  type PersonCardProcess,
  type PersonCardTicket,
  type ScorecardDays,
} from "@/lib/api/schemas";

import { STATUS, isWork } from "./catalogue";
import { memo, meta, type Dataset } from "./dataset";
import { peopleView } from "./people";
import { scorecards } from "./scorecard";
import { personIdFor, personOf } from "./team";
import { iso } from "./time";
import type { Issue } from "./world";

/** The made-up boards, by the fictional account that holds open tickets there (team.ts), in the service's order. */
export const SAMPLE_OTHER_BOARDS: Readonly<Record<string, readonly PersonCardBoard[]>> = {
  // Ada Brooks holds work on both.
  "acc-01": [
    { key: "OPS", name: "Operations", open_tickets: 3 },
    { key: "WEB", name: "Web platform", open_tickets: 1 },
  ],
  // Noor Haddad, a member of DEMO who holds none of its tickets, works on OPS.
  "acc-09": [{ key: "OPS", name: "Operations", open_tickets: 2 }],
};

const OTHER_BOARDS_BY_ID: ReadonlyMap<string, readonly PersonCardBoard[]> = new Map(
  Object.entries(SAMPLE_OTHER_BOARDS).map(([accountId, boards]) => [personIdFor(accountId), boards]),
);

export const PERSON_CARD_NOT_ON_BOARD = "This person is not on this board.";

const inProgress = (status: Issue["status"]) => STATUS[status].category === "indeterminate";

export function inProgressSince(issue: Issue): number {
  const intervals = issue.intervals;
  if (intervals.length === 0) return issue.createdAt;
  let since = intervals[intervals.length - 1].enteredAt;
  for (let index = intervals.length - 2; index >= 0 && inProgress(intervals[index].status); index -= 1) {
    since = intervals[index].enteredAt;
  }
  return since;
}

/** Their work on the board now (Epics left out, as every count of a person's tickets leaves them out). */
function ticketsOf(dataset: Dataset, personId: string): Issue[] {
  const byPerson = memo(dataset, "person-card:tickets", () => {
    const map = new Map<string, Issue[]>();
    for (const issue of dataset.world.issues) {
      const person = isWork(issue) ? personOf(issue) : null;
      if (person) map.set(person.id, [...(map.get(person.id) ?? []), issue]);
    }
    return map;
  });
  return byPerson.get(personId) ?? [];
}

/** The latest status change or logged work on these tickets, up to the sample's now; null when there is none. */
function lastActivity(dataset: Dataset, tickets: readonly Issue[]): string | null {
  let latest = Number.NEGATIVE_INFINITY;
  for (const issue of tickets) {
    for (const change of issue.statusChanges) if (change.at <= dataset.now && change.at > latest) latest = change.at;
    for (const log of issue.worklogs) if (log.at <= dataset.now && log.at > latest) latest = log.at;
  }
  return Number.isFinite(latest) ? iso(latest) : null;
}

/** The other synced boards (in the service's order) on which the person holds open tickets, with how many. */
function servedElsewhere(others: readonly Dataset[], personId: string, days: ScorecardDays): PersonCardBoard[] {
  return others.flatMap((other) => {
    const open = scorecards(other, days).byId.get(personId)?.values.open_tickets.value ?? 0;
    return open > 0 ? [{ key: other.board.key, name: other.board.name, open_tickets: open }] : [];
  });
}

export type PersonCardAnswer = { found: true; body: PersonCard } | { found: false; message: string };

export function personCardView(dataset: Dataset, personId: string, days: ScorecardDays, others: readonly Dataset[] = []): PersonCardAnswer {
  const set = scorecards(dataset, days);
  const row = set.byId.get(personId);
  if (!row) return { found: false, message: PERSON_CARD_NOT_ON_BOARD };

  const holds = row.tickets > 0;
  const count = (key: "open_tickets" | "in_progress" | "done_in_period") => row.values[key].value ?? 0;

  // The scorecard's marks over the measures that compare (the rates and the ratio) the board can show.
  let closer = 0;
  let level = 0;
  let further = 0;
  let tooFew = 0;
  for (const measure of set.measures) {
    if (!measure.measurable || measure.kind === "count") continue;
    const mark = row.values[measure.key].vs_board;
    if (mark === "closer") closer += 1;
    else if (mark === "level") level += 1;
    else if (mark === "further") further += 1;
    else tooFew += 1;
  }
  const compared = closer + level + further;
  const process: PersonCardProcess | null = compared === 0 ? null : { closer, level, further, too_few: tooFew, measurable: compared + tooFew };

  const findings = peopleView(dataset).people.find((summary) => summary.person?.id === personId);
  const tickets = holds ? ticketsOf(dataset, personId) : [];
  const listed: PersonCardTicket[] = tickets
    .filter((issue) => inProgress(issue.status))
    .map((issue) => ({ issue, since: inProgressSince(issue) }))
    // Longest in progress first, then by issue number.
    .sort((a, b) => a.since - b.since || a.issue.num - b.issue.num)
    .map(({ issue, since }) => ({ key: issue.key, summary: issue.summary, status: issue.status, since: iso(since) }));

  return {
    found: true,
    body: {
      meta: meta(dataset),
      person: { ...row.person },
      board: { key: dataset.board.key, name: dataset.board.name },
      membership: holds ? "holds_tickets" : "member_no_tickets",
      work: { open_tickets: count("open_tickets"), in_progress: count("in_progress"), done_in_period: count("done_in_period"), days },
      findings: { open_breaches: findings?.open_breaches ?? 0, open_warnings: findings?.open_warnings ?? 0 },
      process,
      in_progress_now: listed.slice(0, PERSON_CARD_TICKETS),
      in_progress_more: Math.max(0, listed.length - PERSON_CARD_TICKETS),
      other_boards: [...servedElsewhere(others, personId, days), ...(OTHER_BOARDS_BY_ID.get(personId) ?? []).map((board) => ({ ...board }))],
      last_activity_at: holds ? lastActivity(dataset, tickets) : null,
    },
  };
}
