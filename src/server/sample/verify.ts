import { RULE_ID_IN_TEXT, SCORECARD_MEASURES, type FactCell, type FactColumnKind, type FactSet, type PlanStep } from "@/lib/api/schemas";
import { foldText } from "@/lib/names";

/**
 * Numbers, issue keys and dates in a written answer must exist in the facts it
 * was written from (Planning.md principle 3). A port of the backend's
 * oversight/ask/validate.py, so a sample answer passes exactly when a live one
 * would: the same patterns, the same display forms, the same trusted sources.
 *
 * Where a value may come from: number columns (number, count, hours, share,
 * ratio); issue-key columns; date columns; text that code wrote (labels,
 * messages, notes); the plan's parameters; each fact's row count. Ticket text
 * (summary, epic_title) never supplies a number, because anyone who can edit a
 * ticket can write one there. Rule ids such as R-EST-01 are vocabulary, not data.
 *
 * Each verified value is bound to the place it came from, as validate.py binds
 * it: a key to the first place that holds it; a number or date that only one
 * place holds, there; one that several places hold (a 3 in three people's
 * rows) to the place its context points at, the places narrowed in turn and
 * each step kept only when some place survives it: (a) to the rows of the
 * entities around it (in a Markdown table, those named anywhere in its row;
 * in prose, those named before it in its sentence, which ends at . ; ! or ?
 * before a space or at a line break, never at a dot inside a name), people
 * and issue keys first, then other row labels, each kind nearest first; (b) to
 * the fact of the figures bound before it in its sentence, or above it in its
 * table column; (c) in a table, to the fact columns whose label or key
 * matches its column's header; (d) in a table, to the fact of the figures
 * bound anywhere in the table; then (e) the first place left. A name of two
 * words or more is found whole in any case and with or without its accents
 * (foldText); a one-word label only as the data writes it ("will" is not Will).
 */

export interface Binding {
  marker: number;
  text: string;
  fact_ref: string;
  row_index: number;
  column: string;
}

export interface Check {
  ok: boolean;
  problems: string[];
  /** Every verified value in text order, numbered from 1: what the tick-and-tie lines draw. */
  bindings: (Binding & { start: number })[];
}

/** What the validator reads of a fact set; candidates in the weekly insights are checked through the same shape. */
export type VerifiableFacts = Pick<FactSet, "ref" | "columns" | "rows" | "as_of" | "note">;

export const KEY = /\b[A-Z][A-Z0-9_]+-\d+\b/g;
export const NUM = /(?<![\w-])(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?%?|\d+(?:\.\d+)?%?)/g;
/** A rule id, R-EFF-01 or (JO-20) a board's own R-CUS-101: never read as a key or a number. */
const RULE_ID = RULE_ID_IN_TEXT;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;
const ISO_DATETIME = /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:?\d{2})?)?/g;
const MONTH =
  "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const SPELLED_DAY = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH})\\.?\\s+(\\d{4})\\b`, "gi");
const SPELLED_MONTH = new RegExp(`\\b(${MONTH})\\.?\\s+(\\d{4})\\b`, "gi");
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

const NUMBER_KINDS: ReadonlySet<FactColumnKind> = new Set(["number", "count", "hours", "share", "ratio"]);
const TICKET_TEXT_COLUMNS: ReadonlySet<string> = new Set(["summary", "epic_title"]);

interface Source {
  fact_ref: string;
  row_index: number;
  column: string;
}

/* --------------------------------------------------------- display forms -- */

function toNumber(value: unknown): number | null {
  if (value === null || typeof value === "boolean") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const text = value.trim().replace(/,/g, "");
    if (!/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(text)) return null;
    const number = Number(text);
    return Number.isFinite(number) ? number : null;
  }
  return null;
}

/**
 * Round the shortest decimal form of `value` (what Python's repr and JS's
 * String both print) to `decimals` places, half up or half to even. Working on
 * the digits rather than the float keeps 1.005 rounding to 1.01, as a reader
 * (and Python's Decimal) would.
 */
function roundDecimal(value: number, decimals: number, mode: "up" | "even"): string {
  const shortest = String(Math.abs(value));
  if (/e/i.test(shortest)) return value.toFixed(decimals);
  const [whole, fraction = ""] = shortest.split(".");
  const digits = (whole + fraction.padEnd(decimals + 1, "0")).split("").map(Number);
  const keep = whole.length + decimals;
  const next = digits[keep];
  const rest = digits.slice(keep + 1).some((digit) => digit > 0);
  const kept = digits.slice(0, keep);
  const odd = kept[kept.length - 1] % 2 === 1;
  if (next > 5 || (next === 5 && (rest || mode === "up" || odd))) {
    let index = kept.length - 1;
    while (index >= 0 && kept[index] === 9) {
      kept[index] = 0;
      index -= 1;
    }
    if (index < 0) kept.unshift(1);
    else kept[index] += 1;
  }
  const text = kept.join("");
  const integer = text.slice(0, text.length - decimals);
  const result = decimals > 0 ? `${integer}.${text.slice(text.length - decimals)}` : integer;
  return value < 0 && /[1-9]/.test(result) ? `-${result}` : result;
}

/** A number at a fixed number of places, rounded half up: how every figure in a sample answer is written. */
export function fixed(value: number, decimals: number): string {
  return roundDecimal(value, decimals, "up");
}

function withCommas(form: string): string {
  const [whole, fraction] = form.split(".");
  const negative = whole.startsWith("-");
  const digits = negative ? whole.slice(1) : whole;
  if (!/^\d+$/.test(digits)) return form;
  const grouped = (negative ? "-" : "") + digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

function trim(form: string): string {
  return form.includes(".") ? form.replace(/0+$/, "").replace(/\.$/, "") : form;
}

function rounded(number: number, decimals: number): string[] {
  return [number.toFixed(decimals), roundDecimal(number, decimals, "up"), roundDecimal(number, decimals, "even")];
}

/** The strings a value may legitimately be written as (validate.py's display_forms). */
export function displayForms(value: unknown, kind: FactColumnKind | "number" = "number"): Set<string> {
  const number = toNumber(value);
  const forms = new Set<string>();
  if (number === null) return forms;
  if (typeof value === "number") forms.add(String(value));
  else if (typeof value === "string") forms.add(value.trim().replace(/,/g, ""));
  for (const decimals of [0, 1, 2]) {
    for (const form of rounded(number, decimals)) {
      forms.add(form).add(withCommas(form)).add(trim(form)).add(trim(withCommas(form)));
    }
  }
  if (kind === "share" && number >= 0 && number <= 1) {
    for (const decimals of [0, 1]) {
      for (const form of rounded(number * 100, decimals)) {
        forms.add(`${form}%`).add(`${trim(form)}%`).add(form).add(trim(form));
      }
    }
  }
  return forms;
}

/* ------------------------------------------------------------- the facts -- */

const MEASURE_LABELS = new RegExp(SCORECARD_MEASURES.map((measure) => measure.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "gi");

function blank(text: string, pattern: RegExp): string {
  // Masking keeps every other character where it was, so positions stay valid.
  return text.replace(pattern, (match) => " ".repeat(match.length));
}

function monthNumber(name: string): number | null {
  const index = MONTHS.indexOf(name.slice(0, 3).toLowerCase());
  return index < 0 ? null : index + 1;
}

function spelledDay(day: string, month: string, year: string): string | null {
  const number = monthNumber(month);
  if (number === null || Number(day) < 1 || Number(day) > 31) return null;
  return `${year.padStart(4, "0")}-${String(number).padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function spelledMonth(month: string, year: string): string | null {
  const number = monthNumber(month);
  return number === null ? null : `${year.padStart(4, "0")}-${String(number).padStart(2, "0")}`;
}

/** A value -> every place that holds it, in the facts' order (keyed so each place is there once): the first is where a value with no context is bound. */
type Places = Map<string, Map<string, Source>>;

interface Allowed {
  keys: Places;
  dates: Places;
  numbers: Places;
}

const rowKey = (ref: string, row: number): string => `${ref}\u0000${row}`;

function setDefault(map: Places, key: string, source: Source): void {
  let held = map.get(key);
  if (!held) {
    held = new Map();
    map.set(key, held);
  }
  const at = `${rowKey(source.fact_ref, source.row_index)}\u0000${source.column}`;
  if (!held.has(at)) held.set(at, source);
}

function placesOf(map: Places, key: string): Source[] {
  return [...(map.get(key)?.values() ?? [])];
}

function addDate(value: FactCell | undefined, source: Source, allowed: Allowed): void {
  if (typeof value === "string" && ISO_DAY.test(value)) {
    const day = value.slice(0, 10);
    setDefault(allowed.dates, day, source);
    // "in 2026" is the date's year, not an invented number.
    setDefault(allowed.numbers, day.slice(0, 4), source);
  }
}

function addTrustedText(text: string, source: Source, allowed: Allowed): void {
  for (const match of text.matchAll(ISO_DATETIME)) addDate(match[0], source, allowed);
  let work = blank(text, ISO_DATETIME);
  for (const match of work.matchAll(SPELLED_DAY)) {
    const day = spelledDay(match[1], match[2], match[3]);
    if (day) addDate(day, source, allowed);
  }
  work = blank(blank(blank(work, SPELLED_DAY), RULE_ID), KEY);
  for (const match of work.matchAll(NUM)) {
    const token = match[0].replace(/,/g, "");
    if (token.endsWith("%")) {
      const percent = toNumber(token.slice(0, -1));
      if (percent === null) continue;
      for (const form of [token, `${percent.toFixed(0)}%`, `${percent.toFixed(1)}%`, `${trim(percent.toFixed(1))}%`]) {
        setDefault(allowed.numbers, form, source);
      }
    } else {
      for (const form of displayForms(token)) setDefault(allowed.numbers, form, source);
    }
  }
}

function paramForms(value: unknown): Set<string> {
  const forms = displayForms(value);
  if (forms.size > 0 || typeof value !== "string") return forms;
  // The digits inside a string such as "90d".
  for (const match of blank(value, KEY).matchAll(NUM)) for (const form of displayForms(match[0])) forms.add(form);
  return forms;
}

function allowedFrom(facts: readonly VerifiableFacts[], plan: readonly PlanStep[] | null): Allowed {
  const allowed: Allowed = { keys: new Map(), dates: new Map(), numbers: new Map() };
  for (const fact of facts) {
    const kinds = new Map(fact.columns.map((column) => [column.key, column.kind]));
    fact.rows.forEach((row, index) => {
      for (const [column, value] of Object.entries(row)) {
        const source = { fact_ref: fact.ref, row_index: index, column };
        const kind = kinds.get(column) ?? "text";
        if (kind === "issue_key" || column === "issue_key" || column === "epic_key") {
          if (typeof value === "string") setDefault(allowed.keys, value, source);
        } else if (column === "sample_keys" && typeof value === "string") {
          for (const match of value.matchAll(KEY)) setDefault(allowed.keys, match[0], source);
        } else if (NUMBER_KINDS.has(kind)) {
          for (const form of displayForms(value, kind)) setDefault(allowed.numbers, form, source);
        } else if (kind === "date") {
          addDate(value, source, allowed);
        } else if (typeof value === "string" && !TICKET_TEXT_COLUMNS.has(column)) {
          addTrustedText(value, source, allowed);
        }
      }
    });
    if (fact.as_of) addDate(fact.as_of, { fact_ref: fact.ref, row_index: -1, column: "as_of" }, allowed);
    if (fact.note) addTrustedText(fact.note, { fact_ref: fact.ref, row_index: -1, column: "note" }, allowed);
  }
  if (plan !== null) {
    plan.forEach((step, index) => {
      const fact = facts[index];
      if (!fact) return;
      const source = { fact_ref: fact.ref, row_index: -1, column: "params" };
      for (const value of Object.values(step.params)) {
        for (const form of paramForms(value)) setDefault(allowed.numbers, form, source);
      }
    });
  }
  for (const fact of facts) {
    const source = { fact_ref: fact.ref, row_index: -1, column: "row_count" };
    for (const form of displayForms(fact.rows.length, "count")) setDefault(allowed.numbers, form, source);
  }
  return allowed;
}

/* -------------------------------------------------------------- validate -- */

/** Someone an answer may name: a name also reaches the rows that hold only this person's id. */
export interface Named {
  id: string;
  name: string;
}

export interface VerifyOptions {
  /** Everyone the answer may name (people level), as validate.py's `people`. */
  people?: readonly Named[];
}

interface Found {
  start: number;
  token: string;
  /** Every place that holds the value, in the facts' order. */
  sources: Source[];
  kind: "key" | "date" | "number";
}

export function verify(text: string, facts: readonly VerifiableFacts[], plan: readonly PlanStep[] | null, options: VerifyOptions = {}): Check {
  const { keys, dates, numbers } = allowedFrom(facts, plan);
  const found: Found[] = [];
  const problems: string[] = [];
  const record = (start: number, token: string, sources: Source[], kind: Found["kind"], problem: string) => {
    if (sources.length > 0) found.push({ start, token, sources, kind });
    else problems.push(`${problem} ${token}`);
  };

  let work = blank(text, RULE_ID);
  for (const match of work.matchAll(KEY)) record(match.index, match[0], placesOf(keys, match[0]), "key", "unknown key");
  work = blank(work, KEY);

  for (const match of work.matchAll(ISO_DATETIME)) {
    record(match.index, match[0], placesOf(dates, match[0].slice(0, 10)), "date", "unverified date");
  }
  work = blank(work, ISO_DATETIME);
  for (const match of work.matchAll(SPELLED_DAY)) {
    const day = spelledDay(match[1], match[2], match[3]);
    record(match.index, match[0], day ? placesOf(dates, day) : [], "date", "unverified date");
  }
  work = blank(work, SPELLED_DAY);
  for (const match of work.matchAll(SPELLED_MONTH)) {
    const prefix = spelledMonth(match[1], match[2]);
    const month = prefix ? [...dates.entries()].filter(([day]) => day.startsWith(prefix)).flatMap(([, held]) => [...held.values()]) : [];
    record(match.index, match[0], month, "date", "unverified date");
  }
  work = blank(work, SPELLED_MONTH);
  // A measure's label is words, never a figure: "per 10 open tickets" is no one's (oversight/ask/scorecards.py, without_labels).
  work = blank(work, MEASURE_LABELS);

  for (const match of work.matchAll(NUM)) {
    record(match.index, match[0], placesOf(numbers, match[0].replace(/,/g, "")), "number", "unverified number");
  }

  found.sort((a, b) => a.start - b.start);
  const places = bind(found, text, facts, options.people ?? []);
  return {
    ok: problems.length === 0,
    problems: [...new Set(problems)],
    bindings: found.map(({ start, token }, index) => ({ marker: index + 1, text: token, start, ...places[index] })),
  };
}

/* ------------------------------------------- where a figure came from -- */

/** A letter, a mark, a digit or an underscore (Python's \w in validate.py). */
const WORD_CHAR = "[\\p{L}\\p{M}\\p{N}_]";
const WORD = new RegExp(`${WORD_CHAR}+`, "gu");
const HEADER_WORD = /[\p{L}\p{M}\p{N}]+/gu;
const LETTER = /\p{L}/u;
const PERSON_ID = /^p[0-9a-f]{12}$/;
// A sentence ends at . ; ! or ? before a space, or at a line break (a Markdown table row is a line of its own).
const SENTENCE_END = /[.;!?](?=\s)|\n/g;
// A Markdown table's delimiter row: "|---|:--:|", the pipes at either end optional.
const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;
const CELL_PIPE = /(?<!\\)\|/g;
// The columns that say whose a row is, each with the column that names that person beside it.
const PERSON_COLUMNS: readonly [string, string][] = [
  ["person_id", "name"],
  ["assignee_id", "assignee"],
];
// A text cell longer than this is a sentence (a message, a note), not a row's label.
const LABEL_MAX = 120;
// An entity's kind, the strongest first: a person or an issue key; a label only one row of its column holds; any other label.
const IDENTITY = 0;
const ROW_LABEL = 1;
const LABEL = 2;

interface Phrase {
  text: string;
  /** Folded (foldText) when it has two words or more, else as the data writes it. */
  folded: boolean;
}

interface Entity {
  start: number;
  end: number;
  tier: number;
  /** The fact rows it stands for, as rowKey(ref, index). */
  rows: ReadonlySet<string>;
}

interface TableRow {
  table: number;
  start: number;
  end: number;
  cells: [number, number][];
  header: string[];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function words(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

function bind(found: readonly Found[], text: string, facts: readonly VerifiableFacts[], people: readonly Named[]): Source[] {
  let reading: Reading | null = null;
  const chosen: [number, Source][] = [];
  for (const item of found) {
    let source: Source;
    if (item.kind === "key" || item.sources.length === 1) source = item.sources[0];
    else {
      reading ??= new Reading(text, facts, people);
      source = reading.place(item.start, item.sources, chosen);
    }
    chosen.push([item.start, source]);
  }
  return chosen.map(([, source]) => source);
}

/** The places in the rows of each entity in turn, each step kept only when some place is left. */
function byEntities(sources: readonly Source[], entities: readonly Entity[]): Source[] {
  let candidates = [...sources];
  for (const entity of entities) {
    const kept = candidates.filter((source) => entity.rows.has(rowKey(source.fact_ref, source.row_index)));
    if (kept.length > 0) candidates = kept;
  }
  return candidates;
}

/** The places in the fact of the nearest bound figure that has one among them (bound: nearest first). */
function byFact(candidates: Source[], bound: readonly Source[]): Source[] {
  for (const other of bound) {
    const kept = candidates.filter((source) => source.fact_ref === other.fact_ref);
    if (kept.length > 0) return kept;
  }
  return candidates;
}

/** A header's or a column's words, folded, a plural's s taken off: "Tickets reopened" ~ "tickets_reopened". */
function headerWords(text: string): Set<string> {
  return new Set(
    [...foldText(text).matchAll(HEADER_WORD)].map(([word]) => ([...word].length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word)),
  );
}

function sameWords(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((word) => b.has(word));
}

function within(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return [...a].every((word) => b.has(word));
}

function lowerBound(sorted: readonly number[], at: number): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (sorted[middle] < at) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** What an answer says around its figures: the entities it names, where its sentences end, its table rows. */
class Reading {
  private readonly entities: Entity[];
  private readonly ends: number[];
  private readonly rows: TableRow[];
  private readonly rowStarts: number[];
  private readonly labels = new Map<string, Map<string, string>>();

  constructor(text: string, facts: readonly VerifiableFacts[], people: readonly Named[]) {
    this.entities = entitiesIn(text, indexOf(facts, people));
    // A dot inside a name ("Jo B. Smith", "Ada.Brooks") ends no sentence: names are blanked before ends are found.
    let masked = text;
    for (const entity of this.entities) {
      masked = masked.slice(0, entity.start) + " ".repeat(entity.end - entity.start) + masked.slice(entity.end);
    }
    this.ends = [...masked.matchAll(SENTENCE_END)].map((match) => match.index);
    this.rows = tableRows(text);
    this.rowStarts = this.rows.map((row) => row.start);
    for (const fact of facts) {
      if (!this.labels.has(fact.ref)) this.labels.set(fact.ref, new Map(fact.columns.map((column) => [column.key, column.label])));
    }
  }

  private sentence(at: number): number {
    return lowerBound(this.ends, at);
  }

  private row(at: number): TableRow | null {
    const row = this.rows[lowerBound(this.rowStarts, at + 1) - 1];
    return row && at < row.end ? row : null;
  }

  place(start: number, sources: readonly Source[], chosen: readonly [number, Source][]): Source {
    const before = [...chosen].reverse();
    const row = this.row(start);
    if (row === null) {
      // Prose: the entities named before the figure in its sentence, then the figures bound there before it.
      const sentence = this.sentence(start);
      const named = this.entities
        .filter((entity) => entity.start <= start && this.row(entity.start) === null && this.sentence(entity.start) === sentence)
        .sort((a, b) => a.tier - b.tier || b.start - a.start);
      const together = before.filter(([at]) => this.row(at) === null && this.sentence(at) === sentence).map(([, source]) => source);
      return byFact(byEntities(sources, named), together)[0];
    }
    // A table row: the entities named anywhere in it (those before the figure first), then the figures bound above it in
    // its column, then its column's header, then the figures bound anywhere in the table.
    const after = (entity: Entity) => (entity.start > start ? 1 : 0);
    const named = this.entities
      .filter((entity) => row.start <= entity.start && entity.start < row.end)
      .sort((a, b) => a.tier - b.tier || after(a) - after(b) || Math.abs(start - a.start) - Math.abs(start - b.start));
    const column = columnAt(row, start);
    const inTable = before.flatMap(([at, source]): [number, Source][] => {
      const other = this.row(at);
      return other !== null && other.table === row.table ? [[columnAt(other, at), source]] : [];
    });
    let candidates = byEntities(sources, named);
    candidates = byFact(
      candidates,
      inTable.filter(([atColumn]) => atColumn === column).map(([, source]) => source),
    );
    candidates = this.byHeader(candidates, column >= 0 && column < row.header.length ? row.header[column] : "");
    return byFact(
      candidates,
      inTable.map(([, source]) => source),
    )[0];
  }

  /** The places whose fact column's label or key matches the table column's header, the closest match only. */
  private byHeader(candidates: Source[], header: string): Source[] {
    const wanted = headerWords(header);
    if (wanted.size === 0) return candidates;
    const scores = candidates.map((source) => this.likeness(source, wanted));
    const best = Math.max(...scores);
    return best > 0 ? candidates.filter((_, index) => scores[index] === best) : candidates;
  }

  /** 2 when the column's label or key says the header's words, 1 when one holds the other's words, else 0. */
  private likeness(source: Source, wanted: ReadonlySet<string>): number {
    if (source.row_index < 0) return 0;
    const label = this.labels.get(source.fact_ref)?.get(source.column) ?? "";
    let best = 0;
    for (const found of [headerWords(label), headerWords(source.column)]) {
      if (found.size === 0) continue;
      if (sameWords(found, wanted)) return 2;
      if (within(found, wanted) || within(wanted, found)) best = 1;
    }
    return best;
  }
}

function columnAt(row: TableRow, at: number): number {
  return row.cells.findIndex(([start, end]) => start <= at && at < end);
}

interface Index {
  keys: Map<string, Set<string>>;
  phrases: Map<string, { phrase: Phrase; rows: Set<string>; tier: number }>;
}

/** How a text cell is looked for in an answer; null for one that labels nothing (an id, a date, a sentence). */
function phraseOf(value: string): Phrase | null {
  const text = words(value).join(" ");
  const length = [...text].length;
  if (length < 2 || length > LABEL_MAX || !LETTER.test(text) || PERSON_ID.test(text) || ISO_DAY.test(text)) return null;
  if ((text.match(WORD) ?? []).length > 1) return { text: words(foldText(text)).join(" "), folded: true };
  return { text, folded: false };
}

const phraseKey = (phrase: Phrase): string => `${phrase.folded ? "f" : "x"}:${phrase.text}`;

/** The entities the facts hold: issue keys, people's names and row labels, each with the rows it stands for. */
function indexOf(facts: readonly VerifiableFacts[], people: readonly Named[]): Index {
  const keys = new Map<string, Set<string>>();
  const phrases: Index["phrases"] = new Map();
  const holders = new Map<string, Set<string>>();
  const names = new Map<string, { phrase: Phrase; ids: Set<string> }>();
  // How many rows of one column hold each phrase: a phrase one row alone holds is that row's label.
  const counts = new Map<string, { key: string; count: number }>();
  const add = <T>(map: Map<string, Set<T>>, key: string, value: T) => {
    const held = map.get(key) ?? new Set<T>();
    held.add(value);
    map.set(key, held);
  };
  const named = (phrase: Phrase, id: string) => {
    const entry = names.get(phraseKey(phrase)) ?? { phrase, ids: new Set<string>() };
    entry.ids.add(id);
    names.set(phraseKey(phrase), entry);
  };
  for (const fact of facts) {
    const kinds = new Map(fact.columns.map((column) => [column.key, column.kind]));
    fact.rows.forEach((row, index) => {
      const place = rowKey(fact.ref, index);
      for (const [column, value] of Object.entries(row)) {
        if (typeof value !== "string") continue;
        const kind = kinds.get(column) ?? "text";
        if (kind === "issue_key" || column === "issue_key" || column === "epic_key") add(keys, value, place);
        else if (column === "sample_keys") for (const [key] of value.matchAll(KEY)) add(keys, key, place);
        else if (kind === "text" && !TICKET_TEXT_COLUMNS.has(column)) {
          const phrase = phraseOf(value);
          if (!phrase) continue;
          const key = phraseKey(phrase);
          const entry = phrases.get(key) ?? { phrase, rows: new Set<string>(), tier: LABEL };
          entry.rows.add(place);
          phrases.set(key, entry);
          const counted = `${fact.ref}\u0000${column}\u0000${key}`;
          counts.set(counted, { key, count: (counts.get(counted)?.count ?? 0) + 1 });
        }
      }
      for (const [idColumn, nameColumn] of PERSON_COLUMNS) {
        const id = row[idColumn];
        if (typeof id !== "string" || id === "") continue;
        add(holders, id, place);
        const name = row[nameColumn];
        const phrase = typeof name === "string" ? phraseOf(name) : null;
        if (phrase) named(phrase, id);
      }
    });
  }
  for (const person of people) {
    const phrase = phraseOf(person.name);
    if (phrase) named(phrase, person.id);
  }
  for (const { key, count } of counts.values()) {
    const entry = phrases.get(key);
    if (entry && count === 1) entry.tier = ROW_LABEL;
  }
  for (const [key, { phrase, ids }] of names) {
    const rows = new Set(phrases.get(key)?.rows ?? []);
    for (const id of ids) for (const place of holders.get(id) ?? []) rows.add(place);
    if (rows.size > 0) phrases.set(key, { phrase, rows, tier: IDENTITY });
  }
  return { keys, phrases };
}

/** The text folded a character at a time (foldText), and where in the text each folded unit's character starts and ends. */
function folded(text: string): { text: string; starts: number[]; ends: number[] } {
  let out = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let at = 0;
  for (const char of text) {
    const piece = foldText(char);
    out += piece;
    for (let unit = 0; unit < piece.length; unit += 1) {
      starts.push(at);
      ends.push(at + char.length);
    }
    at += char.length;
  }
  return { text: out, starts, ends };
}

/** The entities the text names, in text order; where two would overlap, the longer ("Ada Brooks", never also "Ada"). */
function entitiesIn(text: string, index: Index): Entity[] {
  const spans: Entity[] = [];
  for (const match of blank(text, RULE_ID).matchAll(KEY)) {
    const rows = index.keys.get(match[0]);
    if (rows) spans.push({ start: match.index, end: match.index + match[0].length, tier: IDENTITY, rows });
  }
  const fold = folded(text);
  for (const { phrase, rows, tier } of index.phrases.values()) {
    const parts = words(phrase.text);
    const haystack = phrase.folded ? fold.text : text;
    if (!parts.every((part) => haystack.includes(part))) continue;
    const pattern = new RegExp(`(?<!${WORD_CHAR})${parts.map(escapeRegExp).join("\\s+")}(?!${WORD_CHAR})`, "gu");
    for (const match of haystack.matchAll(pattern)) {
      const end = match.index + match[0].length;
      spans.push(
        phrase.folded
          ? { start: fold.starts[match.index], end: fold.ends[end - 1], tier, rows }
          : { start: match.index, end, tier, rows },
      );
    }
  }
  const taken = new Uint8Array(text.length);
  const entities: Entity[] = [];
  spans.sort((a, b) => a.start - a.end - (b.start - b.end) || a.start - b.start || a.tier - b.tier);
  for (const span of spans) {
    if (taken.subarray(span.start, span.end).some((unit) => unit === 1)) continue;
    taken.fill(1, span.start, span.end);
    entities.push(span);
  }
  return entities.sort((a, b) => a.start - b.start);
}

/** The body rows of every Markdown table in the text: a header row, a delimiter row, then the lines with a pipe. */
function tableRows(text: string): TableRow[] {
  const lines: [number, string][] = [];
  let at = 0;
  for (const line of text.split("\n")) {
    lines.push([at, line]);
    at += line.length + 1;
  }
  const rows: TableRow[] = [];
  let tables = 0;
  let index = 0;
  while (index + 1 < lines.length) {
    const head = lines[index][1];
    const delimiter = lines[index + 1][1];
    if (!head.includes("|") || !delimiter.includes("|") || !TABLE_DELIMITER.test(delimiter)) {
      index += 1;
      continue;
    }
    const header = cellsOf(head).map(([start, end]) => head.slice(start, end).trim());
    index += 2;
    while (index < lines.length && lines[index][1].includes("|") && lines[index][1].trim()) {
      const [start, line] = lines[index];
      rows.push({ table: tables, start, end: start + line.length, cells: cellsOf(line).map(([left, right]) => [start + left, start + right]), header });
      index += 1;
    }
    tables += 1;
  }
  return rows;
}

/** Each cell's span in a table line; a pipe that opens or closes the line bounds no cell of its own. */
function cellsOf(line: string): [number, number][] {
  const bounds = [-1, ...[...line.matchAll(CELL_PIPE)].map((match) => match.index), line.length];
  let cells = bounds.slice(0, -1).map((bound, at): [number, number] => [bound + 1, bounds[at + 1]]);
  const edge = line.trim();
  if (cells.length > 0 && edge.startsWith("|")) cells = cells.slice(1);
  if (cells.length > 0 && edge.endsWith("|") && !edge.endsWith("\\|")) cells = cells.slice(0, -1);
  return cells;
}
