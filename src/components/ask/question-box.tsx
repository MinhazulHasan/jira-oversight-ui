"use client";

import { Clock, CornerDownLeft } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { Keys, type KeyName } from "@/components/shell/kbd";
import { useShell } from "@/components/shell/shell-context";
import { Button } from "@/components/ui/button";
import { ASK_MAX_LENGTH, ASK_MAX_MENTIONS, type DirectoryEntry, type Person } from "@/lib/api/schemas";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";

import { chooseInto, draftOf, EMPTY_DRAFT, type Draft } from "./draft";
import { MentionMenu, type MentionMenuState } from "./mention-menu";
import { groupMatching, mentionedPeople, mentionQueryAt, type Mention, type MentionQuery } from "./mentions";
import { QuestionEditor, type EditorHandle, type QuestionEditorProps } from "./question-editor";

/** The count appears once a question is long enough for the cap to matter. */
const COUNT_FROM = ASK_MAX_LENGTH - 100;
const NO_IDS: readonly string[] = [];

/** Someone to put in the question as a chip (a person card's "Ask about"), by id; each press is a new request. */
export interface QuestionSeed {
  id: string;
}

export type SeedOutcome = "added" | "already" | "no-room" | "not-on-board";

/** Where the @ list's people come from: given only to a reader Ask answers about people. */
export interface MentionSource {
  people: readonly DirectoryEntry[] | undefined;
  state: MentionMenuState;
  retry: () => void;
  ids: readonly string[];
}

export interface QuestionBoxProps {
  /** The question as it is sent: its text, each chip in it written "@Name". */
  value: string;
  onChange: (value: string) => void;
  /** Called with the trimmed question and the people its chips name, by id (none for a team-level reader). */
  onSubmit: (question: string, mentions: string[]) => void;
  busy: boolean;
  placeholder: string;
  /** The question ↑ brings back into an empty field. */
  recall?: string;
  /** The @ list's people. Left out, @ is just a character (a team-level reader). */
  mention?: MentionSource;
  notice?: ReactNode;
  seed?: QuestionSeed | null;
  onSeeded?: (person: Person | null, outcome: SeedOutcome) => void;
}

interface HintProps {
  keys: KeyName[];
  /** Not the first hint on the line: a dot goes before it, and steps aside with it. */
  after?: boolean;
  /** Where the dot shows, when the hint can be the first on the line at some widths. */
  dotClassName?: string;
  className?: string;
  children: string;
  "data-hint"?: string;
}

/** One hint on the line under the question: its key and what it does, kept whole on one line. */
function Hint({ keys, after = false, dotClassName, className, children, ...rest }: HintProps) {
  return (
    <span {...rest} className={cn("inline-flex items-center gap-1.5 whitespace-nowrap", className)}>
      {after ? <span className={cn("text-ink-dim", dotClassName)}>·</span> : null}
      <Keys keys={keys} /> {children}
    </span>
  );
}

/** The keyboard's hints: from a small tablet up, where a keyboard is likely. */
const KEYBOARD_HINT = "hidden sm:inline-flex";

export function QuestionBox({ value, onChange, onSubmit, busy, placeholder, recall, mention, notice, seed = null, onSeeded }: QuestionBoxProps) {
  const editor = useRef<EditorHandle>(null);
  const wasBusy = useRef(busy);
  useEffect(() => {
    if (wasBusy.current && !busy) {
      const active = document.activeElement;
      if (!active || active === document.body || active.closest("[data-question-editor]")) editor.current?.focus();
    }
    wasBusy.current = busy;
  }, [busy]);
  const labelId = useId();
  const hintId = useId();
  const countId = useId();
  const listId = useId();
  const mac = useShell().platform === "mac";
  const question = value.trim();
  const length = value.length;

  /** The question as last edited here: the one shown while it is the value, so neither can drift from the other. */
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [search, setSearch] = useState<MentionQuery | null>(null);
  /** The @ whose list Esc closed: it stays closed while the caret stays in that search. */
  const [dismissed, setDismissed] = useState<number | null>(null);
  const [active, setActive] = useState(0);
  const [said, setSaid] = useState("");

  const directory = mention?.people;
  const people = useMemo(() => directory?.map((entry) => entry.person), [directory]);
  const ids = mention?.ids ?? NO_IDS;
  // A question from elsewhere (the address, the session, ↑) brings its chips with it, by id.
  const restored = useMemo(() => draftOf(value, people, ids), [value, people, ids]);
  const current = draft.text === value ? draft : restored;
  const mentioned = mention ? mentionedPeople(current.mentions) : [];

  // The list's two groups as the search leaves them; the keyboard runs through both as one list.
  const groups = useMemo(() => (search && directory ? groupMatching(directory, search.query) : []), [search, directory]);
  const matches = useMemo(() => groups.flatMap((group) => group.people), [groups]);
  const state = mention?.state ?? "pending";
  // A search with a space in it that finds no one was never a mention: the list stays out of the way of the words.
  const hopeless = state === "success" && matches.length === 0 && /\s/u.test(search?.query ?? "");
  const open = Boolean(mention) && search !== null && search.start !== dismissed && !hopeless;
  const expanded = open && state === "success" && matches.length > 0;
  const activeIndex = expanded ? Math.min(active, matches.length - 1) : -1;
  const optionId = (index: number) => `${listId}-option-${index}`;
  // For a reader who may mention people, the field drives the @ list: a textbox with a listbox for its popup.
  const aria: QuestionEditorProps["aria"] = mention
    ? {
        "aria-autocomplete": "list",
        "aria-haspopup": "listbox",
        "aria-controls": expanded ? listId : undefined,
        "aria-activedescendant": activeIndex >= 0 ? optionId(activeIndex) : undefined,
      }
    : undefined;

  const submit = () => {
    if (!busy && question) onSubmit(question, mentioned.map((person) => person.id));
  };

  /** The search the caret is in now, if the list should follow it. */
  const follow = (text: string, caret: number, standing: readonly Mention[]) => {
    if (!mention) return;
    const found = mentionQueryAt(text, caret, standing);
    if (found === null || found.start !== search?.start || found.query !== search.query) setActive(0);
    setSearch(found);
    if (found === null) setDismissed(null);
  };

  /** Every change to the question: kept here, and passed up as the text it is sent as. */
  const edited = (next: Draft, caret: number) => {
    setDraft(next);
    if (next.text !== value) onChange(next.text);
    follow(next.text, caret, next.mentions);
  };

  const close = () => setSearch(null);

  /** The caret moved: the list follows it while it stays in the search, and closes once it leaves (or text is selected). */
  const caretMoved = (caret: number | null) => {
    if (!search) return;
    const found = caret === null ? null : mentionQueryAt(current.text, caret, current.mentions);
    if (caret === null || found === null || found.start !== search.start) close();
    else if (found.query !== search.query) follow(current.text, caret, current.mentions);
  };

  /** A choice the list cannot take: said where it is seen (the kit's warning, which screen readers hear too), and the list closes. */
  const refuse = (title: string, description: string) => {
    setSaid("");
    notify.warn(title, { id: "ask-mention-refused", description });
    close();
  };

  const choose = (person: Person) => {
    if (!search) return;
    if (mentioned.length >= ASK_MAX_MENTIONS && !mentioned.some((other) => other.id === person.id)) {
      refuse("Mention limit reached", `A question can mention ${ASK_MAX_MENTIONS} people at most.`);
      return;
    }
    const chosen = chooseInto(current, search, person);
    if (!chosen) {
      refuse("No room for that name", `Questions stop at ${ASK_MAX_LENGTH} characters.`);
      return;
    }
    editor.current?.apply(chosen);
    close();
    setDismissed(null);
    setSaid(`${person.name} mentioned.`);
  };

  const reveal = (index: number) => {
    const list = document.getElementById(listId);
    const option = document.getElementById(optionId(index));
    if (!list || !option) return;
    if (index === 0) list.scrollTop = 0;
    else if (index === matches.length - 1) list.scrollTop = list.scrollHeight;
    else {
      if (!option.previousElementSibling?.matches('[role="option"]')) option.previousElementSibling?.scrollIntoView?.({ block: "nearest" });
      option.scrollIntoView?.({ block: "nearest" });
    }
  };

  const move = (step: number) => {
    const next = (activeIndex + step + matches.length) % matches.length;
    setActive(next);
    reveal(next);
  };

  // A person card's "Ask about": their chip at the end of the question, once the board's people say who they are.
  const seeded = useRef(new WeakSet<QuestionSeed>());
  const loaded = mention?.state === "success";
  useEffect(() => {
    if (seed === null || seeded.current.has(seed) || !people || !loaded) return;
    seeded.current.add(seed);
    const person = people.find((candidate) => candidate.id === seed.id) ?? null;
    if (!person) {
      onSeeded?.(null, "not-on-board");
      return;
    }
    // Already in the question: never a second chip for them; the caret goes just after their last one, focus in the box.
    const standing = current.mentions.filter((chip) => chip.person.id === person.id).at(-1);
    if (standing) {
      editor.current?.apply({ draft: current, caret: standing.end });
      onSeeded?.(person, "already");
      return;
    }
    const base = current.text;
    const text = `${base}${base === "" || /\s$/u.test(base) ? "" : " "}@${person.name} `;
    const ids = [...new Set([...current.mentions.map((chip) => chip.person.id), person.id])];
    if (text.length > ASK_MAX_LENGTH || ids.length > ASK_MAX_MENTIONS) {
      notify.warn("No room for that name", {
        id: "ask-mention-refused",
        description: `Questions stop at ${ASK_MAX_LENGTH} characters and ${ASK_MAX_MENTIONS} people.`,
      });
      onSeeded?.(person, "no-room");
      return;
    }
    editor.current?.apply({ draft: draftOf(text, people, ids), caret: text.length });
    onSeeded?.(person, "added");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, people, loaded]);

  const query = search?.query;
  useLayoutEffect(() => {
    const list = document.getElementById(listId);
    if (list) list.scrollTop = 0;
  }, [query, listId]);

  /** The list's keys, while it is open. True when the key was the list's. */
  const listKey = (event: KeyboardEvent<HTMLDivElement>): boolean => {
    const plain = !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey;
    if (event.key === "Escape" && open) {
      setDismissed(search?.start ?? null);
      return true;
    }
    // The people failed to load: Enter is the list's Try again, so the keyboard can do what the button does.
    if (open && state === "error" && event.key === "Enter" && plain) {
      mention?.retry();
      return true;
    }
    if (!expanded) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      move(event.key === "ArrowDown" ? 1 : -1);
      return true;
    }
    if ((event.key === "Enter" && plain) || (event.key === "Tab" && plain)) {
      const person = matches[activeIndex];
      if (person) choose(person);
      return true;
    }
    return false;
  };

  /** The keys the box takes before the editor: the list's, Enter to ask, ↑ in an empty field for the last question. */
  const key = (event: KeyboardEvent<HTMLDivElement>): boolean => {
    if (mention && listKey(event)) return true;
    if (event.key === "Enter" && !event.shiftKey) {
      submit();
      return true;
    }
    if (event.key === "ArrowUp" && value === "" && recall) {
      // Its chips with it: the people it was asked about, by id.
      editor.current?.apply({ draft: draftOf(recall, people, ids), caret: recall.length });
      return true;
    }
    return false;
  };

  // What the list says to a screen reader as it changes: how many people it holds, or why it holds none.
  const listSays = !open
    ? ""
    : state === "pending"
      ? "Loading the board's people."
      : state === "error"
        ? "Could not load people. Press Enter to retry."
        : matches.length === 0
          ? "No one on this board matches."
          : `${matches.length} ${matches.length === 1 ? "person" : "people"} to mention. Up and down arrows to move, Enter to choose.`;

  const textRow = (
    <div className="flex items-start gap-3 px-4 pt-3.5 pb-1">
      <span aria-hidden className="mono pt-px text-md leading-6 text-cite">
        &rsaquo;
      </span>
      <span id={labelId} className="sr-only">
        Your question
      </span>
      <QuestionEditor
        handle={editor}
        draft={current}
        placeholder={placeholder}
        labelledBy={labelId}
        describedBy={`${hintId} ${countId}`}
        aria={aria}
        mac={mac}
        onEdit={edited}
        onCaret={caretMoved}
        onKey={key}
        onBlur={(event) => {
          // A tap on the list moves focus into it (to be handed straight back); anywhere else closes it.
          if (!(event.relatedTarget instanceof Element && event.relatedTarget.closest("[data-mention-menu]"))) close();
        }}
        readOnly={busy}
      />
    </div>
  );

  return (
    <form
      aria-label="Ask a question"
      data-print="hide"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      // A field must be findable without its placeholder: the kit's 3:1 control edge, the accent on focus.
      className="raised flex flex-col border border-rule-control focus-within:border-cite"
    >
      {mention ? (
        <MentionMenu
          open={open}
          anchor={textRow}
          onClose={close}
          onEscape={() => setDismissed(search?.start ?? null)}
          listId={listId}
          optionId={optionId}
          state={state}
          groups={groups}
          query={search?.query ?? ""}
          nobody={(directory?.length ?? 0) === 0}
          activeIndex={activeIndex}
          onActive={setActive}
          onChoose={choose}
          onRetry={mention.retry}
        />
      ) : (
        textRow
      )}
      <div className="flex min-h-11 items-center gap-3 py-2 pr-2.5 pl-4">
        <p id={hintId} className="flex min-w-0 flex-1 items-center text-xs text-ink-low">
          <span aria-hidden className="flex h-5 min-w-0 flex-wrap items-center gap-x-1.5 overflow-hidden" data-hint-line>
            <Hint keys={[mac ? "↵" : "Enter"]} className={KEYBOARD_HINT}>
              to ask
            </Hint>
            {mention ? (
              <Hint keys={["@"]} after dotClassName="hidden sm:inline" data-hint="mention">
                mention someone
              </Hint>
            ) : null}
            <Hint keys={mac ? ["⇧", "↵"] : ["Shift", "Enter"]} after className={KEYBOARD_HINT} data-hint="new-line">
              new line
            </Hint>
            {recall && value === "" ? (
              <Hint keys={["↑"]} after data-hint="recall" className={KEYBOARD_HINT}>
                last question
              </Hint>
            ) : null}
          </span>
          <span className="sr-only">
            Press Enter to ask, Shift and Enter for a new line.{mention ? " Type @ to mention someone on this board." : null}
          </span>
        </p>
        <span
          id={countId}
          className={cn(
            "mono ml-auto shrink-0 text-[11px] whitespace-nowrap",
            length >= COUNT_FROM ? (length >= ASK_MAX_LENGTH ? "text-warn-ink" : "text-ink-low") : "sr-only",
          )}
        >
          <span aria-hidden>
            {length >= ASK_MAX_LENGTH ? "Questions stop at " : null}
            {length} / {ASK_MAX_LENGTH}
          </span>
          <span className="sr-only">
            {length} of {ASK_MAX_LENGTH} characters used.
          </span>
        </span>
        <Button
          type="submit"
          variant="primary"
          iconEnd={CornerDownLeft}
          loading={busy}
          // While a question is being answered the button says so at full strength, and cannot be pressed.
          disabled={!question && !busy}
          aria-disabled={busy || undefined}
          className={cn(length < COUNT_FROM && "ml-auto", busy && "pointer-events-none aria-disabled:opacity-100")}
        >
          {busy ? "Asking" : "Ask"}
        </Button>
      </div>
      {/* Always in the page, so the line is read out when it appears. */}
      <div aria-live="polite" data-ask-notice-region>
        {notice ? (
          <p data-ask-notice className="flex items-start gap-2 border-t border-rule-weak py-2.5 pr-3 pl-4 text-sm text-warn-ink">
            <Clock aria-hidden size={14} strokeWidth={1.75} className="mt-[3px] shrink-0" />
            <span>{notice}</span>
          </p>
        ) : null}
      </div>
      {mention ? (
        <>
          <span role="status" className="sr-only">
            {listSays}
          </span>
          <span role="status" className="sr-only">
            {said}
          </span>
        </>
      ) : null}
    </form>
  );
}
