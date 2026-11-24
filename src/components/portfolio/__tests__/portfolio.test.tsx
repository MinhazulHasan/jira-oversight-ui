import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import type { ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { findingAgeMs, formatAge } from "@/components/findings/model";
import { boardNavigation } from "@/components/shell/board-switcher";
import { renderKit } from "@/components/ui/__tests__/kit";
import { attentionKey, portfolioSchema, type Portfolio, type PortfolioBoard } from "@/lib/api/schemas";

import portfolioJson from "../../../../docs/sample-responses/portfolio.json";
import {
  attentionAge,
  DEFAULT_SORT,
  firstOrder,
  onReadersClock,
  PORTFOLIO_CSV_COLUMNS,
  portfolioTotals,
  sortBoards,
  sortSummary,
  trendLabels,
  weekChange,
} from "../model";
import { PortfolioView } from "../portfolio-view";

vi.mock("next/link", () => ({
  default: ({ href, children, prefetch, ...rest }: { href: string; children: ReactNode; prefetch?: boolean }) => {
    void prefetch;
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  },
}));

const sample = portfolioSchema.parse(portfolioJson);
/** A board synced in time (the documented sample, pinned to its own clock and read days later, is stale). */
const base = { ...sample.boards[0], stale: false };
/** When the sample's figures were worked out, which a first tracked week is read against. */
const NOW = Date.parse(sample.meta.generated_at);
const DAY = 24 * 60 * 60 * 1000;

function board(key: string, name: string, overrides: Partial<PortfolioBoard> = {}): PortfolioBoard {
  return { ...base, project: { key, name }, ...overrides };
}

/** As the service lists a board that has never synced: zeros it has not measured, and no sprint. */
function neverSynced(key: string, name: string): PortfolioBoard {
  return board(key, name, {
    last_sync_at: null, stale: true, open_tickets: 0, in_progress: 0, open_breaches: 0, open_warnings: 0, new_findings_7d: 0,
    resolved_findings_7d: 0, open_findings_trend: [0, 0, 0, 0, 0, 0, 0, 0], tracking_since: null, active_sprint: false,
    unestimated_in_active_sprint: null, sprint_at_risk: null, top_rule: null,
  });
}

/** Three boards, as the service would list them for an admin: one stale, one with no active sprint. */
const BOARDS: PortfolioBoard[] = [
  board("ALPHA", "Alpha programme", { open_breaches: 12, open_warnings: 40, new_findings_7d: 3, resolved_findings_7d: 9, sprint_at_risk: false }),
  board("BRAVO", "Bravo delivery", { open_breaches: 90, open_warnings: 10, stale: true, last_sync_at: "2026-11-01T09:00:00.000Z" }),
  board("DEMO", "Demo project", { active_sprint: false, sprint_at_risk: null, unestimated_in_active_sprint: null, top_rule: null }),
];
const THREE: Portfolio = {
  meta: { ...sample.meta, projects: ["ALPHA", "BRAVO", "DEMO"] },
  boards: BOARDS,
  attention: sample.attention.slice(0, 3).map((item, index) => ({ ...item, project: ["BRAVO", "DEMO", "ALPHA"][index], issue_key: item.issue_key.replace(/^[A-Z][A-Z0-9_]*/, ["BRAVO", "DEMO", "ALPHA"][index]) })),
  boards_not_synced: 0,
};

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

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.cookie = "jo-board=; path=/; max-age=0";
});

/* -------------------------------------------------------------- model --- */

describe("the Portfolio's clock (JO-14)", () => {
  const SYNCED = Date.parse(base.last_sync_at!);

  it("reads a synced board's staleness on the reader's clock, by the top bar's two hours, and leaves one never synced as served", () => {
    const boards = [board("ALPHA", "Alpha programme", { stale: true }), neverSynced("LATE", "Late")];
    expect(onReadersClock(boards, SYNCED + 2 * 60 * 60 * 1000).map((entry) => entry.stale)).toEqual([false, true]);
    expect(onReadersClock(boards, SYNCED + 2 * 60 * 60 * 1000 + 1).map((entry) => entry.stale)).toEqual([true, true]);
    // Before the reader's clock is known, the service's word stands.
    expect(onReadersClock(boards, null).map((entry) => entry.stale)).toEqual([true, true]);
  });

  it("ages a breach on the Findings clock: to now while fresh, to the last run that saw it once stale", () => {
    const item = { ...sample.attention[0], opened_at: new Date(SYNCED - 10 * DAY).toISOString(), last_seen_at: new Date(SYNCED + 60_000).toISOString() };
    expect(attentionAge(item, base.last_sync_at, SYNCED + 60 * 60 * 1000)).toEqual({ ms: 10 * DAY + 60 * 60 * 1000, atLastSync: false });
    expect(attentionAge(item, base.last_sync_at, SYNCED + 9 * DAY)).toEqual({ ms: 10 * DAY + 60_000, atLastSync: true });
  });
});

describe("the Portfolio's order", () => {
  const keys = (boards: PortfolioBoard[]) => boards.map((entry) => entry.project.key);

  it("sorts each way with a board that has no value last, and ties in the service's order", () => {
    expect(keys(sortBoards(BOARDS, "breaches", "desc", NOW))).toEqual(["DEMO", "BRAVO", "ALPHA"]);
    expect(keys(sortBoards(BOARDS, "breaches", "asc", NOW))).toEqual(["ALPHA", "BRAVO", "DEMO"]);
    expect(keys(sortBoards(BOARDS, "board", "asc", NOW))).toEqual(["ALPHA", "BRAVO", "DEMO"]);
    // DEMO has no active sprint and nothing open by rule: last whichever way.
    expect(keys(sortBoards(BOARDS, "sprint", "desc", NOW)).at(-1)).toBe("DEMO");
    expect(keys(sortBoards(BOARDS, "sprint", "asc", NOW)).at(-1)).toBe("DEMO");
    expect(keys(sortBoards(BOARDS, "top_rule", "asc", NOW)).at(-1)).toBe("DEMO");
    // Equal figures keep the service's order.
    const same = [board("B", "B"), board("A", "A")];
    expect(keys(sortBoards(same, "warnings", "desc", NOW))).toEqual(["B", "A"]);
  });

  it("sorts the sprint column at risk first, then by unestimated work, with no sprint last either way", () => {
    const sprints = [
      board("CALM", "Calm", { sprint_at_risk: false, unestimated_in_active_sprint: 30 }),
      board("NONE", "No sprint", { active_sprint: false, sprint_at_risk: null, unestimated_in_active_sprint: null }),
      board("RISK", "At risk", { sprint_at_risk: true, unestimated_in_active_sprint: 2 }),
      board("QUIET", "Quiet", { sprint_at_risk: false, unestimated_in_active_sprint: 4 }),
      neverSynced("LATE", "Late"),
    ];
    expect(keys(sortBoards(sprints, "sprint", "desc", NOW))).toEqual(["RISK", "CALM", "QUIET", "NONE", "LATE"]);
    expect(keys(sortBoards(sprints, "sprint", "asc", NOW))).toEqual(["QUIET", "CALM", "RISK", "NONE", "LATE"]);
    expect(sortSummary("sprint", "desc")).toBe("sorted by sprint, at risk and most unestimated first");
  });

  it("sorts a board with no figures yet, or in its first tracked week, last on every figure", () => {
    const boards = [
      neverSynced("LATE", "Late"),
      board("NEW", "New board", { tracking_since: new Date(NOW - 2 * DAY).toISOString(), new_findings_7d: 117 }),
      ...BOARDS,
    ];
    expect(keys(sortBoards(boards, "breaches", "asc", NOW)).at(-1)).toBe("LATE");
    expect(keys(sortBoards(boards, "warnings", "desc", NOW)).at(-1)).toBe("LATE");
    // A first week's "change" is every finding, new only because tracking began: not the biggest rise.
    expect(keys(sortBoards(boards, "week", "desc", NOW)).slice(-2)).toEqual(["LATE", "NEW"]);
    expect(keys(sortBoards(boards, "board", "asc", NOW))).toEqual(["ALPHA", "BRAVO", "DEMO", "LATE", "NEW"]);
  });

  it("opens most open breaches first; names and syncs sort A to Z and oldest first on their first press", () => {
    expect(DEFAULT_SORT).toEqual({ sort: "breaches", order: "desc" });
    expect(firstOrder("board")).toBe("asc");
    expect(firstOrder("week")).toBe("desc");
    expect(sortSummary("week", "desc")).toBe("sorted by this week's change, biggest rise first");
  });

  it("adds the boards up, and labels the eight weeks", () => {
    expect(portfolioTotals(BOARDS, NOW)).toMatchObject({ boards: 3, stale: 1, neverSynced: 0, breaches: 12 + 90 + base.open_breaches });
    expect(weekChange(BOARDS[0])).toBe(-6);
    expect(trendLabels(8)).toEqual(["7 weeks ago", "6 weeks ago", "5 weeks ago", "4 weeks ago", "3 weeks ago", "2 weeks ago", "Last week", "This week"]);
  });

  it("never adds a board with no figures as zeros, nor a first week's findings as new", () => {
    const first = board("NEW", "New board", { tracking_since: new Date(NOW - 2 * DAY).toISOString(), new_findings_7d: 117, resolved_findings_7d: 0 });
    const totals = portfolioTotals([...BOARDS, neverSynced("LATE", "Late"), first], NOW);
    expect(totals).toMatchObject({ boards: 4, neverSynced: 1, stale: 1, firstWeek: ["New board"] });
    expect(totals.newFindings).toBe(3 + base.new_findings_7d * 2);
    // The export leaves a board's unmeasured figures blank, never 0.
    const breaches = PORTFOLIO_CSV_COLUMNS.find((column) => column.header === "Open breaches")!;
    expect(breaches.value(neverSynced("LATE", "Late"))).toBeNull();
    expect(PORTFOLIO_CSV_COLUMNS.find((column) => column.header === "Sprint")!.value(neverSynced("LATE", "Late"))).toBe("No figures yet");
  });
});

/* --------------------------------------------------------------- page --- */

function serve(body: unknown, status = 200) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderPage(search = "") {
  let current = new URLSearchParams(search);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = renderKit(
    <QueryClientProvider client={client}>
      <NuqsTestingAdapter searchParams={search} onUrlUpdate={(event) => (current = new URLSearchParams(event.searchParams))} hasMemory>
        <PortfolioView />
      </NuqsTestingAdapter>
    </QueryClientProvider>,
  );
  return { url: () => current, unmount: view.unmount };
}

const table = () => screen.getByRole("table", { name: "Boards" });
/** The table with the boards in it (it stands in its final shape while they load). */
const loaded = () => within(screen.getByRole("table", { name: "Boards" })).findByText("Alpha programme");

/** The reader's clock, as the e2e suite pins it: two minutes after the sample's figures, four after its sync. */
const READ_AT = NOW + 2 * 60 * 1000;

describe("the Portfolio page", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(READ_AT);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("says what is open across the boards in one sentence, and lists them most open breaches first", async () => {
    serve(THREE);
    renderPage();
    await loaded();
    const summary = document.querySelector("[data-portfolio-summary]");
    expect(summary).toHaveTextContent(
      `Across 3 boards: ${12 + 90 + base.open_breaches} open breaches and ${40 + 10 + base.open_warnings} open warnings;`,
    );
    expect(summary).toHaveTextContent("1 board has not synced in the last 2 hours.");
    // One summary: the table above the rows says its order alone, never the count again.
    expect(screen.getByText("Sorted by open breaches, most first.")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/Choose one to open its Overview|3 boards, sorted by/);
    const rows = within(table()).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell")[0].textContent)).toEqual([
      expect.stringContaining("Demo project"),
      expect.stringContaining("Bravo delivery"),
      expect.stringContaining("Alpha programme"),
    ]);
    // Stale shown plainly; the sprint in words; nothing open by rule said so.
    expect(within(rows[1]).getByText("Stale")).toBeInTheDocument();
    expect(within(rows[0]).getAllByText("No active sprint").length).toBeGreaterThan(0);
    expect(within(rows[0]).getByText("Nothing open")).toBeInTheDocument();
    // Never "On track": the sprint-risk rule cannot vouch for a sprint (SQA: one past its end date read so).
    expect(within(rows[2]).getByText("No risk flagged")).toBeInTheDocument();
    expect(screen.queryByText("On track")).toBeNull();
    expect(within(rows[2]).getByText("−6")).toBeInTheDocument();
  });

  it("sorts by a column's header, and keeps the sort in the address", async () => {
    serve(THREE);
    const { url } = renderPage();
    await loaded();
    fireEvent.click(within(table()).getByRole("button", { name: /^Board/ }));
    await waitFor(() => expect(url().get("sort")).toBe("board"));
    expect(url().get("order")).toBe("asc");
    const rows = within(table()).getAllByRole("row").slice(1);
    expect(within(rows[0]).getAllByRole("cell")[0]).toHaveTextContent("Alpha programme");
  });

  it("opens a board's Overview from its row, picking it in the board picker first", async () => {
    serve(THREE);
    const assign = vi.spyOn(boardNavigation, "assign").mockImplementation(() => {});
    renderPage();
    await loaded();
    fireEvent.click(within(table()).getByText("Alpha programme"));
    expect(assign).toHaveBeenCalledWith("/");
    expect(document.cookie).toContain("jo-board=ALPHA");
  });

  it("never opens a board that has not synced yet (it has no Overview), on a desktop or a phone", async () => {
    const never = neverSynced("ECHO", "Echo programme");
    serve({ ...THREE, meta: { ...THREE.meta, projects: [...THREE.meta.projects, "ECHO"] }, boards: [...BOARDS, never] });
    const assign = vi.spyOn(boardNavigation, "assign").mockImplementation(() => {});
    renderPage("?sort=board&order=asc");
    await loaded();
    const name = within(table()).getByText("Echo programme");
    expect(within(table()).getAllByText("Never synced").length).toBe(1);
    // Not dressed as a link: no pointer or hover (data-interactive), no chevron, and it says why it does not open.
    const row = name.closest("tr")!;
    expect(row).not.toHaveAttribute("data-interactive");
    expect(row).toHaveAttribute("title", "Not synced yet: no Overview to open");
    expect(row.querySelector(".jo-row-affordance")).toBeNull();
    expect(within(table()).getByText("Alpha programme").closest("tr")).toHaveAttribute("data-interactive", "true");
    fireEvent.click(name);
    fireEvent.keyDown(row, { key: "Enter" });
    expect(assign).not.toHaveBeenCalled();
    expect(document.cookie).not.toContain("jo-board=ECHO");
    const cards = screen.getByRole("list", { name: "Boards" });
    expect(within(cards).getAllByRole("link").map((link) => link.textContent)).toEqual(["Alpha programme", "Bravo delivery", "Demo project"]);
    expect(within(cards).getByText("Echo programme").closest("a")).toBeNull();
  });

  it("shows a board that has not synced yet with no figures, never as a clean board of zeros", async () => {
    serve({ ...THREE, meta: { ...THREE.meta, projects: [...THREE.meta.projects, "ECHO"] }, boards: [...BOARDS, neverSynced("ECHO", "Echo programme")] });
    renderPage("?sort=breaches&order=asc");
    await loaded();
    const rows = within(table()).getAllByRole("row").slice(1);
    // Fewest breaches first, and still last: it has no figure to sort by.
    const echo = rows.at(-1)!;
    expect(echo).toHaveTextContent("Echo programme");
    expect(within(echo).getAllByText("No figures yet").length).toBeGreaterThanOrEqual(5);
    expect(within(echo).queryByText("0")).toBeNull();
    expect(within(echo).queryByText("Nothing open")).toBeNull();
    expect(within(echo).queryByText(/unestimated/)).toBeNull();
    const summary = document.querySelector("[data-portfolio-summary]");
    expect(summary).toHaveTextContent(`Across 3 boards: ${12 + 90 + base.open_breaches} open breaches`);
    expect(summary).toHaveTextContent("1 board has not synced yet.");
    const cards = screen.getByRole("list", { name: "Boards" });
    expect(within(cards).getByText("No figures yet: the board has not synced.")).toBeInTheDocument();
  });

  it("says a board's first tracked week plainly, as the Overview does, rather than a rise", async () => {
    const first = board("FRESH", "Fresh board", { tracking_since: new Date(NOW - 2 * DAY).toISOString(), new_findings_7d: 117, resolved_findings_7d: 0 });
    serve({ ...THREE, meta: { ...THREE.meta, projects: [...THREE.meta.projects, "FRESH"] }, boards: [...BOARDS, first] });
    renderPage();
    await loaded();
    const row = within(table()).getByText("Fresh board").closest("tr")!;
    expect(within(row).getByText("Tracking since")).toBeInTheDocument();
    expect(within(row).queryByText("+117")).toBeNull();
    expect(within(row).getByText("No earlier week to show")).toBeInTheDocument(); // no 8-week line
    const summary = document.querySelector("[data-portfolio-summary]");
    expect(summary).toHaveTextContent(`${3 + base.new_findings_7d * 2} new`);
    expect(summary).toHaveTextContent("leaving out Fresh board, first tracked this week.");
  });

  it("says what the sprint column knows: no sprint alone, and what is not measured, never a 0", async () => {
    const boards = [
      board("ALPHA", "Alpha programme", { sprint_at_risk: true, unestimated_in_active_sprint: 7 }),
      board("BRAVO", "Bravo delivery", { sprint_at_risk: null, unestimated_in_active_sprint: null }),
      board("DEMO", "Demo project", { active_sprint: false, sprint_at_risk: null, unestimated_in_active_sprint: null }),
    ];
    serve({ ...THREE, boards });
    renderPage("?sort=board&order=asc");
    await loaded();
    const [alpha, bravo, demo] = within(table()).getAllByRole("row").slice(1);
    expect(alpha).toHaveTextContent("At risk");
    expect(alpha).toHaveTextContent("7 unestimated");
    expect(bravo).toHaveTextContent("Risk not measured");
    expect(bravo).toHaveTextContent("Estimates not measured");
    expect(bravo).not.toHaveTextContent("No active sprint");
    expect(demo).toHaveTextContent("No active sprint");
    expect(demo).not.toHaveTextContent("unestimated");
  });

  it("lists the oldest open breaches across the boards, each opening its ticket on its own board", async () => {
    serve(THREE);
    const assign = vi.spyOn(boardNavigation, "assign").mockImplementation(() => {});
    renderPage();
    const list = await screen.findByRole("list", { name: "The oldest open breaches" });
    // The age counts from when the rules first saw each breach, and says so.
    expect(screen.getByText("First seen")).toBeInTheDocument();
    expect(screen.getByText("Seen for")).toBeInTheDocument();
    const links = within(list).getAllByRole("link");
    expect(links).toHaveLength(3);
    expect(links[0]).toHaveAttribute("href", `/issues/${THREE.attention[0].issue_key}`);
    expect(links[0]).toHaveTextContent(THREE.attention[0].title);
    expect(links[0]).toHaveTextContent("Bravo delivery");
    fireEvent.click(links[0]);
    expect(assign).toHaveBeenCalledWith(`/issues/${THREE.attention[0].issue_key}`);
    expect(document.cookie).toContain("jo-board=BRAVO");
  });

  it("lists each ticket and rule once, keyed by that, saying how many open findings it holds when more than one", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const skipped = { ...sample.attention[0], project: "BRAVO", issue_key: "BRAVO-99", rule_id: "R-FLOW-02", title: "Skipped a stage" };
    const attention = [
      { ...skipped, findings: 2 },
      // The same ticket under another rule, and the same rule on other tickets and boards: each its own row.
      { ...skipped, rule_id: "R-EST-01", title: "Work started without an estimate", findings: 1 },
      { ...skipped, project: "ALPHA", issue_key: "ALPHA-99", findings: 3 },
      { ...skipped, project: "DEMO", issue_key: "DEMO-99", findings: 1 },
    ];
    serve({ ...THREE, attention });
    renderPage();
    const list = await screen.findByRole("list", { name: "The oldest open breaches" });
    const rows = within(list).getAllByRole("link");
    expect(rows.map((row) => row.getAttribute("href"))).toEqual(["/issues/BRAVO-99", "/issues/BRAVO-99", "/issues/ALPHA-99", "/issues/DEMO-99"]);
    expect(new Set(attention.map(attentionKey)).size).toBe(attention.length);
    // The count beside the rule, only where there is more than one, its figure in Plex Mono.
    const counts = rows.map((row) => row.querySelector("[data-attention-findings]"));
    expect(counts.map((count) => count?.textContent ?? null)).toEqual(["2 findings", null, "3 findings", null]);
    expect(counts[0]?.querySelector(".mono")).toHaveTextContent(/^2$/);
    expect(counts[0]).toHaveAttribute("title", "2 open findings of this rule on BRAVO-99.");
    // The title gives way to the count, not the other way round.
    expect(within(rows[0]).getByTitle("Skipped a stage")).toHaveClass("truncate");
    // No row keyed twice (React's duplicate-key warning goes to console.error), and nothing else said there either.
    expect(errors.mock.calls.flat().map(String).filter((message) => /same key/.test(message))).toEqual([]);
    expect(errors).not.toHaveBeenCalled();
  });

  it("refuses a body naming one ticket and rule twice, rather than show what reads as a duplicate", async () => {
    const twice = { ...sample.attention[0], project: "BRAVO", issue_key: "BRAVO-99", rule_id: "R-FLOW-02", findings: 1 };
    expect(portfolioSchema.safeParse({ ...THREE, attention: [twice, twice] }).success).toBe(false);
    expect(portfolioSchema.safeParse({ ...THREE, attention: [{ ...twice, findings: 0 }] }).success).toBe(false);
    expect(portfolioSchema.safeParse({ ...THREE, attention: [twice, { ...twice, rule_id: "R-EST-01" }] }).success).toBe(true);
    serve({ ...THREE, attention: [twice, twice] });
    renderPage();
    expect(await screen.findByText("The portfolio could not be loaded")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "The oldest open breaches" })).toBeNull();
  });

  it("reads each board's staleness on the reader's clock, by the top bar's rule, whatever the service's clock said (JO-14)", async () => {
    serve({ ...THREE, boards: [board("ALPHA", "Alpha programme", { stale: true }), board("BRAVO", "Bravo delivery", { stale: true }), board("DEMO", "Demo project", { stale: true })] });
    renderPage();
    await loaded();
    expect(within(table()).queryByText("Stale")).not.toBeInTheDocument();
    expect(document.querySelector("[data-portfolio-summary]")).not.toHaveTextContent("not synced in the last");
  });

  it("says Stale once the last sync is over the top bar's two hours old on the reader's clock, though the service said fresh", async () => {
    vi.setSystemTime(Date.parse(base.last_sync_at!) + 2 * 60 * 60 * 1000 + 60_000);
    serve({ ...THREE, boards: THREE.boards.map((entry) => ({ ...entry, stale: false })) });
    renderPage();
    await loaded();
    // ALPHA and DEMO synced with the sample; BRAVO three days before.
    expect(within(table()).getAllByText("Stale")).toHaveLength(3);
    expect(document.querySelector("[data-portfolio-summary]")).toHaveTextContent("3 boards have not synced in the last 2 hours.");
  });

  it("ages each breach as Findings ages it: to now while its board is fresh, else as at the last sync, and says so", async () => {
    serve(THREE);
    renderPage();
    const list = await screen.findByRole("list", { name: "The oldest open breaches" });
    const rows = within(list).getAllByRole("link");
    // The first is on BRAVO, last synced three days before: aged as at that sync, as the Findings drawer would say it.
    const [onBravo, onDemo] = THREE.attention;
    const asAtSync = formatAge(findingAgeMs({ first_seen_at: onBravo.opened_at, last_seen_at: onBravo.last_seen_at, resolved_at: null }, null), "en-GB");
    // Testing Library folds the age's no-break space into a plain one before matching.
    expect(rows[0]).toHaveTextContent(`${asAtSync.replace(/\s/g, " ")}at last sync`);
    // The second is on DEMO, fresh: aged to the reader's now, with nothing said.
    const toNow = formatAge(findingAgeMs({ first_seen_at: onDemo.opened_at, last_seen_at: onDemo.last_seen_at, resolved_at: null }, READ_AT), "en-GB");
    expect(rows[1]).toHaveTextContent(toNow.replace(/\s/g, " "));
    expect(rows[1]).not.toHaveTextContent("at last sync");
  });

  it("on a phone, a card per board with the sort above, each opening the board", async () => {
    serve(THREE);
    renderPage("?sort=board&order=asc");
    const cards = await screen.findByRole("list", { name: "Boards" });
    const links = within(cards).getAllByRole("link");
    // Each card is named by its board, the link its name, the card's whole area pressing it.
    expect(links.map((link) => link.textContent)).toEqual(["Alpha programme", "Bravo delivery", "Demo project"]);
    expect(screen.getByRole("combobox", { name: "Sort by" })).toHaveTextContent("Board, A to Z");
  });

  it("says calmly when no board is open to the reader", async () => {
    serve({ ...THREE, boards: [], attention: [] });
    renderPage();
    expect((await screen.findAllByText("No boards yet")).length).toBeGreaterThan(0);
  });

  it("never says no breach is open beside a board that shows open breaches", async () => {
    // Breaches open, but none on a ticket (all on sprints): not "No open breaches on any board".
    serve({ ...THREE, attention: [] });
    const { unmount } = renderPage();
    expect(await screen.findByText("No open breach is on a ticket")).toBeInTheDocument();
    expect(screen.queryByText("No open breaches on any board")).toBeNull();
    unmount();
    const clean = BOARDS.map((entry) => ({ ...entry, open_breaches: 0 }));
    serve({ ...THREE, boards: clean, attention: [] });
    renderPage();
    expect(await screen.findByText("No open breaches on any board")).toBeInTheDocument();
  });

  it("says inline when the Portfolio cannot be loaded, with a way to try again", async () => {
    const fetchMock = serve({ error: "upstream_unavailable", message: "The oversight service cannot be reached right now." }, 503);
    renderPage();
    expect(await screen.findByText("The portfolio could not be loaded")).toBeInTheDocument();
    serve(THREE);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("table", { name: "Boards" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalled();
  });
});
