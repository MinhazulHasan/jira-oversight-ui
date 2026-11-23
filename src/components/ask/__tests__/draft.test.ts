import { describe, expect, it } from "vitest";

import { ASK_MAX_LENGTH, type Person } from "@/lib/api/schemas";

import {
  caretAt,
  chooseInto,
  deletionRange,
  draftOf,
  EMPTY_DRAFT,
  moveRange,
  NO_HISTORY,
  piecesOf,
  plainText,
  redone,
  remembered,
  replaceRange,
  sameDraft,
  settleRuns,
  snapPoint,
  stepFrom,
  undone,
  wholeRange,
  type Draft,
} from "../draft";
import { mentionedPeople, mentionQueryAt, type Mention } from "../mentions";

/** The sample's fictional people (ids made up here). */
const ADA: Person = { id: "pbc7fe62842ca", name: "Ada Brooks", avatar: null };
const CARMEN: Person = { id: "p599114b761a6", name: "Carmen Ruiz", avatar: "55ea1804e5bd" };
const NOOR: Person = { id: "pc3d7609d78d1", name: "Noor Haddad", avatar: null };
const PEOPLE = [ADA, CARMEN, NOOR];

const chip = (person: Person, start: number): Mention => ({ person, start, end: start + person.name.length + 1 });

/** "Is @Carmen Ruiz on @Ada Brooks's team?": two chips, as the box would hold them. */
const TEXT = "Is @Carmen Ruiz on @Ada Brooks's team?";
const TWO: Draft = { text: TEXT, mentions: [chip(CARMEN, 3), chip(ADA, 19)] };

const shape = (draft: Draft | undefined) => ({ text: draft?.text, chips: draft?.mentions.map((mention) => [mention.person.name, mention.start, mention.end]) });

describe("the model of the question", () => {
  it("is the text as it is sent, each chip written @Name, with a run of text on each side of every chip", () => {
    expect(piecesOf(TWO).map((piece) => (piece.kind === "text" ? piece.text : `[${piece.mention.person.name}]`))).toEqual([
      "Is ",
      "[Carmen Ruiz]",
      " on ",
      "[Ada Brooks]",
      "'s team?",
    ]);
    // Chips at the very start and end, and side by side: an empty run around each, for the caret to stand in.
    const packed: Draft = { text: "@Ada Brooks@Noor Haddad", mentions: [chip(ADA, 0), chip(NOOR, 11)] };
    expect(piecesOf(packed).map((piece) => (piece.kind === "text" ? piece.text : piece.mention.person.id))).toEqual(["", ADA.id, "", NOOR.id, ""]);
    expect(piecesOf(EMPTY_DRAFT)).toEqual([{ kind: "text", text: "", start: 0, end: 0 }]);
  });

  it("rebuilds the chips from the text and the person ids: what is sent comes back as it was", () => {
    const restored = draftOf(TEXT, PEOPLE, [CARMEN.id, ADA.id]);
    expect(sameDraft(restored, TWO)).toBe(true);
    expect(mentionedPeople(restored.mentions)).toEqual([CARMEN, ADA]);
    // Only the people named by id, only people on the board.
    expect(shape(draftOf(TEXT, PEOPLE, [ADA.id])).chips).toEqual([["Ada Brooks", 19, 30]]);
    expect(draftOf(TEXT, PEOPLE, ["p000000000000"]).mentions).toEqual([]);
    expect(draftOf(TEXT, undefined, [ADA.id]).mentions).toEqual([]);
  });

  it("brings back every chip sent: the same person twice, and a chip with a letter typed against it", () => {
    // The box lets a person be picked twice, and keeps a chip whole when a letter is typed right against it.
    const sent: Draft[] = [
      { text: "Is @Ada Brooks ahead of @Noor Haddad, or is @Ada Brooks?", mentions: [chip(ADA, 3), chip(NOOR, 24), chip(ADA, 44)] },
      { text: "is@Ada Brooks ahead?", mentions: [chip(ADA, 2)] },
      { text: "@Ada Brookside and @Noor Haddad@Carmen Ruiz", mentions: [chip(ADA, 0), chip(NOOR, 19), chip(CARMEN, 31)] },
    ];
    for (const draft of sent) {
      const ids = mentionedPeople(draft.mentions).map((person) => person.id);
      expect(shape(draftOf(draft.text, PEOPLE, ids)), draft.text).toEqual(shape(draft));
    }
  });
});

describe("a chip is atomic", () => {
  it("a point inside it goes to an edge, and a range reaching into it takes it whole", () => {
    expect(snapPoint(TWO, 5)).toBe(3);
    expect(snapPoint(TWO, 13)).toBe(15);
    expect(snapPoint(TWO, 5, 1)).toBe(15);
    expect(snapPoint(TWO, 13, -1)).toBe(3);
    expect(snapPoint(TWO, 99)).toBe(TEXT.length);
    expect(wholeRange(TWO, 1, 5)).toEqual([1, 15]);
    expect(wholeRange(TWO, 20, 10)).toEqual([3, 30]);
  });

  it("is removed whole by one Backspace just after it, or one Delete just before it", () => {
    expect(deletionRange(TWO, caretAt(15), -1, "character")).toEqual([3, 15]);
    expect(deletionRange(TWO, caretAt(3), 1, "character")).toEqual([3, 15]);
    const edit = replaceRange(TWO, 3, 15, "");
    expect(shape(edit?.draft)).toEqual({ text: "Is  on @Ada Brooks's team?", chips: [["Ada Brooks", 7, 18]] });
    expect(edit?.caret).toBe(3);
  });

  it("is one step for an arrow, and the text inside it is never a caret position", () => {
    expect(stepFrom(TWO, 15, -1)).toBe(3);
    expect(stepFrom(TWO, 3, 1)).toBe(15);
    expect(stepFrom(TWO, 3, -1)).toBe(2);
    expect(stepFrom(TWO, 16, -1)).toBe(15);
    expect(stepFrom(TWO, 0, -1)).toBe(0);
    expect(stepFrom(TWO, TEXT.length, 1)).toBe(TEXT.length);
    // A character as a reader sees one: an emoji with its modifier, a letter with its accent.
    const flag: Draft = { text: "a👍🏽b", mentions: [] };
    expect(stepFrom(flag, 1, 1)).toBe(5);
    expect(stepFrom(flag, 5, -1)).toBe(1);
  });

  it("cannot be typed into: text typed beside it stands beside it, and it keeps its place", () => {
    const typed = replaceRange(TWO, 15, 15, "'s");
    expect(shape(typed?.draft)).toEqual({ text: "Is @Carmen Ruiz's on @Ada Brooks's team?", chips: [["Carmen Ruiz", 3, 15], ["Ada Brooks", 21, 32]] });
    // Typing over a selection that reaches into a chip replaces the chip with it.
    expect(shape(replaceRange(TWO, 0, 8, "Was")?.draft)).toEqual({ text: "Was on @Ada Brooks's team?", chips: [["Ada Brooks", 7, 18]] });
  });
});

describe("deleting", () => {
  const text = "Find @Carmen Ruiz  open\nbreaches now";
  const draft: Draft = { text, mentions: [chip(CARMEN, 5)] };

  it("a character at a time, a whole emoji or accented letter at once", () => {
    expect(deletionRange(draft, caretAt(4), -1, "character")).toEqual([3, 4]);
    expect(deletionRange({ text: "ok 👍🏽", mentions: [] }, caretAt(7), -1, "character")).toEqual([3, 7]);
    expect(deletionRange({ text: "café", mentions: [] }, caretAt(5), -1, "character")).toEqual([3, 5]);
    expect(deletionRange(draft, caretAt(0), -1, "character")).toBeNull();
    expect(deletionRange(draft, caretAt(text.length), 1, "character")).toBeNull();
  });

  it("a word at a time, a chip across the spaces being the word", () => {
    expect(deletionRange(draft, caretAt(19), -1, "word")).toEqual([5, 19]);
    expect(deletionRange(draft, caretAt(23), -1, "word")).toEqual([19, 23]);
    expect(deletionRange(draft, caretAt(4), 1, "word")).toEqual([4, 17]);
    expect(deletionRange({ text: "what?! now", mentions: [] }, caretAt(6), -1, "word")).toEqual([4, 6]);
  });

  it("to the line's start or end, chips and all, and a line break on its own", () => {
    expect(deletionRange(draft, caretAt(23), -1, "line")).toEqual([0, 23]);
    expect(deletionRange(draft, caretAt(24), -1, "line")).toEqual([23, 24]);
    expect(deletionRange(draft, caretAt(2), 1, "line")).toEqual([2, 23]);
  });

  it("the selection, whatever the unit, grown to whole chips", () => {
    expect(deletionRange(draft, { anchor: 8, focus: 2 }, -1, "word")).toEqual([2, 17]);
  });
});

describe("what goes in as text", () => {
  it("is plain: line breaks as \\n, no control characters, never the editor's caret holder", () => {
    expect(plainText("a\r\nb\rc\u0000d​e\tf")).toBe("a\nb\ncde\tf");
  });

  it("never makes a chip, even when it reads @Name", () => {
    const pasted = replaceRange(EMPTY_DRAFT, 0, 0, "Ask @Ada Brooks");
    expect(shape(pasted?.draft)).toEqual({ text: "Ask @Ada Brooks", chips: [] });
  });

  it("is cut to the 500 characters, whole characters only, and nothing changes when there is no room", () => {
    const nearly: Draft = { text: "x".repeat(ASK_MAX_LENGTH - 3), mentions: [] };
    expect(replaceRange(nearly, nearly.text.length, nearly.text.length, "abcdef")?.draft.text).toHaveLength(ASK_MAX_LENGTH);
    expect(replaceRange(nearly, nearly.text.length, nearly.text.length, "ab👍")?.draft.text.endsWith("ab")).toBe(true);
    const full: Draft = { text: "x".repeat(ASK_MAX_LENGTH), mentions: [] };
    expect(replaceRange(full, 10, 10, "y")).toBeNull();
    // Typing over a selection has the selection's room.
    expect(replaceRange(full, 0, 2, "yz")?.draft.text).toBe(`yz${"x".repeat(ASK_MAX_LENGTH - 2)}`);
  });
});

describe("choosing someone from the @ list", () => {
  it("makes the search their chip and a space, the caret after the space, the chips around it kept", () => {
    const draft: Draft = { text: "Compare @car and @Ada Brooks", mentions: [chip(ADA, 17)] };
    const chosen = chooseInto(draft, mentionQueryAt(draft.text, 12, draft.mentions)!, CARMEN);
    expect(shape(chosen?.draft)).toEqual({ text: "Compare @Carmen Ruiz and @Ada Brooks", chips: [["Carmen Ruiz", 8, 20], ["Ada Brooks", 25, 36]] });
    expect(chosen?.caret).toBe(21);
  });

  it("makes a name typed out in full a chip in place, the text unchanged", () => {
    const draft: Draft = { text: "@Ada Brooks open findings", mentions: [] };
    const chosen = chooseInto(draft, mentionQueryAt(draft.text, 11)!, ADA);
    expect(shape(chosen?.draft)).toEqual({ text: "@Ada Brooks open findings", chips: [["Ada Brooks", 0, 11]] });
    expect(chosen?.caret).toBe(12);
  });

  it("refuses a name the 500 characters have no room for", () => {
    const text = `${"x".repeat(ASK_MAX_LENGTH - 5)} @ca`;
    expect(chooseInto({ text, mentions: [] }, mentionQueryAt(text, text.length)!, CARMEN)).toBeNull();
  });
});

describe("a selection dragged within the question", () => {
  it("moves, chips and all, and not into itself", () => {
    const moved = moveRange(TWO, 3, 16, TEXT.length);
    expect(shape(moved?.draft)).toEqual({ text: "Is on @Ada Brooks's team?@Carmen Ruiz ", chips: [["Ada Brooks", 6, 17], ["Carmen Ruiz", 25, 37]] });
    expect(moved?.caret).toBe(TEXT.length);
    expect(moveRange(TWO, 3, 16, 8)).toBeNull();
  });
});

describe("what an input method composed, read back from the box", () => {
  const carmen = chip(CARMEN, 3);
  const before: Draft = { text: "Is @Carmen Ruiz here?", mentions: [carmen] };

  it("is taken as the DOM holds it, the chips still there by identity", () => {
    const settled = settleRuns(before, ["Is ", carmen, " ここ here?"], 18);
    expect(shape(settled.draft)).toEqual({ text: "Is @Carmen Ruiz ここ here?", chips: [["Carmen Ruiz", 3, 15]] });
    expect(settled.caret).toBe(18);
    // A composition that replaced a selection with a chip in it: the chip is gone.
    expect(shape(settleRuns(before, ["Is ここ here?"], 5).draft)).toEqual({ text: "Is ここ here?", chips: [] });
  });

  it("is cut to the 500 characters, the rest of the question kept as it was", () => {
    const long: Draft = { text: `${"x".repeat(ASK_MAX_LENGTH - 2)} @Carmen Ruiz`.slice(-ASK_MAX_LENGTH), mentions: [] };
    const start = long.text.length - 12;
    const full: Draft = { text: long.text, mentions: [chip(CARMEN, start)] };
    const lead = full.text.slice(0, start);
    const settled = settleRuns(full, [`${lead}かなか`, full.mentions[0]], start + 3);
    expect(settled.draft.text).toHaveLength(ASK_MAX_LENGTH);
    expect(settled.draft.mentions.map((mention) => mention.person.id)).toEqual([CARMEN.id]);
  });
});

describe("undo and redo, the box's own", () => {
  const a = { draft: { text: "a", mentions: [] }, selected: caretAt(1) };
  const ab: Draft = { text: "ab", mentions: [] };
  const abc: Draft = { text: "abc", mentions: [] };

  it("keep a run of typing as one step, and start a new one after a pause or another kind of edit", () => {
    const first = remembered(NO_HISTORY, a, ab, "type", 1000);
    const run = remembered(first, { draft: ab, selected: caretAt(2) }, abc, "type", 1500);
    expect(run.past).toEqual([a]);
    const paused = remembered(first, { draft: ab, selected: caretAt(2) }, abc, "type", 3000);
    expect(paused.past).toHaveLength(2);
    const other = remembered(first, { draft: ab, selected: caretAt(2) }, abc, "delete", 1500);
    expect(other.past).toHaveLength(2);
  });

  it("go back and forward, a new edit dropping what could be redone", () => {
    const history = remembered(NO_HISTORY, a, ab, "other", 0);
    const back = undone(history, { draft: ab, selected: caretAt(2) });
    expect(back?.moment).toEqual(a);
    const forward = redone(back!.history, a);
    expect(forward?.moment.draft).toBe(ab);
    expect(undone(NO_HISTORY, a)).toBeNull();
    expect(redone(history, a)).toBeNull();
    expect(remembered(back!.history, a, abc, "other", 0).future).toEqual([]);
  });
});
