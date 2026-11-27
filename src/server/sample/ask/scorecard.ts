import {
  recordsCodeReview,
  SCORECARD_DEFAULT_DAYS,
  SCORECARD_MEASURES,
  SCORECARD_SENTENCES,
  scorecardCaveat,
  UNASSIGNED_LABEL,
  type CreditReading,
  type FactCell,
  type FactColumnKind,
  type FactSet,
  type Person,
  type ScorecardDays,
  type ScorecardMeasure,
  type ScorecardMeasureKey,
  type ScorecardPerson,
  type ScorecardValue,
} from "@/lib/api/schemas";

import { STATUS } from "../catalogue";
import { ticketsOf } from "../credit";
import type { Dataset } from "../dataset";
import { isWork, MIN_TICKETS, scorecards, within, type ScorecardSet } from "../scorecard";
import { personOf } from "../team";
import { iso, spelledDay } from "../time";
import { listed, type Piece } from "./compose";
import { asksAboutTheFurtherSide, NEGATION_BEFORE, normalise, orderNear, type AskedOrder } from "./match";
import { boardPeopleFacts, boardPeoplePieces } from "./people";
import type { ScriptResult } from "./scripts";

type Row = Record<string, FactCell>;

interface Column {
  key: string;
  label: string;
  kind: FactColumnKind;
}

/** What the board's row reads as in the facts, where a person's name would be (the service's WHOLE_BOARD). */
export const BOARD_NAME = "Whole board";
/** The mark's words, as the page shows them beside a figure. */
const STANDING = { closer: "Closer to the process", further: "Further from the process", level: "Level with the board" } as const;
const TOO_FEW = "Too few tickets";

const SCORECARD_COLUMNS: Column[] = [
  { key: "person_id", label: "Person id", kind: "text" },
  { key: "name", label: "Person", kind: "text" },
  { key: "measure", label: "Measure id", kind: "text" },
  { key: "label", label: "Measure", kind: "text" },
  { key: "kind", label: "Kind", kind: "text" },
  { key: "value", label: "Value", kind: "number" },
  { key: "numerator", label: "Numerator", kind: "count" },
  { key: "denominator", label: "Denominator", kind: "count" },
  { key: "shown", label: "Shown", kind: "text" },
  { key: "enough", label: "Enough tickets", kind: "text" },
  { key: "vs_board", label: "Next to the board", kind: "text" },
  { key: "board_value", label: "Board value", kind: "number" },
  { key: "board_numerator", label: "Board numerator", kind: "count" },
  { key: "board_denominator", label: "Board denominator", kind: "count" },
  { key: "board_shown", label: "Board shown", kind: "text" },
  { key: "measurable", label: "Measurable", kind: "text" },
  { key: "reason", label: "Not measurable because", kind: "text" },
  { key: "rule_ids", label: "Rules", kind: "text" },
];

const COMPARE_COLUMNS: Column[] = [
  { key: "person_id", label: "Person id", kind: "text" },
  { key: "name", label: "Person", kind: "text" },
  { key: "measure", label: "Measure id", kind: "text" },
  { key: "label", label: "Measure", kind: "text" },
  { key: "kind", label: "Kind", kind: "text" },
  { key: "value", label: "Value", kind: "number" },
  { key: "numerator", label: "Numerator", kind: "count" },
  { key: "denominator", label: "Denominator", kind: "count" },
  { key: "shown", label: "Shown", kind: "text" },
  { key: "enough", label: "Enough tickets", kind: "text" },
  { key: "vs_board", label: "Next to the board", kind: "text" },
  { key: "standing", label: "Standing", kind: "text" },
  { key: "measurable", label: "Measurable", kind: "text" },
  { key: "reason", label: "Not measurable because", kind: "text" },
];

const OVERALL_COLUMNS: Column[] = [
  { key: "person_id", label: "Person id", kind: "text" },
  { key: "name", label: "Person", kind: "text" },
  { key: "closer", label: "Closer to the process", kind: "count" },
  { key: "further", label: "Further from the process", kind: "count" },
  { key: "level", label: "Level with the board", kind: "count" },
  { key: "compared", label: "Measures compared", kind: "count" },
  { key: "too_few", label: "Too few tickets", kind: "count" },
  { key: "open_findings_per_10", label: "Open findings per 10 open tickets", kind: "number" },
  { key: "open_findings", label: "Open findings", kind: "count" },
  { key: "open_tickets", label: "Open tickets", kind: "count" },
  { key: "enough", label: "Enough tickets", kind: "text" },
  { key: "standing", label: "Standing", kind: "text" },
];

/** Whose a ticket's figures are, as the service's notes say it (its CREDIT_READING). */
const CREDIT_READING =
  "every ticket, open or finished, by whom it counts for (the board's credit setting: a people field such as " +
  "Programmer, the assignee, or Automatic: Programmer where it is filled, otherwise the assignee; a ticket " +
  "without one counts for no one)";
const READING =
  `${CREDIT_READING}, Epics left out; a rate's value is a percentage of its denominator, a count's ` +
  "value is the count, and open findings per 10 open tickets is the open breaches and warnings on the person's open " +
  `tickets for every 10 of those tickets; enough tickets means the figure rests on at least ${MIN_TICKETS} tickets; ` +
  "next to the board says closer to the process than the board, further from it, or level with it (within 5 " +
  "points, 0.5 for the ratio), only when both sides have enough";
const OVERALL_READING =
  `${CREDIT_READING}, Epics left out; the closer, further and level counts are the measures on ` +
  "which the person's figure stands closer to the process than the board's, further from it, or level with it " +
  "(within 5 points, 0.5 for the ratio); measures compared is their sum; too few tickets counts the measures where " +
  `either side rests on fewer than ${MIN_TICKETS} tickets; open findings per 10 open tickets is the open breaches ` +
  "and warnings on the person's open tickets for every 10 of those tickets, compared only when it rests on enough " +
  "tickets";

/** The work that counts for no one, as a ranking by a count names it after the people: "148 open tickets". */
export const UNASSIGNED_WORDS: Record<RankedCount, readonly [string, string]> = {
  open_tickets: ["open ticket", "open tickets"],
  in_progress: ["ticket in progress", "tickets in progress"],
  done_in_period: ["ticket done", "tickets done"],
};

/** A measure named mid-sentence, as a reader writes it: "by reopened after Done", never "by Reopened after Done". */
const named = (label: string) => label.slice(0, 1).toLowerCase() + label.slice(1);

/** "the last 90 days ( to )": the days as the service writes them, readable on both sides of the Atlantic. */
function periodWords(set: ScorecardSet): string {
  return `the last ${set.period.days} days (${spelledDay(set.period.from)} to ${spelledDay(set.period.to)})`;
}

/** A figure as the page shows it: "72% · 18 of 25" (a rate), "12" (a count), "2.3" (the ratio); null when there is none. */
function shown(measure: Pick<ScorecardMeasure, "kind">, value: ScorecardValue): string | null {
  if (value.value === null) return null;
  if (measure.kind === "count") return String(value.value);
  if (measure.kind === "ratio") return value.value.toFixed(1);
  return `${value.value}% · ${value.numerator} of ${value.denominator}`;
}

/** A figure in a sentence: "72%", "2.3", "12". */
function inSentence(measure: Pick<ScorecardMeasure, "kind">, value: ScorecardValue): string {
  if (measure.kind === "rate") return `${value.value}%`;
  if (measure.kind === "ratio" && value.value !== null) return value.value.toFixed(1);
  return String(value.value);
}

/* ------------------------------------------------------------ the facts -- */

/** oversight_person_scorecard(project, person_ids, days): a row per person asked about and measure, the board's beside it. */
export function scorecardFacts(dataset: Dataset, ref: string, people: readonly Person[], days: ScorecardDays): FactSet {
  const set = scorecards(dataset, days);
  const found = people.map((person) => set.byId.get(person.id)).filter((row): row is ScorecardPerson => row !== undefined);
  const rows: Row[] = found.flatMap((row) =>
    set.measures.map((measure): Row => {
      const value = row.values[measure.key];
      const board = set.board.values[measure.key];
      return {
        person_id: row.person.id,
        name: row.person.name,
        measure: measure.key,
        label: measure.label,
        kind: measure.kind,
        value: value.value,
        numerator: value.numerator,
        denominator: value.denominator,
        shown: shown(measure, value),
        enough: value.enough,
        vs_board: value.vs_board,
        board_value: board.value,
        board_numerator: board.numerator,
        board_denominator: board.denominator,
        board_shown: shown(measure, board),
        measurable: measure.measurable,
        reason: measure.reason,
        rule_ids: measure.rule_ids.length > 0 ? measure.rule_ids.join(", ") : null,
      };
    }),
  );
  return {
    ref,
    tool: "oversight_person_scorecard",
    params: { project: dataset.board.key, person_ids: people.map((person) => person.id), days },
    columns: SCORECARD_COLUMNS,
    rows,
    truncated: false,
    as_of: iso(dataset.world.syncAt),
    note: `each person's figures over ${periodWords(set)}, next to the whole board's, ${READING}`,
  };
}

/** The measures a comparison can be over: those compared with the board (rates and the ratio). */
export type ComparedKey = Exclude<ScorecardMeasureKey, "open_tickets" | "in_progress" | "done_in_period">;
/** The counts everyone can be put in order by, most first (whose backlog is */
export type RankedCount = "open_tickets" | "in_progress" | "done_in_period";
/** The counts of now, which no period bounds: their comparison takes no days, and their answer states none. */
const NOW_COUNTS: readonly RankedCount[] = ["open_tickets", "in_progress"];
export const OVERALL = "overall";

/** The rates of now: the open tickets stuck now, the open findings per 10 open tickets now (the service's NOW_MEASURES). */
const NOW_MEASURES: readonly string[] = ["stuck_now", "open_findings_per_10"];

export type CompareOrder = "closer" | "most" | "fewest";

/** How a comparison is asked for beyond its measure: its order, a question's "top N" or "bottom N", the people asked about. */
export interface CompareOptions {
  order?: CompareOrder;
  n?: number | null;
  /** Only these people (two to ten mentioned side by side), as the service's person_ids. */
  only?: readonly string[] | null;
}

const isCount = (measure: string) => measure === "open_tickets" || measure === "in_progress" || measure === "done_in_period";

export function effectiveOrder(measure: string, order: CompareOrder): CompareOrder {
  if (order === "fewest") return "fewest";
  if (isCount(measure)) return "most";
  return measure === OVERALL || order === "closer" ? "closer" : "most";
}

export function orderWords(measure: string, order: CompareOrder): string {
  if (measure === OVERALL || isCount(measure)) return order === "fewest" ? "fewest first" : "most first";
  return order === "most" ? "highest first" : order === "fewest" ? "lowest first" : "closest to the process first";
}

export function compareOrder(measure: Pick<ScorecardMeasure, "key" | "direction">, people: readonly ScorecardPerson[], order: CompareOrder = "closer"): ScorecardPerson[] {
  const counted = measure.direction === "neutral";
  const used = counted && order === "closer" ? "most" : order;
  const highest = used === "closer" ? measure.direction === "higher_is_closer" : used === "most";
  const sign = highest ? -1 : 1;
  const rank = (row: ScorecardPerson) => {
    const value = row.values[measure.key];
    return (value.enough || counted) && value.value !== null ? sign * value.value : Number.POSITIVE_INFINITY;
  };
  return [...people].sort((a, b) => rank(a) - rank(b));
}

interface Overall {
  row: ScorecardPerson;
  closer: number;
  level: number;
  further: number;
  compared: number;
  tooFew: number;
}

/** The overall order: the number of measures on which a person is closer to */
export function overallOrder(measures: readonly ScorecardMeasure[], people: readonly ScorecardPerson[], order: CompareOrder = "closer"): Overall[] {
  const tally = people.map((row): Overall => {
    const compared = measures.filter((measure) => measure.measurable && measure.kind !== "count");
    const marks = compared.map((measure) => row.values[measure.key].vs_board);
    return {
      row,
      closer: marks.filter((mark) => mark === "closer").length,
      level: marks.filter((mark) => mark === "level").length,
      further: marks.filter((mark) => mark === "further").length,
      compared: marks.filter((mark) => mark !== null).length,
      tooFew: marks.filter((mark) => mark === null).length,
    };
  });
  const ratio = (entry: Overall) => {
    const value = entry.row.values.open_findings_per_10;
    return value.enough && value.value !== null ? value.value : Number.POSITIVE_INFINITY;
  };
  // Two figures on too few tickets tie (Infinity - Infinity is NaN, which sort reads as level).
  const tie = (difference: number) => (Number.isNaN(difference) ? 0 : difference);
  if (order === "fewest") {
    return tally.sort((a, b) => Number(a.compared === 0) - Number(b.compared === 0) || a.closer - b.closer || tie(ratio(b) - ratio(a)));
  }
  return tally.sort((a, b) => Number(a.compared === 0) - Number(b.compared === 0) || b.closer - a.closer || tie(ratio(a) - ratio(b)));
}

/** oversight_people_compare(project, measure, days, order, n): everyone with */
export function compareFacts(
  dataset: Dataset,
  ref: string,
  measure: ComparedKey | RankedCount | typeof OVERALL,
  days: ScorecardDays,
  { order: asked = "closer", n = null, only = null }: CompareOptions = {},
): FactSet {
  const set = scorecards(dataset, days);
  const now = (NOW_COUNTS as readonly string[]).includes(measure);
  const order = effectiveOrder(measure, asked);
  const fewest = order === "fewest";
  const params = {
    project: dataset.board.key,
    measure,
    ...(now ? {} : { days }),
    order,
    ...(n ? { n } : {}),
    ...(only ? { person_ids: [...only] } : {}),
  };
  const askedAbout = (person: Person) => only === null || only.includes(person.id);
  const everyone = only ? "the people asked about" : "everyone with tickets";
  const limit = n ?? Number.POSITIVE_INFINITY;
  const as_of = iso(dataset.world.syncAt);
  if (measure === OVERALL) {
    const ordered = overallOrder(set.measures, set.withTickets, order);
    return {
      ref,
      tool: "oversight_people_compare",
      params,
      columns: OVERALL_COLUMNS,
      rows: ordered.slice(0, limit).map((entry) => ({
        person_id: entry.row.person.id,
        name: entry.row.person.name,
        closer: entry.closer,
        further: entry.further,
        level: entry.level,
        compared: entry.compared,
        too_few: entry.tooFew,
        open_findings_per_10: entry.row.values.open_findings_per_10.value,
        open_findings: entry.row.values.open_findings_per_10.numerator,
        open_tickets: entry.row.values.open_findings_per_10.denominator,
        enough: entry.row.values.open_findings_per_10.enough,
        standing: entry.compared === 0 ? TOO_FEW : null,
      })),
      truncated: ordered.length > limit,
      as_of,
      note:
        "everyone with tickets, by the number of measures on which they are closer to the process than the whole board over " +
        `${periodWords(set)}, ${fewest ? "fewest" : "most"} first, ties by open findings per 10 open tickets (${fewest ? "more" : "fewer"} first; ` +
        `a figure on too few tickets is never compared, so it counts as the most), people compared on no measure last; ${OVERALL_READING}`,
    };
  }
  const counted = isCount(measure);
  const definition = set.measures.find((candidate) => candidate.key === measure)!;
  const ordered = compareOrder(definition, set.withTickets, order).filter((row) => askedAbout(row.person));
  const line = (person: Person | null, value: ScorecardValue, name = BOARD_NAME): Row => ({
    person_id: person?.id ?? null,
    name: person?.name ?? name,
    measure,
    label: definition.label,
    kind: definition.kind,
    value: value.value,
    numerator: value.numerator,
    denominator: value.denominator,
    shown: shown(definition, value),
    enough: value.enough,
    vs_board: value.vs_board,
    standing: person === null || counted ? null : value.vs_board ? STANDING[value.vs_board] : TOO_FEW,
    measurable: definition.measurable,
    reason: definition.reason,
  });
  // After a ranking by a count, the work that is no one's: the tickets that count for no one.
  const nobody = counted && definition.measurable && set.noOne && only === null ? [line(null, set.noOne.values[measure], UNASSIGNED_LABEL)] : [];
  const people = definition.measurable ? ordered.slice(0, limit).map((row) => line(row.person, row.values[measure])) : [];
  // A count of now states no period, and its label may say "now" already ("In progress now").
  const when = now ? (definition.label.endsWith(" now") ? "" : " now") : ` over ${periodWords(set)}`;
  const then = nobody.length > 0 ? "the tickets that count for no one (Unassigned, never ranked), then the whole board" : "the whole board";
  // As the service notes the order: closer first says which way that is; most and fewest, highest or lowest first.
  const direction = definition.direction === "higher_is_closer" ? "highest" : "lowest";
  const orderSaid = order === "closer" ? `closest to the process first (${direction} first)` : order === "most" ? "highest first" : "lowest first";
  return {
    ref,
    tool: "oversight_people_compare",
    params,
    columns: COMPARE_COLUMNS,
    rows: [...people, ...nobody, line(null, set.board.values[measure])],
    truncated: definition.measurable && ordered.length > limit,
    as_of,
    note: !definition.measurable
      ? `${definition.label} is not measurable on this board: ${definition.reason}`
      : counted
        ? `${everyone}, by ${named(definition.label)}${when}, ${fewest ? "fewest" : "most"} first, ties by name, then ${then} ` +
          `(a count is never set beside the board as closer or further); ${READING}`
        : `${everyone}, by ${named(definition.label)} over ${periodWords(set)}, ${orderSaid}, ` +
          `people with too few tickets last, then the whole board; ${READING}`,
  };
}

/* -------------------------------------------------------------- the words -- */

/** A cited figure from a fact set's parameters (the period's days). */
const param = (fact: FactSet, text: string): Piece => ({ text, fact, row: -1, column: "params" });

/** A measure's label in a sentence: words, never a figure ("per 10 open tickets" is no one's figure), so never cited. */
function labelPieces(_fact: FactSet, label: string): Piece[] {
  return [label];
}

const labels = (fact: FactSet, items: readonly string[]): Piece[] => listed(items.map((label) => labelPieces(fact, label)));

/** The caveat, its days cited from the parameters: the final paragraph of every scorecard or comparison answer. */
function caveatPieces(fact: FactSet, days: number, codeReview: boolean, credit: CreditReading): Piece[] {
  const text = scorecardCaveat(days, codeReview, credit);
  const [before, after] = text.split(String(days));
  return [before, param(fact, String(days)), after];
}

/** Whether the board records code review, as the caveat says it. */
const codeReviewShown = (set: ScorecardSet) => recordsCodeReview(set.measures);

/** "{Name}, last {days} days, next to the board: closer to the process on …; further from it on …; level on …." */
function personSummary(fact: FactSet, set: ScorecardSet, row: ScorecardPerson, days: number, notMeasurable: readonly string[]): Piece[] {
  const marked = (mark: ScorecardValue["vs_board"]) =>
    set.measures.filter((measure) => measure.measurable && row.values[measure.key].vs_board === mark).map((measure) => measure.label);
  const tooFew = set.measures
    .filter((measure) => measure.measurable && measure.kind !== "count" && row.values[measure.key].vs_board === null)
    .map((measure) => measure.label);
  const clauses: Piece[][] = [];
  if (marked("closer").length > 0) clauses.push(["closer to the process on ", ...labels(fact, marked("closer"))]);
  if (marked("further").length > 0) clauses.push(["further from it on ", ...labels(fact, marked("further"))]);
  if (marked("level").length > 0) clauses.push(["level on ", ...labels(fact, marked("level"))]);
  const pieces: Piece[] = [row.person.name, ", last ", param(fact, String(days)), " days, next to the board"];
  if (clauses.length === 0) pieces.push(".");
  else pieces.push(": ", ...clauses.flatMap((clause, index) => (index === 0 ? clause : ["; ", ...clause])), ".");
  if (tooFew.length > 0) pieces.push(" Too few tickets to compare: ", ...labels(fact, tooFew), ".");
  if (notMeasurable.length > 0) pieces.push(" Not measurable on this board: ", ...labels(fact, notMeasurable), ".");
  return pieces;
}

/** Then the decision sentence for a personnel question, then the caveat: how every such answer closes. */
function closing(fact: FactSet, set: ScorecardSet, days: number, personnel: boolean): Piece[] {
  return [...(personnel ? ["\n\n", SCORECARD_SENTENCES.decision] : []), "\n\n", ...caveatPieces(fact, days, codeReviewShown(set), set.credit)];
}

/** One person's scorecard, or several side by side: a summary each, next to */
export function scorecardAnswer(dataset: Dataset, people: readonly Person[], days: ScorecardDays, personnel: boolean): ScriptResult {
  const fact = scorecardFacts(dataset, "F1", people, days);
  const set = scorecards(dataset, days);
  const rows = people.map((person) => set.byId.get(person.id)).filter((row): row is ScorecardPerson => row !== undefined);
  const notMeasurable = set.measures.filter((measure) => !measure.measurable).map((measure) => measure.label);
  const paragraphs = rows.map((row) => personSummary(fact, set, row, days, rows.length === 1 ? notMeasurable : []));
  if (rows.length > 1 && notMeasurable.length > 0) paragraphs.push(["Not measurable on this board: ", ...labels(fact, notMeasurable), "."]);
  const pieces: Piece[] = [...paragraphs.flatMap((paragraph, index) => (index === 0 ? paragraph : ["\n\n", ...paragraph])), ...closing(fact, set, days, personnel)];
  return { outcome: "answered", facts: [fact], pieces };
}

/** Everyone in order by one measure, or overall, in the order asked */
export function comparisonAnswer(
  dataset: Dataset,
  measure: ComparedKey | RankedCount | typeof OVERALL,
  days: ScorecardDays,
  personnel: boolean,
  options: CompareOptions & { members?: boolean } = {},
): ScriptResult {
  const fact = compareFacts(dataset, "F1", measure, days, options);
  const set = scorecards(dataset, days);
  const now = (NOW_COUNTS as readonly string[]).includes(measure);
  const members = options.members ? boardPeopleFacts(dataset, "F2", "none") : null;
  const facts = members ? [fact, members] : [fact];
  const after: Piece[] = members ? [" ", ...boardPeoplePieces(members)] : [];
  const ending = (): Piece[] => [...after, ...(now ? (personnel ? ["\n\n", SCORECARD_SENTENCES.decision] : []) : closing(fact, set, days, personnel))];
  const people = fact.rows.flatMap((row, index) => (row.person_id !== null ? [{ row, index }] : []));
  const definition = measure === OVERALL ? null : set.measures.find((candidate) => candidate.key === measure)!;
  if (definition && !definition.measurable) {
    return {
      outcome: "answered",
      facts: [fact],
      pieces: ["Not measurable on this board: ", ...labelPieces(fact, definition.label), `. ${definition.reason}`, ...closing(fact, set, days, personnel)],
    };
  }
  if (people.length === 0) {
    return { outcome: "no_data", facts: [fact], message: "No ticket on this board is assigned to anyone, so there is no one to compare.", suggestions: [] };
  }
  const pieces: Piece[] = [];
  // The order the facts are in, said in plain words: "highest first", "lowest first", "most first", ...
  const firstWords = orderWords(measure, fact.params.order as CompareOrder);
  let compared: typeof people;
  if (measure === OVERALL) {
    compared = people.filter(({ row }) => Number(row.compared) > 0);
    if (compared.length > 0) {
      pieces.push(
        "Measures closer to the process than the board, last ",
        param(fact, String(days)),
        ` days, ${firstWords}: `,
        ...listed(
          compared.map(({ row, index }) => [
            String(row.name),
            " ",
            { text: String(row.closer), fact, row: index, column: "closer" },
            " of ",
            { text: String(row.compared), fact, row: index, column: "compared" },
          ]),
        ),
        ".",
      );
    }
  } else if (definition) {
    // The whole board's row is the last with no person; a count's ranking has the work that counts for no one before it.
    const boardIndex = fact.rows.length - 1;
    const unassignedIndex = fact.rows.findIndex((row) => row.person_id === null && row.name === UNASSIGNED_LABEL);
    const counted = definition.kind === "count";
    compared = people.filter(({ row }) => (counted || row.enough === true) && row.value !== null);
    // A rate is quoted as the page shows it ("72%", from the row's shown figure); the ratio and a count as their value.
    const figure = (index: number): Piece => {
      const row = fact.rows[index];
      const value = { value: row.value as number | null, numerator: row.numerator as number | null, denominator: row.denominator as number | null, enough: true, vs_board: null };
      return definition.kind === "rate"
        ? { text: inSentence(definition, value), fact, row: index, column: "shown" }
        : { text: inSentence(definition, value), fact, row: index, column: "value" };
    };
    if (compared.length > 0) {
      // A count of now, or a rate of now (stuck now, open findings per 10 open tickets), states no period: none is true of it.
      const period: Piece[] = now || NOW_MEASURES.includes(measure) ? [] : [", last ", param(fact, String(days)), " days"];
      pieces.push(
        ...labelPieces(fact, definition.label),
        ...period,
        `, ${firstWords}: `,
        ...listed(compared.map(({ row, index }) => [String(row.name), " ", figure(index)])),
        ".",
      );
    }
    // After the ranking, never in it: "Unassigned: 148 open tickets.", only when it holds some.
    const unassigned = unassignedIndex >= 0 ? Number(fact.rows[unassignedIndex].value ?? 0) : 0;
    if (counted && unassigned > 0) {
      const [one, several] = UNASSIGNED_WORDS[measure as RankedCount];
      pieces.push(...(pieces.length > 0 ? [" "] : []), `${UNASSIGNED_LABEL}: `, figure(unassignedIndex), ` ${unassigned === 1 ? one : several}.`);
    }
    if (boardIndex >= 0 && fact.rows[boardIndex].value !== null) pieces.push(...(pieces.length > 0 ? [" "] : []), "The whole board: ", figure(boardIndex), ".");
  } else {
    compared = people;
  }
  const tooFew = people.filter((entry) => !compared.includes(entry)).map(({ row }) => [String(row.name)]);
  if (tooFew.length > 0) pieces.push(...(pieces.length > 0 ? [" "] : []), "Too few tickets to compare: ", ...listed(tooFew), ".");
  pieces.push(...ending());
  return { outcome: "answered", facts, pieces };
}

export function busiestAnswer(dataset: Dataset, days: ScorecardDays, personnel: boolean, { n = null, doing = false }: CompareOptions & { doing?: boolean } = {}): ScriptResult {
  const open = comparisonAnswer(dataset, "open_tickets", days, personnel, { n, order: "most" });
  if (!doing || open.outcome !== "answered") return open;
  const done = comparisonAnswer(dataset, "done_in_period", days, personnel, { n, order: "most" });
  if (done.outcome !== "answered") return open;
  const [fact] = done.facts;
  const second: FactSet = { ...fact, ref: "F2" };
  const pieces = done.pieces.map((piece) => (typeof piece === "string" || piece.fact !== fact ? piece : { ...piece, fact: second }));
  return { outcome: "answered", facts: [...open.facts, second], pieces: [...open.pieces, " ", ...pieces] };
}

/* ------------------------------------------------------------- backlog -- */

const TICKET_COLUMNS: Column[] = [
  { key: "issue_key", label: "Issue", kind: "issue_key" },
  { key: "summary", label: "Summary", kind: "text" },
  { key: "issue_type", label: "Type", kind: "text" },
  { key: "status", label: "Status", kind: "text" },
  { key: "epic_key", label: "Epic", kind: "issue_key" },
  { key: "assignee_id", label: "Person id", kind: "text" },
  { key: "assignee", label: "Assignee", kind: "text" },
];
/** A person's tickets: the person they count for, who may not be assigned them now (the service's _CREDITED_COLUMNS). */
const CREDITED_COLUMNS: Column[] = [...TICKET_COLUMNS.slice(0, -1), { key: "assignee", label: "Counts for", kind: "text" }];

/** The longest list of one person's tickets an answer asks for (their backlog, what they finished): the whole of it. */
const WHOLE_LIST = 200;

export function openTicketsFacts(dataset: Dataset, ref: string, person: Person, n = WHOLE_LIST): FactSet {
  const issues = ticketsOf(dataset, person.id)
    .filter((issue) => isWork(issue) && STATUS[issue.status].category !== "done")
    .sort((a, b) => b.createdAt - a.createdAt || b.num - a.num);
  return {
    ref,
    tool: "oversight_person_tickets",
    params: { project: dataset.board.key, person: person.id, state: "open", n },
    columns: CREDITED_COLUMNS,
    rows: issues.slice(0, n).map((issue) => ({
      issue_key: issue.key,
      summary: issue.summary,
      issue_type: issue.type,
      status: issue.status,
      epic_key: issue.epicKey,
      assignee_id: person.id,
      assignee: person.name,
    })),
    truncated: issues.length > n,
    as_of: iso(dataset.world.syncAt),
    note: `open tickets (status not done, Epics left out, as the scorecard counts them) that count for this person (the board's credit setting), newest first; ${issues.length} in all`,
  };
}

export function doneTicketsFacts(dataset: Dataset, ref: string, person: Person, days: ScorecardDays, n = WHOLE_LIST): FactSet {
  const set = scorecards(dataset, days);
  const issues = ticketsOf(dataset, person.id)
    .filter((issue) => isWork(issue) && within(set.period, issue.doneAt))
    .sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0) || b.num - a.num);
  return {
    ref,
    tool: "oversight_person_tickets",
    params: { project: dataset.board.key, person: person.id, state: "done", days, n },
    columns: CREDITED_COLUMNS,
    rows: issues.slice(0, n).map((issue) => ({
      issue_key: issue.key,
      summary: issue.summary,
      issue_type: issue.type,
      status: issue.status,
      epic_key: issue.epicKey,
      assignee_id: person.id,
      assignee: person.name,
    })),
    truncated: issues.length > n,
    as_of: iso(dataset.world.syncAt),
    note: `tickets done in ${periodWords(set)} (Epics left out, as the scorecard counts them) that count for this person (the board's credit setting), newest first; ${issues.length} in all`,
  };
}

/** "How many tickets did @X finish this month?": their tickets done in the period, as the scorecard counts them. */
export function doneAnswer(dataset: Dataset, person: Person, days: ScorecardDays): ScriptResult {
  const facts = doneTicketsFacts(dataset, "F1", person, days);
  const count = facts.rows.length;
  const total: Piece = { text: String(count), fact: facts, row: -1, column: "row_count" };
  const period: Piece[] = [" in the last ", { text: String(days), fact: facts, row: -1, column: "params" }, " days"];
  if (count === 0) return { outcome: "answered", facts: [facts], pieces: [person.name, " has no tickets done", ...period, "."] };
  const keys = facts.rows.map((_, index): Piece[] => [{ text: String(facts.rows[index].issue_key), fact: facts, row: index, column: "issue_key" }]);
  const pieces: Piece[] = [person.name, " has ", total, count === 1 ? " ticket done" : " tickets done", ...period];
  if (count <= 4) pieces.push(": ", ...listed(keys), ".");
  else pieces.push(". The latest are ", ...listed(keys.slice(0, 3)), "; the table lists all ", { ...total }, ".");
  return { outcome: "answered", facts: [facts], pieces };
}

/** oversight_ticket_assignee(project, issue_key): one ticket and who holds it now, or that nobody does. */
export function ticketAssigneeFacts(dataset: Dataset, ref: string, key: string): FactSet {
  const issue = dataset.world.issues.find((candidate) => candidate.key === key);
  const holder = issue ? personOf(issue) : null;
  return {
    ref,
    tool: "oversight_ticket_assignee",
    params: { project: dataset.board.key, issue_key: key },
    columns: TICKET_COLUMNS,
    rows: issue
      ? [{ issue_key: issue.key, summary: issue.summary, issue_type: issue.type, status: issue.status, epic_key: issue.epicKey,
           assignee_id: holder?.id ?? null, assignee: holder?.name ?? "Unassigned" }]
      : [],
    truncated: false,
    as_of: iso(dataset.world.syncAt),
    note: !issue
      ? `no ticket ${key} on this board`
      : holder
        ? "the ticket and who holds it now (its current assignee)"
        : "the ticket and who holds it now: nobody is assigned it",
  };
}

/** "Who is assigned DEMO-12?": the ticket's assignee now, by name, or that nobody is. */
export function ticketAssigneeAnswer(dataset: Dataset, key: string): ScriptResult {
  const facts = ticketAssigneeFacts(dataset, "F1", key);
  if (facts.rows.length === 0) {
    return { outcome: "no_data", facts: [facts], message: `Nothing in the ${dataset.board.key} snapshot matched. Looked at: ${key}.`, suggestions: [] };
  }
  const row = facts.rows[0];
  const ticket: Piece = { text: key, fact: facts, row: 0, column: "issue_key" };
  const pieces: Piece[] = row.assignee_id
    ? [ticket, ` (${String(row.status)}) is assigned to `, String(row.assignee), " now."]
    : ["Nobody is assigned ", ticket, ` (${String(row.status)}) now.`];
  return { outcome: "answered", facts: [facts], pieces };
}

/** "What is @X's backlog?": their open tickets now. */
export function backlogAnswer(dataset: Dataset, person: Person): ScriptResult {
  const facts = openTicketsFacts(dataset, "F1", person);
  const count = facts.rows.length;
  if (count === 0) return { outcome: "answered", facts: [facts], pieces: [`${person.name} has no open tickets.`] };
  const keys = facts.rows.map((_, index): Piece[] => [{ text: String(facts.rows[index].issue_key), fact: facts, row: index, column: "issue_key" }]);
  const total: Piece = { text: String(count), fact: facts, row: -1, column: "row_count" };
  const pieces: Piece[] = [person.name, facts.truncated ? " has more than " : " has ", total, count === 1 ? " open ticket" : " open tickets"];
  if (count <= 4) pieces.push(": ", ...listed(keys), ".");
  else pieces.push(". The newest are ", ...listed(keys.slice(0, 3)), "; the table lists all ", { ...total }, ".");
  return { outcome: "answered", facts: [facts], pieces };
}

/* ------------------------------------------------------- reading a question -- */

/** The period a question names, in the days a scorecard reads: 180 for half a */
export function daysIn(question: string): ScorecardDays {
  const words = normalise(question);
  if (/\b(?:180|hundred and eighty)\s+days\b|\b(?:6|six)\s+months\b|\bhalf[\s-](?:a[\s-])?year\b|\b(?:26|twenty[\s-]six)\s+weeks\b|\ball[\s-]time\b|\bsince the (?:beginning|start)\b/.test(words)) {
    return 180;
  }
  if (/\b(?:last|this|active|current|the)\s+sprint\b|\b(?:7|seven|30|thirty)\s+days\b|\b(?:this|last|past|previous)\s+(?:week|month)\b|\b(?:4|four)\s+weeks\b|\ba\s+month\b/.test(words)) {
    return 30;
  }
  return SCORECARD_DEFAULT_DAYS;
}

/** Which measure a comparison question names, if any (the compared ones: rates */
const MEASURE_WORDS: readonly [ComparedKey, RegExp][] = [
  [
    "within_estimate",
    /\b(?:within|over|under|beyond) (?:the |their |its )?(?:estimates?|effort(?: limit)?|limit)\b|\bover[\s-]?r[au]n\w*|\beffort\b|\bburn|\bexceed\w*\s+(?:the |their |its )?(?:estimates?|effort|limit)\b|\bover-?spen[dt]\w*|\bactuals?\s+(?:vs\.?|versus|against|over|to)\s+(?:the\s+)?estimates?\b/,
  ],
  ["estimated_before_start", /\bun-?estimat\w*|\bunsized\b|\bestimat\w*|\bsized?\b|\bsizing\b|\bstory points?\b/],
  [
    "time_logged",
    new RegExp(
      [
        String.raw`\blog(?:s|ged|ging)?\s+(?:\w+\s+){0,2}?time\b|\btime[\s-]?(?:logged|logging|tracking|sheets?)\b|\bworklogs?\b|\btimesheets?\b`,
        String.raw`\b(?:log|book|record)(?:s|ed|ged|ing|ging)?\s+(?:(?:their|his|her|any|the|most|more|fewest|fewer|least|less|no)\s+){0,2}hours\b`,
        String.raw`\b(?:time|hours)\s+(?:\w+\s+){0,4}?(?:log|book|record|track)(?:s|ed|ged|ing|ging)?\b`,
        String.raw`\b(?:track|record|book)(?:s|ed|ing)?\s+(?:of\s+)?(?:(?:their|his|her|any|the|most|more|fewest|fewer|least|less|no|all)\s+){0,2}time\b`,
        String.raw`\bfill(?:s|ed|ing)?\s+in\s+(?:(?:their|his|her|any|the)\s+){0,2}(?:time|hours|timesheets?)\b`,
        String.raw`\b(?:work(?:s|ed|ing)?|spen(?:d|ds|ding|t))\s+(?:(?:their|his|her|any|the|most|more|fewest|fewer|least|less|no)\s+){0,2}hours\b`,
      ].join("|"),
    ),
  ],
  ["stuck_now", /\bstuck\b|\bstalled\b|\bstale\b|\bsitting\b|\blinger\w*/],
  ["reopened", /\bre-?open\w*|\bbounced back\b|\bcame back\b/],
  ["skipped_stage", /\bskip\w*|\bstraight to done\b|\bjump\w*|\bbypass\w*/],
  ["code_review", /\bcode[\s-]?reviews?\b|\breview(?:s|ed|ing)?\s+(?:the\s+|their\s+)?code\b|\breviewed\b/],
  ["open_findings_per_10", /\bfindings?\b|\bbreach\w*|\bwarnings?\b|\bviolations?\b|\bbroken rules?\b/],
];

export function measureIn(question: string): ComparedKey | null {
  const words = normalise(question);
  return MEASURE_WORDS.find(([, pattern]) => pattern.test(words))?.[0] ?? null;
}

const OVER_THE_LIMIT =
  /\b(?:over|beyond)\s+(?:the |their |its )?(?:estimates?|effort(?: limit)?|limit)\b|\bover[\s-]?r[au]n\w*|\bburn\w*|\bexceed\w*|\beffort[\s-]?ratios?\b|\bover-?spen[dt]\w*|\bactuals?\s+(?:vs\.?|versus|against|over|to)\s+(?:the\s+)?estimates?\b/;

function turned(words: string, measure: ComparedKey): boolean {
  const pattern = MEASURE_WORDS.find(([key]) => key === measure)?.[1];
  const found = pattern ? pattern.exec(words) : null;
  if (!found) return false;
  const negated = NEGATION_BEFORE.test(words.slice(0, found.index)) || found[0].startsWith("un");
  const over = measure === "within_estimate" && OVER_THE_LIMIT.test(words);
  return negated !== over;
}

function furtherFirst(measure: ComparedKey | typeof OVERALL): AskedOrder {
  if (measure === OVERALL) return "fewest";
  return SCORECARD_MEASURES.find((candidate) => candidate.key === measure)?.direction === "lower_is_closer" ? "most" : "fewest";
}

export function orderFor(question: string, measure: ComparedKey | typeof OVERALL): CompareOrder | null {
  const words = normalise(question);
  const asked = orderNear(words, measure === OVERALL ? null : (MEASURE_WORDS.find(([key]) => key === measure)?.[1] ?? null));
  if (asksAboutTheFurtherSide(words)) return asked === "fewest" ? "closer" : furtherFirst(measure);
  if (asked === null || measure === OVERALL || !turned(words, measure)) return asked;
  return asked === "most" ? "fewest" : "most";
}

