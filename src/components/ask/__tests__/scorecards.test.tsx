import { screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { renderKit } from "@/components/ui/__tests__/kit";
import { askResponseSchema, PERSON_ID_PATTERN, SCORECARD_SENTENCES, type AskResponse } from "@/lib/api/schemas";

import directoryJson from "../../../../docs/sample-responses/people-directory.json";
import backlogJson from "../../../../docs/sample-responses/ask-backlog.json";
import comparisonJson from "../../../../docs/sample-responses/ask-comparison.json";
import personJson from "../../../../docs/sample-responses/ask-person.json";
import personnelJson from "../../../../docs/sample-responses/ask-personnel.json";
import scorecardJson from "../../../../docs/sample-responses/ask-scorecard.json";
import scorecardsJson from "../../../../docs/sample-responses/ask-scorecards.json";
import { AnswerDocument, useAnswerTrace } from "../answer-document";
import { AskScorecards } from "../ask-scorecards";
import { Ledger } from "../ledger";
import { AskPeopleProvider, namesForIds, peopleIndex, personColumnsOf } from "../people-in-facts";
import { PlanSteps } from "../plan-steps";
import { comparisonFromFacts, comparisonOrderWords, peoplePageOrder, scorecardsFromFacts } from "../scorecard-facts";
import { TraceProvider } from "../trace";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), back: vi.fn() }),
  usePathname: () => "/ask",
  useSearchParams: () => new URLSearchParams(),
}));

const scorecard = askResponseSchema.parse(scorecardJson);
const scorecards = askResponseSchema.parse(scorecardsJson);
const comparison = askResponseSchema.parse(comparisonJson);
const personnel = askResponseSchema.parse(personnelJson);
const backlog = askResponseSchema.parse(backlogJson);
const onePerson = askResponseSchema.parse(personJson);
const directory = directoryJson.people;

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

function Harness({ response }: { response: AskResponse }) {
  const trace = useAnswerTrace(response);
  const known = peopleIndex(response, directory);
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
const ledger = () => screen.getByRole("complementary", { name: "Sources" });
/** Every person id the page shows as text, anywhere: there must be none. */
const idsShown = () => (document.body.textContent ?? "").match(/\bp[0-9a-f]{12}\b/g) ?? [];

describe("a scorecard answer", () => {
  it("draws the person's figures compact under the words, beside the whole board's, the caveat last", () => {
    show(scorecard);
    const compact = screen.getByRole("table", { name: /Carmen Ruiz, last 90 days, next to the whole board/ });
    const rows = within(compact).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(11);
    expect(rows.at(-1)).toHaveAttribute("data-measure", "code_review");
    expect(rows.at(-1)).toHaveTextContent("This board doesn't record code review in Jira.");
    expect(within(compact).getByRole("columnheader", { name: /Carmen Ruiz/ })).toBeInTheDocument();
    expect(within(compact).getByRole("columnheader", { name: "Whole board" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open on the People page/ })).toHaveAttribute("href", `/people?person=${scorecard.people[0].id}`);
    const paragraphs = scorecard.answer!.split("\n\n");
    expect(paragraphs.at(-1)).toMatch(/^Figures from Jira over the last 90 days/);
    expect(idsShown()).toEqual([]);
  });

  it("sets several people side by side, a column each", () => {
    show(scorecards);
    const compact = screen.getByRole("table", { name: /Ada Brooks, Carmen Ruiz, last 90 days/ });
    expect(within(compact).getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["Measure", "Ada Brooks", "Carmen Ruiz", "Whole board"]);
    expect(idsShown()).toEqual([]);
  });

  it("on a narrow column, stacks one compact card per person, and says once what the board cannot show (G6)", () => {
    const { container } = show(scorecards);
    // Both shapes are drawn; the frame's width (a container query) shows one: the table from 29rem, the cards below.
    const table = container.querySelector("[data-compact-scorecard]")!;
    const stack = container.querySelector("[data-compact-cards]")!;
    expect(table.closest(".hidden")?.className).toMatch(/@min-\[29rem\]:block/);
    expect(stack.className).toMatch(/@min-\[29rem\]:hidden/);
    const cards = [...stack.querySelectorAll("[data-compact-card]")];
    expect(cards.map((card) => card.getAttribute("data-compact-card"))).toEqual(scorecards.people.map((person) => person.id));
    for (const [index, card] of cards.entries()) {
      const name = scorecards.people[index].name;
      expect(card).toHaveAccessibleName(`${name}, last 90 days, next to the whole board`);
      expect(within(card as HTMLElement).getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["Measure", name, "Whole board"]);
      // Only what the board can show, in each card: the rest once, under them all.
      expect(card.querySelector('[data-measurable="false"]')).toBeNull();
    }
    const unmeasured = within(stack as HTMLElement).getByRole("list", { name: "Not measurable on this board" });
    expect(within(unmeasured).getAllByRole("listitem")).toHaveLength(1);
    expect(unmeasured).toHaveTextContent("Code review recorded");
    expect(unmeasured).toHaveTextContent("Not measurable. This board doesn't record code review in Jira.");
  });

  it("a personnel question: the figures, then the decision sentence, to the letter", () => {
    show(personnel);
    expect(screen.getByText(SCORECARD_SENTENCES.decision)).toBeInTheDocument();
    expect(screen.getByRole("table", { name: /Carmen Ruiz, last 90 days/ })).toBeInTheDocument();
  });

  it("everyone in order: the comparison compact, a row each, and no one called best", () => {
    show(comparison);
    const compact = screen.getByRole("table", { name: /everyone, by the measures on which each is closer/ });
    const rows = within(compact).getAllByRole("row").slice(1);
    // The overall order sets each person against the board measure by measure: no board row of its own.
    const named = rows.map((line) => line.querySelector("th .truncate")?.textContent);
    expect(named).toEqual(comparison.people.map((person) => person.name));
    expect(rows[0]).toHaveTextContent(/\d+ of \d+/);
    // The question is the reader's own words; the answer never calls anyone best.
    expect(comparison.answer).not.toMatch(/\bbest\b/i);
    expect(idsShown()).toEqual([]);
  });
});

describe("people by name and picture, never by id", () => {
  it("in the facts table: the name column shows the person with their picture; the id column beside it never shows", () => {
    show(backlog);
    const table = within(ledger()).getByRole("table");
    const headers = within(table).getAllByRole("columnheader").map((header) => header.textContent);
    expect(headers).not.toContain("Person id");
    expect(headers).toContain("Assignee");
    const first = within(table).getAllByRole("row")[1];
    expect(first).toHaveTextContent("Carmen Ruiz");
    expect(first.querySelector(".jo-avatar")).not.toBeNull();
    expect(idsShown()).toEqual([]);
  });

  it("in the plan line and the call: the person's name (and picture in words), never the id", () => {
    show(backlog);
    expect(within(ledger()).getByText("Person's tickets")).toBeInTheDocument();
    const params = ledger().querySelector("p.text-ink-mid") as HTMLElement;
    expect(params).toHaveTextContent("Carmen Ruiz");
    expect(params.querySelector(".jo-avatar")).not.toBeNull();
    expect(idsShown()).toEqual([]);
    const known = peopleIndex(backlog, directory);
    const resolve = (id: string) => known.get(id) ?? null;
    renderKit(
      <AskPeopleProvider resolve={resolve}>
        <PlanSteps plan={backlog.plan} />
      </AskPeopleProvider>,
    );
    expect(namesForIds(`person=${backlog.people[0].id}`, resolve)).toBe("person=@Carmen Ruiz");
    expect(namesForIds("person=p000000000000", resolve)).toBe("person=someone on the board");
  });

  it("in a query the analyst wrote: neither the query nor any id in it is shown (SQA)", () => {
    show(onePerson);
    const sql = String(onePerson.facts[0].params.sql);
    expect(sql).toMatch(new RegExp(PERSON_ID_PATTERN.source.replace(/^\^|\$$/g, "")));
    expect(idsShown()).toEqual([]);
    expect(ledger()).not.toHaveTextContent(/SELECT|FROM /);
  });

  it("knows which columns name people, and which ids to hide", () => {
    expect(personColumnsOf({ columns: [{ key: "person_id", label: "Person id", kind: "text" }, { key: "name", label: "Person", kind: "text" }] })).toEqual({
      named: new Map([["name", "person_id"]]),
      hidden: new Set(["person_id"]),
    });
    expect(personColumnsOf({ columns: [{ key: "assignee_id", label: "Person id", kind: "text" }] })).toEqual({
      named: new Map([["assignee_id", "assignee_id"]]),
      hidden: new Set(),
    });
  });
});

describe("the scorecard facts, read back", () => {
  it("read a scorecard set as people, the board and the measures; anything else as nothing", () => {
    const read = scorecardsFromFacts(scorecard.facts[0])!;
    expect(read.days).toBe(90);
    expect(read.people.map((row) => row.person.name)).toEqual(["Carmen Ruiz"]);
    // Skipped stages are measured where the rules engine measures R-FLOW-02, as on DEMO.
    expect(read.measures.filter((measure) => !measure.measurable).map((measure) => measure.key)).toEqual(["code_review"]);
    expect(read.measures.find((measure) => measure.key === "code_review")?.reason).toBe("This board doesn't record code review in Jira.");
    expect(read.board.open_tickets?.value).toBeGreaterThan(0);
    expect(scorecardsFromFacts(backlog.facts[0])).toBeNull();
    expect(scorecardsFromFacts({ ...scorecard.facts[0], rows: [{ measure: "not_a_measure" }] })).toBeNull();
  });

  it("read a board kept as its own row, as a service may send it", () => {
    const fact = {
      ...scorecard.facts[0],
      rows: [
        { person_id: null, name: "Board", measure: "reopened", value: 2, numerator: 7, denominator: 305, enough: true, vs_board: null },
        { person_id: "p599114b761a6", name: "Carmen Ruiz", measure: "reopened", value: 2, numerator: 1, denominator: 57, enough: true, vs_board: "level" },
      ],
    };
    const read = scorecardsFromFacts(fact)!;
    expect(read.board.reopened).toMatchObject({ value: 2, numerator: 7, denominator: 305 });
    expect(read.people[0].values.reopened).toMatchObject({ vs_board: "level" });
  });

  it("read a comparison in the service's order, the board's row apart", () => {
    const read = comparisonFromFacts(comparison.facts[0])!;
    expect(read.measure).toBeNull();
    expect(read.people.map((row) => row.person.name)).toEqual(comparison.people.map((person) => person.name));
    expect(read.board).toBeNull();
    const byMeasure = comparisonFromFacts({
      ...comparison.facts[0],
      params: { ...comparison.facts[0].params, measure: "reopened" },
      rows: [
        { person_id: "p599114b761a6", name: "Carmen Ruiz", measure: "reopened", value: 2, numerator: 1, denominator: 57, enough: true, vs_board: "level" },
        { person_id: null, name: "Whole board", measure: "reopened", value: 2, numerator: 7, denominator: 305, enough: true, vs_board: null },
      ],
    })!;
    expect(byMeasure.measure?.key).toBe("reopened");
    expect(byMeasure.board).toMatchObject({ value: 2, denominator: 305 });
  });
});

describe("a ranking by a count, read back (JO-12, G5)", () => {
  const row = (person_id: string | null, name: string, value: number) => ({
    person_id, name, measure: "open_tickets", label: "Open tickets", kind: "count", value, numerator: null, denominator: null,
    shown: String(value), enough: true, vs_board: null, standing: null, measurable: true, reason: null,
  });
  const fact = {
    ref: "F1",
    tool: "oversight_people_compare",
    params: { project: "DEMO", measure: "open_tickets", order: "fewest" },
    columns: [],
    rows: [row("pfinn00000001", "Finn Gallagher", 3), row("pdev000000002", "Dev Malhotra", 13), row(null, "Unassigned", 9), row(null, "Whole board", 25)],
    truncated: false,
    as_of: "2026-11-04T14:28:00Z",
    note: null,
  };

  it("keeps the work nobody holds apart from the people and the board, so the rows add up", () => {
    const read = comparisonFromFacts(fact)!;
    expect(read.people.map((entry) => entry.person.name)).toEqual(["Finn Gallagher", "Dev Malhotra"]);
    expect([read.unassigned?.value, read.board?.value]).toEqual([9, 25]);
  });

  it("draws it as a muted row after the people, before the whole board, never ranked among them", () => {
    renderKit(<AskScorecards facts={[fact]} />);
    const rows = within(screen.getByRole("table", { name: /Open tickets: everyone, fewest first/ })).getAllByRole("row").slice(1);
    expect(rows.map((line) => line.textContent)).toEqual(["Finn Gallagher3", "Dev Malhotra13", "Unassigned9", "Whole board25"]);
    expect(rows[2]).toHaveAttribute("data-unassigned");
    // The People page opens in the answer's order: fewest first.
    expect(screen.getByRole("link", { name: /Open on the People page/ })).toHaveAttribute("href", "/people?sort=open_tickets&order=asc");
  });
});

describe("a comparison in the order its question asked (JO-14)", () => {
  const row = (person_id: string | null, name: string, value: number, measure = "reopened", label = "Reopened after Done") => ({
    person_id, name, measure, label, kind: "rate", value, numerator: value, denominator: 100, shown: `${value}% · ${value} of 100`,
    enough: true, vs_board: person_id ? "further" : null, standing: person_id ? "Further from the process" : null, measurable: true, reason: null,
  });
  const compare = (order: string | undefined, measure = "reopened", label = "Reopened after Done") => ({
    ref: "F1",
    tool: "oversight_people_compare",
    params: { project: "DEMO", measure, days: 90, ...(order ? { order } : {}) },
    columns: [],
    rows: [row("pada000000001", "Ada Brooks", 40, measure, label), row("pcar000000002", "Carmen Ruiz", 20, measure, label), row(null, "Whole board", 10, measure, label)],
    truncated: false,
    as_of: "2026-11-04T14:28:00Z",
    note: null,
  });

  it("captions a rate highest first, lowest first or closer to the process first, as the call records it", () => {
    // Regression: every rate was captioned "closer to the process first", even under an answer asked for the most.
    renderKit(<AskScorecards facts={[compare("most")]} />);
    expect(screen.getByRole("table", { name: "Reopened after Done, last 90 days: everyone, highest first" })).toBeVisible();
    // The People page opens in the answer's order: the highest reopened first, the reverse of that column's own.
    expect(screen.getByRole("link", { name: /Open on the People page/ })).toHaveAttribute("href", "/people?sort=reopened&order=desc");
  });

  it("opens the People page in the column's own order where the answer is in it", () => {
    renderKit(<AskScorecards facts={[compare("fewest")]} />);
    expect(screen.getByRole("table", { name: "Reopened after Done, last 90 days: everyone, lowest first" })).toBeVisible();
    // Lowest reopened first is the column's own first order (closer to the process first): nothing to add.
    expect(screen.getByRole("link", { name: /Open on the People page/ })).toHaveAttribute("href", "/people?sort=reopened");
  });

  it("captions the overall order fewest first when the question asked for the fewest", () => {
    const overall = (person_id: string, name: string, closer: number) => ({
      person_id, name, closer, further: 1, level: 0, compared: closer + 1, too_few: 0, open_findings_per_10: 2, open_findings: 2,
      open_tickets: 10, enough: true, standing: null,
    });
    const fact = {
      ...compare("fewest"),
      params: { project: "DEMO", measure: "overall", days: 90, order: "fewest" },
      rows: [overall("pada000000001", "Ada Brooks", 1), overall("pcar000000002", "Carmen Ruiz", 3)],
    };
    renderKit(<AskScorecards facts={[fact]} />);
    expect(screen.getByRole("table", { name: "Last 90 days: everyone, by the measures on which each is closer to the process than the board, fewest first" })).toBeVisible();
    // Overall, the People page has no such column: the link opens everyone, sorted by name as the page opens.
    expect(screen.getByRole("link", { name: /Open on the People page/ })).toHaveAttribute("href", "/people");
  });

  it("reads an older call with no order as closer first, a count's as most first", () => {
    expect(comparisonFromFacts(compare(undefined))!.order).toBe("closer");
    expect(comparisonFromFacts(compare("closer"))!.order).toBe("closer");
    expect(comparisonFromFacts({ ...compare(undefined, "open_tickets", "Open tickets"), rows: compare(undefined).rows.map((line) => ({ ...line, kind: "count" })) })!.order).toBe("most");
    const words = (order: "closer" | "most" | "fewest", key: string) =>
      comparisonOrderWords({ order, measure: comparisonFromFacts(compare(order, key, key))!.measure });
    expect([words("closer", "reopened"), words("most", "reopened"), words("fewest", "reopened")]).toEqual(["closer to the process first", "highest first", "lowest first"]);
    expect([words("most", "open_tickets"), words("fewest", "open_tickets")]).toEqual(["most first", "fewest first"]);
    // The page's sort: left out where it is the column's own first order.
    const page = (order: "closer" | "most" | "fewest", key: string) => peoplePageOrder({ order, measure: comparisonFromFacts(compare(order, key, key))!.measure });
    expect([page("closer", "reopened"), page("most", "reopened"), page("fewest", "reopened")]).toEqual([undefined, "desc", undefined]);
    expect([page("most", "estimated_before_start"), page("fewest", "estimated_before_start")]).toEqual([undefined, "asc"]);
    expect([page("most", "open_tickets"), page("fewest", "open_tickets")]).toEqual([undefined, "asc"]);
  });
});

describe("the people a question mentions, side by side by one measure (the JO-12 check)", () => {
  const row = (person_id: string | null, name: string, value: number, numerator: number, denominator: number) => ({
    person_id, name, measure: "time_logged", label: "Time logged on done work", kind: "rate", value, numerator, denominator,
    shown: `${value}% · ${numerator} of ${denominator}`, enough: true, vs_board: person_id ? "level" : null,
    standing: person_id ? "Level with the board" : null, measurable: true, reason: null,
  });
  const fact = {
    ref: "F1",
    tool: "oversight_people_compare",
    params: { project: "DEMO", measure: "time_logged", days: 90, person_ids: ["pcar000000002", "pada000000001"] },
    columns: [],
    rows: [row("pcar000000002", "Carmen Ruiz", 88, 45, 51), row("pada000000001", "Ada Brooks", 85, 55, 65), row(null, "Whole board", 86, 320, 374)],
    truncated: false,
    as_of: "2026-11-04T14:28:00Z",
    note: null,
  };

  it("says who it compares: those people by name, never everyone", () => {
    // Regression: two people asked about were captioned "Everyone in order" and "...: everyone, ...".
    expect(comparisonFromFacts(fact)!.only).toBe(true);
    expect(comparisonFromFacts({ ...fact, params: { project: "DEMO", measure: "time_logged", days: 90 } })!.only).toBe(false);
    renderKit(<AskScorecards facts={[fact]} />);
    expect(screen.getByText(/^Side by side, last 90 days \(F1\)$/)).toBeVisible();
    expect(screen.queryByText(/Everyone in order/)).toBeNull();
    const table = screen.getByRole("table", { name: "Time logged on done work, last 90 days: Carmen Ruiz and Ada Brooks, closer to the process first" });
    expect(within(table).getAllByRole("row").slice(1).map((line) => line.querySelector("th")?.textContent)).toEqual(["Carmen Ruiz", "Ada Brooks", "Whole board"]);
  });

  it("fits a phone's frame: in a narrow column the headers wrap and each mark is its icon, named all the same", () => {
    // Regression: at 390 px the table was 401 px in a 324 px frame, "Next to the board" cut at the edge.
    renderKit(<AskScorecards facts={[fact]} />);
    const table = screen.getByRole("table", { name: /^Time logged on done work, last 90 days: / });
    for (const header of within(table).getAllByRole("columnheader").slice(1)) expect(header.className).toMatch(/@max-\[29rem\]:whitespace-normal/);
    // Both shapes are drawn; the frame's width (a container query) shows one: the words from 29rem, the icon below.
    const cells = [...table.querySelectorAll("[data-mark-cell]")];
    expect(cells).toHaveLength(2);
    for (const cell of cells) {
      const [words, icon] = [...cell.querySelectorAll("[data-mark]")];
      expect(words.className).toMatch(/(^|\s)hidden(\s|$)/);
      expect(words.className).toMatch(/@min-\[29rem\]:inline-flex/);
      expect(icon.className).toMatch(/@min-\[29rem\]:hidden/);
      expect(icon).toHaveTextContent("Level with the board"); // read out, and in its tooltip
    }
  });
});
