import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { FilterBar } from "@/components/findings/filter-bar";
import { PeopleLevelProvider } from "@/components/shell/people-level";
import { renderKit } from "@/components/ui/__tests__/kit";
import { notify } from "@/lib/notify";
import { peopleScorecardSchema, scorecardCaveat, type DirectoryEntry, type PeopleScorecard, type ScorecardValue } from "@/lib/api/schemas";

import findingsSample from "../../../../docs/sample-responses/findings.json";
import directoryJson from "../../../../docs/sample-responses/people-directory.json";
import everyoneJson from "../../../../docs/sample-responses/people-scorecard.json";
import { Comparison } from "../comparison";
import { PeopleView } from "../people-view";
import { PersonPicker } from "../person-picker";
import { Scorecard } from "../scorecard";

/*
 * The JO-11 review's findings on the People page, each with the test that
 * would have caught it (12 Nov 2026): the caveat and the marks' key on the
 * default view; marks told apart by shape; someone compared on nothing said
 * so on a phone; the board's line a sentence; the copy right at every width;
 * skeletons in their final shape, sections and all; an error that does not
 * leave a loading bar; a stale scorecard marked; a choice acknowledged; a
 * link landing on the scorecard; a measure's definition a press away; the
 * picker's states outside its listbox and free of axe violations; and
 * "View scorecard" never naming someone wrongly while the findings load.
 */

vi.mock("@/lib/notify", () => ({ notify: { info: vi.fn(), ok: vi.fn(), warn: vi.fn(), cite: vi.fn(), error: vi.fn() } }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const everyone = peopleScorecardSchema.parse(everyoneJson);
const directory = directoryJson.people as DirectoryEntry[];
const CARMEN = everyone.people.find((row) => row.person.name === "Carmen Ruiz")!.person.id;

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
beforeEach(() => vi.mocked(notify.info).mockClear());
afterEach(() => vi.unstubAllGlobals());

type Reply = { status?: number; body: unknown } | Promise<never>;

function stub(route: (url: URL) => Reply) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const reply = route(new URL(String(input), "http://localhost"));
      if (reply instanceof Promise) return reply;
      return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200, headers: { "content-type": "application/json" } });
    }),
  );
}

function renderPage(search = "") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderKit(
    <QueryClientProvider client={client}>
      <NuqsTestingAdapter searchParams={search} hasMemory>
        <PeopleView />
      </NuqsTestingAdapter>
    </QueryClientProvider>,
  );
}

/** Someone compared with the board on no measure: every rate and the ratio rests on too few tickets. */
function partTimer(data: PeopleScorecard): PeopleScorecard {
  const [first, ...rest] = data.people;
  const values = { ...first.values };
  for (const measure of data.measures) {
    if (measure.measurable && measure.kind !== "count") {
      values[measure.key] = { value: 50, numerator: 1, denominator: 2, enough: false, vs_board: null } satisfies ScorecardValue;
    }
  }
  return { ...data, people: [{ ...first, values }, ...rest] };
}

describe("the People page (the JO-11 review)", () => {
  it("gives the default view the caveat and the marks' key, and copy that fits the table and the list", async () => {
    stub(() => ({ body: everyone }));
    renderPage();
    await screen.findByRole("heading", { name: /Everyone with tickets/ });
    const codeReview = everyone.measures.find((measure) => measure.key === "code_review")!.measurable;
    // No one chosen yet, so the only scorecard caveat on the page is the table's own.
    expect(await screen.findByText(scorecardCaveat(90, codeReview))).toBeInTheDocument();
    // The key's words are on the page, not only in a tooltip.
    const key = screen.getAllByText("Closer to the process").find((element) => !element.closest(".sr-only") && !element.classList.contains("sr-only"));
    expect(key).toBeDefined();
    expect(document.body).toHaveTextContent("Choose someone to open their scorecard");
    expect(document.body).not.toHaveTextContent("Sort by any column");
    expect(screen.getByText(/Choose someone above to see their scorecard/)).toBeInTheDocument();
  });

  it("draws closer and further as shapes told apart at a glance", () => {
    renderKit(<Comparison data={everyone} selectedId={null} onSelect={vi.fn()} sort="name" order="asc" onSort={vi.fn()} />);
    const shape = (mark: string) => document.querySelector(`[data-mark="${mark}"] svg`)?.getAttribute("class") ?? "";
    expect(shape("closer")).toContain("lucide-circle-dot");
    expect(shape("further")).toMatch(/lucide-circle(?!-dot)/);
    expect(shape("further")).not.toContain("circle-dot");
  });

  it("says on a phone that someone was compared on no measure, never 'Closer on 0 of 0', and ends the board's line", () => {
    const data = partTimer(everyone);
    renderKit(<Comparison data={data} selectedId={null} onSelect={vi.fn()} sort="name" order="asc" onSort={vi.fn()} />);
    const list = document.querySelector('[data-comparison="list"]')!;
    const first = list.querySelector(`[data-person="${data.people[0].person.id}"]`)!;
    expect(first).toHaveTextContent("Too few tickets");
    expect(first).not.toHaveTextContent("0 of 0");
  });

  it("writes the board's line on a phone as a sentence before the direction", () => {
    renderKit(<Comparison data={everyone} selectedId={null} onSelect={vi.fn()} sort="reopened" order="asc" onSort={vi.fn()} />);
    const list = document.querySelector('[data-comparison="list"]')!;
    expect(list).toHaveTextContent(/Whole board: [\d.]+%? · [^.]+\. Lower is closer to the process\./);
  });

  it("holds the sections in their final places while the figures load", async () => {
    stub(() => new Promise<never>(() => {}));
    renderPage();
    expect(screen.getByRole("heading", { name: /Everyone with tickets/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Scorecard/ })).toBeInTheDocument();
    // No one chosen: the empty panel, not an 11-row scorecard that then collapses.
    expect(screen.getByText("No one chosen yet")).toBeInTheDocument();
    expect(document.querySelector("[data-board]")).not.toBeNull();
  });

  it("loads a chosen person's scorecard in its final shape, its caveat's place included", () => {
    stub(() => new Promise<never>(() => {}));
    renderPage(`?person=${CARMEN}`);
    const loading = screen.getAllByRole("status").find((status) => status.textContent?.includes("Loading the scorecard"))!;
    expect(loading.lastElementChild).toHaveClass("border-t");
  });

  it("writes the period asked for when the figures could not be loaded, never a loading bar", async () => {
    stub(() => ({ status: 500, body: { error: "internal", message: "no" } }));
    renderPage();
    await screen.findByText("Couldn't load the scorecards");
    const period = screen.getByText("Last 90 days");
    expect(period.closest("p")?.querySelector(".skeleton")).toBeNull();
  });

  it("acknowledges a choice in the table, and lands a link on the scorecard", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      return (this as HTMLElement).id === "scorecard" ? ({ top: 980, bottom: 1700 } as DOMRect) : ({ top: 0, bottom: 0 } as DOMRect);
    });
    stub(() => ({ body: everyone }));
    renderPage(`?person=${CARMEN}`);
    await screen.findByRole("heading", { name: "Carmen Ruiz" });
    await waitFor(() => expect(scroll).toHaveBeenCalled());
    const table = document.querySelector('[data-comparison="table"]')!;
    fireEvent.click(table.querySelector(`tr[data-person="${everyone.people[0].person.id}"]`)!);
    await waitFor(() => expect(notify.info).toHaveBeenCalledWith("Person chosen", expect.objectContaining({ description: expect.stringContaining("scorecard is open below") })));
    vi.restoreAllMocks();
  });

  it("marks the scorecard as another period's while the new period loads", async () => {
    let release: (value: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), "http://localhost");
        if (url.searchParams.get("days") === "30") return new Promise<Response>((resolve) => (release = resolve));
        return new Response(JSON.stringify(everyone), { status: 200, headers: { "content-type": "application/json" } });
      }),
    );
    renderPage(`?person=${CARMEN}`);
    await screen.findByRole("heading", { name: "Carmen Ruiz" });
    fireEvent.click(screen.getByRole("radio", { name: "30 days" }));
    await waitFor(() => expect(document.querySelector('#scorecard [aria-busy="true"]')).not.toBeNull());
    await act(async () => release(new Response(JSON.stringify(everyone), { status: 200, headers: { "content-type": "application/json" } })));
  });

  it("opens a measure's definition with a press, as a disclosure, never a button that does nothing", () => {
    const carmen = everyone.people.find((row) => row.person.id === CARMEN)!;
    renderKit(<Scorecard person={carmen.person} tickets={carmen.tickets} values={carmen.values} board={everyone.board} measures={everyone.measures} days={90} />);
    const name = screen.getByRole("button", { name: /Reopened after Done: what it counts/ });
    expect(name).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(name);
    expect(name).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("dialog")).toHaveTextContent("Tickets done in the period that were reopened.");
  });

  it("keeps the person picker's states outside its listbox, said aloud, and free of axe violations", async () => {
    const check = async () => {
      const results = await axe.run(document.body, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"], rules: { region: { enabled: false } } });
      return results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map((violation) => violation.id);
    };
    const { unmount } = renderKit(<PersonPicker entries={directory} state="success" onRetry={vi.fn()} value={null} onValueChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Person: choose someone/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Search people" }), { target: { value: "zzz" } });
    const listbox = screen.getByRole("listbox", { name: "People on this board" });
    expect(listbox).not.toHaveTextContent("No one");
    expect(screen.getByRole("status")).toHaveTextContent("No one on this board matches that.");
    expect(await check()).toEqual([]);
    unmount();

    const retry = vi.fn();
    renderKit(<PersonPicker entries={undefined} state="error" onRetry={retry} value={null} onValueChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Person: choose someone/ }));
    expect(screen.getByRole("listbox", { name: "People on this board" }).querySelector("button")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Press Enter to retry.");
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Search people" }), { key: "Enter" });
    expect(retry).toHaveBeenCalled();
    expect(await check()).toEqual([]);
  });

  it("names the person 'View scorecard' opens from the board's directory, never 'someone not on this board' while findings load", async () => {
    stub((url) => (url.pathname.endsWith("/people/directory") ? { body: directoryJson } : { status: 500, body: {} }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const filters = { q: "", severity: null, state: "open", rule: [], epic: [], person: [CARMEN], first_seen: "all", sort: "first_seen_at", order: "desc", page: 1 } as const;
    renderKit(
      <QueryClientProvider client={client}>
        <NuqsTestingAdapter searchParams="">
          <PeopleLevelProvider peopleLevel>
            <FilterBar filters={{ ...filters, person: [CARMEN], rule: [], epic: [] }} setFilters={vi.fn()} facets={undefined} />
          </PeopleLevelProvider>
        </NuqsTestingAdapter>
      </QueryClientProvider>,
    );
    expect(screen.getByRole("link", { name: /View scorecard/ })).not.toHaveAccessibleName(/someone not on this board/);
    await waitFor(() => expect(screen.getByRole("link", { name: /View scorecard/ })).toHaveAccessibleName("View scorecard of Carmen Ruiz"));
    expect(findingsSample.facets).toBeDefined();
  });
});
