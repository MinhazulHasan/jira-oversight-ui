import { z } from "zod";

import { firstOrder, type SortOrder } from "@/components/people/model";
import {
  SCORECARD_DEFAULT_DAYS,
  SCORECARD_MEASURES,
  UNASSIGNED_LABEL,
  scorecardMeasureKeySchema,
  vsBoardSchema,
  type FactSet,
  type Person,
  type ScorecardMeasure,
  type ScorecardMeasureKey,
  type ScorecardValue,
} from "@/lib/api/schemas";

export const SCORECARD_TOOL = "oversight_person_scorecard";
export const COMPARE_TOOL = "oversight_people_compare";

const count = z.number().int().nonnegative().nullable().optional();
const figure = z.number().nonnegative().nullable().optional();
/** A cell the service may write as a boolean or as text ("true", "yes"). */
const flag = z
  .union([z.boolean(), z.string(), z.null()])
  .optional()
  .transform((value) => (typeof value === "string" ? /^(true|yes|1)$/i.test(value.trim()) : value ?? null));

const scorecardRow = z.object({
  person_id: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  measure: scorecardMeasureKeySchema,
  label: z.string().nullable().optional(),
  value: figure,
  numerator: count,
  denominator: count,
  enough: flag,
  vs_board: vsBoardSchema.nullable().optional(),
  board_value: figure,
  board_numerator: count,
  board_denominator: count,
  measurable: flag,
  reason: z.string().nullable().optional(),
});

type ScorecardRow = z.output<typeof scorecardRow>;

const valueOf = (row: Pick<ScorecardRow, "value" | "numerator" | "denominator" | "enough" | "vs_board">): ScorecardValue => ({
  value: row.value ?? null,
  numerator: row.numerator ?? null,
  denominator: row.denominator ?? null,
  enough: row.enough === true,
  vs_board: row.vs_board ?? null,
});

const boardOf = (row: ScorecardRow): ScorecardValue => ({
  value: row.board_value ?? null,
  numerator: row.board_numerator ?? null,
  denominator: row.board_denominator ?? null,
  enough: false,
  vs_board: null,
});

export interface FactScorecards {
  days: number;
  measures: ScorecardMeasure[];
  people: { person: Person; values: Partial<Record<ScorecardMeasureKey, ScorecardValue>> }[];
  board: Partial<Record<ScorecardMeasureKey, ScorecardValue>>;
}

function daysOf(fact: FactSet): number {
  const days = fact.params.days;
  return typeof days === "number" && Number.isFinite(days) ? days : SCORECARD_DEFAULT_DAYS;
}

export function scorecardsFromFacts(fact: FactSet, resolve: (id: string) => Person | null = () => null): FactScorecards | null {
  if (fact.tool !== SCORECARD_TOOL || fact.rows.length === 0) return null;
  const parsed = z.array(scorecardRow).safeParse(fact.rows);
  if (!parsed.success) return null;
  const people = new Map<string, FactScorecards["people"][number]>();
  const board: FactScorecards["board"] = {};
  const flags = new Map<ScorecardMeasureKey, { measurable: boolean | null; reason: string | null; label: string | null }>();
  for (const row of parsed.data) {
    const known = flags.get(row.measure);
    flags.set(row.measure, {
      measurable: known?.measurable ?? row.measurable,
      reason: known?.reason ?? row.reason ?? null,
      label: known?.label ?? row.label ?? null,
    });
    if (!row.person_id) {
      board[row.measure] = { ...valueOf(row), vs_board: null };
      continue;
    }
    if (row.board_value !== undefined || row.board_denominator !== undefined) board[row.measure] ??= boardOf(row);
    const person = resolve(row.person_id) ?? { id: row.person_id, name: row.name ?? "Someone", avatar: null };
    const entry = people.get(row.person_id) ?? { person, values: {} };
    entry.values[row.measure] = valueOf(row);
    people.set(row.person_id, entry);
  }
  if (people.size === 0) return null;
  const measures = SCORECARD_MEASURES.map((definition): ScorecardMeasure => {
    const known = flags.get(definition.key);
    const shown = board[definition.key];
    const empty = shown === undefined || (shown.value === null && shown.numerator === null && shown.denominator === null);
    const measurable = known?.measurable ?? !empty;
    return {
      key: definition.key,
      label: known?.label ?? definition.label,
      kind: definition.kind,
      direction: definition.direction,
      rule_ids: [],
      measurable,
      reason: measurable ? null : (known?.reason ?? "This board cannot show it."),
    };
  });
  return { days: daysOf(fact), measures, people: [...people.values()], board };
}

/* ------------------------------------------------------- the comparison -- */

const compareRow = z.object({
  position: count,
  person_id: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  value: figure,
  numerator: count,
  denominator: count,
  enough: flag,
  vs_board: vsBoardSchema.nullable().optional(),
  closer: count,
  level: count,
  further: count,
  compared: count,
  too_few: count,
  open_findings_per_10: figure,
  open_findings: count,
  open_tickets: count,
  standing: z.string().nullable().optional(),
  tickets: count,
});

export interface ComparedPerson {
  person: Person;
  /** By a measure: their figure for it. Overall: their open findings per 10 open tickets, with its counts. */
  value: ScorecardValue;
  closer: number | null;
  level: number | null;
  further: number | null;
  compared: number | null;
  /** The facts' standing: "Too few tickets" for someone compared on no measure (overall), the mark's words by one. */
  standing: string | null;
}

export interface FactComparison {
  days: number;
  /** The measure the order is by, or null for the overall order (measures closer than the board). */
  measure: ScorecardMeasure | null;
  order: ComparisonOrder;
  /** In the service's order (above), too few tickets last whatever the order. */
  people: ComparedPerson[];
  board: ScorecardValue | null;
  unassigned: ScorecardValue | null;
  only: boolean;
}

/** The orders a comparison can be in (the service's oversight_people_compare `order`). */
export type ComparisonOrder = "closer" | "most" | "fewest";

function orderOf(fact: FactSet, measure: ScorecardMeasure | null): ComparisonOrder {
  const order = fact.params.order;
  if (order === "most" || order === "fewest" || order === "closer") return order;
  return measure?.kind === "count" ? "most" : "closer";
}

/** Everyone in order from a comparison fact set, and the board's row; null when it is not one. */
export function comparisonFromFacts(fact: FactSet, resolve: (id: string) => Person | null = () => null): FactComparison | null {
  if (fact.tool !== COMPARE_TOOL || fact.rows.length === 0) return null;
  const parsed = z.array(compareRow).safeParse(fact.rows);
  if (!parsed.success) return null;
  const key = scorecardMeasureKeySchema.safeParse(fact.params.measure);
  const definition = key.success ? SCORECARD_MEASURES.find((candidate) => candidate.key === key.data) : undefined;
  const measure: ScorecardMeasure | null = definition
    ? { ...definition, rule_ids: [], measurable: true, reason: null }
    : null;
  const people: ComparedPerson[] = [];
  let board: ScorecardValue | null = null;
  let unassigned: ScorecardValue | null = null;
  const lastNobody = parsed.data.map((row) => !row.person_id).lastIndexOf(true);
  for (const [index, row] of parsed.data.entries()) {
    if (!row.person_id) {
      const value = { ...valueOf(row), value: measure ? (row.value ?? null) : (row.open_findings_per_10 ?? null), vs_board: null };
      // The whole board's row is the last with no person; a count's ranking has the work nobody holds before it.
      if (index === lastNobody) board = value;
      else if (row.name === UNASSIGNED_LABEL && measure?.kind === "count") unassigned = value;
      continue;
    }
    people.push({
      person: resolve(row.person_id) ?? { id: row.person_id, name: row.name ?? "Someone", avatar: null },
      // Overall, the ratio with its counts and whether it rests on enough tickets to be compared (contract 4.15).
      value: measure
        ? valueOf(row)
        : {
            value: row.open_findings_per_10 ?? null,
            numerator: row.open_findings ?? null,
            denominator: row.open_tickets ?? null,
            enough: row.enough === true,
            vs_board: null,
          },
      closer: row.closer ?? null,
      level: row.level ?? null,
      further: row.further ?? null,
      compared: row.compared ?? null,
      standing: row.standing ?? null,
    });
  }
  if (people.length === 0) return null;
  const only = Array.isArray(fact.params.person_ids) && fact.params.person_ids.length > 0;
  return { days: daysOf(fact), measure, order: orderOf(fact, measure), people, board, unassigned, only };
}

/** The counts of now, which no period bounds: their comparison states no days (the service's NOW_COUNTS). */
export const NOW_COUNTS: readonly string[] = ["open_tickets", "in_progress"];

export function comparisonOrderWords(comparison: Pick<FactComparison, "measure" | "order">): string {
  if (!comparison.measure || comparison.measure.kind === "count") return comparison.order === "fewest" ? "fewest first" : "most first";
  if (comparison.order === "most") return "highest first";
  return comparison.order === "fewest" ? "lowest first" : "closer to the process first";
}

export function peoplePageOrder(comparison: Pick<FactComparison, "measure" | "order">): SortOrder | undefined {
  if (!comparison.measure || comparison.order === "closer") return undefined;
  const wanted: SortOrder = comparison.order === "most" ? "desc" : "asc";
  return wanted === firstOrder(comparison.measure.key) ? undefined : wanted;
}
