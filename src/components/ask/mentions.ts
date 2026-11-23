import { ASK_MAX_LENGTH, ASK_MAX_MENTIONS, type DirectoryEntry, type Person } from "@/lib/api/schemas";
import { compareByFoldedName, foldText } from "@/lib/names";

/*
 * Mentions in the question, as the text it is sent as: where a typed @ starts
 * a search for someone, who the search finds, what choosing them writes, and
 * the people a question's chips name. The box shows each mention as a chip
 * (draft.ts holds the question as text and chips); here a chip is its
 * "@Name" in the text. Pure functions, so every rule is tested without a browser.
 */

/** Someone picked from the @ list (a chip in the question), and where their "@Name" stands in its text. */
export interface Mention {
  person: Person;
  /** Where the @ is. */
  start: number;
  /** Just after the name. */
  end: number;
}

/** A search for someone in progress: the @ that started it, and what is typed after it up to the caret. */
export interface MentionQuery {
  start: number;
  end: number;
  query: string;
}

/** The longest search kept open: past it the @ was not a mention after all. */
const MAX_QUERY = 64;
const MAX_QUERY_WORDS = 4;
/** What an @ may follow and still start a mention: nothing, a space, or an opening bracket or quote. "a@b" is an address. */
const OPENS = /[\s([{"'“‘«]/u;
/** A letter, mark or digit right against a name makes it part of a longer word: "@Ada Brookss" is not Ada Brooks. */
const WORDISH = /[\p{L}\p{M}\p{N}_]/u;

/** How a mention is written in the question sent: "@Name", as the service reads it. */
export const mentionLabel = (person: Pick<Person, "name">) => `@${person.name}`;
const labelOf = mentionLabel;

/**
 * The search the caret is in: an @ at the start or after a space (or an
 * opening bracket or quote), then up to four words on the same line, with no
 * other @. Null when there is none, or when the @ is a mention already made.
 */
export function mentionQueryAt(text: string, caret: number, mentions: readonly Mention[] = []): MentionQuery | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  if (at > 0 && !OPENS.test(before.charAt(at - 1))) return null;
  if (mentions.some((mention) => mention.start === at)) return null;
  const query = before.slice(at + 1);
  if (query.length > MAX_QUERY || /[\r\n@]/.test(query) || /^\s/u.test(query)) return null;
  if (query.trim().split(/\s+/u).length > MAX_QUERY_WORDS) return null;
  return { start: at, end: caret, query };
}

/** A name's words, folded for a typed search: case, accents and apostrophes aside; hyphens part words. */
function wordsOf(text: string): string[] {
  return foldText(text)
    .replace(/['’]/g, "")
    .split(/[\s\-‐‑‒–—]+/u)
    .filter(Boolean);
}

/**
 * Whether a name answers a search: each word typed starts a word of the name,
 * in order, so "car" and "ruiz" and "car ru" all find Carmen Ruiz, and
 * "élif" finds Elif. Case and accents are ignored. An empty search finds everyone.
 */
export function nameMatches(name: string, query: string): boolean {
  const words = wordsOf(name);
  let from = 0;
  for (const part of wordsOf(query)) {
    const index = words.findIndex((word, at) => at >= from && word.startsWith(part));
    if (index < 0) return false;
    from = index + 1;
  }
  return true;
}

/**
 * The people a search finds: those whose first name it starts first, then in
 * the directory's order (name folded for case and accents, then id), so
 * "Élodie" sorts among the Es and "Øyvind" among the Os, never after Z.
 */
export function peopleMatching(people: readonly Person[], query: string): Person[] {
  const first = wordsOf(query)[0];
  const leads = (person: Person) => (first !== undefined && wordsOf(person.name)[0]?.startsWith(first) ? 0 : 1);
  return people.filter((person) => nameMatches(person.name, query)).sort((a, b) => leads(a) - leads(b) || compareByFoldedName(a, b));
}

/** The @ list's two groups, in the order they are listed: who holds the board's tickets now, then its members who hold none. */
export const MENTION_GROUPS = [
  { key: "tickets", label: "With tickets" },
  { key: "none", label: "No tickets" },
] as const;

export type MentionGroupKey = (typeof MENTION_GROUPS)[number]["key"];

/** One group of the @ list as a search leaves it: its heading, and the people in it the search finds. */
export interface MentionGroup {
  key: MentionGroupKey;
  label: string;
  people: Person[];
}

/**
 * The people a search finds on the board's directory, in the @ list's two
 * groups: "With tickets" (assigned at least one of its tickets now), then
 * "No tickets" (members Jira lets you assign its tickets to who hold none),
 * each ordered as peopleMatching orders. A group the search empties is left
 * out, heading and all. The keyboard moves through them as one list:
 * flattened, they are the options in order.
 */
export function groupMatching(directory: readonly DirectoryEntry[], query: string): MentionGroup[] {
  const people: Record<MentionGroupKey, Person[]> = { tickets: [], none: [] };
  for (const entry of directory) people[entry.tickets > 0 ? "tickets" : "none"].push(entry.person);
  return MENTION_GROUPS.flatMap(({ key, label }) => {
    const found = peopleMatching(people[key], query);
    return found.length > 0 ? [{ key, label, people: found }] : [];
  });
}

/**
 * The text with "@Name " in place of the search (and the rest of the word
 * the caret was in), the mention it makes, and where the caret goes: just
 * after the space. Null when the question would pass its 500 characters.
 */
export function insertMention(
  text: string,
  search: MentionQuery,
  person: Person,
): { text: string; mention: Mention; caret: number } | null {
  const label = labelOf(person);
  // The rest of the word the caret was in ("@car|men"), never the punctuation after it.
  const rest = /^[\p{L}\p{M}\p{N}_'’-]*/u.exec(text.slice(search.end))?.[0] ?? "";
  const after = text.slice(search.end + rest.length);
  const spacer = /^\s/u.test(after) ? "" : " ";
  const next = `${text.slice(0, search.start)}${label}${spacer}${after}`;
  if (next.length > ASK_MAX_LENGTH) return null;
  const end = search.start + label.length;
  return { text: next, mention: { person, start: search.start, end }, caret: end + 1 };
}

/**
 * The mentions still standing after the text changed from `before` to
 * `after`: those the edit did not touch, moved along with it. One the edit
 * reached into (a letter typed inside the name, or deleted from it) is plain
 * text from then on, whatever the text later says. Typing just before the @
 * or just after the name leaves it standing.
 */
export function rebaseMentions(mentions: readonly Mention[], before: string, after: string): Mention[] {
  if (before === after) return [...mentions];
  // The edit is what lies between the longest common start and the longest common end.
  const limit = Math.min(before.length, after.length);
  let start = 0;
  while (start < limit && before[start] === after[start]) start += 1;
  let tail = 0;
  while (tail < limit - start && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail += 1;
  const removedEnd = before.length - tail;
  const shift = after.length - before.length;
  return mentions.flatMap((mention) => {
    if (mention.end <= start) return [mention];
    if (mention.start >= removedEnd) return [{ ...mention, start: mention.start + shift, end: mention.end + shift }];
    return [];
  });
}

/** Whether a mention is whole: "@Name" exactly where it was put, not run into a longer word on either side. */
export function isIntact(mention: Mention, text: string): boolean {
  if (text.slice(mention.start, mention.end) !== labelOf(mention.person)) return false;
  const before = text.charAt(mention.start - 1);
  return (mention.start === 0 || OPENS.test(before)) && !WORDISH.test(text.charAt(mention.end));
}

/** The people a question's chips name: each once, in the order they first appear, at most ten. */
export function mentionedPeople(mentions: readonly Mention[]): Person[] {
  const people: Person[] = [];
  for (const mention of [...mentions].sort((a, b) => a.start - b.start)) {
    if (!people.some((person) => person.id === mention.person.id)) people.push(mention.person);
  }
  return people.slice(0, ASK_MAX_MENTIONS);
}

/**
 * The mentions in a text that came from elsewhere (the address, the last
 * question), sent with these person ids: every "@Name" of each of them is
 * their chip again, as the box sent it, the same person twice included. A
 * whole "@Name" (not run into a longer word) is taken first, each id's first
 * one before any other, so two people of one name get one each and
 * "@Ada Brooksby" is never Ada Brooks's. Then one a letter touches, as the
 * box sends a chip with a letter typed against it ("is@Ada Brooks"), the
 * longer name first. People not on the board, or whose name is not in the
 * text, are left out. In the order they stand, none overlapping.
 */
export function mentionsIn(text: string, people: readonly Person[] | undefined, ids: readonly string[]): Mention[] {
  if (!people || ids.length === 0) return [];
  const sent = ids.flatMap((id) => people.find((candidate) => candidate.id === id) ?? []);
  const everywhere = (person: Person): Mention[] => {
    const label = labelOf(person);
    const at: Mention[] = [];
    for (let start = text.indexOf(label); start >= 0; start = text.indexOf(label, start + 1)) {
      at.push({ person, start, end: start + label.length });
    }
    return at;
  };
  const found: Mention[] = [];
  const free = (mention: Mention) => found.every((other) => mention.end <= other.start || mention.start >= other.end);
  const whole = (mention: Mention) => isIntact(mention, text) && free(mention);
  for (const person of sent) {
    const first = everywhere(person).find(whole);
    if (first) found.push(first);
  }
  for (const person of sent) for (const mention of everywhere(person)) if (whole(mention)) found.push(mention);
  const longestFirst = [...sent].sort((a, b) => b.name.length - a.name.length);
  for (const person of longestFirst) for (const mention of everywhere(person)) if (free(mention)) found.push(mention);
  return found.sort((a, b) => a.start - b.start);
}
