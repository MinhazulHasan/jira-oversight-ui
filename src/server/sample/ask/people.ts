import { normalizeFindingsQuery } from "@/lib/api/params";
import { noTicketsSentence, UNASSIGNED_LABEL, type FactCell, type FactColumnKind, type FactSet, type Person, type PersonSummary } from "@/lib/api/schemas";
import { compareByFoldedName, findNames, foldText } from "@/lib/names";

import { STATUS } from "../catalogue";
import type { Dataset } from "../dataset";
import { matchingFindings } from "../findings";
import { directoryPeople, peopleView } from "../people";
import { personOf } from "../team";
import { iso } from "../time";
import { cite, listed, type Piece } from "./compose";
import { asksForFewest, severityIn } from "./match";
import type { ScriptResult } from "./scripts";

/*
 * Ask at people level, in sample mode: the questions about people the
 * service's catalogue path answers, read from the analyst's views as the live
 * service reads them (the people view, and findings and issues with their
 * current assignee), with a query in the facts as the analyst writes one.
 * Facts only: who has the most open breaches or warnings, and one person's
 * open findings or work in progress. Nobody is rated or judged, and an answer
 * names a person only when its facts or the question's mentions do.
 */

type Row = Record<string, FactCell>;
type Severity = "breach" | "warning";

interface Column {
  key: string;
  label: string;
  kind: FactColumnKind;
}

const MEASURE = { breach: "open_breaches", warning: "open_warnings" } as const;
const PLURAL = { breach: "breaches", warning: "warnings" } as const;
const OTHER: Record<Severity, Severity> = { breach: "warning", warning: "breach" };

/** The sentence every answer about findings by person ends with: whose findings are whose (the service's _FOLLOWS). */
const FOLLOWS = "Findings follow the ticket's current assignee.";

function queryFacts(dataset: Dataset, ref: string, sql: string, columns: Column[], rows: Row[], note: string, truncated = false): FactSet {
  return { ref, tool: "oversight_query", params: { sql }, columns, rows, truncated, as_of: iso(dataset.world.syncAt), note };
}

/* ------------------------------------------------------------- the views -- */

const PEOPLE_COLUMNS: Column[] = [
  { key: "person_id", label: "Person id", kind: "text" },
  { key: "name", label: "Name", kind: "text" },
  { key: "tickets", label: "Tickets", kind: "count" },
  { key: "open_tickets", label: "Open tickets", kind: "count" },
  { key: "open_breaches", label: "Open breaches", kind: "count" },
  { key: "open_warnings", label: "Open warnings", kind: "count" },
  { key: "tickets_with_findings", label: "Tickets with findings", kind: "count" },
];
const PEOPLE_SELECT = "SELECT person_id, name, tickets, open_tickets, open_breaches, open_warnings, tickets_with_findings FROM people";

export type Ranked = "open_breaches" | "open_warnings" | "open_findings" | "open_tickets" | "tickets" | "tickets_with_findings";

/** A people figure in words, one and several: "1 open breach", "3 open breaches" (the service's _FIGURE_WORDS). */
const FIGURE_WORDS: Record<Ranked, readonly [string, string]> = {
  open_breaches: ["open breach", "open breaches"],
  open_warnings: ["open warning", "open warnings"],
  open_findings: ["open finding", "open findings"],
  open_tickets: ["open ticket", "open tickets"],
  tickets: ["ticket", "tickets"],
  tickets_with_findings: ["ticket with findings", "tickets with findings"],
};

/** How each ranking reads in its note: findings are breaches and warnings together (the service's _RANKED_BY). */
const RANKED_BY: Record<Ranked, string> = {
  ...Object.fromEntries(Object.entries(FIGURE_WORDS).map(([key, words]) => [key, words[1]])),
  open_findings: "open findings (open breaches and open warnings together)",
} as Record<Ranked, string>;

/** The figures whose answers end saying whose findings are whose. */
const ABOUT_FINDINGS: readonly Ranked[] = ["open_breaches", "open_warnings", "open_findings", "tickets_with_findings"];

/**
 * How the people view's rows read, as the service's oversight_people notes
 * them (JO-12, G5): people only, by one figure, ties by name; the tickets
 * nobody holds as one row after them, never ranked; a person's tickets the
 * board's work, Epics left out.
 */
function peopleNote(rankBy: Ranked, { fewest = false, mentioned = false, unassigned = false } = {}): string {
  const whose = mentioned
    ? "one row for each person asked about, by person id, who is assigned a ticket on this board now"
    : "one row per person assigned a ticket on this board now";
  const after = unassigned ? "; then one row for the tickets nobody holds (Unassigned), which is no one's and never ranked" : "";
  return (
    `${whose}, by ${RANKED_BY[rankBy]}, ${fewest ? "fewest" : "most"} first, ties by name${after}; a person's tickets are the board's work, ` +
    "Epics left out, as the scorecard counts them; findings follow the ticket's current assignee: a person's findings are those on the tickets " +
    "they hold now, and a sprint finding is no one's"
  );
}

function personRow(row: PersonSummary): Row {
  return {
    person_id: row.person?.id ?? null,
    name: row.person?.name ?? UNASSIGNED_LABEL,
    tickets: row.tickets,
    open_tickets: row.open_tickets,
    open_breaches: row.open_breaches,
    open_warnings: row.open_warnings,
    tickets_with_findings: row.tickets_with_findings,
  };
}

function rowsOfPeople(dataset: Dataset): (PersonSummary & { person: Person })[] {
  return peopleView(dataset).people.filter((row): row is PersonSummary & { person: Person } => row.person !== null);
}

/** The people view's row for the tickets nobody holds; null when every ticket has someone. */
function unassignedRow(dataset: Dataset): PersonSummary | null {
  return peopleView(dataset).people.find((row) => row.person === null) ?? null;
}

/**
 * A "who" ranking, as the service's oversight_people ranks (JO-12, G5): the
 * people only, by one figure, most first (fewest first when asked), ties by
 * name folded for case and accents, then id; then the tickets nobody holds,
 * as one row of their own, never ranked.
 */
function peopleRanking(dataset: Dataset, ref: string, rankBy: Ranked, n: number, fewest: boolean, only: readonly string[] | null = null): FactSet {
  const sign = fewest ? -1 : 1;
  // Findings are breaches and warnings together: their sum is the figure ranked by, a column of its own.
  const findings = rankBy === "open_findings";
  const value = (row: PersonSummary) => (findings ? row.open_breaches + row.open_warnings : row[rankBy as Exclude<Ranked, "open_findings">]);
  const ranked = [...rowsOfPeople(dataset)]
    .filter((row) => only === null || only.includes(row.person.id))
    .sort((a, b) => sign * (value(b) - value(a)) || compareByFoldedName(a.person, b.person));
  // The people asked about alone: the tickets nobody holds are no one asked about.
  const nobody = only === null ? unassignedRow(dataset) : null;
  const select = findings ? PEOPLE_SELECT.replace(" FROM people", ", open_breaches + open_warnings AS open_findings FROM people") : PEOPLE_SELECT;
  const where = only === null ? "person_id IS NOT NULL" : `person_id IN (${only.map((id) => `'${id}'`).join(", ")})`;
  const people = `${select} WHERE ${where} ORDER BY ${rankBy} ${fewest ? "ASC" : "DESC"}, name LIMIT ${n}`;
  const row = (summary: PersonSummary): Row => ({ ...personRow(summary), ...(findings ? { open_findings: value(summary) } : {}) });
  return queryFacts(
    dataset,
    ref,
    nobody ? `SELECT * FROM (${people}) UNION ALL ${select} WHERE person_id IS NULL` : people,
    findings ? [...PEOPLE_COLUMNS, { key: "open_findings", label: "Open findings", kind: "count" }] : PEOPLE_COLUMNS,
    [...ranked.slice(0, n).map(row), ...(nobody ? [row(nobody)] : [])],
    peopleNote(rankBy, { fewest, unassigned: nobody !== null, mentioned: only !== null }),
    ranked.length > n,
  );
}

/** Everyone on the board ranked by one severity's open findings, most first (fewest first for who has the least). */
export function rankingFacts(dataset: Dataset, ref: string, severity: Severity, n = 5, fewest = false): FactSet {
  return peopleRanking(dataset, ref, MEASURE[severity], n, fewest);
}

/** How many of a ranking's rows are people: the tickets nobody holds come after them, never among them. */
const peopleIn = (facts: FactSet) => facts.rows.filter((row) => row.person_id !== null).length;

/**
 * The tickets nobody holds, after a ranking and never in it (JO-12, G5), in
 * the service's words: "Unassigned: 148 open tickets."; nothing when they hold
 * none of the figure.
 */
function unassignedPieces(facts: FactSet, column: Ranked): Piece[] {
  const index = facts.rows.findIndex((row) => row.person_id === null && row.name === UNASSIGNED_LABEL);
  if (index < 0) return [];
  const amount = countAt(facts, index, column);
  if (amount === 0) return [];
  const [one, several] = FIGURE_WORDS[column];
  return [" ", `${UNASSIGNED_LABEL}: `, cite.count(facts, index, column), ` ${amount === 1 ? one : several}.`];
}

/**
 * Who has the fewest of one figure, as the service says it (oversight/llm/scripted.py, _render_fewest): whoever has
 * the fewest, everyone level with them (three by name, the rest as others), then who comes next.
 */
function fewestPieces(facts: FactSet, column: string, words: string): Piece[] {
  const low = countAt(facts, 0, column);
  const people = facts.rows.slice(0, peopleIn(facts));
  const tied = people.flatMap((_, index) => (countAt(facts, index, column) === low ? [index] : []));
  const pieces: Piece[] =
    tied.length === 1
      ? [nameAt(facts, 0), ` has the fewest ${words}: `, cite.count(facts, 0, column)]
      : [
          ...listed([...tied.slice(0, 3).map((index) => [nameAt(facts, index)]), ...(tied.length > 3 ? [["others"]] : [])]),
          ` have the fewest ${words}, `,
          cite.count(facts, 0, column),
          " each",
        ];
  const next = people.findIndex((_, index) => countAt(facts, index, column) !== low);
  if (next >= 0) pieces.push(", then ", nameAt(facts, next), " with ", cite.count(facts, next, column));
  pieces.push(".");
  return pieces;
}

/* -------------------------------------------------- everyone on the board -- */

const BOARD_PEOPLE_COLUMNS: Column[] = [
  { key: "person_id", label: "Person id", kind: "text" },
  { key: "name", label: "Person", kind: "text" },
  { key: "tickets", label: "Tickets", kind: "count" },
];

/**
 * oversight_board_people(project, holding): everyone on the board as the @
 * list shows them (the people assigned its tickets now, then its members who
 * hold none, each by name), or only those members: the service's tool and
 * note, word for word.
 */
export function boardPeopleFacts(dataset: Dataset, ref: string, holding: "any" | "none"): FactSet {
  const holders = rowsOfPeople(dataset)
    .map((row) => ({ person: row.person, tickets: row.tickets }))
    .sort((a, b) => compareByFoldedName(a.person, b.person));
  const held = new Set(holders.map((row) => row.person.id));
  // A member who holds none of its tickets, or someone who holds only Epics (no work: JO-12, G5).
  const members = directoryPeople(dataset)
    .filter((person) => !held.has(person.id))
    .sort(compareByFoldedName)
    .map((person) => ({ person, tickets: 0 }));
  const chosen = holding === "none" ? members : [...holders, ...members];
  return {
    ref,
    tool: "oversight_board_people",
    params: { project: dataset.board.key, holding },
    columns: BOARD_PEOPLE_COLUMNS,
    rows: chosen.map((row) => ({ person_id: row.person.id, name: row.person.name, tickets: row.tickets })),
    truncated: false,
    as_of: iso(dataset.world.syncAt),
    note:
      holding === "none"
        ? `the members of this board (its last member fetch) who hold none of its tickets now, by name; ${members.length} in all`
        : `everyone on this board, as the @ list shows them: the ${holders.length} ${holders.length === 1 ? "person" : "people"} assigned its tickets now ` +
          `(tickets: the ones they hold, any status, Epics left out), then the ${members.length} ` +
          `${members.length === 1 ? "member who holds" : "members who hold"} none, each by name; ${holders.length + members.length} in all`,
  };
}

/** More names than this and the answer says how many, and the facts list them (the service's _NAMES_IN_A_SENTENCE). */
const NAMES_IN_A_SENTENCE = 20;

/** "Who is on this board?" (everyone, and who of them holds no ticket) or "Who has no tickets?" (those members), in the service's words. */
export function boardPeopleAnswer(dataset: Dataset, holding: "any" | "none"): ScriptResult {
  const facts = boardPeopleFacts(dataset, "F1", holding);
  if (facts.rows.length === 0) {
    return { outcome: "no_data", facts: [facts], message: `Nothing in the ${dataset.board.key} snapshot matched. Looked at: everyone on the board.`, suggestions: [] };
  }
  return { outcome: "answered", facts: [facts], pieces: boardPeoplePieces(facts) };
}

/**
 * The words for a board-people fact set: the service's _render_board_people,
 * word for word. Each name once (JO-12, G8): the people who hold its tickets,
 * then how many members hold none, and who.
 */
export function boardPeoplePieces(facts: FactSet): Piece[] {
  const names = facts.rows.map((_, index) => nameAt(facts, index));
  const none = facts.rows.flatMap((row, index) => (row.tickets === 0 ? [nameAt(facts, index)] : []));
  const holders = facts.rows.flatMap((row, index) => (row.tickets !== 0 ? [nameAt(facts, index)] : []));
  const total: Piece = { text: String(names.length), fact: facts, row: -1, column: "row_count" };
  const joined = (list: readonly string[]) => listed(list.map((name) => [name]));
  if (facts.params.holding === "none") {
    if (names.length === 0) return ["Everyone on this board holds at least one of its tickets."];
    if (names.length > NAMES_IN_A_SENTENCE) return [total, " members of this board have no tickets on it; the facts list them by name."];
    return [noTicketsSentence(names)];
  }
  if (names.length > NAMES_IN_A_SENTENCE) {
    return [total, " people are on this board: those assigned its tickets first, then its members who hold none; the facts list them by name."];
  }
  const who: Piece[] = [total, names.length === 1 ? " person is on this board" : " people are on this board"];
  if (none.length === 0) return [...who, ": ", ...joined(names), "."];
  if (holders.length === 0) {
    return [...who, names.length === 1 ? ", a member who holds none of its tickets: " : ", all members who hold none of its tickets: ", ...joined(none), "."];
  }
  return [
    ...who,
    ": ",
    ...joined(holders),
    `, and ${none.length} ${none.length === 1 ? "member who holds" : "members who hold"} none of its tickets: `,
    ...joined(none),
    ".",
  ];
}

/** The mentioned people's rows, most open breaches first. */
export function mentionedFacts(dataset: Dataset, ref: string, ids: readonly string[]): FactSet {
  const rows = rowsOfPeople(dataset)
    .filter((row) => ids.includes(row.person.id))
    .sort((a, b) => b.open_breaches - a.open_breaches || compareByFoldedName(a.person, b.person));
  const where = ids.length === 1 ? `person_id = '${ids[0]}'` : `person_id IN (${ids.map((id) => `'${id}'`).join(", ")})`;
  return queryFacts(
    dataset,
    ref,
    `${PEOPLE_SELECT} WHERE ${where} ORDER BY open_breaches DESC, name`,
    PEOPLE_COLUMNS,
    rows.map(personRow),
    peopleNote("open_breaches", { mentioned: true }),
  );
}

/** One person's open findings, newest first: issue findings on the tickets assigned to them now. */
export function personFindingsFacts(dataset: Dataset, ref: string, personId: string, severity: Severity | null, n = 20): FactSet {
  const findings = matchingFindings(
    dataset,
    normalizeFindingsQuery({ person: [personId], state: "open", severity: severity ?? undefined, sort: "first_seen_at", order: "desc", page_size: 100 }),
  );
  return queryFacts(
    dataset,
    ref,
    `SELECT finding_id, rule_id, rule_title, severity, issue_key, summary, epic_key, first_seen_at FROM findings WHERE assignee_id = '${personId}' AND state = 'open'${severity ? ` AND severity = '${severity}'` : ""} ORDER BY first_seen_at DESC LIMIT ${n}`,
    [
      { key: "finding_id", label: "Finding", kind: "text" },
      { key: "rule_id", label: "Rule", kind: "text" },
      { key: "rule_title", label: "Rule title", kind: "text" },
      { key: "severity", label: "Severity", kind: "text" },
      { key: "issue_key", label: "Issue", kind: "issue_key" },
      { key: "summary", label: "Summary", kind: "text" },
      { key: "epic_key", label: "Epic", kind: "issue_key" },
      { key: "first_seen_at", label: "First seen", kind: "date" },
    ],
    findings.slice(0, n).map((finding) => ({
      finding_id: finding.finding_id,
      rule_id: finding.rule_id,
      rule_title: finding.rule_title,
      severity: finding.severity,
      issue_key: finding.issue_key,
      summary: finding.issue_summary,
      epic_key: finding.epic_key,
      first_seen_at: finding.first_seen_at,
    })),
    `open ${severity ? PLURAL[severity] : "findings"} on the tickets assigned to the person now, newest first`,
    findings.length > n,
  );
}

/** One person's tickets in progress (Epics left out), newest first. */
export function inProgressFacts(dataset: Dataset, ref: string, personId: string, n = 50): FactSet {
  const issues = dataset.world.issues
    .filter((issue) => issue.type !== "Epic" && STATUS[issue.status].category === "indeterminate" && personOf(issue)?.id === personId)
    .sort((a, b) => b.createdAt - a.createdAt || b.num - a.num);
  return queryFacts(
    dataset,
    ref,
    `SELECT issue_key, summary, issue_type, status, epic_key FROM issues WHERE assignee_id = '${personId}' AND status_category = 'indeterminate' AND issue_type <> 'Epic' ORDER BY created DESC LIMIT ${n}`,
    [
      { key: "issue_key", label: "Issue", kind: "issue_key" },
      { key: "summary", label: "Summary", kind: "text" },
      { key: "issue_type", label: "Type", kind: "text" },
      { key: "status", label: "Status", kind: "text" },
      { key: "epic_key", label: "Epic", kind: "issue_key" },
    ],
    issues.slice(0, n).map((issue) => ({
      issue_key: issue.key,
      summary: issue.summary,
      issue_type: issue.type,
      status: issue.status,
      epic_key: issue.epicKey,
    })),
    "tickets assigned to the person now whose status is in progress; Epic issues left out (containers, not work)",
    issues.length > n,
  );
}

/* -------------------------------------------------------------- answers -- */

const nameAt = (fact: FactSet, index: number) => String(fact.rows[index]?.name ?? "");
const countAt = (fact: FactSet, index: number, column: string) => Number(fact.rows[index]?.[column] ?? 0);

/**
 * "Who has the most open breaches?" (or warnings): the ranking, its leader's
 * figures, the two who follow. "Who has the fewest?": fewest first, in the
 * service's words.
 */
export function rankingAnswer(dataset: Dataset, question: string): ScriptResult {
  const severity = severityIn(question) ?? "breach";
  const fewest = asksForFewest(question);
  const facts = rankingFacts(dataset, "F1", severity, fewest ? 10 : 5, fewest);
  const measure = MEASURE[severity];
  if (facts.rows.length === 0) {
    return { outcome: "no_data", facts: [facts], message: "No ticket on this board is assigned to anyone. Looked at: the people view.", suggestions: [] };
  }
  const people = peopleIn(facts);
  const unassigned = unassignedPieces(facts, measure);
  if (people === 0) {
    return { outcome: "answered", facts: [facts], pieces: ["No one on this board holds a ticket now.", ...unassigned, ` ${FOLLOWS}`] };
  }
  if (fewest) return { outcome: "answered", facts: [facts], pieces: [...fewestPieces(facts, measure, `open ${PLURAL[severity]}`), ...unassigned, ` ${FOLLOWS}`] };
  const lead = countAt(facts, 0, measure);
  if (lead === 0) {
    return { outcome: "answered", facts: [facts], pieces: [`Nobody on this board has an open ${severity}.`, ...unassigned, ` ${FOLLOWS}`] };
  }
  const tied = facts.rows.slice(0, people).filter((_, index) => countAt(facts, index, measure) === lead).length;
  const pieces: Piece[] =
    tied === 1
      ? [
          nameAt(facts, 0),
          ` has the most open ${PLURAL[severity]}, `,
          cite.count(facts, 0, measure),
          ", with ",
          cite.count(facts, 0, MEASURE[OTHER[severity]]),
          ` open ${PLURAL[OTHER[severity]]} on `,
          cite.count(facts, 0, "tickets_with_findings"),
          " tickets with findings.",
        ]
      : [...listed(facts.rows.slice(0, tied).map((_, index) => [nameAt(facts, index)])), ` have the most open ${PLURAL[severity]}, `, cite.count(facts, 0, measure), " each."];
  const next = [tied, tied + 1].filter((index) => index < people && countAt(facts, index, measure) > 0);
  if (next.length > 0) {
    pieces.push(
      next.length === 1 ? " Next comes " : " Next come ",
      ...listed(next.map((index) => [nameAt(facts, index), " with ", cite.count(facts, index, measure)])),
      ".",
    );
  }
  pieces.push(...unassigned, ` ${FOLLOWS}`);
  return { outcome: "answered", facts: [facts], pieces };
}

/**
 * "Who holds the most open tickets?" (JO-09's ranking by the people view's
 * open tickets): most first, in the service's words ("<Name> has the most open
 * tickets: 11, then <Name> with 9."), or fewest first when the question asks
 * who has the least; then the tickets nobody holds, never ranked
 * ("Unassigned: 148 open tickets."). The open tickets are the board's work,
 * Epics left out, as the scorecard and "who has the biggest backlog?" count
 * them, so both give one figure and one order (JO-12, G5).
 */
export function ticketsRankingAnswer(dataset: Dataset, column: Ranked, fewest = false, only: readonly string[] | null = null): ScriptResult {
  const facts = peopleRanking(dataset, "F1", column, 50, fewest, only);
  if (facts.rows.length === 0) {
    return { outcome: "no_data", facts: [facts], message: "No ticket on this board is assigned to anyone. Looked at: the people view.", suggestions: [] };
  }
  // Findings figures end saying whose findings are whose, as the service's answers do.
  const follows: Piece[] = ABOUT_FINDINGS.includes(column) ? [` ${FOLLOWS}`] : [];
  const unassigned = unassignedPieces(facts, column);
  const people = peopleIn(facts);
  if (people === 0) return { outcome: "answered", facts: [facts], pieces: ["No one on this board holds a ticket now.", ...unassigned] };
  const words = FIGURE_WORDS[column][1];
  if (fewest) return { outcome: "answered", facts: [facts], pieces: [...fewestPieces(facts, column, words), ...unassigned, ...follows] };
  // The service's _render_people: whoever has the most (up to three level with them, "13 each"), then the next
  // figure below theirs; no one at all when the most is none.
  const top = countAt(facts, 0, column);
  if (top === 0) {
    return { outcome: "answered", facts: [facts], pieces: [`No one on this board has ${/^[aeiou]/.test(words) ? "an" : "a"} ${FIGURE_WORDS[column][0]}.`, ...unassigned, ...follows] };
  }
  const leaders = facts.rows.slice(0, people).flatMap((_, index) => (countAt(facts, index, column) === top ? [index] : [])).slice(0, 3);
  const pieces: Piece[] =
    leaders.length === 1
      ? [nameAt(facts, 0), ` has the most ${words}: `, cite.count(facts, 0, column)]
      : [...listed(leaders.map((index) => [nameAt(facts, index)])), ` have the most ${words}, `, cite.count(facts, 0, column), " each"];
  const after = facts.rows.slice(0, people).findIndex((_, index) => countAt(facts, index, column) !== top && countAt(facts, index, column) > 0);
  if (after >= 0) pieces.push(", then ", nameAt(facts, after), " with ", cite.count(facts, after, column));
  pieces.push(".", ...unassigned, ...follows);
  return { outcome: "answered", facts: [facts], pieces };
}

/** The first few distinct issue keys of a findings list, each cited from the row it first appears in. */
function recentKeys(facts: FactSet, count: number): Piece[][] {
  const seen = new Set<string>();
  const picked: Piece[][] = [];
  facts.rows.forEach((row, index) => {
    const key = row.issue_key;
    if (picked.length >= count || typeof key !== "string" || seen.has(key)) return;
    seen.add(key);
    picked.push([cite.key(facts, index, "issue_key")]);
  });
  return picked;
}

/** "@X's open findings" (or breaches, or warnings): their counts from the people view, and where the newest are. */
export function personFindingsAnswer(dataset: Dataset, question: string, person: Person): ScriptResult {
  const severity = severityIn(question);
  const row = mentionedFacts(dataset, "F1", [person.id]);
  const list = personFindingsFacts(dataset, "F2", person.id, severity);
  const pieces: Piece[] = [person.name];
  if (list.rows.length === 0) {
    pieces.push(` has no open ${severity ? PLURAL[severity] : "findings"}.`);
  } else if (severity === null) {
    pieces.push(
      " has ",
      cite.count(row, 0, "open_breaches"),
      " open breaches and ",
      cite.count(row, 0, "open_warnings"),
      " open warnings, on ",
      cite.count(row, 0, "tickets_with_findings"),
      " tickets.",
    );
  } else {
    pieces.push(" has ", cite.count(row, 0, MEASURE[severity]), ` open ${PLURAL[severity]}.`);
  }
  const keys = recentKeys(list, 3);
  if (list.rows.length === 1) {
    pieces.push(" It is on ", ...keys[0], ".");
  } else if (list.rows.length > 1 && list.rows.length <= 3) {
    pieces.push(" They are on ", ...listed(keys), ".");
  } else if (list.rows.length > 3) {
    pieces.push(" The newest are on ", ...listed(keys), list.truncated ? "; the table lists the latest " : "; the table lists all ", cite.rows(list), ".");
  }
  pieces.push(` ${FOLLOWS}`);
  return { outcome: "answered", facts: [row, list], pieces };
}

/** "What is @X working on?": their tickets in progress now. */
export function workingOnAnswer(dataset: Dataset, person: Person): ScriptResult {
  const facts = inProgressFacts(dataset, "F1", person.id);
  const count = facts.rows.length;
  if (count === 0) return { outcome: "answered", facts: [facts], pieces: [`${person.name} has no tickets in progress.`] };
  const keys = facts.rows.map((_, index) => [cite.key(facts, index, "issue_key")]);
  const pieces: Piece[] = [person.name, facts.truncated ? " has more than " : " has ", cite.rows(facts), count === 1 ? " ticket in progress" : " tickets in progress"];
  if (count <= 4) pieces.push(": ", ...listed(keys), ".");
  else pieces.push(". The newest are ", ...listed(keys.slice(0, 3)), "; the table lists all ", cite.rows(facts), ".");
  return { outcome: "answered", facts: [facts], pieces };
}

/** Several people mentioned: each one's open breaches and warnings, most breaches first. */
export function mentionedAnswer(dataset: Dataset, people: readonly Person[]): ScriptResult {
  const facts = mentionedFacts(dataset, "F1", people.map((person) => person.id));
  const parts = facts.rows.map((_, index): Piece[] =>
    index === 0
      ? [nameAt(facts, 0), " has ", cite.count(facts, 0, "open_breaches"), " open breaches and ", cite.count(facts, 0, "open_warnings"), " open warnings"]
      : [nameAt(facts, index), " has ", cite.count(facts, index, "open_breaches"), " and ", cite.count(facts, index, "open_warnings")],
  );
  const pieces: Piece[] = parts.flatMap((part, index) => (index === 0 ? part : ["; ", ...part]));
  pieces.push(`. ${FOLLOWS}`);
  return { outcome: "answered", facts: [facts], pieces };
}

/* ------------------------------------------------------------ the names -- */

/** The board's people an answer names, in the order it first names them. */
export function namedPeople(text: string, people: readonly Person[]): Person[] {
  const byName = new Map<string, Person>();
  for (const person of people) if (!byName.has(person.name)) byName.set(person.name, person);
  const named: Person[] = [];
  for (const found of findNames(text, [...byName.keys()])) {
    const person = byName.get(found.name);
    if (person && !named.some((other) => other.id === person.id)) named.push(person);
  }
  return named;
}

/**
 * The people an answer names, if every one of them is in its facts (a cell
 * holding the name) or among the question's mentions; null when one is not,
 * and the answer may not be shown. The service checks every answer so.
 */
export function verifiedPeople(answer: string, facts: readonly FactSet[], mentioned: readonly Person[], people: readonly Person[]): Person[] | null {
  const named = namedPeople(answer, people);
  const inFacts = (name: string) => facts.some((fact) => fact.rows.some((row) => Object.values(row).some((value) => value === name)));
  const verified = named.every((person) => mentioned.some((other) => other.id === person.id) || inFacts(person.name));
  return verified ? named : null;
}

/** People a question names by typing their full display name: found, or a name two people on the board share. */
export interface Typed {
  /** One person each, in the order the question names them. */
  people: Person[];
  /** Names the question types that more than one person on the board has, as the board writes them. */
  ambiguous: string[];
  /** The first name typed on its own that more than one person on the board has, and their full names. */
  ambiguousFirst: { first: string; names: string[] } | null;
}

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A name as whole words in any case: blanked once found, so a full name is never also read as a first name. */
const asWords = (name: string, flags: string) => new RegExp(`(?<![\\p{L}\\p{N}_])${escaped(name)}(?![\\p{L}\\p{N}_])`, flags);

/** Where a first name stands in the text as the data writes it, capital and all, and not where a sentence starts. */
function firstNameAt(text: string, first: string): number {
  for (const match of text.matchAll(asWords(first, "gu"))) {
    const before = text.slice(0, match.index).trimEnd();
    if (before.length > 0 && !/[.!?]$/.test(before)) return match.index;
  }
  return -1;
}

/**
 * The people a question names in its own words (JO-11): each full display
 * name on the board, folded for case and accents as the @ list folds a search,
 * standing as whole words. A name only one person on the board has (a ticket
 * holder or a member) is that person, as if picked with @; a name two or more
 * share is ambiguous, and the admin is asked to pick with @.
 */
export function typedPeople(question: string, board: readonly Person[]): Typed {
  const byName = new Map<string, Person[]>();
  for (const person of board) {
    const folded = foldText(person.name);
    byName.set(folded, [...(byName.get(folded) ?? []), person]);
  }
  const people: Person[] = [];
  const ambiguous: string[] = [];
  for (const found of findNames(foldText(question), [...byName.keys()])) {
    const holders = byName.get(found.name) ?? [];
    if (holders.length === 1) {
      if (!people.some((person) => person.id === holders[0].id)) people.push(holders[0]);
    } else if (holders.length > 1 && !ambiguous.includes(holders[0].name)) {
      ambiguous.push(holders[0].name);
    }
  }
  // A first name typed on its own (the JO-11 review: "Is Ada doing well?"), as the service reads one
  // (oversight/ask/people.py, first_named_in): the first word of a name of two words or more, as the data writes it
  // and not where a sentence starts, after every full name is taken out. One person's is that person; a first name
  // two people share asks for @, naming them.
  let rest = question;
  for (const person of board) rest = rest.replace(asWords(person.name.trim(), "giu"), (match) => " ".repeat(match.length));
  const whole = new Set(board.map((person) => person.name.trim()));
  const firsts = new Map<string, Person[]>();
  for (const person of board) {
    const words = person.name.trim().split(/\s+/);
    if (words.length < 2 || whole.has(words[0])) continue;
    firsts.set(words[0], [...(firsts.get(words[0]) ?? []), person]);
  }
  let ambiguousFirst: Typed["ambiguousFirst"] = null;
  const found = [...firsts.keys()].map((first) => ({ first, at: firstNameAt(rest, first) })).filter((hit) => hit.at >= 0);
  for (const { first } of found.sort((a, b) => a.at - b.at)) {
    const holders = firsts.get(first) ?? [];
    if (holders.length === 1) {
      if (!people.some((person) => person.id === holders[0].id)) people.push(holders[0]);
    } else if (ambiguousFirst === null) {
      ambiguousFirst = { first, names: holders.map((person) => person.name) };
    }
  }
  return { people, ambiguous, ambiguousFirst };
}

/** Where a name typed in lower case stands as a person's: after a word that asks about someone, or before a possessive. */
const SLOT_BEFORE = String.raw`\b(?:is|was|has|does|did|how['’]?s|what['’]?s|for|of|about|by|from|with|to|show|me)\s+`;

/**
 * The people a question names by a first name or a surname (the first or the
 * last word of a name of two words or more; a surname that is also a common
 * word, never), or a one-word name, typed in another case than the board
 * writes it, where a person's name stands ("how is ada doing?", "how is
 * Brooks doing?", "ada's backlog"), as the service reads them
 * (oversight/ask/people.py, loosely_named_in): the name as the board writes
 * it and everyone who goes by it, in order of first appearance. Read only
 * when no name was found otherwise and the question asks something of one
 * person: "will" in "when will the sprint end?" is no one.
 */
export function looselyNamed(question: string, board: readonly Person[]): { first: string; people: Person[] }[] {
  const groups = new Map<string, { first: string; people: Person[] }>();
  for (const person of board) {
    const words = person.name.trim().split(/\s+/);
    if (words[0] === "" || person.name.trim() === "Unassigned" || person.name.trim() === "Unnamed account") continue;
    const surname = words.length > 1 && !NOT_NAMES.has(foldText(words[words.length - 1])) ? [words[words.length - 1]] : [];
    for (const written of [words[0], ...surname]) {
      const key = foldText(written);
      if (key.length < 2) continue;
      const group = groups.get(key) ?? { first: written, people: [] };
      if (!group.people.some((other) => other.id === person.id)) group.people.push(person);
      groups.set(key, group);
    }
  }
  const folded = foldText(question);
  const found: { at: number; key: string }[] = [];
  for (const key of groups.keys()) {
    const name = escaped(key);
    const slot = new RegExp(`${SLOT_BEFORE}(${name})(?![\\p{L}\\p{N}_])|(?<![\\p{L}\\p{N}_])(${name})['’]s?(?![\\p{L}\\p{N}_])`, "u").exec(folded);
    if (slot) found.push({ at: slot.index + (slot[1] !== undefined ? slot[0].length - slot[1].length : 0), key });
  }
  return found.sort((a, b) => a.at - b.at).map(({ key }) => groups.get(key)!);
}

/* ------------------------------------------------- a name no one has (G3) -- */

/** Ask's words for a name typed where a person's name stands that no one on the board goes by (prompts.py NO_ONE_CALLED). */
export function noOneCalledMessage(name: string): string {
  return `No one called ${name} is on this board.`;
}

/**
 * The last resort for a question about people that nothing here places
 * (JO-12, G3/G4: never turn an admin away): the figures it is answered with,
 * said first (prompts.py LAST_RESORT_OVERALL and LAST_RESORT_SCORECARD).
 */
export const LAST_RESORT = {
  overall: "This answer uses the overall comparison: the number of measures on which each person is closer to the process than the whole board.",
  scorecard: "This answer uses the scorecard: each measure next to the whole board's.",
} as const;

/**
 * Where a typed name stands, as the service reads one (oversight/ask/people.py, _NAME_SLOT): after a word that asks
 * about someone, but not "to" (a verb follows it: "to finish"), or before a possessive.
 */
const NAME_SLOT = String.raw`\b(?:is|was|has|does|did|how['’]?s|what['’]?s|for|of|about|by|from|with|show|me)\s+`;
const LETTERS = String.raw`\p{L}+`;
const WORDY = String.raw`[\p{L}\p{N}_'’-]`;
const TYPED_NAME = new RegExp(`${NAME_SLOT}(${LETTERS})(?!${WORDY})|(?<!${WORDY})(${LETTERS})['’]s?(?!${WORDY})`, "gu");

/**
 * Words that stand in those places but are never anyone's name: pronouns and
 * determiners, the words of a question, of time, of the board's work and of
 * its process. Compared folded. The service's NOT_NAMES, word for word.
 */
const NOT_NAMES = new Set(
  `a about after all also always an and another any anybody anyone anything are as at back bad badly be been before
  being best better both but by can could do does doing done down each either else enough ever every everybody
  everyone everything few fewer fewest for from get gets getting go goes going gone good got had has have having he
  her here hers herself him himself his how however i if in into is it its itself just last least less let lot lots
  many may me might mine more most much must my myself need needs neither never new next no nobody none noone nor not
  nothing now of off often old on once one ones only or other others our ours out over overall own please quite
  rather really same she should since so some somebody someone something soon still such than that the their theirs
  them themselves then there these they this those through thus to today tomorrow too under unless until up upon us
  usually very was we well were what whatever when where whether which while who whoever whole whom whose why will
  with within without worse worst would yes yesterday yet you your yours yourself ok okay thanks hello hi
  day days week weeks weekly month months monthly year years quarter quarters time times period periods date dates
  morning afternoon evening tonight
  board boards project projects team teams squad group groups company organisation organization department dept
  people person persons member members developer developers dev devs engineer engineers tester testers assignee
  assignees user users staff admin admins lead leads manager managers owner owners reporter reporters unassigned
  work works worked working workload workloads load loads backlog backlogs ticket tickets issue issues task tasks
  subtask subtasks story stories bug bugs epic epics release releases version versions feature features sprint
  sprints velocity process processes workflow workflows flow delivery quality progress review reviews reviewed
  testing test tests tested status statuses stage stages estimate estimates estimated estimation estimating effort
  finding findings breach breaches warning warnings rule rules jira data figure figures number numbers scorecard
  scorecards rate rates average median total totals count counts cycle overview report reports dashboard open
  closed todo blocked blocker blockers stuck plate capacity
  lower lowest higher highest larger largest bigger biggest greater greatest smaller smallest maximum minimum
  ascending descending top bottom`.split(/\s+/),
);

/** The question folded a character at a time (foldText), and where each folded character stood in the question. */
function foldedWithPlaces(text: string): { folded: string; places: number[] } {
  let folded = "";
  const places: number[] = [];
  let at = 0;
  for (const char of text) {
    for (const piece of foldText(char)) {
      folded += piece;
      places.push(at);
    }
    at += char.length;
  }
  return { folded, places };
}

const startsASentence = (text: string, at: number) => {
  const before = text.slice(0, at).trimEnd();
  return before === "" || /[.!?]$/.test(before);
};

/**
 * A name typed where a person's name stands ("how is zara doing?", "zara's
 * backlog", "Who is Zara?") that no one on the board goes by, as the question
 * writes it with a capital ("Zara"); null when there is none. The service's
 * unknown_name, read alike: a word counts as a name only when the question
 * asks something of one person (`asks`), or when it is typed with a capital
 * and not where a sentence starts; never a word of NOT_NAMES, a word of
 * anyone's name on the board (a surname typed alone is someone's), a word in
 * capitals (a key or an abbreviation), or one with a digit. Read only when
 * nothing else made sense of a question at people level.
 */
export function unknownName(question: string, board: readonly Person[], asks: boolean): string | null {
  const taken = new Set(board.flatMap((person) => person.name.split(/\s+/).filter(Boolean).map(foldText)));
  const { folded, places } = foldedWithPlaces(question);
  const found: { start: number; end: number }[] = [];
  for (const match of folded.matchAll(TYPED_NAME)) {
    const word = match[1] ?? match[2];
    const offset = match[1] !== undefined ? match[0].length - match[1].length : 0;
    found.push({ start: match.index + offset, end: match.index + offset + word.length });
  }
  for (const { start, end } of found.sort((a, b) => a.start - b.start)) {
    const word = folded.slice(start, end);
    const first = places[start];
    const typed = question.slice(first, places[end - 1] + (question.codePointAt(places[end - 1])! > 0xffff ? 2 : 1));
    const upper = typed.length > 1 && typed === typed.toUpperCase() && typed !== typed.toLowerCase();
    if ([...word].length < 2 || NOT_NAMES.has(word) || taken.has(word) || upper) continue;
    const capital = typed[0] !== typed[0].toLowerCase() && !startsASentence(question, first);
    if (asks || capital) return typed[0].toUpperCase() + typed.slice(1);
  }
  return null;
}

/** Ask's words when a first name typed on its own could be more than one person (prompts.py AMBIGUOUS_FIRST_NAME). */
export function ambiguousFirstNameMessage(first: string, names: readonly string[]): string {
  return `${first} could be ${[...new Set(names)].join(" or ")}. Type @ and pick the one you mean.`;
}

/** Ask's words when a typed name could be more than one person: pick with @, which shows their pictures. */
export function ambiguousNameMessage(names: readonly string[]): string {
  // The service's words (oversight/ask/prompts.py AMBIGUOUS_NAME): the names joined with "or".
  return `More than one person on this board is called ${[...new Set(names)].join(" or ")}. Type @ and pick the one you mean.`;
}

/**
 * Whether a question names someone on the board, as typed (any case, any
 * accents), or carries an @. Anyone on the board counts: a ticket holder, or a
 * member who holds none (the directory), whose name is a person's all the same.
 */
export function namesSomeone(question: string, dataset: Dataset): boolean {
  if (/(^|[\s([{"'“‘])@\S/u.test(question)) return true;
  return findNames(foldText(question), directoryPeople(dataset).map((person) => foldText(person.name))).length > 0;
}
