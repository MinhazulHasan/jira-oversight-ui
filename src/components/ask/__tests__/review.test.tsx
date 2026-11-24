import { screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { renderKit } from "@/components/ui/__tests__/kit";
import { askResponseSchema, SCORECARD_SENTENCES, type AskResponse } from "@/lib/api/schemas";
import { askSample } from "@/server/sample/ask";
import { buildDataset } from "@/server/sample/dataset";
import { personIdFor } from "@/server/sample/team";

import directoryJson from "../../../../docs/sample-responses/people-directory.json";
import comparisonJson from "../../../../docs/sample-responses/ask-comparison.json";
import personnelJson from "../../../../docs/sample-responses/ask-personnel.json";
import scorecardsJson from "../../../../docs/sample-responses/ask-scorecards.json";
import { AnswerDocument, useAnswerTrace } from "../answer-document";
import { rowLink } from "../describe";
import { Ledger } from "../ledger";
import { AskPeopleProvider, peopleIndex } from "../people-in-facts";
import { TraceProvider } from "../trace";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/ask",
  useSearchParams: () => new URLSearchParams(),
}));

beforeAll(() => {
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

const dataset = buildDataset(Date.parse("2026-11-04T14:30:00Z"));
const ask = (question: string, mentions: string[] = [], comparison: "on" | "off" = "on") =>
  askResponseSchema.parse(JSON.parse(JSON.stringify(askSample(dataset, question, 0, { level: "people", mentions, comparison }))));

function Harness({ response }: { response: AskResponse }) {
  const trace = useAnswerTrace(response);
  const known = peopleIndex(response, directoryJson.people);
  return (
    <AskPeopleProvider resolve={(id) => known.get(id) ?? null}>
      <TraceProvider answerId={response.qa_id} citations={response.citations} order={trace.order}>
        <AnswerDocument response={response} segments={trace.segments} describe={trace.describe} onAsk={vi.fn()} busy={false} />
        <Ledger state={{ kind: "response", response }} />
      </TraceProvider>
    </AskPeopleProvider>
  );
}

const show = (response: AskResponse) => renderKit(<Harness response={response} />);
const before = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

describe("Ask's figures for people (the JO-11 review)", () => {
  it("draws the figures between the words and the closing sentences: words, figures, the decision, the caveat last", () => {
    const response = askResponseSchema.parse(personnelJson);
    show(response);
    const article = screen.getByRole("article");
    const table = within(article).getByRole("table", { name: /next to the whole board/ });
    const decision = within(article).getByText(SCORECARD_SENTENCES.decision);
    const caveat = within(article).getByText(/^Figures from Jira over the last/);
    const words = [...article.querySelectorAll("p")].find((paragraph) => (paragraph.textContent ?? "").includes("next to the board: "))!;
    expect([before(words, table), before(table, decision), before(decision, caveat)]).toEqual([true, true, true]);
    const footer = article.querySelector("footer")!;
    expect(before(caveat, footer)).toBe(true);
  });

  it("labels someone compared on no measure, numbers no one, and marks a ratio on too few tickets", () => {
    const response = askResponseSchema.parse(comparisonJson);
    const facts = response.facts[0];
    // As the service sends someone compared on no measure (the demo's part-timer): standing "Too few tickets".
    const nobody = { ...facts.rows[0], closer: 0, further: 0, level: 0, compared: 0, too_few: 6, standing: "Too few tickets" };
    const shaped = { ...response, facts: [{ ...facts, rows: [...facts.rows.slice(1), nobody] }] };
    show(shaped);
    const table = screen.getByRole("table", { name: /everyone, by the measures on which each is closer/ });
    const rows = within(table).getAllByRole("row").slice(1);
    const last = rows.at(-1)!;
    expect(last).toHaveTextContent("Too few tickets");
    expect(last).not.toHaveTextContent("0 of 0");
    // Nobody is numbered: an order is not a rank, and people level with each other are not first and second.
    expect(rows.map((row) => row.querySelector("th")?.textContent?.match(/^\d/))).toEqual(rows.map(() => null));
    // A ratio on too few open tickets carries the mark, and its counts are there to read.
    const few = facts.rows.findIndex((row) => row.enough === false && row.open_findings_per_10 !== null);
    expect(few).toBeGreaterThanOrEqual(0);
    const fewRow = rows.find((row) => row.getAttribute("data-person") === facts.rows[few].person_id)!;
    expect(fewRow.querySelector('[data-mark="too_few"]')).not.toBeNull();
    expect(fewRow).toHaveTextContent(/\d+ findings? on \d+ open tickets?/);
    // The key is shown, for the marks drawn.
    expect(screen.getAllByText("Too few tickets").length).toBeGreaterThan(1);
  });

  it("puts everyone in order by a count, most first, with no marks and no key", () => {
    show(ask("Who closed the most tickets this month?"));
    const table = screen.getByRole("table", { name: /Done in the period, last 30 days: everyone, most first/ });
    expect(within(table).queryByRole("columnheader", { name: "Next to the board" })).toBeNull();
    expect(document.querySelector("[data-mark]")).toBeNull();
    expect(screen.getByRole("link", { name: /Open on the People page/ })).toHaveAttribute("href", "/people?days=30&sort=done_in_period");
  });

  it("keeps the answer's period and order in its links to the People page", () => {
    const carmen = personIdFor("acc-03");
    const response = ask("Is @Carmen Ruiz doing well this month?", [carmen]);
    show(response);
    expect(screen.getByRole("link", { name: /Open on the People page/ })).toHaveAttribute("href", `/people?days=30&person=${carmen}`);
    // The ledger's rows open the same figures.
    const fact = response.facts[0];
    expect(rowLink(fact, fact.rows[0])?.href).toBe(`/people?days=30&person=${carmen}`);
  });

  it("orders a comparison by a measure on the People page as the answer does", () => {
    show(ask("Rank everyone by reopened work this month"));
    expect(screen.getByRole("link", { name: /Open on the People page/ })).toHaveAttribute("href", "/people?days=30&sort=reopened");
  });

  it("gives each person's one-line summary, and holds the board's column in view", () => {
    const response = askResponseSchema.parse(scorecardsJson);
    show(response);
    const summaries = document.querySelector("[data-scorecard-summaries]")!;
    expect(within(summaries as HTMLElement).getAllByRole("listitem")).toHaveLength(2);
    expect(summaries).toHaveTextContent(/Ada Brooks: (Closer to the process than the board on \d+ of \d+ measures?|Too few tickets to compare)/);
    const table = screen.getByRole("table", { name: /Ada Brooks, Carmen Ruiz, last 90 days/ });
    expect(within(table).getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["Measure", "Ada Brooks", "Carmen Ruiz", "Whole board"]);
    // The board's figures are held at the right edge while the people's scroll (data-board-cell, sticky in the CSS).
    expect(within(table).getByRole("columnheader", { name: "Whole board" })).toHaveAttribute("data-board-cell");
    expect(table.querySelectorAll("tbody td[data-board-cell]").length).toBeGreaterThan(0);
    // A reason the board cannot show a measure stays within the frame's width, whatever the columns.
    const reason = within(table).getAllByText(/This board/)[0].closest("td")!;
    expect(reason.querySelector(".max-w-\\[17rem\\]")).not.toBeNull();
  });

  it("says a decline is one in the foot and in the ledger, never 'not understood'", () => {
    show(ask("Who is best on the board? Rank the others", [], "off"));
    const article = screen.getByRole("article");
    expect(within(article.querySelector("footer")!).getByText("Turned down: comparing people is off here")).toBeInTheDocument();
    expect(within(article).queryByText("Not understood")).toBeNull();
    expect(screen.getByRole("complementary", { name: "Sources" })).toHaveTextContent("Nothing was read. Comparing people is off.");
  });
});
