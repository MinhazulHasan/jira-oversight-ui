import { scorecardHref } from "@/components/people/links";
import { findingsSearchParams } from "@/lib/api/params";
import { UNNAMED_ACCOUNT, type PersonCard, type PersonCardProcess, type ScorecardDays } from "@/lib/api/schemas";
import { formatCount } from "@/lib/format";

/*
 * The person card (JO-13) in words and links: what its lines say, where its
 * actions lead, how long a ticket has been in progress. Pure functions, so
 * every phrase is tested without a browser. The card states facts about
 * tickets, next to the whole board's; it never rates anyone, and its marks
 * are drawn in the neutral inks, as the scorecard's are.
 */

/** The period a card reads, from a page's own: 30, 90 or 180 days as the scorecard reads them, 90 for anything else. */
export function cardDays(days: number): ScorecardDays {
  return days === 30 || days === 180 ? days : 90;
}

/** The first word of a display name, for "Ask about Ada"; the whole name when it is one word. */
export function firstName(name: string): string {
  if (name === UNNAMED_ACCOUNT) return "them";
  const [first] = name.trim().split(/\s+/u);
  return first || name;
}

/** The header's plain line, in parts: the count (set in Plex Mono) and the words around it. */
export interface HeaderLine {
  /** "Holds", "No open tickets on", "Member of". */
  lead: string;
  /** The open tickets, when they hold any: "13". */
  figure: string | null;
  /** " open tickets on", " open ticket on". */
  middle: string;
  /** The board's name, as the top bar names it. */
  board: string;
  /** " · no tickets" for a member who holds none. */
  tail: string;
  /** The whole line, for a screen reader and a copy. */
  text: string;
  /** Its tooltip: the whole line, with the board's key where its name is not the key. */
  title: string;
}

/**
 * "Holds 13 open tickets on Demo project", "No open tickets on Demo
 * project" (they hold only finished ones), or "Member of Demo project · no
 * tickets" (a member who holds none of the board's tickets). The board by
 * its name, as the top bar and the brief name it ("on AILED"); its key is in
 * the tooltip. The count is of open tickets: GET /people's and the
 * scorecard's figure, Epics left out.
 */
export function headerLine(card: Pick<PersonCard, "membership" | "work" | "board">, locale?: string): HeaderLine {
  const board = card.board.name || card.board.key;
  const titled = (text: string) => ({ text, title: board === card.board.key ? text : `${text} (${card.board.key})` });
  if (card.membership === "member_no_tickets") {
    return { lead: "Member of ", figure: null, middle: "", board, tail: " · no tickets", ...titled(`Member of ${board} · no tickets`) };
  }
  const open = card.work.open_tickets;
  if (open === 0) return { lead: "No open tickets on ", figure: null, middle: "", board, tail: "", ...titled(`No open tickets on ${board}`) };
  const figure = formatCount(open, { locale });
  const middle = open === 1 ? " open ticket on " : " open tickets on ";
  return { lead: "Holds ", figure, middle, board, tail: "", ...titled(`Holds ${figure}${middle}${board}`) };
}

/**
 * The process meter's sentence, as the scorecard says it: "Closer to the
 * process than the board on 5 of 8 measures." The second figure counts the
 * measures they were compared on (closer, level or further), so the card
 * and the People page say the same.
 */
export function processSentence(process: PersonCardProcess, locale?: string): string {
  const parts = processSentenceParts(process, locale);
  return `${parts.lead} on ${parts.closer} of ${parts.compared} ${parts.noun}.`;
}

/**
 * The sentence in its parts, so the card can set its two figures in Plex
 * Mono: "Closer to the process than the board", "5", "8", "measures".
 */
export function processSentenceParts(process: PersonCardProcess, locale?: string): { lead: string; closer: string; compared: string; noun: string } {
  const compared = process.closer + process.level + process.further;
  return {
    lead: "Closer to the process than the board",
    closer: formatCount(process.closer, { locale }),
    compared: formatCount(compared, { locale }),
    noun: compared === 1 ? "measure" : "measures",
  };
}

/** The one muted line in the meter's place, when nothing about them could be compared with the board. */
export function noComparisonLine(card: Pick<PersonCard, "membership">): string {
  return card.membership === "member_no_tickets" ? "Nothing to compare: no tickets on this board." : "Too few tickets to compare with the board on any measure.";
}

/** What the list of tickets in progress says when it lists none. */
export function idleLine(card: Pick<PersonCard, "membership">): string {
  return card.membership === "member_no_tickets" ? "Nothing in progress on this board." : "Nothing in progress now.";
}

/** The meter's parts, in order, with the words each count goes by. */
export const METER_PARTS = [
  { key: "closer", label: "closer" },
  { key: "level", label: "level" },
  { key: "further", label: "further" },
  { key: "too_few", label: "too few tickets" },
] as const;
export type MeterPart = (typeof METER_PARTS)[number]["key"];

/** The meter in words, for assistive technology: "5 closer, 1 level, 2 further and 2 with too few tickets, of 10 measures". */
export function meterSummary(process: PersonCardProcess, locale?: string): string {
  const count = (value: number) => formatCount(value, { locale });
  const parts = [
    `${count(process.closer)} closer`,
    `${count(process.level)} level`,
    `${count(process.further)} further`,
    `${count(process.too_few)} with too few tickets`,
  ];
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}, of ${count(process.measurable)} ${process.measurable === 1 ? "measure" : "measures"}`;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * How long a ticket has been in progress, up to `asOf`: now, on the same
 * clock as the card's last activity, or the last sync once that is stale
 * (the card then says so): "for 3 days", "for 1 day", "for 5 hours", "for
 * less than an hour". Whole units, rounded down. Null when the
 * start is not known (the contract allows it, a synced ticket never has it):
 * the row then says no time at all.
 */
export function inProgressFor(since: string | null, asOf: string, locale?: string): string | null {
  if (since === null) return null;
  const span = Math.max(0, Date.parse(asOf) - Date.parse(since));
  if (!Number.isFinite(span) || span < HOUR) return "for less than an hour";
  if (span < DAY) {
    const hours = Math.floor(span / HOUR);
    return `for ${formatCount(hours, { locale })} ${hours === 1 ? "hour" : "hours"}`;
  }
  const days = Math.floor(span / DAY);
  return `for ${formatCount(days, { locale })} ${days === 1 ? "day" : "days"}`;
}

/** "and 4 more", for the tickets in progress the card does not list. */
export function moreText(more: number, locale?: string): string | null {
  return more > 0 ? `and ${formatCount(more, { locale })} more` : null;
}

/**
 * The findings line's label: what its counts cover, said where everyone sees
 * it (not only in a tooltip, which touch and the keyboard never get). They
 * are the open findings on every ticket the person holds, done ones too, as
 * Findings filtered to them lists them, so they can outnumber the open
 * tickets many times; the scorecard says the same of its link to them.
 */
export const FINDINGS_LABEL = "Open findings on all their tickets";

/** The findings line's tooltip, the scope said in full. */
export const FINDINGS_SCOPE = "On every ticket they hold, done ones too";

/** What a count of open findings is called under the label, which says they are open: "breach", "warnings". */
export function findingsNoun(count: number, severity: "breach" | "warning"): string {
  if (severity === "breach") return count === 1 ? "breach" : "breaches";
  return count === 1 ? "warning" : "warnings";
}

/** "3 breaches", "1 warning". */
export function findingsText(count: number, severity: "breach" | "warning", locale?: string): string {
  return `${formatCount(count, { locale })} ${findingsNoun(count, severity)}`;
}

/* -------------------------------------------------------- other boards -- */

/**
 * How many of the other boards fit whole on the card's one line, in order:
 * all of them when they fit beside "Also on"; else as many as fit with room
 * left for "+N more" after them; at least one, however narrow the line (it
 * then ends in an ellipsis). `lead` is the width "Also on" takes, `widths`
 * each board's (its separator included), `more` the width "+N more" takes
 * and `room` the line's. Widths in CSS pixels, so half a pixel is allowed.
 */
export function boardsThatFit(lead: number, widths: readonly number[], more: number, room: number): number {
  const whole = lead + widths.reduce((sum, width) => sum + width, 0);
  if (whole <= room + 0.5) return widths.length;
  let used = lead + more;
  let fit = 0;
  for (const width of widths) {
    if (used + width > room + 0.5) break;
    used += width;
    fit += 1;
  }
  return Math.max(1, fit);
}

/** Other boards, in words: "OPS (2 open)", "OPS (2 open) and WEB (1 open)", "A (1 open), B (2 open) and C (3 open)". */
export function boardsText(boards: readonly { key: string; open_tickets: number }[], locale?: string): string {
  const named = boards.map((board) => `${board.key} (${formatCount(board.open_tickets, { locale })} open)`);
  return named.length <= 1 ? (named[0] ?? "") : `${named.slice(0, -1).join(", ")} and ${named.at(-1)}`;
}

/* --------------------------------------------------------------- links -- */

/** Findings filtered to them: every open finding on the tickets they hold, as the card's findings line counts them. */
export function findingsHref(personId: string): string {
  return `/findings?${findingsSearchParams({ person: [personId] }).toString()}`;
}

/** Their scorecard on the People page, over the card's period. */
export function scorecardLink(personId: string, days: number): string {
  return scorecardHref(personId, { days });
}

/** Everything they are working on now, in Ask: the list the card's three come from (the scorecard's "In progress now" link). */
export function workingOnHref(person: { id: string; name: string }): string {
  return `/ask?${new URLSearchParams({ q: `What is @${person.name} working on?`, m: person.id }).toString()}`;
}

/** Ask with their chip in the question box, nothing asked yet. */
export function askAboutHref(personId: string): string {
  return `/ask?${new URLSearchParams({ about: personId }).toString()}`;
}

/** A ticket's own page. */
export function issueHref(key: string): string {
  return `/issues/${encodeURIComponent(key)}`;
}
