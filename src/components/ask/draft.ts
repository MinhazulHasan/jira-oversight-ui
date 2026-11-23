import { ASK_MAX_LENGTH, type Person } from "@/lib/api/schemas";

import { insertMention, mentionLabel, mentionsIn, rebaseMentions, type Mention, type MentionQuery } from "./mentions";

/*
 * The question box's content as a model: the question's text exactly as it
 * is sent, each chip in it written "@Name", and the chips (who, and where
 * their "@Name" stands). The box draws its DOM from this and changes only
 * this: every keystroke, deletion, paste, drop, undo and choice becomes a
 * change of the model (question-editor.tsx), so a chip is always whole: it
 * goes in one piece or not at all, and nothing is ever typed inside it. Pure
 * functions, so every rule is tested without a browser.
 */

/** The question as the box holds it. */
export interface Draft {
  /** The question as it is sent: its text, each chip written "@Name". At most 500 characters. */
  readonly text: string;
  /** The chips, in the order they stand, none overlapping, each exactly its "@Name" in the text. */
  readonly mentions: readonly Mention[];
}

export const EMPTY_DRAFT: Draft = { text: "", mentions: [] };

/** A selection, as offsets into the draft's text: where it started, and where the caret is. Equal for a caret. */
export interface Selected {
  readonly anchor: number;
  readonly focus: number;
}

export const caretAt = (at: number): Selected => ({ anchor: at, focus: at });

/** A change made: the draft it leaves, and where the caret goes. */
export interface Edit {
  readonly draft: Draft;
  readonly caret: number;
}

/** What the box shows, in order: a run of text (perhaps empty) on each side of every chip. */
export type Piece =
  | { readonly kind: "text"; readonly text: string; readonly start: number; readonly end: number }
  | { readonly kind: "chip"; readonly mention: Mention; readonly index: number };

export function piecesOf(draft: Draft): Piece[] {
  const pieces: Piece[] = [];
  let at = 0;
  draft.mentions.forEach((mention, index) => {
    pieces.push({ kind: "text", text: draft.text.slice(at, mention.start), start: at, end: mention.start });
    pieces.push({ kind: "chip", mention, index });
    at = mention.end;
  });
  pieces.push({ kind: "text", text: draft.text.slice(at), start: at, end: draft.text.length });
  return pieces;
}

/**
 * A question from elsewhere (the address, the session, ↑) with its chips
 * rebuilt: every "@Name" of each person id sent with it becomes their chip
 * again (mentionsIn), the same person twice and a chip with a letter typed
 * against it included. Text naming no one picked stays text.
 */
export function draftOf(text: string, people: readonly Person[] | undefined, ids: readonly string[]): Draft {
  const mentions: Mention[] = [];
  for (const mention of [...mentionsIn(text, people, ids)].sort((a, b) => a.start - b.start)) {
    if (mentions.every((other) => mention.start >= other.end)) mentions.push(mention);
  }
  return { text, mentions };
}

export function sameDraft(a: Draft, b: Draft): boolean {
  return (
    a.text === b.text &&
    a.mentions.length === b.mentions.length &&
    a.mentions.every((mention, index) => {
      const other = b.mentions[index];
      return mention.start === other.start && mention.end === other.end && mention.person.id === other.person.id;
    })
  );
}

/* ------------------------------------------------------------ chip edges --- */

/** The chip a point falls strictly inside, if any. */
function chipAround(draft: Draft, at: number): Mention | undefined {
  return draft.mentions.find((mention) => mention.start < at && at < mention.end);
}

/**
 * A point moved out of any chip it falls inside: to the edge `bias` points
 * to, or (without one) the nearer edge. A caret never stands inside a chip.
 */
export function snapPoint(draft: Draft, at: number, bias: -1 | 0 | 1 = 0): number {
  const clamped = Math.max(0, Math.min(at, draft.text.length));
  const chip = chipAround(draft, clamped);
  if (!chip) return clamped;
  if (bias !== 0) return bias < 0 ? chip.start : chip.end;
  return clamped - chip.start <= chip.end - clamped ? chip.start : chip.end;
}

/** A range, in order, grown to take in whole any chip it reaches into. */
export function wholeRange(draft: Draft, from: number, to: number): [number, number] {
  let start = Math.max(0, Math.min(from, to));
  let end = Math.min(draft.text.length, Math.max(from, to));
  for (const mention of draft.mentions) {
    if (mention.start < start && start < mention.end) start = mention.start;
    if (mention.start < end && end < mention.end) end = mention.end;
  }
  return [start, end];
}

/* ------------------------------------------------------------------ edits --- */

/** The editor's caret holder beside a chip (question-editor.tsx): never part of a question. */
export const CARET_HOLDER = "​";
// Control characters other than the line break and the tab, and the caret holder.
const UNWANTED = /[\u0000-\u0008\u000B-\u001F\u007F​]/g;

/** Text as the question takes it: line breaks as "\n", no control characters, nothing invisible of the editor's. */
export function plainText(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(UNWANTED, "");
}

/** As much of `text` as fits in `room` characters, never half a character. */
function fitted(text: string, room: number): string {
  if (text.length <= room) return text;
  if (room <= 0) return "";
  const cut = text.slice(0, room);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/**
 * Plain text in place of a range (grown to whole chips): what typing,
 * deleting, pasting and dropping do. The text is cut to what the question's
 * 500 characters leave room for, as a text field's limit cuts a paste; it
 * never makes a chip. Null when nothing would change.
 */
export function replaceRange(draft: Draft, from: number, to: number, insert: string): Edit | null {
  const [start, end] = wholeRange(draft, from, to);
  const text = fitted(plainText(insert), ASK_MAX_LENGTH - (draft.text.length - (end - start)));
  if (text === "" && start === end) return null;
  const shift = text.length - (end - start);
  return {
    draft: {
      text: draft.text.slice(0, start) + text + draft.text.slice(end),
      mentions: draft.mentions.flatMap((mention) =>
        mention.end <= start ? [mention] : mention.start >= end ? [{ ...mention, start: mention.start + shift, end: mention.end + shift }] : [],
      ),
    },
    caret: start + text.length,
  };
}

/**
 * Someone chosen from the @ list: the search (and the rest of the word it
 * was in) becomes their chip and a space, the caret just after the space.
 * Null when the question has no room for the name.
 */
export function chooseInto(draft: Draft, search: MentionQuery, person: Person): Edit | null {
  const written = insertMention(draft.text, search, person);
  if (!written) return null;
  const mentions = [...rebaseMentions(draft.mentions, draft.text, written.text), written.mention].sort((a, b) => a.start - b.start);
  return { draft: { text: written.text, mentions }, caret: written.caret };
}

/**
 * A selection dragged to another place in the question: moved, chips and
 * all (a drop from elsewhere is plain text, replaceRange). Null when it would
 * land inside itself.
 */
export function moveRange(draft: Draft, from: number, to: number, at: number): Edit | null {
  const [start, end] = wholeRange(draft, from, to);
  const target = snapPoint(draft, at);
  if (start === end || (target >= start && target <= end)) return null;
  const moved = draft.text.slice(start, end);
  const inside = draft.mentions.filter((mention) => mention.start >= start && mention.end <= end);
  const rest = replaceRange(draft, start, end, "")?.draft ?? draft;
  const place = target > end ? target - moved.length : target;
  const shift = moved.length;
  return {
    draft: {
      text: rest.text.slice(0, place) + moved + rest.text.slice(place),
      mentions: [
        ...rest.mentions.filter((mention) => mention.end <= place),
        ...inside.map((mention) => ({ ...mention, start: mention.start - start + place, end: mention.end - start + place })),
        ...rest.mentions.filter((mention) => mention.start >= place).map((mention) => ({ ...mention, start: mention.start + shift, end: mention.end + shift })),
      ],
    },
    caret: place + moved.length,
  };
}

/* ------------------------------------------------------- steps and units --- */

const graphemes = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;

/** One character (as a reader sees one: an emoji, a letter with its accents) before `at`, not before `floor`. */
function characterBefore(text: string, at: number, floor: number): number {
  if (at <= floor) return floor;
  const segment = graphemes?.segment(text).containing(at - 1);
  const surrogate = at - 2 >= floor && /[\uDC00-\uDFFF]/.test(text.charAt(at - 1)) && /[\uD800-\uDBFF]/.test(text.charAt(at - 2));
  return Math.max(floor, segment ? segment.index : at - (surrogate ? 2 : 1));
}

/** One character after `at`, not past `ceiling`. */
function characterAfter(text: string, at: number, ceiling: number): number {
  if (at >= ceiling) return ceiling;
  const segment = graphemes?.segment(text).containing(at);
  const surrogate = at + 1 < ceiling && /[\uD800-\uDBFF]/.test(text.charAt(at)) && /[\uDC00-\uDFFF]/.test(text.charAt(at + 1));
  return Math.min(ceiling, segment ? segment.index + segment.segment.length : at + (surrogate ? 2 : 1));
}

/** Where the run of text around `at` starts and ends: the chips either side of it, or the ends of the question. */
function runAround(draft: Draft, at: number): [number, number] {
  let floor = 0;
  let ceiling = draft.text.length;
  for (const mention of draft.mentions) {
    if (mention.end <= at) floor = Math.max(floor, mention.end);
    if (mention.start >= at) ceiling = Math.min(ceiling, mention.start);
  }
  return [floor, ceiling];
}

/**
 * Where the caret goes for one press of an arrow: past one character, or
 * over a whole chip as one, as Jira and Confluence step over a mention.
 */
export function stepFrom(draft: Draft, at: number, direction: -1 | 1): number {
  const here = snapPoint(draft, at, direction);
  if (direction < 0) {
    const chip = draft.mentions.find((mention) => mention.end === here);
    return chip ? chip.start : characterBefore(draft.text, here, runAround(draft, here)[0]);
  }
  const chip = draft.mentions.find((mention) => mention.start === here);
  return chip ? chip.end : characterAfter(draft.text, here, runAround(draft, here)[1]);
}

/** How far a deletion reaches: a character, a word (a chip is one), or to the line's start or end. */
export type DeleteUnit = "character" | "word" | "line";

const WORD = /[\p{L}\p{M}\p{N}_'’]/u;
const SPACE = /\s/u;

/**
 * The range one press of Backspace (direction -1) or Delete (1) removes,
 * when the browser has not said: the selection when there is one; else a
 * chip right beside the caret, whole; else a character, a word or the rest
 * of the line. Null at the question's edge.
 */
export function deletionRange(draft: Draft, selected: Selected, direction: -1 | 1, unit: DeleteUnit): [number, number] | null {
  if (selected.anchor !== selected.focus) return wholeRange(draft, selected.anchor, selected.focus);
  const text = draft.text;
  const at = snapPoint(draft, selected.focus);
  const chipAt = (edge: number) => draft.mentions.find((mention) => (direction < 0 ? mention.end : mention.start) === edge);
  if (direction < 0 ? at === 0 : at === text.length) return null;
  const beside = chipAt(at);
  if (beside) return [beside.start, beside.end];
  const [floor, ceiling] = runAround(draft, at);
  if (unit === "character") {
    return direction < 0 ? [characterBefore(text, at, floor), at] : [at, characterAfter(text, at, ceiling)];
  }
  if (unit === "line") {
    if (direction < 0) return text.charAt(at - 1) === "\n" ? [at - 1, at] : wholeRange(draft, text.lastIndexOf("\n", at - 1) + 1, at);
    const next = text.indexOf("\n", at);
    return text.charAt(at) === "\n" ? [at, at + 1] : wholeRange(draft, at, next < 0 ? text.length : next);
  }
  // A word: the spaces before it, then the word (or a run of punctuation); a chip across the spaces is the word.
  const charAt = (edge: number) => (direction < 0 ? text.charAt(edge - 1) : text.charAt(edge));
  let edge = at;
  const inside = (point: number) => (direction < 0 ? point > floor : point < ceiling);
  while (inside(edge) && SPACE.test(charAt(edge))) edge += direction;
  const chip = chipAt(edge);
  if (chip && edge !== at) return direction < 0 ? [chip.start, at] : [at, chip.end];
  const wordy = WORD.test(charAt(edge));
  while (inside(edge) && !SPACE.test(charAt(edge)) && WORD.test(charAt(edge)) === wordy) edge += direction;
  return direction < 0 ? [edge, at] : [at, edge];
}

/* -------------------------------------------------- the browser's changes --- */

/** What the box's DOM holds, read back in order: runs of text, and the chips still in it. */
export type Run = string | Mention;

const runLength = (run: Run) => (typeof run === "string" ? run.length : mentionLabel(run.person).length);

function draftOfRuns(runs: readonly Run[]): Draft {
  let text = "";
  const mentions: Mention[] = [];
  for (const run of runs) {
    if (typeof run === "string") {
      text += plainText(run);
    } else {
      const label = mentionLabel(run.person);
      mentions.push({ person: run.person, start: text.length, end: text.length + label.length });
      text += label;
    }
  }
  return { text, mentions };
}

/** A draft as a list of characters and chips, the chips by identity. */
function tokensOf(runs: readonly Run[]): Run[] {
  return runs.flatMap((run): Run[] => (typeof run === "string" ? plainText(run).split("") : [run]));
}

/**
 * The draft once the browser has changed the box itself: what an input
 * method composed, which is left to the browser while it composes (Japanese,
 * Chinese, the accents a Mac makes from a held key). `runs` is the DOM read
 * back, its chips the drawn draft's own; the change is cut to what the 500
 * characters leave room for, the rest of the question kept as it was.
 */
export function settleRuns(before: Draft, runs: readonly Run[], caret: number): Edit {
  const after = draftOfRuns(runs);
  if (after.text.length <= ASK_MAX_LENGTH) return { draft: after, caret: Math.min(caret, after.text.length) };
  const old = tokensOf(piecesOf(before).map((piece) => (piece.kind === "text" ? piece.text : piece.mention)));
  const now = tokensOf(runs);
  let head = 0;
  while (head < old.length && head < now.length && old[head] === now[head]) head += 1;
  let tail = 0;
  while (tail < old.length - head && tail < now.length - head && old[old.length - 1 - tail] === now[now.length - 1 - tail]) tail += 1;
  const kept: Run[] = [];
  let used = [...old.slice(0, head), ...old.slice(old.length - tail)].reduce((sum, token) => sum + runLength(token), 0);
  for (const token of now.slice(head, now.length - tail)) {
    if (used + runLength(token) > ASK_MAX_LENGTH) break;
    kept.push(token);
    used += runLength(token);
  }
  // Never half a character at the cut.
  const last = kept.at(-1);
  if (typeof last === "string" && /[\uD800-\uDBFF]/.test(last)) kept.pop();
  const lead = [...old.slice(0, head), ...kept];
  return { draft: draftOfRuns([...lead, ...old.slice(old.length - tail)]), caret: lead.reduce((sum, token) => sum + runLength(token), 0) };
}

/* ---------------------------------------------------------------- history --- */

/** What an edit was, for undo: runs of typing (or of deleting) undo together. */
export type EditKind = "type" | "delete" | "other";

/** A state the box can go back to: the draft, and the selection it had. */
export interface Moment {
  readonly draft: Draft;
  readonly selected: Selected;
}

/** The box's own undo and redo (the browser's cannot know the model). */
export interface History {
  readonly past: readonly Moment[];
  readonly future: readonly Moment[];
  /** The last edit: its kind, when, and the draft it left, so the next of its kind can join it. */
  readonly last: { readonly kind: EditKind; readonly at: number; readonly draft: Draft } | null;
}

export const NO_HISTORY: History = { past: [], future: [], last: null };
const KEEP = 100;
/** Typing (or deleting) within a second of the last of its kind, where it left off, is one step to undo. */
const RUN_MS = 1000;

/** The history once an edit is made from `before`: a new step, or the run it continues. Redo is gone. */
export function remembered(history: History, before: Moment, after: Draft, kind: EditKind, now: number): History {
  const last = history.last;
  const runsOn = kind !== "other" && last !== null && last.kind === kind && last.draft === before.draft && now - last.at < RUN_MS;
  return { past: runsOn ? history.past : [...history.past, before].slice(-KEEP), future: [], last: { kind, at: now, draft: after } };
}

/** One step back: the moment to return to, and the history after it. Null when there is none. */
export function undone(history: History, current: Moment): { history: History; moment: Moment } | null {
  const moment = history.past.at(-1);
  if (!moment) return null;
  return { history: { past: history.past.slice(0, -1), future: [...history.future, current], last: null }, moment };
}

/** One step forward again, after an undo. */
export function redone(history: History, current: Moment): { history: History; moment: Moment } | null {
  const moment = history.future.at(-1);
  if (!moment) return null;
  return { history: { past: [...history.past, current], future: history.future.slice(0, -1), last: null }, moment };
}
