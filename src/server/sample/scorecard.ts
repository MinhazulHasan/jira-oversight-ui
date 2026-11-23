import type { ScorecardQuery } from "@/lib/api/params";
import {
  CODE_REVIEW_NOT_RECORDED,
  SCORECARD_MEASURES,
  SCORECARD_SENTENCES,
  type ApiErrorCode,
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
import { memo, meta, type Dataset } from "./dataset";
import { directoryPeople, workPeople } from "./people";
import { personOf } from "./team";
import { DAY, HOUR, iso } from "./time";
import type { Issue } from "./world";

/*
 * GET /people/scorecard in the sample (JO-11): how each person's tickets are
 * handled next to the whole board's, computed on read from the same issues
 * and findings every other view reads, by each ticket's current assignee, as
 * the service computes it (oversight/api/scorecard.py). The figures are facts
 * about tickets; nothing here rates anyone. Whether someone is closer to the
 * process than the board is said only where both have enough tickets.
 */

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
  // Every rule the board runs: its own (JO-20) among them, added per board by rulesOf.
  open_findings_per_10: RULES.map((rule) => rule.id),
};

/** The rules a measure reads on the board: the ratio reads every rule the board has, its own rules too (JO-20). */
function rulesOf(dataset: Dataset, key: ScorecardMeasureKey): string[] {
  return key === "open_findings_per_10" ? dataset.rules.map((rule) => rule.def.id) : [...RULE_IDS[key]];
}

/** The contract's words for a measure the board cannot show. */
export const NOT_MEASURABLE_REASONS = {
  skipped_stage: "This board has no stages to skip.",
  code_review: CODE_REVIEW_NOT_RECORDED,
  time_logged: "No one logged time on this board in the period.",
  estimates: "This board has no estimates.",
  /** JO-15: the measure's rule turned off in the board's rule settings, so it holds no one to it there. */
  ruleOff: "Its rule is off on this board.",
  rulesOff: "Its rules are off on this board.",
} as const;

/** The period: the days back from the snapshot's as-of (the last sync), both edges in. */
interface Period {
  days: ScorecardDays;
  from: number;
  to: number;
}

function periodOf(dataset: Dataset, days: ScorecardDays): Period {
  const to = dataset.world.syncAt;
  return { days, from: to - days * DAY, to };
}

export const within = (period: Period, at: number | null): at is number => at !== null && at >= period.from && at <= period.to;

/**
 * Whether the rules engine measures a rule on the board, as the service reads
 * its latest rules run (rule_status; JO-12, G11): the sample's engine measures
 * a rule the board runs exactly when nothing it needs is missing, as the
 * Overview and the rule catalogue say.
 */
function engineMeasures(dataset: Dataset, ruleId: string): boolean {
  const rule = dataset.rules.find((candidate) => candidate.def.id === ruleId);
  return rule !== undefined && rule.enabled && missingFor(rule.catalogue).length === 0;
}

/** Whether the board has turned the rule off in its rule settings (JO-15). */
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
    // One truth per board (JO-12, G11): skipped stages and code review are measured exactly where the engine
    // measures R-FLOW-02 and R-FLOW-01, so the scorecard never says "no stages to skip" beside open "Skipped a stage"
    // findings. On DEMO the engine measures skipped stages (backlog straight to done), never code review. A rule the
    // board turned off (JO-15) is measured no more, and that is the reason, unless the board could not measure it on.
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
      // DEMO's estimate is story points (process.yaml's estimate block), so the board has estimates. A measure whose
      // rules the board has all turned off (JO-15) holds no one to them there: stuck_now never reads 0% for want of
      // W-AGE-01's findings.
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

function openFindings(dataset: Dataset, issue: Issue): number {
  return (dataset.engine.byIssue.get(issue.key) ?? []).filter((finding) => finding.resolvedAt === null).length;
}

/** Work, as every rule counts it (catalogue.ts): re-exported for the sample's Ask. */
export { isWork };

/** Whether a ticket entered the testing stage: never on DEMO, whose workflow maps no status to it. */
function reachedTesting(issue: Issue): boolean {
  return issue.intervals.some((interval) => STATUS[interval.status].stage === "testing");
}

/**
 * Every measure over a set of tickets: one person's (their tickets now) or
 * the board's (every ticket, assigned or not), as the service works them out
 * (oversight/api/scorecard.py): the work among them (Epics left out, as every
 * rule counts), an estimate first set within R-EST-02's grace of the start,
 * effort under R-EFF-01's threshold (it breaches at or over it), and the open
 * findings on the open work beside the open work, so both sides count the
 * same tickets. Not measurable measures hold nothing at all, so they can
 * never read as a zero.
 */
function valuesOf(dataset: Dataset, tickets: readonly Issue[], period: Period, measures: readonly ScorecardMeasure[]): ScorecardValues {
  const issues = tickets.filter(isWork);
  const open = issues.filter((issue) => STATUS[issue.status].category !== "done");
  const done = issues.filter((issue) => within(period, issue.doneAt));
  const started = issues.filter((issue) => within(period, issue.startedAt));
  // An effort ratio needs an estimate and time logged: a ratio of 0 is missing time, not effort (contract 8.2).
  const effort = done.filter((issue) => issue.effortRatio !== null && issue.timeSpentS > 0);
  const tested = done.filter(reachedTesting);
  // The board's own thresholds (JO-15): R-EST-02's grace, and R-EFF-01's effort limit below.
  const grace = estimateGraceHours(dataset.rules) * HOUR;
  const limit = effortThreshold(dataset.rules);
  const all: ScorecardValues = {
    open_tickets: countValue(open.length),
    in_progress: countValue(issues.filter((issue) => STATUS[issue.status].category === "indeterminate").length),
    done_in_period: countValue(done.length),
    estimated_before_start: rateValue(
      started.filter((issue) => issue.estimateSetAt !== null && issue.estimateSetAt <= issue.startedAt! + grace).length,
      started.length,
    ),
    time_logged: rateValue(done.filter((issue) => issue.timeSpentS > 0 || issue.aggregateTimeSpentS > 0).length, done.length),
    within_estimate: rateValue(effort.filter((issue) => issue.effortRatio! < limit).length, effort.length),
    stuck_now: rateValue(open.filter((issue) => hasOpenFinding(dataset, issue, "W-AGE-01")).length, open.length),
    reopened: rateValue(done.filter((issue) => issue.reopenCount > 0).length, done.length),
    skipped_stage: rateValue(done.filter((issue) => issue.skips.length > 0).length, done.length),
    code_review: rateValue(tested.filter((issue) => !hasOpenOrResolved(dataset, issue, "R-FLOW-01")).length, tested.length),
    open_findings_per_10: ratioValue(
      open.reduce((sum, issue) => sum + openFindings(dataset, issue), 0),
      open.length,
    ),
  };
  for (const measure of measures) if (!measure.measurable) all[measure.key] = { ...NOTHING };
  return all;
}

/** Any R-FLOW-01 breach on the ticket, open or resolved: the ticket reached testing without review either way. */
function hasOpenOrResolved(dataset: Dataset, issue: Issue, ruleId: string): boolean {
  return (dataset.engine.byIssue.get(issue.key) ?? []).some((finding) => finding.rule.id === ruleId);
}

/**
 * Where a person's rate or ratio stands next to the board's, read on the
 * values as shown (whole percentages, one decimal), so a reader can check it:
 * level within 5 points (0.5 for the ratio), else closer or further by the
 * measure's direction. Nothing when either side has too few tickets.
 */
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
  /** Everyone on the board (ticket holders and members), by id. */
  byId: ReadonlyMap<string, ScorecardPerson>;
  /** The people who hold a ticket on the board now (its work, Epics left out), in the directory's order. */
  holders: readonly ScorecardPerson[];
  /**
   * The work nobody holds, as Ask's rankings by a count say it after the
   * people (JO-12, G5: no one's, never ranked); null when every ticket has
   * someone.
   */
  unassigned: { tickets: number; values: ScorecardValues } | null;
}

/** Every scorecard for one period, computed once per dataset. */
export function scorecards(dataset: Dataset, days: ScorecardDays): ScorecardSet {
  return memo(dataset, `scorecard:${days}`, () => {
    const period = periodOf(dataset, days);
    const measures = measuresFor(dataset, period);
    const issues = dataset.world.issues;
    // A person's tickets and the board's are its work, Epics left out, as GET /people counts them (JO-12, G5).
    const work = issues.filter(isWork);
    const board = { tickets: work.length, values: valuesOf(dataset, issues, period, measures) };
    const byPerson = new Map<string, Issue[]>();
    const nobody: Issue[] = [];
    for (const issue of work) {
      const person = personOf(issue);
      if (person) byPerson.set(person.id, [...(byPerson.get(person.id) ?? []), issue]);
      else nobody.push(issue);
    }
    const card = (person: Person): ScorecardPerson => {
      const theirs = byPerson.get(person.id) ?? [];
      if (theirs.length === 0) {
        // A member who holds none of the board's tickets (or only Epics): nothing to count, so nothing to compare.
        const values = Object.fromEntries(measures.map((measure) => [measure.key, { ...NOTHING }])) as ScorecardValues;
        return { person: { ...person }, tickets: 0, values };
      }
      return { person: { ...person }, tickets: theirs.length, values: compared(measures, valuesOf(dataset, theirs, period, measures), board.values) };
    };
    const everyone = directoryPeople(dataset).map(card);
    const holderIds = new Set(workPeople(dataset).map((person) => person.id));
    return {
      period,
      measures,
      board,
      byId: new Map(everyone.map((row) => [row.person.id, row])),
      holders: everyone.filter((row) => holderIds.has(row.person.id)).sort((a, b) => compareByFoldedName(a.person, b.person)),
      unassigned: nobody.length > 0 ? { tickets: nobody.length, values: valuesOf(dataset, nobody, period, measures) } : null,
    };
  });
}

export type ScorecardAnswer =
  | { found: true; body: PeopleScorecard }
  | { found: false; status: 403 | 404; error: ApiErrorCode; message: string };

export const SCORECARD_NOT_ON_BOARD = "Someone asked for is not on this board.";

/**
 * The endpoint's body for a validated query. With comparison off, two or more
 * people is refused in the contract's words, and nobody asked for is the
 * board's figures alone; with it on, nobody asked for is everyone who holds a
 * ticket. Someone asked for who is not on the board at all is not found.
 */
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
        ? [...set.holders]
        : [];
  return {
    found: true,
    body: {
      meta: meta(dataset),
      period: { days: set.period.days, from: iso(set.period.from), to: iso(set.period.to) },
      basis: "current_assignee",
      comparison,
      measures: set.measures.map((measure) => ({ ...measure, rule_ids: [...measure.rule_ids] })),
      board: { tickets: set.board.tickets, values: structuredClone(set.board.values) },
      people: people.map((row) => structuredClone(row)),
    },
  };
}
