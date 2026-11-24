"use client";

import {
  forwardRef,
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FocusEvent,
  type FormEvent,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type Ref,
} from "react";

import { noteTyping, PersonCardChip } from "@/components/person-card/person-card-trigger";
import { usePeopleLevel } from "@/components/shell/people-level";
import { PersonAvatar } from "@/components/ui/person-avatar";
import type { Person } from "@/lib/api/schemas";
import { cn } from "@/lib/utils";

import {
  CARET_HOLDER,
  caretAt,
  deletionRange,
  moveRange,
  NO_HISTORY,
  piecesOf,
  redone,
  remembered,
  replaceRange,
  sameDraft,
  settleRuns,
  snapPoint,
  stepFrom,
  undone,
  wholeRange,
  type DeleteUnit,
  type Draft,
  type Edit,
  type EditKind,
  type History,
  type Run,
  type Selected,
} from "./draft";

/** What an input method sends while it composes: the browser's own, read back when the composition ends. */
const COMPOSITION = new Set(["insertCompositionText", "deleteCompositionText", "insertFromComposition", "deleteByComposition"]);
/** Plain text in: typing, the spelling fixer's replacement, a paste or drop the browser hands over itself, a yank. */
const INSERTIONS = new Set(["insertText", "insertReplacementText", "insertFromPaste", "insertFromPasteAsQuotation", "insertFromDrop", "insertFromYank"]);
const DELETIONS: Record<string, [-1 | 1, DeleteUnit]> = {
  deleteContentBackward: [-1, "character"],
  deleteContentForward: [1, "character"],
  deleteWordBackward: [-1, "word"],
  deleteWordForward: [1, "word"],
  deleteSoftLineBackward: [-1, "line"],
  deleteSoftLineForward: [1, "line"],
  deleteHardLineBackward: [-1, "line"],
  deleteHardLineForward: [1, "line"],
};
/** Deletions of exactly what is selected (or what the browser names). */
const CLEARS = new Set(["deleteByCut", "deleteByDrag", "deleteContent", "deleteEntireSoftLine"]);
/** A drag's two ends: a selection dragged out of the box, or text dropped in, is the drag's, wherever focus is. */
const DRAGS = new Set(["insertFromDrop", "deleteByDrag"]);
/** A press this recent before focus arrives means the pointer placed the caret, not the keyboard. */
const POINTER_FOCUS_MS = 600;

interface Point {
  node: Node;
  offset: number;
}

const chipNumber = (node: Node): number | null =>
  node.nodeType === Node.ELEMENT_NODE && (node as Element).hasAttribute("data-chip") ? Number((node as Element).getAttribute("data-chip")) : null;

/** The chip a node is in (or is), if any. */
function chipOf(node: Node | null, root: Node): Element | null {
  for (let at = node; at && at !== root; at = at.parentNode) if (chipNumber(at) !== null) return at as Element;
  return null;
}

function readBox(root: HTMLElement, drawn: Draft, points: readonly Point[]): { runs: Run[]; offsets: (number | null)[] } {
  const runs: Run[] = [];
  const offsets: (number | null)[] = points.map(() => null);
  let length = 0;
  const mark = (node: Node, offset: number) =>
    points.forEach((point, index) => {
      if (offsets[index] === null && point.node === node && point.offset === offset) offsets[index] = length;
    });
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const data = (node as Text).data;
      points.forEach((point, index) => {
        if (offsets[index] === null && point.node === node) offsets[index] = length + data.slice(0, point.offset).replaceAll(CARET_HOLDER, "").length;
      });
      const text = data.replaceAll(CARET_HOLDER, "");
      if (!text) return;
      const last = runs.at(-1);
      if (typeof last === "string") runs[runs.length - 1] = last + text;
      else runs.push(text);
      length += text.length;
      return;
    }
    const chip = chipNumber(node);
    if (chip !== null) {
      const start = length;
      const mention = drawn.mentions[chip];
      if (mention) {
        runs.push(mention);
        length += mention.end - mention.start;
      }
      points.forEach((point, index) => {
        if (offsets[index] === null && node.contains(point.node)) offsets[index] = point.node === node && point.offset === 0 ? start : length;
      });
      return;
    }
    node.childNodes.forEach((child, index) => {
      mark(node, index);
      visit(child);
    });
    mark(node, node.childNodes.length);
  };
  visit(root);
  return { runs, offsets };
}

/** The DOM point for an offset in the drawn draft: always in a run of text (a caret holder beside a chip), never in a chip. */
function pointAt(root: HTMLElement, drawn: Draft, at: number): Point {
  let length = 0;
  let end: Point = { node: root, offset: 0 };
  for (const child of root.childNodes) {
    if (!(child instanceof HTMLElement)) continue;
    const chip = chipNumber(child);
    if (chip !== null) {
      const mention = drawn.mentions[chip];
      length += mention ? mention.end - mention.start : 0;
      continue;
    }
    if (!child.hasAttribute("data-run")) continue;
    const text = child.firstChild;
    const holder = child.hasAttribute("data-holder");
    const size = holder ? 0 : (text?.textContent?.length ?? 0);
    end = text ? { node: text, offset: text.textContent?.length ?? 0 } : { node: child, offset: 0 };
    if (at <= length + size) return text && !holder ? { node: text, offset: at - length } : end;
    length += size;
  }
  return end;
}

/** The selection, as offsets into the drawn draft, when it is in the box. */
function selectionIn(root: HTMLElement, drawn: Draft): Selected | null {
  const selection = root.ownerDocument.getSelection();
  const { anchorNode, focusNode } = selection ?? {};
  if (!selection || !anchorNode || !focusNode || !root.contains(anchorNode) || !root.contains(focusNode)) return null;
  const [anchor, focus] = readBox(root, drawn, [
    { node: anchorNode, offset: selection.anchorOffset },
    { node: focusNode, offset: selection.focusOffset },
  ]).offsets;
  return anchor === null || focus === null ? null : { anchor: snapPoint(drawn, anchor), focus: snapPoint(drawn, focus) };
}

function select(root: HTMLElement, drawn: Draft, selected: Selected): void {
  const selection = root.ownerDocument.getSelection();
  if (!selection) return;
  const anchor = pointAt(root, drawn, selected.anchor);
  const focus = selected.anchor === selected.focus ? anchor : pointAt(root, drawn, selected.focus);
  const same =
    selection.anchorNode === anchor.node && selection.anchorOffset === anchor.offset && selection.focusNode === focus.node && selection.focusOffset === focus.offset;
  if (!same) selection.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
}

/** The range a beforeinput says it will change, in the drawn draft, when the browser says and it is in the box. */
function targetOf(event: InputEvent, root: HTMLElement, drawn: Draft): [number, number] | null {
  const range = typeof event.getTargetRanges === "function" ? event.getTargetRanges()[0] : undefined;
  if (!range || !root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const [start, end] = readBox(root, drawn, [
    { node: range.startContainer, offset: range.startOffset },
    { node: range.endContainer, offset: range.endOffset },
  ]).offsets;
  return start === null || end === null ? null : wholeRange(drawn, start, end);
}

function caretBox(root: HTMLElement, range: Range): DOMRect | null {
  const own = range.getBoundingClientRect();
  const { startContainer: node, startOffset: offset } = range;
  const text = node.nodeType === Node.TEXT_NODE ? (node.textContent ?? "") : null;
  const afterBreak = range.collapsed && text !== null && offset > 0 && text[offset - 1] === "\n";
  if (own.height > 0 && !afterBreak) return own;
  if (!range.collapsed) return null;
  const probe = root.ownerDocument.createRange();
  if (text !== null && offset < text.length) {
    probe.setStart(node, offset);
    probe.setEnd(node, offset + 1);
    const next = probe.getBoundingClientRect();
    if (next.height > 0) return next;
  }
  const chip = text !== null && offset === text.length ? node.nextSibling : null;
  if (chip instanceof HTMLElement && chip !== root.querySelector("br[data-tail]")) {
    const next = chip.getBoundingClientRect();
    if (next.height > 0) return next;
  }
  const tail = root.querySelector("br[data-tail]");
  if (!tail) return null;
  probe.setStart(node, offset);
  probe.setEndBefore(tail);
  // Only the editor's invisible caret holders between the caret and the end: the caret is on the last line.
  if (probe.toString().replaceAll(CARET_HOLDER, "") !== "") return null;
  const end = tail.getBoundingClientRect();
  return end.height > 0 ? end : null;
}

/** Keeps the caret's whole line in sight once the question scrolls (past six lines). */
function reveal(root: HTMLElement): void {
  const selection = root.ownerDocument.getSelection();
  if (!selection || selection.rangeCount === 0) return;
  const range = selection.getRangeAt(0);
  if (typeof range.getBoundingClientRect !== "function") return;
  const caret = caretBox(root, range);
  if (!caret) return;
  const style = getComputedStyle(root);
  const line = parseFloat(style.lineHeight);
  const box = root.getBoundingClientRect();
  const viewTop = box.top + root.clientTop;
  const viewBottom = viewTop + root.clientHeight;
  let top = caret.top;
  let bottom = caret.bottom;
  if (line > 0) {
    const origin = viewTop + (parseFloat(style.paddingTop) || 0) - root.scrollTop;
    top = origin + Math.floor(((caret.top + caret.bottom) / 2 - origin) / line) * line;
    bottom = top + line;
  }
  if (bottom > viewBottom) root.scrollTop += Math.ceil(bottom - viewBottom);
  else if (top < viewTop) root.scrollTop -= Math.ceil(viewTop - top);
}

/** The text position under the pointer, for a drop. */
function pointFromXY(document: Document, x: number, y: number): Point | null {
  if ("caretPositionFromPoint" in document && typeof document.caretPositionFromPoint === "function") {
    const position = document.caretPositionFromPoint(x, y);
    if (position) return { node: position.offsetNode, offset: position.offset };
  }
  if ("caretRangeFromPoint" in document && typeof document.caretRangeFromPoint === "function") {
    const range = document.caretRangeFromPoint(x, y);
    if (range) return { node: range.startContainer, offset: range.startOffset };
  }
  return null;
}

/** React's own nodes as it drew them, and each run's text: what a browser's change is put back to. */
interface Drawn {
  nodes: Node[];
  texts: (string | null)[];
}

function putBack(root: HTMLElement, drawn: Drawn): void {
  drawn.nodes.forEach((node, index) => {
    const text = drawn.texts[index];
    if (text === null) return;
    const only = node.firstChild;
    if (!only || only !== node.lastChild || only.nodeType !== Node.TEXT_NODE || (only as Text).data !== text) node.textContent = text;
  });
  const now = [...root.childNodes];
  if (now.length !== drawn.nodes.length || now.some((node, index) => node !== drawn.nodes[index])) root.replaceChildren(...drawn.nodes);
}

function Chip({ person, index, selected, onReturn }: { person: Person; index: number; selected: boolean; onReturn: (index: number) => void }) {
  return (
    <PersonCardChip person={person} onReturnFocus={() => onReturn(index)}>
      <ChipPill person={person} index={index} selected={selected} />
    </PersonCardChip>
  );
}

const ChipPill = forwardRef<HTMLSpanElement, { person: Person; index: number; selected: boolean } & HTMLAttributes<HTMLSpanElement>>(function ChipPill(
  { person, index, selected, ...card },
  ref,
) {
  const peopleLevel = usePeopleLevel();
  return (
    <span
      {...card}
      ref={ref}
      contentEditable={false}
      data-chip={index}
      data-mentioned={person.id}
      data-selected={selected || undefined}
      className={cn(
        "inline-flex max-w-[min(14rem,100%)] items-baseline gap-1.5 rounded-full bg-hover py-px pr-2 pl-px align-baseline whitespace-nowrap text-ink",
        // A chip that opens a card says so as the answer's pills do: the pressed ground under the pointer and while open.
        peopleLevel && "cursor-pointer transition-colors duration-100 hover:bg-pressed data-[card-open]:bg-pressed",
        // Selected with the text around it, the pill takes the selection's colour whole, its own text no second one.
        "selection:bg-transparent data-[selected]:bg-cite-tint-strong",
      )}
    >
      <PersonAvatar person={person} className="self-center" />
      <span className="min-w-0 overflow-clip leading-5 text-ellipsis">{person.name}</span>
    </span>
  );
});

export interface EditorHandle {
  focus: () => void;
  /** A change made other than at the keyboard (someone chosen from the @ list, ↑): one step to undo, the caret placed. */
  apply: (edit: Edit) => void;
}

export interface QuestionEditorProps {
  handle: Ref<EditorHandle>;
  /** The question to show. */
  draft: Draft;
  placeholder: string;
  labelledBy: string;
  describedBy: string;
  /** The @ list's ARIA, for a reader who may mention people. */
  aria?: Pick<HTMLAttributes<HTMLDivElement>, "aria-autocomplete" | "aria-haspopup" | "aria-controls" | "aria-activedescendant">;
  /** Ctrl+Y redoes, off a Mac (on one it is the text system's yank). */
  mac: boolean;
  /** Every change to the question, and where the caret is after it. */
  onEdit: (draft: Draft, caret: number) => void;
  /** The caret moved with no change: where it is, or null while text is selected. */
  onCaret: (caret: number | null) => void;
  /** Keys the box takes before the editor (the @ list's, Enter, ↑): true when it took one. */
  onKey: (event: KeyboardEvent<HTMLDivElement>) => boolean;
  onBlur: (event: FocusEvent<HTMLDivElement>) => void;
  /** While a question is being answered: nothing can be typed, pasted or dropped (the product owner, 13 Nov 2026). */
  readOnly?: boolean;
}

export function QuestionEditor({ handle, draft, placeholder, labelledBy, describedBy, aria, mac, onEdit, onCaret, onKey, onBlur, readOnly = false }: QuestionEditorProps) {
  const peopleLevel = usePeopleLevel();
  const box = useRef<HTMLDivElement>(null);
  /** The draft as drawn, and React's nodes for it: taken after each render, never mid-composition. */
  const drawn = useRef<Draft>(draft);
  const drawnNodes = useRef<Drawn>({ nodes: [], texts: [] });
  /** The selection to put in place once an edit's draft is drawn, and the draft it was made from. */
  const pending = useRef<{ draft: Draft; from: Draft; selected: Selected } | null>(null);
  /** The selection last seen in the box: where focus from the keyboard puts the caret back. */
  const last = useRef<Selected | null>(null);
  const history = useRef<History>(NO_HISTORY);
  /** The draft the history was written up to: a question put in from elsewhere starts it afresh. */
  const historyFor = useRef<Draft | null>(null);
  const composing = useRef(false);
  const [composingShown, setComposingShown] = useState(false);
  /** A composition that has ended, still to be read back once the browser is done with it. */
  const settling = useRef<number | null>(null);
  const pressedAt = useRef(Number.NEGATIVE_INFINITY);
  /** Where focus from the keyboard puts the caret, until the browser has placed its own. */
  const focusTarget = useRef<Selected | null>(null);
  /** A selection being dragged from the box, and whether it was dropped back in. */
  const dragged = useRef<[number, number] | null>(null);
  const droppedHere = useRef(false);
  /** The chips inside the selection, by number ("0,2"), drawn as selected. */
  const [chosenChips, setChosenChips] = useState("");

  useLayoutEffect(() => {
    const root = box.current;
    if (!root) return;
    // While an input method composes, the DOM is the browser's: what React drew stays as it was.
    if (!composing.current) {
      drawn.current = draft;
      const nodes = [...root.childNodes];
      drawnNodes.current = { nodes, texts: nodes.map((node) => (node instanceof HTMLElement && node.hasAttribute("data-run") ? node.textContent : null)) };
    }
    const target = pending.current;
    if (!target || target.from === draft) return;
    pending.current = null;
    if (target.draft !== draft) return;
    focusTarget.current = null;
    last.current = target.selected;
    if (root.ownerDocument.activeElement === root) {
      select(root, draft, target.selected);
      reveal(root);
    }
  });

  const current = (root: HTMLElement): Selected => selectionIn(root, drawn.current) ?? last.current ?? caretAt(drawn.current.text.length);

  const showChosen = (selected: Selected) => {
    const [start, end] = wholeRange(drawn.current, selected.anchor, selected.focus);
    const chips = drawn.current.mentions.flatMap((mention, index) => (start < end && mention.start >= start && mention.end <= end ? [index] : []));
    setChosenChips(chips.join(","));
  };

  /** A caret or selection put in place with no change to the question. */
  const place = (selected: Selected) => {
    const root = box.current;
    if (!root) return;
    last.current = selected;
    select(root, drawn.current, selected);
    reveal(root);
    showChosen(selected);
    onCaret(selected.anchor === selected.focus ? selected.focus : null);
  };

  /** An edit: one step to undo (or the next of a run of typing), the caret placed once the result is drawn. */
  const commit = (edit: Edit | null, kind: EditKind, before: Selected) => {
    if (!edit) return;
    const from = drawn.current;
    if (sameDraft(edit.draft, from)) {
      place(caretAt(edit.caret));
      return;
    }
    if (historyFor.current !== from) history.current = NO_HISTORY;
    history.current = remembered(history.current, { draft: from, selected: before }, edit.draft, kind, Date.now());
    historyFor.current = edit.draft;
    pending.current = { draft: edit.draft, from, selected: caretAt(edit.caret) };
    setChosenChips("");
    onEdit(edit.draft, edit.caret);
  };

  const travel = (step: typeof undone) => {
    const root = box.current;
    if (!root) return;
    const from = drawn.current;
    if (historyFor.current !== from) {
      history.current = NO_HISTORY;
      historyFor.current = from;
    }
    const moved = step(history.current, { draft: from, selected: current(root) });
    if (!moved) return;
    history.current = moved.history;
    historyFor.current = moved.moment.draft;
    pending.current = { draft: moved.moment.draft, from, selected: moved.moment.selected };
    setChosenChips("");
    onEdit(moved.moment.draft, moved.moment.selected.focus);
  };

  /** Reads back what an input method composed (or anything else the browser changed itself) and makes it the draft's. */
  const settle = () => {
    if (settling.current !== null) window.clearTimeout(settling.current);
    settling.current = null;
    const root = box.current;
    if (!root) return;
    if (composing.current) {
      composing.current = false;
      setComposingShown(false);
    }
    const from = drawn.current;
    const selection = root.ownerDocument.getSelection();
    const focus = selection?.focusNode && root.contains(selection.focusNode) ? [{ node: selection.focusNode, offset: selection.focusOffset }] : [];
    const { runs, offsets } = readBox(root, from, focus);
    // React's nodes back as it drew them, so it can draw the result over them.
    putBack(root, drawnNodes.current);
    const edit = settleRuns(from, runs, offsets[0] ?? Number.MAX_SAFE_INTEGER);
    if (sameDraft(edit.draft, from)) {
      if (root.ownerDocument.activeElement === root) place(caretAt(edit.caret));
      return;
    }
    commit(edit, "type", last.current ?? caretAt(edit.caret));
  };

  /** Before anything else acts: a composition still to be read back is read now, and a keyboard focus's caret is placed. */
  const catchUp = () => {
    if (settling.current !== null) settle();
    const root = box.current;
    const target = focusTarget.current;
    if (root && target && root.ownerDocument.activeElement === root) {
      select(root, drawn.current, target);
      last.current = target;
    }
    focusTarget.current = null;
  };

  const beforeInput = useEffectEvent((event: InputEvent) => {
    // An input method's composition is the browser's while it runs.
    if (event.isComposing || COMPOSITION.has(event.inputType)) return;
    event.preventDefault();
    const root = box.current;
    if (!root) return;
    if (!DRAGS.has(event.inputType) && !root.contains(root.ownerDocument.activeElement)) return;
    catchUp();
    const from = drawn.current;
    const selected = current(root);
    const [start, end] = wholeRange(from, selected.anchor, selected.focus);
    const type = event.inputType;
    if (INSERTIONS.has(type)) {
      const text = event.data ?? event.dataTransfer?.getData("text/plain") ?? "";
      if (!text) return;
      const [at, to] = targetOf(event, root, from) ?? [start, end];
      commit(replaceRange(from, at, to, text), type === "insertText" ? "type" : "other", selected);
    } else if (type === "insertParagraph" || type === "insertLineBreak") {
      commit(replaceRange(from, start, end, "\n"), "type", selected);
    } else if (type in DELETIONS) {
      const [direction, unit] = DELETIONS[type];
      const named = start === end ? targetOf(event, root, from) : null;
      const range = named && named[0] !== named[1] ? named : deletionRange(from, selected, direction, unit);
      if (range) commit(replaceRange(from, range[0], range[1], ""), "delete", selected);
    } else if (CLEARS.has(type)) {
      // A selection dropped back into the box was moved by the drop itself.
      if (type === "deleteByDrag" && droppedHere.current) return;
      const [at, to] = targetOf(event, root, from) ?? [start, end];
      if (at !== to) commit(replaceRange(from, at, to, ""), "other", selected);
    } else if (type === "historyUndo" || type === "historyRedo") {
      travel(type === "historyUndo" ? undone : redone);
    }
    // Anything else (bold, a link, a transposition) has no place in a question, and is refused.
  });

  /** The caret moved (a click, Home or End, a line up or down): followed, unless an edit's own caret is still to come. */
  const readCaret = () => {
    const root = box.current;
    if (!root || root.ownerDocument.activeElement !== root || composing.current || pending.current || settling.current !== null) return;
    const selected = selectionIn(root, drawn.current);
    if (!selected) return;
    // A caret a browser put inside a chip (it cannot stay there) goes to the chip's nearer edge.
    const selection = root.ownerDocument.getSelection();
    if (chipOf(selection?.anchorNode ?? null, root) || chipOf(selection?.focusNode ?? null, root)) select(root, drawn.current, selected);
    last.current = selected;
    showChosen(selected);
    onCaret(selected.anchor === selected.focus ? selected.focus : null);
  };
  const selectionChange = useEffectEvent(() => readCaret());

  // The composition's timer reads back with the latest of everything.
  const settleLatest = useRef(settle);
  useLayoutEffect(() => {
    settleLatest.current = settle;
  });

  useEffect(() => {
    const root = box.current;
    if (!root) return;
    const onBeforeInput = (event: InputEvent) => beforeInput(event);
    const onSelectionChange = () => selectionChange();
    root.addEventListener("beforeinput", onBeforeInput);
    root.ownerDocument.addEventListener("selectionchange", onSelectionChange);
    return () => {
      root.removeEventListener("beforeinput", onBeforeInput);
      root.ownerDocument.removeEventListener("selectionchange", onSelectionChange);
    };
  }, []);

  useEffect(() => {
    const timer = settling;
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    };
  }, []);

  useImperativeHandle(handle, () => ({
    focus: () => box.current?.focus({ preventScroll: true }),
    apply: (edit) => {
      const root = box.current;
      if (!root) return;
      catchUp();
      commit(edit, "other", current(root));
      if (root.ownerDocument.activeElement !== root) root.focus({ preventScroll: true });
    },
  }));

  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // While a question is being answered the box takes no keys but Tab, so focus can still move on.
    if (readOnly) {
      if (event.key !== "Tab") event.preventDefault();
      return;
    }
    // Typing never opens a person's card, even with the pointer resting on a chip.
    noteTyping();
    // The keys belong to an input method until it is done.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    catchUp();
    if (onKey(event)) {
      event.preventDefault();
      return;
    }
    const key = event.key.toLowerCase();
    const command = event.metaKey !== event.ctrlKey && !event.altKey;
    if (command && key === "z") {
      event.preventDefault();
      travel(event.shiftKey ? redone : undone);
    } else if (command && !mac && event.ctrlKey && !event.shiftKey && key === "y") {
      event.preventDefault();
      travel(redone);
    } else if ((event.key === "ArrowLeft" || event.key === "ArrowRight") && !event.altKey && !event.ctrlKey && !event.metaKey) {
      // One press, one step: a chip is one, a caret holder none.
      event.preventDefault();
      const root = box.current;
      if (!root) return;
      const direction = event.key === "ArrowLeft" ? -1 : 1;
      const selected = current(root);
      if (!event.shiftKey && selected.anchor !== selected.focus) {
        place(caretAt(direction < 0 ? Math.min(selected.anchor, selected.focus) : Math.max(selected.anchor, selected.focus)));
      } else {
        const focus = stepFrom(drawn.current, selected.focus, direction);
        place(event.shiftKey ? { anchor: selected.anchor, focus } : caretAt(focus));
      }
    }
  };

  const mouseDown = (event: MouseEvent<HTMLDivElement>) => {
    pressedAt.current = performance.now();
    focusTarget.current = null;
    if (settling.current !== null) settle();
    const root = box.current;
    const chip = event.target instanceof Element ? event.target.closest("[data-chip]") : null;
    if (!root || !chip || !root.contains(chip) || event.button !== 0) return;
    // A chip is never entered, dragged or half selected by a press.
    event.preventDefault();
    if (peopleLevel && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) return;
    // Anywhere else the press puts the caret beside the chip, on the nearer side.
    const mention = drawn.current.mentions[Number(chip.getAttribute("data-chip"))];
    if (!mention) return;
    const edge = chip.getBoundingClientRect();
    const at = event.clientX < edge.left + edge.width / 2 ? mention.start : mention.end;
    if (root.ownerDocument.activeElement !== root) root.focus({ preventScroll: true });
    place({ anchor: event.shiftKey ? current(root).anchor : at, focus: at });
  };

  const returnAfter = (index: number) => {
    const root = box.current;
    if (!root) return;
    const mention = drawn.current.mentions[index];
    const after = caretAt(mention ? mention.end : drawn.current.text.length);
    // Where focus arriving here puts the caret, so the box's own focus handling puts it there too.
    last.current = after;
    focusTarget.current = null;
    if (root.ownerDocument.activeElement !== root) root.focus({ preventScroll: true });
    place(after);
  };

  const focus = () => {
    const root = box.current;
    if (!root || pending.current || performance.now() - pressedAt.current < POINTER_FOCUS_MS) return;
    const from = drawn.current;
    const target = last.current ? { anchor: snapPoint(from, last.current.anchor), focus: snapPoint(from, last.current.focus) } : caretAt(from.text.length);
    focusTarget.current = target;
    select(root, from, target);
    if (typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(() => catchUp());
  };

  const copy = (event: ClipboardEvent<HTMLDivElement>, cut: boolean) => {
    const root = box.current;
    if (!root) return;
    catchUp();
    const from = drawn.current;
    const selected = selectionIn(root, from);
    // A clipboard event made by a script may carry no clipboard at all.
    const clipboard = event.clipboardData as DataTransfer | null;
    if (!selected || selected.anchor === selected.focus || !clipboard) return;
    const [start, end] = wholeRange(from, selected.anchor, selected.focus);
    // Plain text, each chip as its "@Name": the question as it is sent.
    event.preventDefault();
    clipboard.setData("text/plain", from.text.slice(start, end));
    if (cut) commit(replaceRange(from, start, end, ""), "other", selected);
  };

  const paste = (event: ClipboardEvent<HTMLDivElement>) => {
    // Plain text only, never HTML or pictures, and never a chip: "@Name" pasted is text.
    event.preventDefault();
    if (readOnly) return;
    const root = box.current;
    if (!root) return;
    catchUp();
    const text = (event.clipboardData as DataTransfer | null)?.getData("text/plain") ?? "";
    const selected = current(root);
    if (text) commit(replaceRange(drawn.current, selected.anchor, selected.focus, text), "other", selected);
  };

  const dragStart = (event: DragEvent<HTMLDivElement>) => {
    const root = box.current;
    const selected = root ? selectionIn(root, drawn.current) : null;
    if (!selected || selected.anchor === selected.focus) {
      event.preventDefault();
      return;
    }
    const range = wholeRange(drawn.current, selected.anchor, selected.focus);
    dragged.current = range;
    droppedHere.current = false;
    event.dataTransfer.clearData();
    event.dataTransfer.setData("text/plain", drawn.current.text.slice(range[0], range[1]));
    event.dataTransfer.effectAllowed = "copyMove";
  };

  const drop = (event: DragEvent<HTMLDivElement>) => {
    // What is dropped from elsewhere is plain text; a selection dragged within the box moves, chips and all.
    event.preventDefault();
    if (readOnly) return;
    const root = box.current;
    if (!root) return;
    catchUp();
    const from = drawn.current;
    const point = pointFromXY(root.ownerDocument, event.clientX, event.clientY);
    const offset = point && root.contains(point.node) ? readBox(root, from, [point]).offsets[0] : null;
    const at = snapPoint(from, offset ?? from.text.length);
    const moving = dragged.current;
    const edit = moving ? moveRange(from, moving[0], moving[1], at) : replaceRange(from, at, at, event.dataTransfer.getData("text/plain"));
    droppedHere.current = moving !== null;
    dragged.current = null;
    commit(edit, "other", current(root));
    if (root.ownerDocument.activeElement !== root) root.focus({ preventScroll: true });
  };

  const input = (event: FormEvent<HTMLDivElement>) => {
    const native = event.nativeEvent as InputEvent;
    // Mid-composition the DOM is the input method's; Safari clears its marked text before it writes the final text.
    if (native.isComposing || native.inputType === "deleteCompositionText") return;
    if (composing.current && settling.current === null) return;
    // The end of a composition in Safari, or a change the browser made without asking: read back now.
    settle();
  };

  const seen = new Map<string, number>();
  const chosen = new Set(chosenChips ? chosenChips.split(",").map(Number) : []);

  return (
    <div className="grid min-w-0 flex-1">
      <div
        ref={box}
        role="textbox"
        aria-multiline="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        aria-placeholder={placeholder}
        aria-keyshortcuts="/"
        {...aria}
        // Focusable as a field is, and the target of aria-activedescendant.
        tabIndex={0}
        contentEditable={!readOnly}
        aria-readonly={readOnly || undefined}
        suppressContentEditableWarning
        spellCheck
        enterKeyHint="send"
        data-page-search=""
        data-question-editor=""
        onKeyDown={keyDown}
        onKeyUp={readCaret}
        onMouseDown={mouseDown}
        onFocus={focus}
        onBlur={onBlur}
        onCopy={(event) => copy(event, false)}
        onCut={(event) => copy(event, true)}
        onPaste={paste}
        onDragStart={dragStart}
        onDragEnd={() => {
          dragged.current = null;
          droppedHere.current = false;
        }}
        onDrop={drop}
        onCompositionStart={() => {
          if (settling.current !== null) settle();
          composing.current = true;
          setComposingShown(true);
        }}
        onCompositionEnd={() => {
          if (settling.current !== null) window.clearTimeout(settling.current);
          settling.current = window.setTimeout(() => settleLatest.current(), 0);
        }}
        onInput={input}
        className="col-start-1 row-start-1 max-h-36 min-h-6 overflow-y-auto text-md leading-6 break-words whitespace-pre-wrap text-ink outline-none aria-readonly:cursor-progress aria-readonly:text-ink-mid"
      >
        {draft.text === ""
          ? null
          : piecesOf(draft).map((piece, index) => {
              if (piece.kind === "text") {
                const empty = piece.text === "";
                return (
                  <span key={`run-${index}`} data-run="" data-holder={empty ? "" : undefined}>
                    {empty ? CARET_HOLDER : piece.text}
                  </span>
                );
              }
              const id = piece.mention.person.id;
              const nth = seen.get(id) ?? 0;
              seen.set(id, nth + 1);
              return (
                <Chip key={`chip-${id}-${nth}`} person={piece.mention.person} index={piece.index} selected={chosen.has(piece.index)} onReturn={returnAfter} />
              );
            })}
        {/* The line after a final line break or chip needs a line box for the caret, as an empty editable does. */}
        <br data-tail="" />
      </div>
      {draft.text === "" && !composingShown ? (
        <span aria-hidden className="pointer-events-none col-start-1 row-start-1 text-md leading-6 text-ink-low select-none">
          {placeholder}
        </span>
      ) : null}
    </div>
  );
}
