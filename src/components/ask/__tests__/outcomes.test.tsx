import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { renderKit } from "@/components/ui/__tests__/kit";
import { ASK_BUDGET_NOTE, ASK_DECLINES, askResponseSchema, type AskResponse } from "@/lib/api/schemas";

import answeredJson from "../../../../docs/sample-responses/ask-answered.json";
import trendJson from "../../../../docs/sample-responses/ask-answered-trend.json";
import noDataJson from "../../../../docs/sample-responses/ask-no-data.json";
import notMeasurableJson from "../../../../docs/sample-responses/ask-not-measurable.json";
import notUnderstoodJson from "../../../../docs/sample-responses/ask-not-understood.json";
import notVerifiedJson from "../../../../docs/sample-responses/ask-not-verified.json";
import peopleJson from "../../../../docs/sample-responses/ask-people.json";
import noTicketsJson from "../../../../docs/sample-responses/ask-person-no-tickets.json";
import personJson from "../../../../docs/sample-responses/ask-person.json";
import { AnswerDocument, useAnswerTrace } from "../answer-document";
import { withoutTickets } from "../answer-prose";
import { Ledger } from "../ledger";
import { TraceProvider } from "../trace";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/ask",
  useSearchParams: () => new URLSearchParams(),
}));

const answered = askResponseSchema.parse(answeredJson);
const trend = askResponseSchema.parse(trendJson);
const noData = askResponseSchema.parse(noDataJson);
const notMeasurable = askResponseSchema.parse(notMeasurableJson);
/** JO-09 judgement words, as an older service would still send them (since JO-11 the sample answers with figures). */
const judgement = {
  ...askResponseSchema.parse(notUnderstoodJson),
  question: "Who is the slowest developer?",
  message: ASK_DECLINES.judgement,
  suggestions: ["Who has the most open breaches?", "Who has the most open warnings?", "Which epics have the most open breaches?"],
};
const ranking = askResponseSchema.parse(peopleJson);
const onePerson = askResponseSchema.parse(personJson);
const notVerified = askResponseSchema.parse(notVerifiedJson);
const noTickets = askResponseSchema.parse(noTicketsJson);

beforeAll(() => {
  // jsdom has no media queries; the line respects prefers-reduced-motion through one.
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
});

function Harness({ response, onAsk }: { response: AskResponse; onAsk: (question: string) => void }) {
  const trace = useAnswerTrace(response);
  return (
    <TraceProvider answerId={response.qa_id} citations={response.citations} order={trace.order}>
      <AnswerDocument response={response} segments={trace.segments} describe={trace.describe} onAsk={onAsk} busy={false} />
      <Ledger state={{ kind: "response", response }} />
    </TraceProvider>
  );
}

function show(response: AskResponse) {
  const onAsk = vi.fn();
  const view = renderKit(<Harness response={response} onAsk={onAsk} />);
  return { ...view, onAsk };
}

const ledger = () => screen.getByRole("complementary", { name: "Sources" });
const tracedRows = () => ledger().querySelectorAll("tr[data-traced]");

describe("an answer", () => {
  it("reads as a document: the question as its title, every cited value bound with its marker", () => {
    show(answered);
    expect(screen.getByRole("heading", { level: 2, name: answered.question })).toBeInTheDocument();
    const values = screen.getAllByRole("button", { name: /, citation \d+$/ });
    expect(values).toHaveLength(8);
    [
      "DEMO-704, citation 1",
      "73, citation 2",
      "27, citation 3",
      "94, citation 4",
      "DEMO-763, citation 5",
      "57, citation 6",
      "DEMO-89, citation 7",
      "54, citation 8",
    ].forEach((name, index) => expect(values[index]).toHaveAccessibleName(name));
    expect(values[1]).toHaveAccessibleDescription("From F1 Hot spots, row 1, Open breaches.");
    expect(screen.getByText(/Answer · 8 figures cited/)).toBeInTheDocument();
  });

  it("traces its first value as soon as it is shown, and another on hover", () => {
    show(answered);
    expect([...tracedRows()].map((row) => row.getAttribute("data-row"))).toEqual(["0"]);

    fireEvent.mouseEnter(screen.getByRole("button", { name: "57, citation 6" }));
    expect([...tracedRows()].map((row) => row.getAttribute("data-row"))).toEqual(["1"]);
    const cell = ledger().querySelector('[data-cell="F1:1:open_breaches"]');
    expect(cell?.className).toMatch(/bg-cite-tint-strong/);

    fireEvent.mouseLeave(screen.getByRole("button", { name: "57, citation 6" }));
    expect([...tracedRows()].map((row) => row.getAttribute("data-row"))).toEqual(["0"]);
  });

  it("steps through the values with the arrow keys, and lets go on Escape", () => {
    show(answered);
    const values = screen.getAllByRole("button", { name: /, citation \d+$/ });
    // One tab stop for all of them.
    expect(values.filter((value) => value.tabIndex === 0)).toHaveLength(1);

    act(() => values[0].focus());
    fireEvent.keyDown(values[0], { key: "ArrowRight" });
    expect(values[1]).toHaveFocus();
    fireEvent.keyDown(values[1], { key: "End" });
    expect(values[7]).toHaveFocus();
    expect([...tracedRows()].map((row) => row.getAttribute("data-row"))).toEqual(["2"]);

    // Held by the reader, the arrows work from anywhere that is not a field.
    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    expect(values[6]).toHaveFocus();

    fireEvent.keyDown(values[6], { key: "Escape" });
    expect(tracedRows()).toHaveLength(0);
  });

  it("sets out the facts: the call in words, typed figures and the cited cells, never the raw call", () => {
    show(answered);
    const panel = ledger();
    expect(within(panel).getByRole("heading", { level: 3, name: "Hot spots" })).toBeInTheDocument();
    expect(within(panel).getByText("top 5")).toBeInTheDocument();
    // Go-live (SQA): the catalogue call's own name is a developer's, not a reader's.
    expect(panel).not.toHaveTextContent("oversight_hot_spots");
    expect(within(panel).getByText(/More rows exist in Jira/)).toBeInTheDocument();
    expect(within(panel).getByText("1 source")).toBeInTheDocument();
    // The epic's title folds under its key; the counts stay in their own columns.
    expect(within(panel).getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "Epic and Epic title",
      "Open breaches",
      "Open warnings",
      "Issues with findings",
      "Opens",
    ]);
    const firstRow = panel.querySelector('tr[data-row="0"]') as HTMLElement;
    expect(within(firstRow).getByText("Data import pipeline")).toBeInTheDocument();
    expect(within(firstRow).getByRole("cell", { name: "73, cited as 2" })).toHaveAttribute("data-cell", "F1:0:open_breaches");
    expect(within(firstRow).getByRole("cell", { name: /^DEMO-704, cited as 1\s*Data import pipeline$/ })).toBeInTheDocument();
  });

  it("opens a row where it leads: an epic's findings", () => {
    show(answered);
    const row = ledger().querySelector('tr[data-row="1"]') as HTMLElement;
    fireEvent.click(row);
    expect(push).toHaveBeenCalledWith("/findings?epic=DEMO-763");
    fireEvent.keyDown(row, { key: "Enter" });
    expect(push).toHaveBeenLastCalledWith("/findings?epic=DEMO-763");
  });

  it("says it was answered and when, and nothing a developer reads (SQA)", () => {
    show(answered);
    const meta = document.querySelector("article footer") as HTMLElement;
    expect(meta).toHaveTextContent(/^Answered·asked /);
    expect(meta).not.toHaveTextContent(/scripted|ms|Numbers verified|Ref |claude/);
    expect(screen.queryByRole("button", { name: /Copy answer reference/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Ask again for a fresh answer" })).toBeInTheDocument();
    expect(screen.getByText("Point at a figure to see its source.")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/Hover a figure to trace it to its row/);
  });

  it("offers questions to ask next", () => {
    const { onAsk } = show(answered);
    const next = screen.getByRole("list", { name: "Suggested questions" });
    const chips = within(next).getAllByRole("button");
    expect(chips.map((chip) => chip.textContent)).not.toContain(answered.question);
    fireEvent.click(chips[0]);
    expect(onAsk).toHaveBeenCalledWith(chips[0].textContent);
  });

  it("ties a value read from a fact set's note to the note", () => {
    show(trend);
    fireEvent.mouseEnter(screen.getByRole("button", { name: "30, citation 6" }));
    const note = ledger().querySelector("[data-traced]");
    expect(note?.textContent).toMatch(/^done work finished in the last 30 days/);
    expect(within(ledger()).getAllByText(/^1\.03×$/).length).toBeGreaterThan(0);
    expect(within(ledger()).getByText("80%")).toBeInTheDocument();
    expect(within(ledger()).getAllByText(/^(17 Aug 2026|Aug 17, 2026)$/).length).toBeGreaterThan(0);
  });
});

describe("an answer about people", () => {
  it("marks each person it names where their name stands: picture or initials, the name, and a way to their open findings", () => {
    show(ranking);
    const prose = document.querySelector("[data-answer-prose]") as HTMLElement;
    const marks = [...prose.querySelectorAll("[data-person-mention]")];
    expect(marks.map((mark) => mark.getAttribute("data-person-mention"))).toEqual(ranking.people.map((person) => person.id));
    const [lead] = ranking.people;
    const first = within(prose).getByRole("link", { name: lead.name });
    expect(first).toHaveAttribute("href", `/findings?state=open&person=${lead.id}`);
    // The picture is decorative: the name is what is read, and what is copied.
    const avatar = first.querySelector("[data-avatar]");
    expect(avatar).toHaveAttribute("aria-hidden", "true");
    expect(avatar).toHaveAttribute("data-avatar", lead.avatar ? "picture" : "initials");
    // Nothing of the picture joins the words: each mark reads as the name alone.
    expect(marks.map((mark) => mark.textContent)).toEqual(ranking.people.map((person) => person.name));
    expect(prose.textContent).toMatch(new RegExp(`^${lead.name} has the most open breaches`));
    // The figures are still bound to their rows.
    expect(screen.getAllByRole("button", { name: /, citation \d+$/ })).toHaveLength(ranking.citations.length);
  });

  it("marks a name only where it stands as a whole word, and only for the people the answer lists", () => {
    const [lead] = onePerson.people;
    const twice = `${lead.name} has 3 open breaches. ${lead.name}son and ${lead.name}'s colleagues are not marked twice over.`;
    const { unmount } = show({ ...onePerson, answer: twice, citations: [] });
    const marks = document.querySelectorAll("[data-answer-prose] [data-person-mention]");
    expect(marks).toHaveLength(2);
    unmount();
    show({ ...onePerson, people: [] });
    expect(document.querySelectorAll("[data-answer-prose] [data-person-mention]")).toHaveLength(0);
  });
});

describe("people mentioned who hold no tickets on the board", () => {
  const [noor] = noTickets.people;
  const tomas = { id: "p612c407b515f", name: "Tomás Ferreira", avatar: null };
  const yuki = { id: "pe068f42bb810", name: "Yuki Tanabe", avatar: null };

  it("all of them: the sentence, each marked where their name stands as an answer marks people, and nothing read", () => {
    const { onAsk } = show(noTickets);
    expect(document.querySelector("article")).toHaveAttribute("data-outcome", "no_data");
    const prose = document.querySelector("[data-answer-prose]") as HTMLElement;
    expect(prose).toHaveTextContent(/^Noor Haddad has no tickets on this board\.$/);
    // Marked as an answer marks people, but leading nowhere: with no tickets, their open findings are an empty page.
    const mark = prose.querySelector(`[data-person-mention="${noor.id}"]`) as HTMLElement;
    expect(mark).toHaveTextContent(noor.name);
    expect(mark.tagName).toBe("SPAN");
    expect(mark).not.toHaveAttribute("href");
    expect(mark).not.toHaveAttribute("title");
    expect(within(prose).queryByRole("link")).not.toBeInTheDocument();
    // Built in code: no model and no script wrote it, so the footer names no writer.
    const footer = document.querySelector("article footer") as HTMLElement;
    expect(footer).toHaveTextContent(/^No data·asked /);
    expect(footer).not.toHaveTextContent("scripted");
    // No picture: the initials, decorative, beside the name.
    expect(mark.querySelector("[data-avatar]")).toHaveAttribute("data-avatar", "initials");
    expect(mark.querySelector("[data-avatar]")).toHaveAttribute("aria-hidden", "true");
    // Not "widen the question": nothing was searched, and the way on is someone else, or the board's figures.
    expect(screen.queryByRole("heading", { name: "Widen the question" })).not.toBeInTheDocument();
    expect(screen.getByText(/Type @ to pick someone else/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Who has the most open breaches?" }));
    expect(onAsk).toHaveBeenCalledWith("Who has the most open breaches?");
    expect(within(ledger()).getByText(/They hold no tickets on this board/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    // Three of them: one sentence, each marked, in the order mentioned.
    cleanup();
    const answer = "Noor Haddad, Tomás Ferreira and Yuki Tanabe have no tickets on this board.";
    show({ ...noTickets, answer, people: [noor, tomas, yuki] });
    const marks = [...document.querySelectorAll("[data-answer-prose] [data-person-mention]")];
    expect(marks.map((element) => element.textContent)).toEqual(["Noor Haddad", "Tomás Ferreira", "Yuki Tanabe"]);
    expect(marks.every((element) => element.tagName === "SPAN")).toBe(true);
    expect(document.querySelector("[data-answer-prose]")).toHaveTextContent(answer);
  });

  it("some of them: the answer about the others, then a paragraph of its own for them, marked, the figures still bound", () => {
    const answer = `${onePerson.answer}\n\nNoor Haddad has no tickets on this board.`;
    show({ ...onePerson, answer, people: [...onePerson.people, noor] });
    const paragraphs = document.querySelectorAll("[data-answer-prose] p");
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[1]).toHaveTextContent("Noor Haddad has no tickets on this board.");
    // The person with tickets leads to their open findings; the one with none is marked with no link.
    const [lead] = onePerson.people;
    expect(within(paragraphs[0] as HTMLElement).getAllByRole("link", { name: lead.name })[0]).toHaveAttribute("data-person-mention", lead.id);
    expect(within(paragraphs[1] as HTMLElement).queryByRole("link")).not.toBeInTheDocument();
    expect(paragraphs[1].querySelector(`[data-person-mention="${noor.id}"]`)?.tagName).toBe("SPAN");
    expect(screen.getAllByRole("button", { name: /, citation \d+$/ })).toHaveLength(onePerson.citations.length);
  });

  it("finds the people of the closing sentence, and no one in an answer that does not end with it", () => {
    const people = [...onePerson.people, noor, tomas, yuki];
    expect([...withoutTickets("Noor Haddad has no tickets on this board.", [noor])]).toEqual([noor.id]);
    expect([...withoutTickets(`${onePerson.answer}\n\nTomás Ferreira and Yuki Tanabe have no tickets on this board.`, people)]).toEqual([tomas.id, yuki.id]);
    expect([...withoutTickets(onePerson.answer, people)]).toEqual([]);
    expect([...withoutTickets("Noor Haddad has no tickets on this board. Yet.", people)]).toEqual([]);
    expect([...withoutTickets(null, people)]).toEqual([]);
  });
});

describe("the outcomes that are not answers", () => {
  it("about a person, at team level: answers stay at team level, and the Person filter is the way to one person", () => {
    const { onAsk } = show({ ...judgement, message: ASK_DECLINES.teamLevel, suggestions: ["Where do tickets get stuck most?"] });
    expect(screen.getByText("Team level", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("Answers stay at team level")).toBeInTheDocument();
    expect(screen.getByText(ASK_DECLINES.teamLevel)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open the Person filter/ })).toHaveAttribute("href", "/findings?state=open&menu=person");
    fireEvent.click(screen.getByRole("button", { name: "Where do tickets get stuck most?" }));
    expect(onAsk).toHaveBeenCalledWith("Where do tickets get stuck most?");
    expect(within(ledger()).getByText(/Nothing was read/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a judgement of someone, at people level: one sentence, and the facts that can be asked instead", () => {
    const { onAsk } = show(judgement);
    expect(screen.getByText("Facts, not judgements", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText("Ask does not judge people")).toBeInTheDocument();
    expect(screen.getByText(ASK_DECLINES.judgement)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Who has the most open breaches?" }));
    expect(onAsk).toHaveBeenCalledWith("Who has the most open breaches?");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("comparison turned off by an organisation: the contract sentence, and how to ask about one person", () => {
    show({ ...judgement, message: ASK_DECLINES.comparisonOff });
    expect(screen.getByText("Comparison turned off", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText(ASK_DECLINES.comparisonOff)).toBeInTheDocument();
    expect(screen.getByText(/Type @ and pick one person to see their scorecard/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("someone mentioned with no tickets on the board: said plainly, with how to pick someone who has", () => {
    show({ ...judgement, message: ASK_DECLINES.unknownMention });
    expect(screen.getByText("Not on this board", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByText(ASK_DECLINES.unknownMention)).toBeInTheDocument();
    expect(screen.getByText(/Type @ to pick someone on this board/)).toBeInTheDocument();
  });

  it("not understood, in general: what can be asked, with suggestions", () => {
    show({ ...judgement, message: "That question can't be answered from the Jira data; try one of the suggestions." });
    expect(screen.getByRole("heading", { name: "What can be asked" })).toBeInTheDocument();
    expect(screen.getByText(/One issue's story, by its key \(DEMO-142\)/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /\?$/ }).length).toBeGreaterThanOrEqual(3);
  });

  it("no data: what was searched, an empty lookup, and a way to widen", () => {
    show(noData);
    expect(screen.getByText(/No ticket was reopened after Done in the last 7 days/)).toBeInTheDocument();
    const looked = screen.getByRole("heading", { name: "Looked at" }).parentElement as HTMLElement;
    expect(within(looked).getByText("R-FLOW-03")).toBeInTheDocument();
    expect(looked).toHaveTextContent("open and resolved · last 7 days · up to 20");
    expect(screen.getByRole("heading", { name: "Widen the question" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Which tickets have been reopened after Done?" })).toBeInTheDocument();
    expect(within(ledger()).getByText("No rows: nothing matched this lookup.")).toBeInTheDocument();
    expect(within(ledger()).getByText("0 rows")).toBeInTheDocument();
  });

  it("not measurable: the hatch, the missing evidence named, and the gap as a finding", () => {
    const { container } = show(notMeasurable);
    expect(container.querySelector(".hatch")).not.toBeNull();
    expect(screen.getByText("Jira holds no evidence of code review")).toBeInTheDocument();
    expect(screen.getByText("That gap is itself a finding.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /See the process against Jira/ })).toHaveAttribute("href", "/process");
    expect(screen.getByRole("heading", { name: "What would have been looked up" })).toBeInTheDocument();
    expect(within(ledger()).getByText(/Jira holds no evidence for this/)).toBeInTheDocument();
  });

  it("not verified: the facts only, with the reason in plain words", () => {
    show(notVerified);
    expect(screen.getByText("Only the facts are shown")).toBeInTheDocument();
    expect(screen.getByText(/could not be verified against the facts/)).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: /, citation \d+$/ })).toHaveLength(0);
    expect(screen.getByText(/Wording withheld/).closest("footer")).toHaveTextContent("Facts only");
    expect(ledger().querySelectorAll("tbody tr")).toHaveLength(12);
    // Hours to one decimal place, the kit's way ("144.6 h", the unit joined by a no-break space).
    expect(within(ledger()).getByText("144.6 h")).toBeInTheDocument();
    expect(within(ledger()).getByRole("heading", { level: 3, name: "Trend" })).toBeInTheDocument();
  });
});

describe("an answer built without the AI model (JO-12)", () => {
  it("says so under the answer, in the muted note style, when the day's AI budget is used up", () => {
    show({ ...answered, note: ASK_BUDGET_NOTE });
    const note = document.querySelector("[data-answer-note]");
    expect(note).toHaveTextContent("Today's AI budget is used up, so this answer was built without the AI model.");
    expect(note).toHaveClass("text-ink-low");
    cleanup();
    show(answered);
    expect(document.querySelector("[data-answer-note]")).toBeNull();
  });
});
