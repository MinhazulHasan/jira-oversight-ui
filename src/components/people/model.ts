import { findingsSearchParams } from "@/lib/api/params";
import {
  SCORECARD_MEASURES,
  type Person,
  type ScorecardMeasure,
  type ScorecardMeasureKey,
  type ScorecardPerson,
  type ScorecardValue,
  type ScorecardValues,
} from "@/lib/api/schemas";
import { formatCount, formatNumber, formatShare, MISSING } from "@/lib/format";
import { compareByFoldedName } from "@/lib/names";

/*
 * The People page and the scorecard in words and order: how each figure
 * reads, which mark it carries next to the board, where its tickets are, and
 * how the everyone table sorts. Pure functions, so every phrase and every
 * order is tested without a browser. The marks are facts about tickets next
 * to the board, never a verdict on anyone: they are drawn in the neutral inks,
 * never the status colours.
 */

/** Where a figure stands next to the board's: the service's comparison, or too few tickets to make one. */
export type Mark = "closer" | "further" | "level" | "too_few";

/** The words each mark carries (with its icon, in the neutral inks: these are not good or bad). */
export const MARK_LABEL: Record<Mark, string> = {
  closer: "Closer to the process",
  further: "Further from the process",
  level: "Level with the board",
  too_few: "Too few tickets",
};

/**
 * What each measure counts, in plain words: the table's header tooltips and
 * the scorecard's own. They say exactly what the service counts (contract
 * 4.15): the work on their tickets now, Epics left out as every rule leaves
 * them out.
 */
export const MEASURE_DEFINITIONS: Record<ScorecardMeasureKey, string> = {
  open_tickets: "Their tickets that are not done now, Epics left out.",
  in_progress: "Their tickets in progress now, Epics left out.",
  done_in_period: "Their tickets done in the period, Epics left out.",
  estimated_before_start:
    "Tickets started in the period that had an estimate at the start.",
  time_logged: "Tickets done in the period with time logged.",
  within_estimate:
    "Tickets done with an estimate and time logged that stayed under the effort limit.",
  stuck_now:
    "Open tickets stuck in a status longer than usual.",
  reopened: "Tickets done in the period that were reopened.",
  skipped_stage: "Tickets done in the period that skipped a stage.",
  code_review: "Tickets that reached testing with code review recorded first.",
  open_findings_per_10: "Open findings per 10 open tickets.",
};

/** Which way is closer to the process, said once under a header. */
export function directionText(measure: Pick<ScorecardMeasure, "direction">): string | null {
  if (measure.direction === "higher_is_closer") return "Higher is closer to the process.";
  if (measure.direction === "lower_is_closer") return "Lower is closer to the process.";
  return null;
}

/* ------------------------------------------------------------- figures -- */

/** A figure as the page writes it: the value, and the counts behind it. */
export interface FigureText {
  /** "72%", "11", "13.5", or a dash when there is nothing to show. */
  value: string;
  /** "18 of 25", "9 findings on 10 open tickets", or null for a count. */
  detail: string | null;
  /** The whole figure as one phrase for assistive technology and a copy: "72%, 18 of 25". */
  spoken: string;
}

export function figureText(measure: Pick<ScorecardMeasure, "kind" | "measurable">, value: ScorecardValue, locale?: string): FigureText {
  if (!measure.measurable) return { value: MISSING, detail: null, spoken: "not measurable" };
  const counts =
    value.numerator === null || value.denominator === null
      ? null
      : measure.kind === "ratio"
        ? `${formatCount(value.numerator, { locale })} ${value.numerator === 1 ? "finding" : "findings"} on ${formatCount(value.denominator, { locale })} open ${value.denominator === 1 ? "ticket" : "tickets"}`
        : `${formatCount(value.numerator, { locale })} of ${formatCount(value.denominator, { locale })}`;
  if (value.value === null) {
    return { value: MISSING, detail: counts, spoken: counts ? `none to show, ${counts}` : "none to show" };
  }
  const shown =
    measure.kind === "rate"
      ? formatShare(value.value / 100, { locale })
      : measure.kind === "ratio"
        ? formatNumber(value.value, { locale, decimals: 1 })
        : formatCount(value.value, { locale });
  return { value: shown, detail: counts, spoken: counts ? `${shown}, ${counts}` : shown };
}

/**
 * The mark a person's figure carries: the service's comparison with the
 * board, or "too few tickets" for a rate or ratio it could not compare. A
 * count carries none (counts are never compared), and nor does a measure the
 * board cannot show.
 */
export function markOf(measure: Pick<ScorecardMeasure, "kind" | "measurable">, value: ScorecardValue): Mark | null {
  if (!measure.measurable || measure.kind === "count") return null;
  return value.vs_board ?? "too_few";
}

/** How a person's figures stand next to the board's, counted over the measures compared. */
export interface Standing {
  closer: number;
  further: number;
  level: number;
  /** The measures compared: both sides had enough tickets. */
  compared: number;
  /** Rates and ratios the board can show but this person has too few tickets for. */
  tooFew: number;
}

export function standingOf(measures: readonly ScorecardMeasure[], values: Partial<ScorecardValues>): Standing {
  const standing: Standing = { closer: 0, further: 0, level: 0, compared: 0, tooFew: 0 };
  for (const measure of measures) {
    const value = values[measure.key];
    // A measure a fact set holds no figure for (Ask's compact scorecard reads the facts) is no mark at all.
    if (value === undefined) continue;
    const mark = markOf(measure, value);
    if (mark === null) continue;
    if (mark === "too_few") standing.tooFew += 1;
    else {
      standing[mark] += 1;
      standing.compared += 1;
    }
  }
  return standing;
}

/** The scorecard's one-line summary: "Closer to the process than the board on 5 of 8 measures; further on 2, level on 1." */
export function standingText(standing: Standing): string {
  if (standing.compared === 0) return "Too few tickets to compare with the board on any measure.";
  const measures = standing.compared === 1 ? "measure" : "measures";
  const rest = [
    standing.further > 0 ? `further on ${standing.further}` : null,
    standing.level > 0 ? `level on ${standing.level}` : null,
  ].filter((part): part is string => part !== null);
  return `Closer to the process than the board on ${standing.closer} of ${standing.compared} ${measures}${rest.length > 0 ? `; ${rest.join(", ")}` : ""}.`;
}

/* --------------------------------------------------------------- links -- */

export interface MeasureLink {
  href: string;
  /** The link's words on the page. */
  label: string;
  /** What it opens, in full, for assistive technology. */
  description: string;
}

/** Ask, about one person, as the @ list would send it: the question with @Name, and the person by id. */
function askAbout(question: string, person: Person): string {
  return `/ask?${new URLSearchParams({ q: question.replace("{name}", `@${person.name}`), m: person.id }).toString()}`;
}

/**
 * Where a measure's tickets are. The counts open Ask's list of exactly the
 * tickets they count (their backlog, what they work on, what they finished in
 * the period), so the figure and the list agree. A figure Findings can list
 * exactly (open tickets stuck now) opens Findings filtered so. Findings has no
 * filter for "done in the period" or "on open tickets", so the other figures
 * open every finding of the person for those rules, said so in the link's
 * words ("All findings"): the list is wider than the figure, never mistaken
 * for it. Null where nothing lists them.
 */
export function measureLink(
  measure: Pick<ScorecardMeasure, "key" | "rule_ids" | "measurable" | "label">,
  person: Person,
  days: number = 90,
): MeasureLink | null {
  if (!measure.measurable) return null;
  const findings = (rules: readonly string[], state: "open" | "all") =>
    `/findings?${findingsSearchParams({ person: [person.id], rule: [...rules], state }).toString()}`;
  switch (measure.key) {
    case "open_tickets":
      return { href: askAbout("What is {name}'s backlog?", person), label: "Tickets", description: `${person.name}'s open tickets, in Ask` };
    case "in_progress":
      return { href: askAbout("What is {name} working on?", person), label: "Tickets", description: `${person.name}'s tickets in progress, in Ask` };
    case "done_in_period":
      return {
        href: askAbout(`What did {name} finish in the last ${days} days?`, person),
        label: "Tickets",
        description: `${person.name}'s tickets done in the last ${days} days, in Ask`,
      };
    case "open_findings_per_10":
      // The figure counts the findings on their open tickets; Findings cannot be held to open tickets, so the link
      // opens every open finding of theirs and says so where it is read, on all their tickets (done ones too): the
      // larger number it lands on is expected, never taken for a wrong figure (the JO-11 check, G10).
      return {
        href: findings([], "open"),
        label: "Open findings on all their tickets",
        description: `${person.name}'s open findings on every ticket they hold, done ones too; this figure counts those on their open tickets`,
      };
    case "stuck_now":
      return measure.rule_ids.length > 0
        ? { href: findings(measure.rule_ids, "open"), label: "Findings", description: `${person.name}'s open findings for ${measure.label.toLowerCase()}` }
        : null;
    default:
      return measure.rule_ids.length > 0
        ? {
            href: findings(measure.rule_ids, "all"),
            label: "All findings",
            description: `${person.name}'s findings for ${measure.label.toLowerCase()} on every ticket they hold, from any time; this figure counts the last ${days} days`,
          }
        : null;
  }
}

/* ------------------------------------------------------------- sorting -- */

/** What the everyone table sorts by: a person's name, or one of the measures. */
export type SortKey = "name" | ScorecardMeasureKey;
export type SortOrder = "asc" | "desc";

export const SORT_KEYS: readonly SortKey[] = ["name", ...SCORECARD_MEASURES.map((measure) => measure.key)];

export function isSortKey(value: string): value is SortKey {
  return (SORT_KEYS as readonly string[]).includes(value);
}

/**
 * The order a column sorts in first: names A to Z, counts most first, a rate
 * or ratio closer to the process first (higher first where higher is closer).
 */
export function firstOrder(key: SortKey): SortOrder {
  if (key === "name") return "asc";
  const measure = SCORECARD_MEASURES.find((candidate) => candidate.key === key)!;
  return measure.direction === "lower_is_closer" ? "asc" : "desc";
}

/** The order's words for the narrow list's control: "Closer first", "Most first", "A to Z". */
export function orderLabel(key: SortKey, order: SortOrder): string {
  if (key === "name") return order === "asc" ? "A to Z" : "Z to A";
  const measure = SCORECARD_MEASURES.find((candidate) => candidate.key === key)!;
  if (measure.direction === "neutral") return order === "desc" ? "Most first" : "Fewest first";
  return order === firstOrder(key) ? "Closer first" : "Further first";
}

/** A figure the table can place in an order: a count, or a rate or ratio with enough tickets behind it. */
function orderable(measure: (typeof SCORECARD_MEASURES)[number], value: ScorecardValue): number | null {
  if (value.value === null) return null;
  if (measure.kind !== "count" && !value.enough) return null;
  return value.value;
}

/**
 * The everyone table in an order. By a measure: its figure in the order asked
 * for, ties by name; anyone with too few tickets for it (or none) always
 * last, by name, whichever way the column is turned, so a small sample never
 * tops or tails the table.
 */
export function sortPeople(rows: readonly ScorecardPerson[], key: SortKey, order: SortOrder): ScorecardPerson[] {
  const byName = (a: ScorecardPerson, b: ScorecardPerson) => compareByFoldedName(a.person, b.person);
  if (key === "name") {
    const sorted = [...rows].sort(byName);
    return order === "asc" ? sorted : sorted.reverse();
  }
  const measure = SCORECARD_MEASURES.find((candidate) => candidate.key === key)!;
  const sign = order === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = orderable(measure, a.values[key]);
    const right = orderable(measure, b.values[key]);
    if (left === null || right === null) return Number(left === null) - Number(right === null) || byName(a, b);
    return sign * (left - right) || byName(a, b);
  });
}

/** The measures a table or list shows: those the board can show, in the contract's order. */
export function shownMeasures(measures: readonly ScorecardMeasure[]): ScorecardMeasure[] {
  return measures.filter((measure) => measure.measurable);
}
