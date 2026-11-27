import { createParser, parseAsStringLiteral } from "nuqs";

import {
  PERSON_ID_PATTERN,
  PROOF_MEASURE_KEYS,
  SCORECARD_MEASURES,
  TICKETS_MEASURE,
  type ProofCredit,
  type ProofDetails,
  type ProofMeasureKey,
  type ProofTicket,
  type ScorecardValue,
} from "@/lib/api/schemas";
import { formatCount, formatHours, formatRatio } from "@/lib/format";

/** The whole board in the address, where a person id would be. */
export const BOARD = "board";

const personOrBoard = createParser({
  parse: (value: string) => {
    const id = value.trim().toLowerCase();
    return id === BOARD || PERSON_ID_PATTERN.test(id) ? id : null;
  },
  serialize: (value: string) => value,
});

/** The open proof in the address, so a link opens the same one: `proof=<measure>&proof_person=<id|board>`. */
export const proofUrlParsers = {
  proof: parseAsStringLiteral(PROOF_MEASURE_KEYS),
  proof_person: personOrBoard,
};

/** A figure to prove: its measure (or "tickets"), and whose it is; null is the whole board. */
export interface ProofTarget {
  measure: ProofMeasureKey;
  person: string | null;
}

export const sameTarget = (a: ProofTarget | null, b: ProofTarget | null) => a?.measure === b?.measure && a?.person === b?.person;

/** What the cell is called, so focus can go back to it when the proof closes. */
export const cellId = (target: ProofTarget) => `${target.measure}:${target.person ?? BOARD}`;

/** The figures of now, which no period bounds: their header says when, not over how long. */
const NOW: ReadonlySet<ProofMeasureKey> = new Set(["open_tickets", "in_progress", "stuck_now", "open_findings_per_10", "tickets"]);
export const isNowMeasure = (key: ProofMeasureKey) => NOW.has(key);

export function measureLabel(key: ProofMeasureKey): string {
  return key === "tickets" ? TICKETS_MEASURE.label : SCORECARD_MEASURES.find((measure) => measure.key === key)!.label;
}

/** The two groups a rate's tickets fall in, and the ratio's: counted first, in the measure's own words. */
export const GROUP_WORDS: Partial<Record<ProofMeasureKey, readonly [counted: string, other: string]>> = {
  estimated_before_start: ["Estimated first", "Estimated late or never"],
  time_logged: ["Time logged", "No time logged"],
  within_estimate: ["Within the limit", "Over the limit"],
  stuck_now: ["Stuck", "Not stuck"],
  reopened: ["Reopened", "Not reopened"],
  skipped_stage: ["Skipped a stage", "No skips"],
  code_review: ["Review recorded", "No review recorded"],
  open_findings_per_10: ["With open findings", "No open findings"],
};

/* ------------------------------------------------------------- words -- */

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);

/** The figure in one plain sentence: "7 of 9 open tickets are stuck in a status." A count's goes on from its figure: "13" "tickets open now." */
export function proofSentence(
  key: ProofMeasureKey,
  figures: { counted: number; total: number; findings: number; days: number; name: string | null },
  locale?: string,
): string {
  const { counted, total, findings, days, name } = figures;
  const n = (value: number) => formatCount(value, { locale });
  const of = `${n(counted)} of ${n(total)}`;
  const tickets = plural(total, "ticket", "tickets");
  const period = `the last ${n(days)} days`;
  const are = plural(counted, "is", "are");
  const were = plural(counted, "was", "were");
  const have = plural(counted, "has", "have");
  switch (key) {
    case "open_tickets":
      return `${tickets} open now.`;
    case "in_progress":
      return `${tickets} in progress now.`;
    case "done_in_period":
      return `${tickets} done in ${period}.`;
    case "tickets":
      return name ? `${tickets} that count for ${name}.` : `${tickets} on the board, Epics left out.`;
    case "estimated_before_start":
      return `${of} ${tickets} started in ${period} had an estimate before work started.`;
    case "time_logged":
      return `${of} ${tickets} done in ${period} ${have} time logged.`;
    case "within_estimate":
      return `${of} ${tickets} done with an estimate stayed within the effort limit.`;
    case "stuck_now":
      return `${of} open ${tickets} ${are} stuck in a status.`;
    case "reopened":
      return `${of} ${tickets} done in ${period} ${were} reopened.`;
    case "skipped_stage":
      return `${of} ${tickets} done in ${period} skipped a stage.`;
    case "code_review":
      return `${of} ${tickets} that reached testing had code review recorded.`;
    case "open_findings_per_10":
      return `${n(findings)} open ${plural(findings, "finding", "findings")} on ${n(total)} open ${tickets}.`;
  }
}

/** A stretch of time in hours, as a person says it: "3 h", "12 days". */
export function spanWords(hours: number, locale?: string): string {
  if (hours < 1) return "under an hour";
  if (hours < 48) return `${formatCount(Math.round(hours), { locale })} h`;
  const days = Math.round(hours / 24);
  return `${formatCount(days, { locale })} ${plural(days, "day", "days")}`;
}

const TIMES = ["", "once", "twice"];

/** "p90 of To Do: 524.8 h" said after the status it names: "p90 524.8 h". */
function limitWords(threshold: string): string {
  const match = /^(p\d+) of .+?: (.+)$/.exec(threshold);
  return match ? `${match[1]} ${match[2]}` : threshold;
}

function joinWords(words: readonly string[]): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

/** The measure's detail on a ticket in plain words: the first line, and a quieter second one where it has more to say. */
export function detailWords(
  key: ProofMeasureKey,
  ticket: Pick<ProofTicket, "detail" | "counted">,
  locale?: string,
): { main: string; more: string | null; ids?: boolean } | null {
  const hours = (seconds: number) => formatHours(seconds / 3600, { locale });
  switch (key) {
    case "estimated_before_start": {
      const detail = ticket.detail as ProofDetails["estimated_before_start"];
      if (detail.estimate_set_at === null) return { main: "No estimate", more: null };
      const gap = (Date.parse(detail.estimate_set_at) - Date.parse(detail.started_at)) / 3_600_000;
      if (gap <= 0) return { main: `Estimated ${spanWords(-gap, locale)} before work started`, more: null };
      return { main: `Estimate set ${spanWords(gap, locale)} after work started`, more: gap <= detail.grace_hours ? `Within the ${formatCount(detail.grace_hours, { locale })} h grace` : null };
    }
    case "time_logged": {
      const detail = ticket.detail as ProofDetails["time_logged"];
      if (detail.time_spent_s === 0 && detail.subtask_time_spent_s === 0) return { main: "No time logged", more: null };
      if (detail.time_spent_s === 0) return { main: `${hours(detail.subtask_time_spent_s)} logged on subtasks`, more: null };
      return { main: `Logged ${hours(detail.time_spent_s)}`, more: detail.subtask_time_spent_s > 0 ? `${hours(detail.subtask_time_spent_s)} more on subtasks` : null };
    }
    case "within_estimate": {
      const detail = ticket.detail as ProofDetails["within_estimate"];
      const logged = detail.estimate_s === null ? `Logged ${hours(detail.logged_s)}` : `Logged ${hours(detail.logged_s)} of ${hours(detail.estimate_s)}`;
      return { main: `${logged} · ${formatRatio(detail.ratio, { locale })}`, more: `Limit ${formatRatio(detail.limit, { locale })}` };
    }
    case "stuck_now": {
      const detail = ticket.detail as ProofDetails["stuck_now"];
      // The status is the row's chip: the sentence keeps the time, the part that must not be cut.
      const main = detail.hours === null ? "In its status" : `For ${spanWords(detail.hours, locale)}`;
      return { main, more: detail.threshold ? `Limit ${limitWords(detail.threshold)}` : null };
    }
    case "reopened": {
      const { times } = ticket.detail as ProofDetails["reopened"];
      return { main: times === 0 ? "Not reopened" : `Reopened ${TIMES[times] ?? `${formatCount(times, { locale })} times`}`, more: null };
    }
    case "skipped_stage": {
      const { stages } = ticket.detail as ProofDetails["skipped_stage"];
      return { main: stages.length === 0 ? "No stage skipped" : `Skipped ${joinWords(stages)}`, more: null };
    }
    case "code_review": {
      const { breach } = ticket.detail as ProofDetails["code_review"];
      return { main: breach ? "No review recorded" : "Review recorded", more: null };
    }
    case "open_findings_per_10": {
      const { findings, rule_ids: rules } = ticket.detail as ProofDetails["open_findings_per_10"];
      return {
        main: findings === 0 ? "No open findings" : `${formatCount(findings, { locale })} open ${plural(findings, "finding", "findings")}`,
        more: rules.length > 0 ? rules.join(" · ") : null,
        ids: true,
      };
    }
    default:
      return null;
  }
}

/** The small tag beside whom a ticket counts for: why it counts for them. */
export function basisWords(credit: ProofCredit): string | null {
  switch (credit.basis) {
    case "field":
      return credit.field;
    case "assignee_now":
      return "Assignee";
    default:
      return null;
  }
}

/** A figure with tickets behind it: a count above nought, a rate or the ratio over one ticket or more. A dash or 0 of 0 has none. */
export function hasTicketsBehind(measure: { kind: "count" | "rate" | "ratio"; measurable: boolean }, value: ScorecardValue): boolean {
  if (!measure.measurable || value.value === null) return false;
  return measure.kind === "count" ? value.value > 0 : (value.denominator ?? 0) > 0;
}

/** What a cell's button says to a screen reader: whose figure, which, the figure, and what pressing it does. */
export function cellName(who: string, key: ProofMeasureKey, spoken: string): string {
  return `${who}, ${measureLabel(key)}, ${spoken}: show tickets`;
}

/* -------------------------------------------------------------- Jira -- */

/** More keys than this and Jira's search address grows too long to open: the keys and the JQL are copied instead. */
export const JIRA_KEYS_MAX = 100;

export const jql = (keys: readonly string[]) => `key in (${keys.join(", ")})`;

/** Jira's search for these keys, on the site the tickets' own links name (its browse page's neighbour). */
export function jiraSearchUrl(ticketUrl: string, keys: readonly string[]): string {
  const url = new URL("../issues/", ticketUrl);
  url.searchParams.set("jql", jql(keys));
  return url.href;
}
