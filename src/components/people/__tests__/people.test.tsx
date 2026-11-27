import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderKit } from "@/components/ui/__tests__/kit";
import { peopleScorecardSchema, type PeopleScorecard, type ScorecardPerson } from "@/lib/api/schemas";

import directoryJson from "../../../../docs/sample-responses/people-directory.json";
import offJson from "../../../../docs/sample-responses/people-scorecard-off.json";
import personJson from "../../../../docs/sample-responses/people-scorecard-person.json";
import everyoneJson from "../../../../docs/sample-responses/people-scorecard.json";
import { figureText, firstOrder, markOf, measureLink, orderLabel, sortPeople, standingOf, standingText } from "../model";
import { PeopleView } from "../people-view";
import { Scorecard, ScorecardSkeleton } from "../scorecard";

const everyone = peopleScorecardSchema.parse(everyoneJson);
const onePerson = peopleScorecardSchema.parse(personJson);
const off = peopleScorecardSchema.parse(offJson);
const measure = (key: string) => everyone.measures.find((candidate) => candidate.key === key)!;
const row = (name: string): ScorecardPerson => everyone.people.find((candidate) => candidate.person.name === name)!;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the figures in words", () => {
  it("writes a rate as a whole percentage and its counts, a count alone, the ratio to one decimal", () => {
    const carmen = row("Carmen Ruiz");
    expect(figureText(measure("estimated_before_start"), carmen.values.estimated_before_start, "en-GB")).toEqual({
      value: `${carmen.values.estimated_before_start.value}%`,
      detail: `${carmen.values.estimated_before_start.numerator} of ${carmen.values.estimated_before_start.denominator}`,
      spoken: `${carmen.values.estimated_before_start.value}%, ${carmen.values.estimated_before_start.numerator} of ${carmen.values.estimated_before_start.denominator}`,
    });
    expect(figureText(measure("open_tickets"), carmen.values.open_tickets, "en-GB")).toMatchObject({ value: String(carmen.values.open_tickets.value), detail: null });
    expect(figureText(measure("open_findings_per_10"), { value: 135.5, numerator: 149, denominator: 11, enough: true, vs_board: "further" }, "en-GB")).toMatchObject({
      value: "135.5",
      detail: "149 findings on 11 open tickets",
    });
    expect(figureText(measure("reopened"), { value: null, numerator: 0, denominator: 0, enough: false, vs_board: null }, "en-GB")).toMatchObject({
      value: "—",
      detail: "0 of 0",
    });
    expect(figureText(measure("code_review"), everyone.board.values.code_review, "en-GB")).toMatchObject({ value: "—", spoken: "not measurable" });
  });

  it("marks a rate or ratio by the service's comparison, too few tickets where it made none, and never a count", () => {
    const carmen = row("Carmen Ruiz");
    expect(markOf(measure("open_tickets"), carmen.values.open_tickets)).toBeNull();
    expect(markOf(measure("code_review"), carmen.values.code_review)).toBeNull();
    expect(markOf(measure("reopened"), { value: 50, numerator: 2, denominator: 4, enough: false, vs_board: null })).toBe("too_few");
    expect(markOf(measure("reopened"), { value: 2, numerator: 1, denominator: 57, enough: true, vs_board: "level" })).toBe("level");
  });

  it("sums a person up in one line: closer on so many of the measures compared", () => {
    expect(standingText({ closer: 5, further: 2, level: 1, compared: 8, tooFew: 0 })).toBe(
      "Closer to the process than the board on 5 of 8 measures; further on 2, level on 1.",
    );
    expect(standingText({ closer: 1, further: 0, level: 0, compared: 1, tooFew: 3 })).toBe("Closer to the process than the board on 1 of 1 measure.");
    expect(standingText({ closer: 0, further: 0, level: 0, compared: 0, tooFew: 7 })).toBe("Too few tickets to compare with the board on any measure.");
    const standing = standingOf(everyone.measures, row("Carmen Ruiz").values);
    expect(standing.compared + standing.tooFew).toBe(everyone.measures.filter((candidate) => candidate.measurable && candidate.kind !== "count").length);
  });

  it("leads each measure to its tickets: Findings by person and rule, or Ask's list of their tickets", () => {
    const carmen = row("Carmen Ruiz").person;
    expect(measureLink(measure("estimated_before_start"), carmen)?.href).toBe(`/findings?rule=R-EST-01&rule=R-EST-02&state=all&person=${carmen.id}`);
    expect(measureLink(measure("stuck_now"), carmen)?.href).toBe(`/findings?rule=W-AGE-01&person=${carmen.id}`);
    expect(measureLink(measure("open_findings_per_10"), carmen)?.href).toBe(`/findings?person=${carmen.id}`);
    expect(measureLink(measure("open_tickets"), carmen)?.href).toBe(`/ask?q=What+is+%40Carmen+Ruiz%27s+backlog%3F&m=${carmen.id}`);
    expect(measureLink(measure("in_progress"), carmen)?.href).toBe(`/ask?q=What+is+%40Carmen+Ruiz+working+on%3F&m=${carmen.id}`);
    // Done in the period opens Ask's list of exactly those tickets, over the scorecard's own period.
    expect(measureLink(measure("done_in_period"), carmen, 30)?.href).toBe(`/ask?q=What+did+%40Carmen+Ruiz+finish+in+the+last+30+days%3F&m=${carmen.id}`);
    expect(measureLink(measure("open_findings_per_10"), carmen)?.label).toBe("Open findings on tickets they hold");
    expect(measureLink(measure("estimated_before_start"), carmen)?.label).toBe("All findings");
    expect(measureLink(measure("estimated_before_start"), carmen, 30)?.description).toMatch(/from any time; this figure counts the last 30 days$/);
    expect(measureLink(measure("stuck_now"), carmen)?.label).toBe("Findings");
    expect(measureLink(measure("code_review"), carmen)).toBeNull();
  });
});

describe("the everyone table's order", () => {
  const names = (rows: ScorecardPerson[]) => rows.map((candidate) => candidate.person.name);
  const enough = (key: "reopened" | "estimated_before_start" | "stuck_now") => everyone.people.filter((candidate) => candidate.values[key].enough);

  it("sorts a rate closer to the process first, whichever way that is, and too few tickets last both ways", () => {
    expect(firstOrder("estimated_before_start")).toBe("desc");
    expect(firstOrder("reopened")).toBe("asc");
    expect(firstOrder("open_tickets")).toBe("desc");
    expect(firstOrder("name")).toBe("asc");
    for (const key of ["estimated_before_start", "stuck_now"] as const) {
      for (const order of ["asc", "desc"] as const) {
        const sorted = sortPeople(everyone.people, key, order);
        const counted = enough(key).length;
        const values = sorted.slice(0, counted).map((candidate) => candidate.values[key].value!);
        expect(values, `${key} ${order}`).toEqual([...values].sort((a, b) => (order === "asc" ? a - b : b - a)));
        expect(sorted.slice(counted).every((candidate) => !candidate.values[key].enough), `${key} ${order}`).toBe(true);
      }
    }
    expect(orderLabel("estimated_before_start", "desc")).toBe("Closer first");
    expect(orderLabel("reopened", "desc")).toBe("Further first");
    expect(orderLabel("open_tickets", "asc")).toBe("Fewest first");
    expect(orderLabel("name", "desc")).toBe("Z to A");
  });

  it("sorts by name, folded for case and accents, either way", () => {
    expect(names(sortPeople(everyone.people, "name", "asc"))).toEqual(names(everyone.people));
    expect(names(sortPeople(everyone.people, "name", "desc"))).toEqual(names(everyone.people).reverse());
  });
});

describe("the scorecard", () => {
  const show = (card: PeopleScorecard, person: ScorecardPerson) =>
    renderKit(
      <Scorecard person={person.person} tickets={person.tickets} values={person.values} board={card.board} measures={card.measures} days={card.period.days} />,
    );

  it("a row per measure, the person's figure beside the board's, the mark in words, the measures it cannot show last", () => {
    const carmen = row("Carmen Ruiz");
    show(everyone, carmen);
    expect(screen.getByRole("heading", { name: "Carmen Ruiz" })).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Carmen Ruiz" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((candidate) => candidate.getAttribute("data-measure"))).toEqual([
      ...everyone.measures.filter((candidate) => candidate.measurable).map((candidate) => candidate.key),
      // Skipped stages are measured on DEMO, as the rules engine measures them; code review is not.
      "code_review",
    ]);
    const notMeasurable = rows.at(-1)!;
    expect(notMeasurable).toHaveAttribute("data-measurable", "false");
    expect(notMeasurable).toHaveTextContent("Not measurable. This board doesn't record code review in Jira.");
    const estimated = rows.find((candidate) => candidate.getAttribute("data-measure") === "estimated_before_start")!;
    const value = carmen.values.estimated_before_start;
    expect(estimated).toHaveTextContent(`${value.value}%`);
    expect(estimated).toHaveTextContent(`${value.numerator} of ${value.denominator}`);
    expect(estimated).toHaveTextContent(`${everyone.board.values.estimated_before_start.numerator} of ${everyone.board.values.estimated_before_start.denominator}`);
    const marks = [...table.querySelectorAll("td [data-mark]")].map((mark) => mark.getAttribute("data-mark"));
    const expected = everyone.measures.flatMap((candidate) => {
      const mark = markOf(candidate, carmen.values[candidate.key]);
      return mark === null ? [] : [mark];
    });
    expect(marks).toEqual(expected);
    expect(screen.getByText(standingText(standingOf(everyone.measures, carmen.values)))).toBeInTheDocument();
    expect(
      screen.getByText(/^Figures from Jira over the last 90 days, next to the whole board\. Tickets count for .+\. Code review isn't recorded/),
    ).toBeInTheDocument();
    // Neutral inks only: never the status colours, which mean breach and resolved.
    expect(table.innerHTML).not.toMatch(/breach|ok-ink|text-ok|warn/);
  });

  it("says too few tickets where it could not compare, and still shows the counts", () => {
    const hana = onePerson.people[0];
    show(onePerson, hana);
    const tooFew = Object.entries(hana.values).filter(([key, value]) => key !== "code_review" && value.value !== null && !value.enough);
    expect(tooFew.length).toBeGreaterThan(0);
    for (const [key, value] of tooFew) {
      const line = document.querySelector(`tr[data-measure="${key}"]`)!;
      expect(line.querySelector('[data-mark="too_few"]')).not.toBeNull();
      expect(line).toHaveTextContent(figureText(measure(key), value, "en-GB").detail!);
    }
  });

  it("for someone with no tickets: says so, and shows nothing as a zero", () => {
    const noor = { person: { id: "p48c4e26bc1d6", name: "Noor Haddad", avatar: null }, tickets: 0, values: Object.fromEntries(everyone.measures.map((candidate) => [candidate.key, { value: null, numerator: null, denominator: null, enough: false, vs_board: null }])) } as ScorecardPerson;
    show(everyone, noor);
    expect(screen.getByText("Noor Haddad has no tickets on this board.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Findings|Tickets/ })).not.toBeInTheDocument();
    expect(document.querySelector("table")!.textContent).not.toMatch(/\b0%/);
  });

  it("loads in its final shape: a row for each measure", () => {
    renderKit(<ScorecardSkeleton />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading the scorecard");
    expect(document.querySelectorAll(".jo-scorecard-skeleton > div")).toHaveLength(12);
  });
});

/* ---------------------------------------------------------------- the page -- */

type Reply = { status?: number; body: unknown };

function stub(route: (url: URL) => Reply) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    const reply = route(url);
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderPage(search = "") {
  let current = new URLSearchParams(search);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderKit(
    <QueryClientProvider client={client}>
      <NuqsTestingAdapter searchParams={search} onUrlUpdate={(event) => (current = new URLSearchParams(event.searchParams))} hasMemory>
        <PeopleView />
      </NuqsTestingAdapter>
    </QueryClientProvider>,
  );
  return { url: () => current };
}

describe("the People page", () => {
  it("with comparison on: everyone in the table; a row opens their scorecard below, and the address keeps it", async () => {
    stub((url) => (url.pathname.endsWith("/people/scorecard") ? { body: everyone } : { status: 404, body: { error: "not_found", message: "no" } }));
    const page = renderPage();
    const table = await screen.findByRole("table", { name: /Everyone with tickets/ });
    const rows = within(table).getAllByRole("row").filter((candidate) => candidate.hasAttribute("data-person"));
    expect(rows).toHaveLength(everyone.people.length);
    expect(screen.getByText("No one chosen yet")).toBeInTheDocument();
    fireEvent.click(rows.find((candidate) => candidate.textContent?.includes("Carmen Ruiz"))!);
    await waitFor(() => expect(page.url().get("person")).toBe(row("Carmen Ruiz").person.id));
    expect(await screen.findByRole("heading", { name: "Carmen Ruiz" })).toBeInTheDocument();
    // The board's own row closes the table.
    expect(within(table).getByText("Whole board")).toBeInTheDocument();
  });

  it("sorts by any column from its header, and the address keeps the sort", async () => {
    stub(() => ({ body: everyone }));
    const page = renderPage();
    const table = await screen.findByRole("table", { name: /Everyone with tickets/ });
    fireEvent.click(within(table).getByRole("button", { name: /Reopened after Done/ }));
    await waitFor(() => expect(page.url().get("sort")).toBe("reopened"));
    const header = within(table).getByRole("columnheader", { name: /Reopened after Done/ });
    expect(header).toHaveAttribute("aria-sort", "ascending");
    fireEvent.click(within(table).getByRole("button", { name: /Reopened after Done/ }));
    await waitFor(() => expect(page.url().get("order")).toBe("desc"));
  });

  it("at phone width, a list with the sort above it: the figure it is sorted by beside each name", async () => {
    stub(() => ({ body: everyone }));
    renderPage("?sort=estimated_before_start");
    const list = await screen.findByRole("list", { name: "Everyone with tickets" });
    const items = within(list).getAllByRole("button");
    const expected = sortPeople(everyone.people, "estimated_before_start", "desc");
    expect(items.map((item) => item.querySelector(".truncate")?.textContent)).toEqual(expected.map((candidate) => candidate.person.name));
    expect(items[0]).toHaveTextContent(`${expected[0].values.estimated_before_start.value}%`);
    const region = document.querySelector('[data-comparison="list"]') as HTMLElement;
    expect(within(region).getByRole("combobox", { name: /Sort by/ })).toBeInTheDocument();
    expect(within(region).getByRole("radiogroup", { name: "Order" })).toBeInTheDocument();
    expect(within(region).getByRole("radio", { name: "Closer first" })).toHaveAttribute("aria-checked", "true");
  });

  it("with comparison off: no table, a person picker from the board, and one person's scorecard", async () => {
    const fetchMock = stub((url) => {
      if (url.pathname.endsWith("/people/directory")) return { body: directoryJson };
      if (url.searchParams.has("person")) return { body: onePerson };
      return { body: off };
    });
    const page = renderPage("?days=30");
    expect(await screen.findByText(/Comparing people is off\. One person at a time/)).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: /Everyone with tickets/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Person: choose someone" }));
    const listbox = await screen.findByRole("listbox", { name: "People on this board" });
    expect(within(listbox).getAllByRole("group").map((group) => group.getAttribute("aria-labelledby") && within(group).getAllByRole("option").length)).toEqual([8, 3]);
    fireEvent.click(within(listbox).getByRole("option", { name: /Hana Mori/ }));
    await waitFor(() => expect(page.url().get("person")).toBe(onePerson.people[0].person.id));
    expect(await screen.findByRole("heading", { name: "Hana Mori" })).toBeInTheDocument();
    const asked = fetchMock.mock.calls.map(([input]) => new URL(String(input), "http://localhost")).filter((url) => url.pathname.endsWith("/people/scorecard"));
    expect(asked.map((url) => url.search)).toEqual(["?days=30", `?days=30&person=${onePerson.people[0].person.id}`]);
  });

  it("says when the figures cannot be loaded, and Try again asks again", async () => {
    let fail = true;
    stub(() => (fail ? { status: 503, body: { error: "upstream_unavailable", message: "Down." } } : { body: everyone }));
    renderPage();
    expect(await screen.findByText("Couldn't load the scorecards")).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(await screen.findByRole("table", { name: /Everyone with tickets/ })).toBeInTheDocument();
  });

  it("says when the person in the address is not on this board", async () => {
    stub((url) => (url.searchParams.has("person") ? { status: 404, body: { error: "not_found", message: "Someone asked for is not on this board." } } : { body: everyone }));
    renderPage("?person=p000000000000");
    expect(await screen.findByText("Not on this board")).toBeInTheDocument();
  });
});
