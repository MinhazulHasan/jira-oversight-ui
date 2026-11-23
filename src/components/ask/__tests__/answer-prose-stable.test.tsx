import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { AnswerSegment } from "@/lib/api/citations";
import type { Citation, Person } from "@/lib/api/schemas";

import { AnswerProse } from "../answer-prose";
import { TraceProvider } from "../trace";

/*
 * The JO-11 check's G1 and G7, on the answer's prose:
 * - G1: a re-render updates the document in place. Built inline, react-markdown's components map handed React new
 *   component types on every render, so each paragraph, value, pill and picture was unmounted and mounted again
 *   (WebKit measured a mention's picture as it was being replaced).
 * - G7: a cited value, its marker and its link's arrow, and a person's pill, keep the punctuation that touches them on
 *   their line: no line starts with a full stop, a comma or a lone arrow.
 */

const ADA: Person = { id: "pada000000001", name: "Ada Brooks", avatar: null };
const CARMEN: Person = { id: "pcar000000002", name: "Carmen Ruiz", avatar: null };

const text = (value: string): AnswerSegment => ({ kind: "text", text: value });
let marker = 0;
const cite = (value: string): AnswerSegment => {
  marker += 1;
  return { kind: "cite", text: value, citation: { marker, text: value, fact_ref: "F1", row_index: 0, column: "n" } };
};

function answer(): AnswerSegment[] {
  marker = 0;
  return [
    text("Open tickets, most first: Ada Brooks "),
    cite("13"),
    text(", Carmen Ruiz "),
    cite("12"),
    text(". The newest is "),
    cite("DEMO-1135"),
    text("; see ("),
    cite("DEMO-12"),
    text("). Ada Brooks's backlog."),
  ];
}

const prose = () => document.querySelector("[data-answer-prose]") as HTMLElement;

/** The prose as the page draws it: inside the answer's trace, so each value is a button that holds its row. */
function Answer({ describe, unlinked }: { describe: (marker: number) => string; unlinked?: ReadonlySet<string> }) {
  const segments = answer();
  const citations = segments.flatMap((segment): Citation[] => (segment.kind === "cite" ? [segment.citation] : []));
  return (
    <TraceProvider answerId="qa-1" citations={citations} order={citations.map((citation) => citation.marker)}>
      <AnswerProse segments={segments} describe={describe} people={[ADA, CARMEN]} unlinked={unlinked} />
    </TraceProvider>
  );
}

describe("the answer's prose, re-rendered (G1)", () => {
  it("keeps every node it drew: paragraphs, values, pills and pictures update in place", () => {
    const view = render(<Answer describe={(m) => `citation ${m}`} />);
    const before = {
      paragraph: prose().querySelector("p"),
      value: prose().querySelector("[data-marker='1']"),
      pill: prose().querySelector(`[data-person-mention="${ADA.id}"]`),
      avatar: prose().querySelector(`[data-person-mention="${ADA.id}"] [data-avatar]`),
    };
    expect(Object.values(before).every((node) => node !== null)).toBe(true);
    // A parent's re-render hands new arrays, a new describe and a new set of people, as AskView does on every render.
    view.rerender(<Answer describe={(m) => `where ${m} comes from`} unlinked={new Set()} />);
    expect(prose().querySelector("p")).toBe(before.paragraph);
    expect(prose().querySelector("[data-marker='1']")).toBe(before.value);
    expect(prose().querySelector(`[data-person-mention="${ADA.id}"]`)).toBe(before.pill);
    expect(prose().querySelector(`[data-person-mention="${ADA.id}"] [data-avatar]`)).toBe(before.avatar);
    // And what changed is drawn: the new description.
    expect(document.getElementById(before.value!.getAttribute("aria-describedby")!)).toHaveTextContent("where 1 comes from");
  });
});

describe("the answer's prose at a line's end (G7)", () => {
  it("holds a value, its marker and the punctuation after it together, and a key with its arrow", () => {
    render(<Answer describe={(m) => `citation ${m}`} />);
    const glued = [...prose().querySelectorAll("[data-glued]")];
    expect(glued.every((group) => group.classList.contains("whitespace-nowrap"))).toBe(true);
    const of = (selector: string) => glued.find((group) => group.querySelector(selector))!;
    // The value, its marker (and the words a screen reader hears for it), then the comma: one group.
    expect(of("[data-marker='1']").textContent).toMatch(/^13, citation 1.*,$/);
    expect(of("[data-marker='2']").textContent).toMatch(/^12, citation 2.*\.$/);
    // The key, its arrow and the semicolon after it: one group, so the arrow never starts a line.
    const key = of("[data-marker='3']");
    expect(key.querySelector("a[href='/issues/DEMO-1135']")).not.toBeNull();
    expect(key.textContent).toMatch(/;$/);
    // An opening bracket before a value and the closing one after it.
    expect(of("[data-marker='4']").textContent).toMatch(/^\(DEMO-12.*\)\.$/);
  });

  it("holds a person's pill to the comma or the possessive after it, never the space", () => {
    render(<Answer describe={(m) => `citation ${m}`} />);
    const pills = [...prose().querySelectorAll(`[data-person-mention="${ADA.id}"]`)];
    expect(pills).toHaveLength(2);
    // The first pill stands before a space and a value: nothing to hold. The second before "'s backlog.".
    expect(pills[0].parentElement?.hasAttribute("data-glued")).toBe(false);
    expect(pills[1].parentElement).toHaveAttribute("data-glued");
    expect(pills[1].parentElement!.textContent).toBe("Ada Brooks's");
    // The prose still reads as written.
    expect(prose().textContent).toContain("Open tickets, most first: Ada Brooks 13");
    expect(prose().textContent).toContain("Ada Brooks's backlog.");
  });
});

describe("a figure and its unit at a line's end (the JO-12 check)", () => {
  /** "Where do tickets get stuck most?" in the sample's words, with a ratio and a unit in words besides. */
  function unitSegments(): AnswerSegment[] {
    marker = 0;
    return [
      text("Work waited longest in Review: a median of "),
      cite("161.6"),
      text(" h across "),
      cite("321"),
      text(" closed intervals, with a p90 of "),
      cite("336.6"),
      text(" h. The effort ratio was "),
      cite("1.42"),
      text("× in the week, and "),
      cite("12"),
      text(" hours went unlogged."),
    ];
  }

  function Units({ segments }: { segments: AnswerSegment[] }) {
    const citations = segments.flatMap((segment): Citation[] => (segment.kind === "cite" ? [segment.citation] : []));
    return (
      <TraceProvider answerId="qa-units" citations={citations} order={citations.map((citation) => citation.marker)}>
        <AnswerProse segments={segments} describe={(m) => `citation ${m}`} />
      </TraceProvider>
    );
  }

  it("holds a unit symbol, and the punctuation after it, to its figure; a unit in words stays prose", () => {
    // Regression: at 390 px in WebKit, lines began with the unit ("161.6² / h across", "336.6⁶ / h.").
    render(<Units segments={unitSegments()} />);
    const group = (m: number) => prose().querySelector(`[data-marker='${m}']`)!.parentElement!;
    expect(group(1)).toHaveAttribute("data-glued");
    expect(group(1)).toHaveClass("whitespace-nowrap");
    expect(group(1).textContent).toMatch(/^161\.6, citation 1.* h$/);
    expect(group(3).textContent).toMatch(/^336\.6, citation 3.* h\.$/);
    expect(group(4).textContent).toMatch(/^1\.42, citation 4.*×$/);
    // Words after a figure are prose: "321 closed" and "12 hours" break where prose breaks.
    expect(group(2).hasAttribute("data-glued")).toBe(false);
    expect(group(5).hasAttribute("data-glued")).toBe(false);
    // Only the unit is held: the words after it stay outside, and the prose reads as written.
    expect(group(1).textContent).not.toContain("across");
    const words = prose().cloneNode(true) as HTMLElement;
    words.querySelectorAll(".sr-only, [hidden], sup").forEach((node) => node.remove());
    expect(words.textContent).toBe(
      "Work waited longest in Review: a median of 161.6 h across 321 closed intervals, with a p90 of 336.6 h. The effort ratio was 1.42× in the week, and 12 hours went unlogged.",
    );
  });
});

describe("a person's pill before punctuation (G7)", () => {
  it("ends close to the name where a comma or a possessive touches it, and keeps its room before a space", () => {
    render(<Answer describe={(m) => `citation ${m}`} />);
    const pills = [...prose().querySelectorAll(`[data-person-mention="${ADA.id}"]`)];
    expect(pills[0]).toHaveClass("pr-2");
    expect(pills[1]).toHaveClass("pr-1");
  });
});
