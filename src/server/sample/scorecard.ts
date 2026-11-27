import type { ScorecardQuery } from "@/lib/api/params";
import {
  CODE_REVIEW_NOT_RECORDED,
  SCORECARD_MEASURES,
  SCORECARD_SENTENCES,
  type ApiErrorCode,
  type CreditReading,
  type PeopleScorecard,
  type Person,
  type ScorecardDays,
  type ScorecardMeasure,
  type ScorecardMeasureKey,
  type ScorecardPerson,
  type ScorecardValue,
  type ScorecardValues,
  type VsBoard,
} from "@/lib/api/schemas";
import { compareByFoldedName } from "@/lib/names";

import { effortThreshold, estimateGraceHours } from "./board-rules";
import { RULES, STATUS, isWork, missingFor } from "./catalogue";
import { creditChoice, creditMemo, stepOneField, ticketsByPerson, ticketsOf } from "./credit";
import { meta, type Dataset } from "./dataset";
import type { FindingRecord } from "./engine";
import type { IgnoreInfo } from "./ignores";
import { directoryPeople, workPeople } from "./people";
import { DAY, HOUR, iso } from "./time";
import type { Issue } from "./world";

/** A rate or ratio compares only when its denominator holds at least this many tickets: one constant, here. */
export const MIN_TICKETS = 5;
/** Within this many percentage points of the board, a rate is level with it. */
const LEVEL_POINTS = 5;
/** Within this much of the board, open findings per 10 open tickets are level with it. */
const LEVEL_RATIO = 0.5;

/** The rules whose findings are each measure's tickets (the contract's table); the ratio reads every rule. */
const RULE_IDS: Record<ScorecardMeasureKey, readonly string[]> = {
  open_tickets: [],
  in_progress: [],
  done_in_period: [],
  estimated_before_start: ["R-EST-01", "R-EST-02"],
  time_logged: [],
  within_estimate: ["R-EFF-01"],
  stuck_now: ["W-AGE-01"],
  reopened: ["R-FLOW-03"],
  skipped_stage: ["R-FLOW-02"],
  code_review: ["R-FLOW-01", "W-REV-01"],
  // Every rule the board runs: its own among them, added per board by rulesOf.
  open_findings_per_10: RULES.map((rule) => rule.id),
};

/** The rules a measure reads on the board: the ratio reads every rule the board has, its own rules too. */
function rulesOf(dataset: Dataset, key: ScorecardMeasureKey): string[] {
  return key === "open_findings_per_10" ? dataset.rules.map((rule) => rule.def.id) : [...RULE_IDS[key]];
}

/** The contract's words for a measure the board cannot show. */
export const NOT_MEASURABLE_REASONS = {
  skipped_stage: "This board has no stages to skip.",
  code_review: CODE_REVIEW_NOT_RECORDED,
  time_logged: "No one logged time on this board in the period.",
  estimates: "This board has no estimates.",
  /** the measure's rule turned off in the board's rule settings, so it holds no one to it there. */
  ruleOff: "Its rule is off on this board.",
  rulesOff: "Its rules are off on this board.",
} as const;

/** The period: the days back from the snapshot's as-of (the last sync), both edges in. */
export interface Period {
  days: ScorecardDays;
  from: number;
  to: number;
}

function periodOf(dataset: Dataset, days: ScorecardDays): Period {
  const to = dataset.world.syncAt;
  return { days, from: to - days * DAY, to };
}

export const within = (period: Period, at: number | null): at is number => at !== null && at >= period.from && at <= period.to;

/** Whether the rules engine measures a rule on the board, as the service reads */
function engineMeasures(dataset: Dataset, ruleId: string): boolean {
  const rule = dataset.rules.find((candidate) => candidate.def.id === ruleId);
  return rule !== undefined && rule.enabled && missingFor(rule.catalogue).length === 0;
}

/** Whether the board has turned the rule off in its rule settings. */
function turnedOff(dataset: Dataset, ruleId: string): boolean {
  return dataset.rules.some((rule) => rule.def.id === ruleId && !rule.enabled);
}

/** The reason for a rule the board has turned off though it could measure it; null otherwise. */
function offReason(dataset: Dataset, ruleId: string): string | null {
  const rule = RULES.find((candidate) => candidate.id === ruleId);
  return rule !== undefined && turnedOff(dataset, ruleId) && missingFor(rule).length === 0 ? NOT_MEASURABLE_REASONS.ruleOff : null;
}

/** Why the board cannot show a measure, or null when it can. */
function reasonFor(dataset: Dataset, key: ScorecardMeasureKey, period: Period): string | null {
  switch (key) {
    case "skipped_stage":
      return engineMeasures(dataset, "R-FLOW-02") ? null : (offReason(dataset, "R-FLOW-02") ?? NOT_MEASURABLE_REASONS.skipped_stage);
    case "code_review":
      return engineMeasures(dataset, "R-FLOW-01") ? null : (offReason(dataset, "R-FLOW-01") ?? NOT_MEASURABLE_REASONS.code_review);
    case "time_logged":
      return dataset.world.issues.some((issue) => issue.worklogs.some((log) => within(period, log.at)))
        ? null
        : NOT_MEASURABLE_REASONS.time_logged;
    case "open_findings_per_10":
      return null;
    default: {
      const rules = RULE_IDS[key];
      if (rules.length === 0 || !rules.every((ruleId) => turnedOff(dataset, ruleId))) return null;
      return rules.length === 1 ? NOT_MEASURABLE_REASONS.ruleOff : NOT_MEASURABLE_REASONS.rulesOff;
    }
  }
}

function measuresFor(dataset: Dataset, period: Period): ScorecardMeasure[] {
  return SCORECARD_MEASURES.map((measure) => {
    const reason = reasonFor(dataset, measure.key, period);
    return {
      key: measure.key,
      label: measure.label,
      kind: measure.kind,
      direction: measure.direction,
      rule_ids: rulesOf(dataset, measure.key),
      measurable: reason === null,
      reason,
    };
  });
}

/* -------------------------------------------------------------- values -- */

const NOTHING: ScorecardValue = { value: null, numerator: null, denominator: null, enough: false, vs_board: null };

const countValue = (value: number): ScorecardValue => ({ value, numerator: null, denominator: null, enough: true, vs_board: null });

/** A whole percentage, half up; null with nothing to divide by. Enough is a denominator of MIN_TICKETS or more. */
function rateValue(numerator: number, denominator: number): ScorecardValue {
  return {
    value: denominator === 0 ? null : Math.round((100 * numerator) / denominator),
    numerator,
    denominator,
    enough: denominator >= MIN_TICKETS,
    vs_board: null,
  };
}

/** Open findings per 10 open tickets, to one decimal, half up. */
function ratioValue(numerator: number, denominator: number): ScorecardValue {
  return {
    value: denominator === 0 ? null : Math.round((100 * numerator) / denominator) / 10,
    numerator,
    denominator,
    enough: denominator >= MIN_TICKETS,
    vs_board: null,
  };
}

function hasOpenFinding(dataset: Dataset, issue: Issue, ruleId: string): boolean {
  return (dataset.engine.byIssue.get(issue.key) ?? []).some((finding) => finding.resolvedAt === null && finding.rule.id === ruleId);
}

/** The ticket's open findings (an ignored one is resolved, so never among them): the ratio's numerator and the proof's detail. */
export function openFindingsOf(dataset: Dataset, issue: Issue): FindingRecord[] {
  return (dataset.engine.byIssue.get(issue.key) ?? []).filter((finding) => finding.resolvedAt === null);
}

function openFindings(dataset: Dataset, issue: Issue): number {
  return openFindingsOf(dataset, issue).length;
}

/** Work, as every rule counts it (catalogue.ts): re-exported for the sample's Ask. */
export { isWork };

/** Whether a ticket entered the testing stage: never on DEMO, whose workflow maps no status to it. */
function reachedTesting(issue: Issue): boolean {
  return issue.intervals.some((interval) => STATUS[interval.status].stage === "testing");
}

/** One measure's tickets: those it counts out of (a rate's denominator, a count's tickets), those counted, and those an ignore leaves out. */
export interface MeasureSet {
  all: readonly Issue[];
  counted: readonly Issue[];
  leftOut: readonly { issue: Issue; ignore: IgnoreInfo }[];
}

export type MeasureSets = Record<ScorecardMeasureKey, MeasureSet>;

/** The tickets behind every figure of one row: each figure is its set's size, and the proof lists the same sets. */
export function measureSets(dataset: Dataset, tickets: readonly Issue[], period: Period): MeasureSets {
  const work = tickets.filter(isWork);
  const open = work.filter((issue) => STATUS[issue.status].category !== "done");
  const done = work.filter((issue) => within(period, issue.doneAt));
  const started = work.filter((issue) => within(period, issue.startedAt));
  // An effort ratio needs an estimate and time logged: a ratio of 0 is missing time, not effort (contract 8.2).
  const effort = done.filter((issue) => issue.effortRatio !== null && issue.timeSpentS > 0);
  const tested = done.filter(reachedTesting);
  // The board's own thresholds: R-EST-02's grace, and R-EFF-01's effort limit below.
  const grace = estimateGraceHours(dataset.rules) * HOUR;
  const limit = effortThreshold(dataset.rules);
  const set = (key: ScorecardMeasureKey, base: readonly Issue[], counts: (issue: Issue) => boolean = () => true): MeasureSet => {
    const rules = RULE_IDS[key];
    const all: Issue[] = [];
    const leftOut: { issue: Issue; ignore: IgnoreInfo }[] = [];
    for (const issue of base) {
      // An ignore of a measure's rules leaves the ticket out of it, judged neither way; of the ratio, only a whole ticket's.
      const ignore = key === "open_findings_per_10" ? dataset.ignores.ticket(issue.key) : rules.length > 0 ? dataset.ignores.covers(issue.key, rules) : null;
      if (ignore) leftOut.push({ issue, ignore });
      else all.push(issue);
    }
    return { all, counted: all.filter(counts), leftOut };
  };
  return {
    open_tickets: set("open_tickets", open),
    in_progress: set("in_progress", work.filter((issue) => STATUS[issue.status].category === "indeterminate")),
    done_in_period: set("done_in_period", done),
    estimated_before_start: set("estimated_before_start", started, (issue) => issue.estimateSetAt !== null && issue.estimateSetAt <= issue.startedAt! + grace),
    time_logged: set("time_logged", done, (issue) => issue.timeSpentS > 0 || issue.aggregateTimeSpentS > 0),
    within_estimate: set("within_estimate", effort, (issue) => issue.effortRatio! < limit),
    stuck_now: set("stuck_now", open, (issue) => hasOpenFinding(dataset, issue, "W-AGE-01")),
    reopened: set("reopened", done, (issue) => issue.reopenCount > 0),
    skipped_stage: set("skipped_stage", done, (issue) => issue.skips.length > 0),
    code_review: set("code_review", tested, (issue) => !hasOpenOrResolved(dataset, issue, "R-FLOW-01")),
    open_findings_per_10: set("open_findings_per_10", open, (issue) => openFindings(dataset, issue) > 0),
  };
}

/** Each figure as its set's size: a count, a rate of those counted, or the open findings per 10 open tickets. */
function valuesFrom(dataset: Dataset, sets: MeasureSets, measures: readonly ScorecardMeasure[]): ScorecardValues {
  const all = Object.fromEntries(
    SCORECARD_MEASURES.map(({ key, kind }) => {
      const { all: tickets, counted } = sets[key];
      if (kind === "count") return [key, countValue(tickets.length)];
      if (kind === "rate") return [key, rateValue(counted.length, tickets.length)];
      return [key, ratioValue(tickets.reduce((sum, issue) => sum + openFindings(dataset, issue), 0), tickets.length)];
    }),
  ) as ScorecardValues;
  for (const measure of measures) if (!measure.measurable) all[measure.key] = { ...NOTHING };
  return all;
}

function valuesOf(dataset: Dataset, tickets: readonly Issue[], period: Period, measures: readonly ScorecardMeasure[]): ScorecardValues {
  return valuesFrom(dataset, measureSets(dataset, tickets, period), measures);
}

/** The tickets a row's figures are worked out from: every ticket for the whole board, a person's tickets for them. */
export function rowTickets(dataset: Dataset, personId: string | null): readonly Issue[] {
  return personId === null ? dataset.world.issues : ticketsOf(dataset, personId);
}

/** The sets behind one row's figures over a period (the whole board's for null): what the proof lists. */
export function rowSets(dataset: Dataset, days: ScorecardDays, personId: string | null): { period: Period; sets: MeasureSets } {
  return creditMemo(dataset, `scorecard:sets:${days}:${personId ?? "board"}`, () => {
    const period = periodOf(dataset, days);
    return { period, sets: measureSets(dataset, rowTickets(dataset, personId), period) };
  });
}

/** Any R-FLOW-01 breach on the ticket, open or resolved: the ticket reached testing without review either way. */
export function hasOpenOrResolved(dataset: Dataset, issue: Issue, ruleId: string): boolean {
  return (dataset.engine.byIssue.get(issue.key) ?? []).some((finding) => finding.rule.id === ruleId);
}

/** Where a person's rate or ratio stands next to the board's, read on the */
export function vsBoard(measure: Pick<ScorecardMeasure, "kind" | "direction">, person: ScorecardValue, board: ScorecardValue): VsBoard | null {
  if (measure.kind === "count" || measure.direction === "neutral") return null;
  if (!person.enough || !board.enough || person.value === null || board.value === null) return null;
  const gap = person.value - board.value;
  const level = measure.kind === "rate" ? LEVEL_POINTS : LEVEL_RATIO;
  if (Math.abs(gap) <= level + 1e-9) return "level";
  const higher = gap > 0;
  return higher === (measure.direction === "higher_is_closer") ? "closer" : "further";
}

function compared(measures: readonly ScorecardMeasure[], values: ScorecardValues, board: ScorecardValues): ScorecardValues {
  const out = { ...values };
  for (const measure of measures) out[measure.key] = { ...values[measure.key], vs_board: vsBoard(measure, values[measure.key], board[measure.key]) };
  return out;
}

/* ------------------------------------------------------------ the cards -- */

export interface ScorecardSet {
  period: Period;
  measures: ScorecardMeasure[];
  board: { tickets: number; values: ScorecardValues };
  /** Everyone on the board (people with tickets and members), by id. */
  byId: ReadonlyMap<string, ScorecardPerson>;
  /** The people with a ticket on the board (its work, Epics left out, that counts for them), in the directory's order. */
  withTickets: readonly ScorecardPerson[];
  /** The work that counts for no one, as Ask's rankings by a count say it after the people; null when there is none. */
  noOne: { tickets: number; values: ScorecardValues } | null;
  /** The board's credit setting, as the caveat words it. */
  credit: CreditReading;
}

/** Every scorecard for one period, computed once per dataset and credit setting. */
export function scorecards(dataset: Dataset, days: ScorecardDays): ScorecardSet {
  return creditMemo(dataset, `scorecard:${days}`, () => {
    const period = periodOf(dataset, days);
    const measures = measuresFor(dataset, period);
    const issues = dataset.world.issues;
    // A person's tickets and the board's are its work, Epics left out, as GET /people counts them.
    const work = issues.filter(isWork);
    const board = { tickets: work.length, values: valuesOf(dataset, issues, period, measures) };
    const tickets = ticketsByPerson(dataset);
    const card = (person: Person): ScorecardPerson => {
      const theirs = tickets.byPerson.get(person.id) ?? [];
      if (theirs.length === 0) {
        // No ticket counts for them (a member, someone the setting does not name, or only Epics): nothing to compare.
        const values = Object.fromEntries(measures.map((measure) => [measure.key, { ...NOTHING }])) as ScorecardValues;
        return { person: { ...person }, tickets: 0, values };
      }
      const values = valuesOf(dataset, theirs, period, measures);
      return { person: { ...person }, tickets: theirs.length, values: compared(measures, values, board.values) };
    };
    const everyone = directoryPeople(dataset).map(card);
    const ids = new Set(workPeople(dataset).map((person) => person.id));
    const choice = creditChoice(dataset);
    return {
      period,
      measures,
      board,
      byId: new Map(everyone.map((row) => [row.person.id, row])),
      withTickets: everyone.filter((row) => ids.has(row.person.id)).sort((a, b) => compareByFoldedName(a.person, b.person)),
      noOne: tickets.byNobody.length > 0 ? { tickets: tickets.byNobody.length, values: valuesOf(dataset, tickets.byNobody, period, measures) } : null,
      credit: { source: choice.source, field: stepOneField(choice)?.name ?? null },
    };
  });
}

export type ScorecardAnswer =
  | { found: true; body: PeopleScorecard }
  | { found: false; status: 403 | 404; error: ApiErrorCode; message: string };

export const SCORECARD_NOT_ON_BOARD = "Someone asked for is not on this board.";

/** The endpoint's body for a validated query. With comparison off, two or more */
export function scorecardView(dataset: Dataset, query: ScorecardQuery, comparison: "on" | "off"): ScorecardAnswer {
  if (comparison === "off" && query.person.length > 1) {
    return { found: false, status: 403, error: "comparison_off", message: SCORECARD_SENTENCES.comparisonOff };
  }
  const set = scorecards(dataset, query.days);
  const asked = query.person.map((id) => set.byId.get(id));
  if (asked.some((row) => row === undefined)) return { found: false, status: 404, error: "not_found", message: SCORECARD_NOT_ON_BOARD };
  const people =
    query.person.length > 0
      ? (asked as ScorecardPerson[]).sort((a, b) => compareByFoldedName(a.person, b.person))
      : comparison === "on"
        ? [...set.withTickets]
        : [];
  return {
    found: true,
    body: {
      meta: meta(dataset),
      period: { days: set.period.days, from: iso(set.period.from), to: iso(set.period.to) },
      basis: "credit",
      comparison,
      measures: set.measures.map((measure) => ({ ...measure, rule_ids: [...measure.rule_ids] })),
      board: { tickets: set.board.tickets, values: structuredClone(set.board.values) },
      people: people.map((row) => structuredClone(row)),
    },
  };
}
