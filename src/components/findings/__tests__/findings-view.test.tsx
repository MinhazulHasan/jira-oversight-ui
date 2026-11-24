import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { notify } from "@/lib/notify";

import { BREACH_ID, SAMPLE, findingsRequests, renderFindings, stubApi } from "./harness";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The result line, as a screen reader hears it once the list has loaded. */
async function resultLine() {
  return waitFor(() => {
    const line = screen.getAllByRole("status").find((element) => /open|findings|breach|warning/.test(element.textContent ?? ""));
    if (!line) throw new Error("no result line yet");
    return line;
  });
}

async function rows() {
  const table = await screen.findByRole("table", { name: "Findings" });
  await within(table).findAllByText("DEMO-1098");
  return within(table).getAllByRole("row").slice(1);
}

describe("the Findings list", () => {
  it("says what it found, politely, and lists the page", async () => {
    stubApi();
    renderFindings();

    const body = await rows();
    expect(body).toHaveLength(SAMPLE.findings.items.length);
    expect(await resultLine()).toHaveTextContent(/^809 open findings\s*·\s*, 523 breaches$/);

    // The sprint finding names its sprint where an issue would be; every row reads severity, rule and state.
    expect(within(body[0]).getByText("Sprint 26")).toBeInTheDocument();
    expect(within(body[1]).getByText("Breach")).toBeInTheDocument();
    expect(within(body[1]).getByText("R-EST-01")).toBeInTheDocument();
    expect(within(body[1]).getByTitle("Build API rate limiting")).toBeInTheDocument();
    expect(within(body[1]).getByText("Integrations API")).toBeInTheDocument();
    expect(within(body[1]).getByText("4 h")).toBeInTheDocument();
    expect(within(body[1]).getByText("Open")).toBeInTheDocument();
  });

  it("puts the facet counts on the filter choices", async () => {
    stubApi();
    renderFindings();
    await rows();

    expect(screen.getByRole("radio", { name: "Breach, 523" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Warning, 286" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "All, 809" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Resolved, 737" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "All, 1,546" })).toBeInTheDocument();
  });

  it("writes a filter to the URL, starts again at page one and says so", async () => {
    const user = userEvent.setup();
    const fetchMock = stubApi();
    const info = vi.spyOn(notify, "info");
    const view = renderFindings("?page=3");
    await rows();

    await user.click(screen.getByRole("radio", { name: /^Breach/ }));
    await waitFor(() => expect(view.url().get("severity")).toBe("breach"));
    expect(view.url().get("page")).toBeNull();
    expect(info).toHaveBeenCalledWith("Filter applied", expect.objectContaining({ description: "Severity: Breach" }));
    await waitFor(() => expect(findingsRequests(fetchMock).at(-1)?.toString()).toBe("severity=breach"));
  });

  it("chooses rules from a searchable list with their counts", async () => {
    const user = userEvent.setup();
    stubApi();
    const view = renderFindings();
    await rows();

    await user.click(screen.getByRole("button", { name: "Rule Any" }));
    const list = await screen.findByRole("listbox", { name: "Rule" });
    const option = within(list).getByRole("option", { name: /R-EFF-01/ });
    expect(option).toHaveTextContent("Effort far beyond the estimate");
    expect(option).toHaveTextContent("76");
    await user.click(option);
    await waitFor(() => expect(view.url().getAll("rule")).toEqual(["R-EFF-01"]));
  });

  it("filters by a board's own rule from a link (JO-20), and drops an id no rule can have", async () => {
    const fetchMock = stubApi();
    renderFindings("?rule=r-cus-101&rule=R-CUS-1");
    await rows();
    await waitFor(() => expect(findingsRequests(fetchMock).at(-1)?.getAll("rule")).toEqual(["R-CUS-101"]));
  });

  it("offers work outside every epic as “(no epic)”", async () => {
    const user = userEvent.setup();
    stubApi();
    const view = renderFindings();
    await rows();

    await user.click(screen.getByRole("button", { name: "Epic Any" }));
    const list = await screen.findByRole("listbox", { name: "Epic" });
    await user.click(within(list).getByRole("option", { name: /\(no epic\)/ }));
    await waitFor(() => expect(view.url().getAll("epic")).toEqual(["none"]));
  });

  it("searches once typing settles, and clears everything with Clear", async () => {
    const user = userEvent.setup();
    const fetchMock = stubApi();
    const info = vi.spyOn(notify, "info");
    const view = renderFindings("?severity=breach&rule=R-EST-01&sort=severity");
    await rows();

    await user.type(screen.getByRole("searchbox", { name: "Search findings" }), "rate limiting");
    await waitFor(() => expect(view.url().get("q")).toBe("rate limiting"));
    await waitFor(() => expect(findingsRequests(fetchMock).at(-1)?.get("q")).toBe("rate limiting"));
    // One request for the whole phrase, not one per key.
    expect(findingsRequests(fetchMock).filter((search) => search.has("q"))).toHaveLength(1);

    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(view.url().toString()).toBe("sort=severity"));
    expect(info).toHaveBeenLastCalledWith("Filters cleared", expect.anything());
    expect(screen.queryByRole("button", { name: "Clear filters" })).not.toBeInTheDocument();
    // The button went with the filters; focus goes to the search, not to the page.
    expect(screen.getByRole("searchbox", { name: "Search findings" })).toHaveFocus();
  }, 20_000);

  it("sorts through the API: a header click writes the sort and the table keeps the API's order", async () => {
    const user = userEvent.setup();
    const reversed = { ...SAMPLE.findings, items: [...SAMPLE.findings.items].reverse() };
    const fetchMock = stubApi((path, url) => (path === "findings" && url.searchParams.has("sort") ? { body: reversed } : undefined));
    const view = renderFindings();
    await rows();

    expect(screen.getByRole("columnheader", { name: "First seen" })).toHaveAttribute("aria-sort", "descending");
    await user.click(screen.getByRole("button", { name: "Issue" }));
    await waitFor(() => expect(view.url().toString()).toBe("sort=issue_key&order=asc"));
    await waitFor(() => expect(findingsRequests(fetchMock).at(-1)?.toString()).toBe("sort=issue_key&order=asc"));
    expect(screen.getByRole("columnheader", { name: "Issue" })).toHaveAttribute("aria-sort", "ascending");

    const table = screen.getByRole("table", { name: "Findings" });
    await waitFor(() => expect(within(within(table).getAllByRole("row")[1]).queryByText("Sprint 26")).toBeNull());
    expect(within(within(table).getAllByRole("row").at(-1)!).getByText("Sprint 26")).toBeInTheDocument();
  });

  it("opens a row's evidence in the drawer, by the URL", async () => {
    const user = userEvent.setup();
    stubApi();
    const view = renderFindings();
    const body = await rows();

    await user.click(within(body[1]).getByText("R-EST-01"));
    await waitFor(() => expect(view.url().get("finding")).toBe(BREACH_ID));
    const drawer = await screen.findByRole("dialog", { name: "Work started without an estimate" });
    expect(within(drawer).getByText("Why the rule fired")).toBeInTheDocument();
  });

  it("says what was looked at when nothing matches", async () => {
    stubApi((path) =>
      path === "findings" ? { body: { ...SAMPLE.findings, items: [], total: 0, page: 1 } } : undefined,
    );
    renderFindings("?q=zebra&first_seen=7d");

    expect(await screen.findByText("No findings match these filters")).toBeInTheDocument();
    expect(
      screen.getByText("open findings in DEMO, first seen in the last 7 days, matching “zebra”."),
    ).toBeInTheDocument();
    // The way out sits in the empty table as well as at the end of the filter row.
    const table = screen.getByRole("table", { name: "Findings" });
    expect(within(table).getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
  });

  it("offers the last page when the address points past it", async () => {
    stubApi((path) => (path === "findings" ? { body: { ...SAMPLE.findings, items: [], page: 99 } } : undefined));
    renderFindings("?page=99");
    expect(await screen.findByText("Nothing on page 99")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Go to page 33" })).toBeInTheDocument();
  });

  it("keeps a failure inline, with a retry that works", async () => {
    const user = userEvent.setup();
    let down = true;
    stubApi((path) =>
      path === "findings" && down ? { status: 503, body: { error: "upstream_unavailable", message: "Down." } } : undefined,
    );
    renderFindings();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load the findings");
    expect(alert).toHaveTextContent("HTTP 503 · upstream_unavailable");
    down = false;
    await user.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await rows()).toHaveLength(SAMPLE.findings.items.length);
  });
});

describe("First seen and Open for, on one clock", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** A figure read as hours: "6 h" and "6 h ago" are 6, "2 d" is 48; "<1 h" is 0. */
  const hours = (text: string) => {
    const match = /^(<)?([\d,]+)\s(h|d)/.exec(text.trim());
    if (!match) throw new Error(`not an age: ${text}`);
    return match[1] ? 0 : Number(match[2].replace(/,/g, "")) * (match[3] === "d" ? 24 : 1);
  };

  /** Each row's First seen (as it reads, "6 h ago") and Open for, under their headers, and the Open for header. */
  async function ages() {
    const table = await screen.findByRole("table", { name: "Findings" });
    await within(table).findAllByText("DEMO-1098");
    const headers = within(table).getAllByRole("columnheader");
    const first = headers.findIndex((header) => header.textContent === "First seen");
    const open = headers.findIndex((header) => header.textContent?.startsWith("Open for"));
    const rows = within(table)
      .getAllByRole("row")
      .slice(1)
      .map((row) => {
        const cells = within(row).getAllByRole("cell");
        return { first: cells[first].querySelector("time")?.firstChild?.textContent ?? "", open: cells[open].textContent ?? "" };
      });
    return { header: headers[open], rows };
  }

  it("while the board's data is fresh, reads every open finding's age to now: the span First seen says", async () => {
    // Regression: "First seen 6 h ago" beside "Open for 5 h": the age ran to the last rules run and was cut down.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-04T14:32:00.000Z"));
    stubApi();
    renderFindings();
    const { header, rows } = await ages();
    expect(header).toHaveTextContent(/^Open for$/);
    expect(rows).toHaveLength(SAMPLE.findings.items.length);
    expect(rows[2]).toEqual({ first: "6 h ago", open: "6 h" });
    for (const row of rows) {
      const [seen, open] = [hours(row.first), hours(row.open)];
      // One span: the same figure in the same unit, and a day read in hours rounds to the days First seen says.
      if (/h ago$/.test(row.first) === /h$/.test(row.open)) expect(open).toBe(seen);
      else expect(Math.round(open / 24) * 24).toBe(seen);
    }
  });

  it("once the board's data is stale, says the ages are as at the last sync, where First seen reads now", async () => {
    // Regression: "First seen 9 d ago" beside "Open for 2 h", with nothing to say the age stopped at the last sync.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-13T09:00:00.000Z"));
    stubApi();
    renderFindings();
    const { header, rows } = await ages();
    expect(header).toHaveTextContent("Open for at last sync");
    expect(header.querySelector("[title]")?.getAttribute("title")).toMatch(/^As at the last sync, .*2026/);
    expect(rows[0]).toEqual({ first: "9 d ago", open: "2 h" });
    expect(screen.getByRole("columnheader", { name: /^Open for at last sync/ })).toBeInTheDocument();
  });
});

describe("the person view", () => {
  const ADA = "pbc7fe62842ca";

  it("shows each row's assignee by name, Unassigned in the secondary ink, and nobody for a sprint", async () => {
    stubApi();
    renderFindings();
    const body = await rows();

    const header = screen.getByRole("columnheader", { name: "Assignee" });
    // The API cannot sort by assignee, so the header offers no sort.
    expect(header).not.toHaveAttribute("aria-sort");
    expect(within(header).queryByRole("button")).not.toBeInTheDocument();

    expect(within(body[1]).getByText("Grace Lindqvist")).toHaveAttribute("title", "Grace Lindqvist");
    expect(within(body[15]).getByText("Unassigned")).toHaveClass("text-ink-low");
    expect(within(body[0]).getByText("No one: a sprint finding")).toHaveClass("sr-only");
  });

  it("gives a finding whose ticket has left the synced data to no one, not to Unassigned", async () => {
    // As the API sends it: the key kept, the issue's summary, type and assignee gone.
    const items = SAMPLE.findings.items.map((item, index) =>
      index === 15 ? { ...item, issue_summary: null, issue_type: null, assignee: null } : item,
    );
    stubApi((path) => (path === "findings" ? { body: { ...SAMPLE.findings, items } } : undefined));
    renderFindings();
    const body = await rows();
    expect(within(body[15]).queryByText("Unassigned")).not.toBeInTheDocument();
    expect(within(body[15]).getByText("No one: the ticket is no longer in the synced data")).toHaveClass("sr-only");
  });

  it("filters to one person from a searchable menu, Unassigned last, and says so", async () => {
    const user = userEvent.setup();
    const fetchMock = stubApi();
    const info = vi.spyOn(notify, "info");
    const view = renderFindings("?page=2");
    await rows();

    await user.click(screen.getByRole("button", { name: "Person Any" }));
    const list = await screen.findByRole("listbox", { name: "Person" });
    const options = within(list).getAllByRole("option");
    expect(options).toHaveLength(9);
    expect(options[0]).toHaveTextContent(/Ada Brooks\s*149/);
    expect(options.at(-1)).toHaveTextContent(/Unassigned.*16/);

    await user.type(screen.getByRole("combobox", { name: "Search person" }), "ada");
    expect(within(list).getAllByRole("option")).toHaveLength(1);
    await user.keyboard("{Enter}");
    await waitFor(() => expect(view.url().getAll("person")).toEqual([ADA]));
    expect(view.url().get("page")).toBeNull();
    expect(info).toHaveBeenCalledWith("Filter applied", expect.objectContaining({ description: "Person: Ada Brooks" }));
    await waitFor(() => expect(findingsRequests(fetchMock).at(-1)?.getAll("person")).toEqual([ADA]));

    await user.keyboard("{Escape}{Escape}");
    expect(screen.getByRole("button", { name: "Person Ada Brooks" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(view.url().getAll("person")).toEqual([]));
  });

  it("filters to the unassigned tickets", async () => {
    const user = userEvent.setup();
    stubApi();
    const view = renderFindings();
    await rows();

    await user.click(screen.getByRole("button", { name: "Person Any" }));
    const list = await screen.findByRole("listbox", { name: "Person" });
    await user.click(within(list).getByRole("option", { name: /Unassigned/ }));
    await waitFor(() => expect(view.url().getAll("person")).toEqual(["unassigned"]));
  });

  it("reads people from a shared address in any case, drops what cannot be a person, and names the empty result", async () => {
    const fetchMock = stubApi((path) =>
      path === "findings" ? { body: { ...SAMPLE.findings, items: [], total: 0, page: 1 } } : undefined,
    );
    renderFindings(`?person=${ADA.toUpperCase()}&person=acc-01&person=someone%40example.com`);

    expect(await screen.findByText("No findings match these filters")).toBeInTheDocument();
    expect(findingsRequests(fetchMock).at(-1)?.getAll("person")).toEqual([ADA]);
    expect(screen.getByText("open findings in DEMO, assigned to Ada Brooks.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Person Ada Brooks" })).toBeInTheDocument();
  });

  it("opens the Person menu on arrival with menu=person, and drops it from the address once it closes", async () => {
    const user = userEvent.setup();
    const fetchMock = stubApi();
    const view = renderFindings("?state=open&menu=person");

    const list = await screen.findByRole("listbox", { name: "Person" });
    await waitFor(() => expect(within(list).getAllByRole("option")).toHaveLength(9));
    expect(screen.getByRole("combobox", { name: "Search person" })).toHaveFocus();
    // Not a filter: the API never hears of it.
    expect(findingsRequests(fetchMock).every((search) => !search.has("menu"))).toBe(true);

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("listbox", { name: "Person" })).not.toBeInTheDocument());
    await waitFor(() => expect(view.url().get("menu")).toBeNull());
    expect(view.url().get("state")).toBe("open");
  });
});
