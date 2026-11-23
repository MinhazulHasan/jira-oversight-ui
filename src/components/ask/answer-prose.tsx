"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import {
  Children,
  cloneElement,
  createContext,
  Fragment,
  isValidElement,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  type ReactElement,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { PersonCardTrigger } from "@/components/person-card/person-card-trigger";
import { usePeopleLevel } from "@/components/shell/people-level";
import { PersonAvatar } from "@/components/ui/person-avatar";
import type { AnswerSegment } from "@/lib/api/citations";
import type { Person } from "@/lib/api/schemas";
import { isIssueKey } from "@/lib/issue-key";
import { findNames } from "@/lib/names";
import { cn } from "@/lib/utils";

import { valueKey } from "./describe";
import { useTrace, type Step } from "./trace";

const STEP_KEYS: Record<string, Step> = {
  ArrowRight: "next",
  ArrowDown: "next",
  ArrowLeft: "previous",
  ArrowUp: "previous",
  Home: "first",
  End: "last",
};

/**
 * A value the answer quotes, bound to the cell it was read from: set in Plex
 * Mono on a teal underline, with its citation marker. One tab stop for all of
 * them (the held one, else the first); the arrow keys step, Home and End jump,
 * Esc lets go. Hover traces it for as long as the pointer stays; a click or
 * focus holds it.
 */
function BoundValue({ text, marker, description }: { text: string; marker: number; description: string }) {
  const trace = useTrace();
  const ref = useRef<HTMLButtonElement>(null);
  const descriptionId = useId();
  const register = trace?.register;

  useEffect(() => {
    if (!register) return;
    register(valueKey(marker), ref.current);
    return () => register(valueKey(marker), null);
  }, [register, marker]);

  if (!trace) return <span className="mono font-medium">{text}</span>;

  const active = trace.active === marker;
  const tabStop = (trace.held?.marker ?? trace.order[0]) === marker;

  return (
    <>
      <button
        ref={ref}
        type="button"
        data-marker={marker}
        tabIndex={tabStop ? 0 : -1}
        aria-describedby={descriptionId}
        onMouseEnter={() => trace.point(marker)}
        onMouseLeave={() => trace.point(null)}
        onFocus={() => trace.hold(marker, "user")}
        onClick={() => trace.hold(marker, "user")}
        onKeyDown={(event) => {
          const where = STEP_KEYS[event.key];
          if (where) {
            event.preventDefault();
            trace.step(marker, where);
          } else if (event.key === "Escape") {
            event.preventDefault();
            trace.hold(null);
          }
        }}
        className={cn(
          "inline whitespace-nowrap rounded-[3px] px-px text-left transition-colors duration-100",
          active ? "bg-cite-tint text-cite-hot" : "text-ink hover:bg-cite-tint",
        )}
      >
        <span
          data-bound-text
          className="mono bg-[linear-gradient(var(--cite-line),var(--cite-line))] bg-[length:100%_1.5px] bg-[position:0_calc(100%-1px)] bg-no-repeat font-medium"
        >
          {text}
        </span>
        <span className="sr-only">, citation {marker}</span>
        <sup
          aria-hidden
          className={cn(
            "mono ml-[3px] inline-flex h-[15px] min-w-[15px] items-center justify-center rounded-[3px] px-[3px] align-super text-[10px] leading-none font-medium transition-colors duration-100",
            active ? "bg-cite text-cite-ink" : "bg-cite-tint text-cite",
          )}
        >
          {marker}
        </sup>
      </button>
      <span id={descriptionId} hidden>
        {description}
      </span>
    </>
  );
}

/** A cited issue key also opens its page (the timeline, its findings and the link to Jira). */
function IssueLink({ issueKey }: { issueKey: string }) {
  return (
    <Link
      href={`/issues/${issueKey}`}
      aria-label={`Open ${issueKey}`}
      title={`Open ${issueKey}`}
      className="ml-0.5 inline-flex size-4 translate-y-[1px] items-center justify-center rounded-[3px] text-ink-low transition-colors duration-100 hover:bg-hover hover:text-cite-hot"
    >
      <ArrowUpRight aria-hidden size={12} strokeWidth={2} />
    </Link>
  );
}

/**
 * Someone the answer names, marked as Jira marks a mention: their picture
 * and name on a neutral pill. The pill takes its baseline from the name, so
 * the name sits on the sentence's own line; the picture is centred in the
 * pill on its own, the same for a picture as for initials. Shorter than the
 * line, so nothing moves; a name too long for the column wraps inside the
 * pill rather than running off it.
 *
 * Ask names people only at people level (an admin, or sign-in off), where
 * the pill opens the person's card, as a mention does in Jira and Confluence
 * (JO-13): resting on it shows the card, a press pins it, and the card leads
 * on to their findings, their scorecard and Ask. Without the card (a reader
 * the card is not for), the pill leads to their open findings; someone who
 * holds none of the board's tickets gets the same pill with no link
 * (`linked={false}`): their open findings would be an empty page.
 */
export function PersonMention({ person, linked = true, tight = false }: { person: Person; linked?: boolean; tight?: boolean }) {
  const peopleLevel = usePeopleLevel();
  // Tight before the punctuation that touches it ("Ada Brooks,"): the pill ends close to the name, so the comma reads
  // as the sentence's, not a space away (the JO-11 check, G7).
  const pill = cn("inline-flex max-w-full items-baseline gap-1.5 rounded-full bg-hover py-px pl-px text-ink", tight ? "pr-1" : "pr-2");
  const content = (
    <>
      <PersonAvatar person={person} className="self-center" />
      {/* Never clipped: a clipped box would hand the pill a baseline of its own. A name too long for the column wraps
          inside the pill, even where the pill is held to the punctuation after it (Glued). */}
      <span className="min-w-0 leading-5 whitespace-normal [overflow-wrap:anywhere]">{person.name}</span>
    </>
  );
  if (peopleLevel) {
    return (
      <PersonCardTrigger
        person={person}
        data-person-mention={person.id}
        data-unlinked={linked ? undefined : ""}
        className={cn(pill, "transition-colors duration-100 hover:bg-pressed data-[state=open]:bg-pressed")}
      >
        {content}
      </PersonCardTrigger>
    );
  }
  if (!linked) {
    return (
      <span data-person-mention={person.id} data-unlinked="" className={pill}>
        {content}
      </span>
    );
  }
  return (
    <Link
      href={`/findings?state=open&person=${person.id}`}
      title={`${person.name}: open findings`}
      data-person-mention={person.id}
      className={cn(pill, "transition-colors duration-100 hover:bg-pressed")}
    >
      {content}
    </Link>
  );
}

/** The sentence the service builds in code for people mentioned who hold none of the board's tickets (contract 4.6). */
const NO_TICKETS_SENTENCE = /^(.+) (?:has|have) no tickets on this board\.$/u;

/**
 * The ids of the people an answer's closing no-tickets sentence names: the
 * whole `no_data` answer, or the last paragraph of a mixed one. They hold none
 * of the board's tickets, so their pill leads nowhere. Empty when the answer
 * does not end so.
 */
export function withoutTickets(answer: string | null | undefined, people: readonly Person[]): ReadonlySet<string> {
  const last = answer?.trim().split(/\n[^\S\n]*\n/u).at(-1)?.trim() ?? "";
  const names = NO_TICKETS_SENTENCE.exec(last)?.[1];
  if (!names) return new Set();
  const found = new Set(findNames(names, people.map((person) => person.name)).map((name) => name.name));
  return new Set(people.filter((person) => found.has(person.name)).map((person) => person.id));
}

// A cited value stands in the Markdown as a placeholder the parser leaves alone.
const OPEN = "\uE000";
const CLOSE = "\uE001";
const PLACEHOLDER = /\uE000(\d+)\uE001/g;

/**
 * Punctuation that closes onto what stands before it ("88.", "Ada Brooks,", "DEMO-12)", "Ada Brooks's"), and
 * punctuation that opens onto what follows it ("(DEMO-12").
 */
const CLOSING = /^(?:['’]s(?!\p{L}))?[.,;:!?…)\]}’”"'%]*/u;
const OPENING = /[([{‘“"]+$/u;
/**
 * A unit symbol after a figure, a space after it or touching it ("161.6 h", "3 d", "8 pts", "1.42×"): held to the
 * figure, so no line starts with a unit (the JO-12 check; the marker before it is a box a line may break after).
 * Symbols and their short forms only: a unit in words ("12 hours") is prose, and may break as prose does.
 */
const UNIT = /^[  ]?(?:h|hrs?|d|mins?|wks?|pts?|x|×|%)(?![\p{L}\p{N}_])/u;

/**
 * A cited value or a person's pill held together with the punctuation that
 * touches it, so no line starts with a full stop, a comma or a link's lone
 * arrow (the JO-11 check, G7): the value, its marker and its arrow, or the
 * pill, with an opening bracket before and the punctuation after, on one
 * line. Only the touching characters: the line still breaks at the spaces
 * around them.
 */
function Glued({ children }: { children: ReactNode }) {
  return (
    <span data-glued="" className="whitespace-nowrap">
      {children}
    </span>
  );
}

/** What binds the rendered Markdown's text: the placeholders swapped for their values, and the people it names marked. */
type Bind = (children: ReactNode) => ReactNode;
const BindContext = createContext<Bind>((children) => children);

/** A Markdown element's children, bound by the answer this prose renders. */
function Bound({ children }: { children: ReactNode }) {
  const bind = useContext(BindContext);
  return <>{bind(children)}</>;
}

/**
 * How each Markdown element renders: defined once, here, never per render.
 * react-markdown takes each entry as a component type, so a map built inline
 * would hand React new types on every render, and every paragraph, value,
 * pill and picture would be unmounted and mounted again (the JO-11 check, G1:
 * a mention's picture measured as it was being replaced). The answer's own
 * values reach them through BindContext instead.
 */
const COMPONENTS: Components = {
  p: ({ children }) => (
    <p className="whitespace-pre-line">
      <Bound>{children}</Bound>
    </p>
  ),
  li: ({ children }) => (
    <li className="pl-1 whitespace-pre-line">
      <Bound>{children}</Bound>
    </li>
  ),
  ul: ({ children }) => <ul className="list-disc space-y-1 pl-5 marker:text-ink-low">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal space-y-1 pl-5 marker:text-ink-low">{children}</ol>,
  strong: ({ children }) => (
    <strong className="font-semibold">
      <Bound>{children}</Bound>
    </strong>
  ),
  em: ({ children }) => (
    <em>
      <Bound>{children}</Bound>
    </em>
  ),
  h1: ({ children }) => (
    <h3 className="text-md font-semibold">
      <Bound>{children}</Bound>
    </h3>
  ),
  h2: ({ children }) => (
    <h3 className="text-md font-semibold">
      <Bound>{children}</Bound>
    </h3>
  ),
  h3: ({ children }) => (
    <h3 className="text-md font-semibold">
      <Bound>{children}</Bound>
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="font-semibold">
      <Bound>{children}</Bound>
    </h4>
  ),
  table: ({ children }) => (
    <div className="max-w-full overflow-x-auto">
      <table className="w-auto border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-rule px-3 py-1.5 text-left text-xs font-medium text-ink-low first:pl-0">
      <Bound>{children}</Bound>
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-rule-weak px-3 py-1.5 align-top first:pl-0">
      <Bound>{children}</Bound>
    </td>
  ),
  code: ({ children }) => (
    <code className="mono text-[0.92em]">
      <Bound>{children}</Bound>
    </code>
  ),
  // The model's own links and images are not rendered: text only.
  a: ({ children }) => <Bound>{children}</Bound>,
  img: () => null,
};

const REMARK_PLUGINS = [remarkGfm];

/**
 * A run of text, values and pills with the punctuation that touches a value
 * or a pill held to it (Glued): a closing mark after, an opening one before.
 * A cited figure is held to the unit symbol after it too, with the
 * punctuation that closes onto the unit ("161.6 h."). A cited key is held to
 * its arrow as well (`arrowed`): the arrow is a box of its own, which a line
 * may otherwise break before.
 */
function glue(parts: readonly ReactNode[], arrowed: ReadonlySet<string> = new Set()): ReactNode[] {
  const queue = [...parts];
  const out: ReactNode[] = [];
  for (let index = 0; index < queue.length; index += 1) {
    const part = queue[index];
    if (!isValidElement(part)) {
      if (part !== "" && part !== null) out.push(part);
      continue;
    }
    let before = "";
    const previous = out.at(-1);
    if (typeof previous === "string") {
      before = OPENING.exec(previous)?.[0] ?? "";
      if (before) {
        const rest = previous.slice(0, -before.length);
        if (rest) out[out.length - 1] = rest;
        else out.pop();
      }
    }
    let after = "";
    const next = queue[index + 1];
    if (typeof next === "string") {
      // A unit only after a value (a pill is a name, never a figure), then whatever punctuation closes onto it.
      const unit = part.type === PersonMention ? "" : (UNIT.exec(next)?.[0] ?? "");
      after = unit + (CLOSING.exec(next.slice(unit.length))?.[0] ?? "");
      if (after) queue[index + 1] = next.slice(after.length);
    }
    if (!before && !after && !arrowed.has(part.key ?? "")) {
      out.push(part);
      continue;
    }
    // A person's pill tucks up to the punctuation after it.
    const held = after && part.type === PersonMention ? cloneElement(part as ReactElement<{ tight?: boolean }>, { tight: true }) : part;
    out.push(
      <Glued key={`g-${String(part.key)}`}>
        {before}
        {held}
        {after}
      </Glued>,
    );
  }
  return out;
}

/**
 * The written answer as an annotated document: the model's Markdown
 * (paragraphs, bullet lists, bold, tables) with every cited figure bound to
 * its row, every cited issue key a link, and everyone it names (the answer's
 * verified `people`) marked with their picture wherever their name stands.
 * Raw HTML, images and the model's own links are never rendered: the only
 * links are the ones this page makes. A re-render updates the document in
 * place: nothing in it is mounted again (COMPONENTS).
 */
export function AnswerProse({
  segments,
  describe,
  people = [],
  unlinked,
}: {
  segments: readonly AnswerSegment[];
  /** Where a citation comes from, in words, for its value's description. */
  describe: (marker: number) => string;
  /** The people the answer names, as the response lists them. */
  people?: readonly Person[];
  /** The ids of the people marked without a link: those who hold none of the board's tickets (withoutTickets). */
  unlinked?: ReadonlySet<string>;
}) {
  const markdown = segments.map((segment, index) => (segment.kind === "text" ? segment.text : `${OPEN}${index}${CLOSE}`)).join("");

  const bind = useMemo<Bind>(() => {
    const byName = new Map<string, Person>();
    for (const person of people) if (!byName.has(person.name)) byName.set(person.name, person);
    const names = [...byName.keys()];

    /** Plain text with each person it names marked, as whole words only. */
    const mark = (text: string, key: string): ReactNode[] => {
      const parts: ReactNode[] = [];
      let last = 0;
      findNames(text, names).forEach((found, index) => {
        const person = byName.get(found.name);
        if (!person) return;
        if (found.start > last) parts.push(text.slice(last, found.start));
        parts.push(<PersonMention key={`${key}-p${index}`} person={person} linked={!unlinked?.has(person.id)} />);
        last = found.end;
      });
      if (last < text.length) parts.push(text.slice(last));
      return parts;
    };

    const cite = (index: number) => {
      const segment = segments[index];
      if (!segment || segment.kind !== "cite") return null;
      return (
        <Fragment key={`c${index}`}>
          <BoundValue text={segment.text} marker={segment.citation.marker} description={describe(segment.citation.marker)} />
          {isIssueKey(segment.text) ? <IssueLink issueKey={segment.text} /> : null}
        </Fragment>
      );
    };

    return (children) =>
      Children.map(children, (child, at) => {
        if (typeof child !== "string") return child;
        if (!child.includes(OPEN)) return names.length > 0 ? glue(mark(child, `t${at}`)) : child;
        const parts: ReactNode[] = [];
        const arrowed = new Set<string>();
        let last = 0;
        for (const match of child.matchAll(PLACEHOLDER)) {
          if (match.index > last) parts.push(...mark(child.slice(last, match.index), `t${at}-${last}`));
          const index = Number(match[1]);
          const segment = segments[index];
          if (segment?.kind === "cite" && isIssueKey(segment.text)) arrowed.add(`c${index}`);
          parts.push(cite(index));
          last = match.index + match[0].length;
        }
        if (last < child.length) parts.push(...mark(child.slice(last), `t${at}-${last}`));
        return glue(parts, arrowed);
      });
  }, [segments, describe, people, unlinked]);

  return (
    <div className="max-w-[70ch] space-y-3 text-md leading-[1.75] text-ink" data-answer-prose>
      <BindContext.Provider value={bind}>
        <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={COMPONENTS} skipHtml>
          {markdown}
        </ReactMarkdown>
      </BindContext.Provider>
    </div>
  );
}
