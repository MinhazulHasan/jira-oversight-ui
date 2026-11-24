import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { toCsv } from "@/components/ui/csv";
import { renderKit } from "@/components/ui/__tests__/kit";
import { ACCESS_ACTIONS, accessLogSchema, usageSchema, type AccessLog } from "@/lib/api/schemas";
import { formatCount, formatDateTime, formatTime } from "@/lib/format";
import { notify } from "@/lib/notify";

import accessLogJson from "../../../../docs/sample-responses/access-log.json";
import directoryJson from "../../../../docs/sample-responses/people-directory.json";
import usageJson from "../../../../docs/sample-responses/usage.json";
import { AccessLogView } from "../access-log-view";
import { ACCESS_LOG_CSV_COLUMNS, addDays, dayIn, detailWords, presetOf, presetPeriod, viewerRole, zoneName } from "../model";
import { resetsAt, UsageView } from "../usage-view";

const log = accessLogSchema.parse(accessLogJson);
/** Text as toHaveTextContent reads it: every run of spaces (a time's narrow no-break space too) as one. */
const spaced = (text: string) => text.replace(/\s+/g, " ");

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
});

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

function render(view: React.ReactNode, search = "") {
  let current = new URLSearchParams(search);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  renderKit(
    <QueryClientProvider client={client}>
      <NuqsTestingAdapter searchParams={search} onUrlUpdate={(event) => (current = new URLSearchParams(event.searchParams))} hasMemory>
        {view}
      </NuqsTestingAdapter>
    </QueryClientProvider>,
  );
  return { url: () => current };
}

/* -------------------------------------------------------------- model --- */

describe("governance's days and words", () => {
  it("counts calendar days in the organisation's zone", () => {
    expect(dayIn("2026-11-04T23:30:00Z", "Europe/London")).toBe("2026-11-04");
    expect(dayIn("2026-07-04T23:30:00Z", "Europe/London")).toBe("2026-07-05");
    expect(dayIn("2026-11-05T03:00:00Z", "America/New_York")).toBe("2026-11-04");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(presetPeriod("7d", "2026-11-04")).toEqual({ from: "2026-10-29", to: "2026-11-04" });
    expect(presetOf({ from: "2026-10-29", to: "2026-11-04" }, "2026-11-04")).toBe("7d");
    expect(presetOf({ from: null, to: null }, null)).toBe("all");
    expect(presetOf({ from: "2026-10-01", to: "2026-10-02" }, "2026-11-04")).toBeNull();
  });

  it("says who read and what the detail adds, plainly", () => {
    const [view, scorecard] = log.entries;
    expect(viewerRole(scorecard)).toBe("Admin");
    expect(viewerRole({ ...scorecard, level: "team" })).toBe("User");
    expect(viewerRole({ ...scorecard, viewer: { hash: "local", name: "Local (sign-in off)" } })).toBe("Sign-in off");
    expect(detailWords(scorecard)).toBe("Last 90 days");
    expect(detailWords(view)).toBe("50 entries");
    expect(detailWords({ ...view, detail: { ...view.detail, entries: 1 } })).toBe("1 entry");
  });

  it("exports in the page's words: the role, and 'Every board' for a read of the log", () => {
    const [view, scorecard] = log.entries;
    const csv = toCsv([view, scorecard, { ...scorecard, level: "team" }], ACCESS_LOG_CSV_COLUMNS).split(/\r?\n/);
    expect(csv[0]).toContain("Role");
    expect(csv[0]).not.toContain("Level");
    expect(csv[1]).toContain(",Admin,Viewed the access log,Every board,");
    expect(csv[2]).toContain(",Admin,Viewed a scorecard,DEMO,");
    expect(csv[3]).toContain(",User,Viewed a scorecard,DEMO,");
  });

  it("names a zone in words once: UTC as UTC, a city's zone by its name", () => {
    expect(zoneName("UTC")).toBe("UTC");
    expect(zoneName("America/Chicago", "en-GB")).toBe("Central Time");
    expect(zoneName("Europe/London", "en-GB")).toBe("United Kingdom Time");
    expect(zoneName("Not/A_Zone")).toBe("A Zone");
  });
});

/* --------------------------------------------------------- access log --- */

function serveLog(pages: Record<string, AccessLog> = { first: log }) {
  return stub((url) => {
    if (url.pathname.endsWith("/people/directory")) return { body: directoryJson };
    if (url.pathname.endsWith("/access-log")) {
      const cursor = url.searchParams.get("cursor");
      return { body: cursor ? pages[cursor] : pages.first };
    }
    return { status: 404, body: { error: "not_found", message: "none" } };
  });
}

const logTable = () => screen.getByRole("table", { name: "Access log" });

describe("the access log page", () => {
  it("lists who read whose figures, newest first, the time in the reader's own zone with the date in full", async () => {
    serveLog();
    render(<AccessLogView />);
    const table = await screen.findByRole("table", { name: "Access log" });
    await within(table).findByText("Viewed a scorecard");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(log.entries.length);
    const time = rows[0].querySelector("time");
    expect(time).toHaveAttribute("datetime", log.entries[0].at);
    expect(time?.textContent).toBe(formatDateTime(log.entries[0].at));
    expect(time?.textContent).toMatch(/2026/);
    expect(within(rows[0]).getByText("Viewed the access log")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Every board")).toBeInTheDocument();
    expect(within(rows[1]).getByRole("button", { name: "Ada Brooks" })).toBeInTheDocument();
    expect(within(rows[1]).getByText("Last 90 days")).toBeInTheDocument();
    // When the list was read, in the reader's zone; no zone is ever named, nor its IANA id.
    const summary = screen.getAllByText(/entries/, { selector: "span[aria-live]" })[0];
    expect(summary).toHaveTextContent(spaced(`newest first, as of ${formatTime(log.meta.generated_at)}.`));
    expect(document.body).not.toHaveTextContent("Europe/London");
    expect(document.body).not.toHaveTextContent(/Times in/);
  });

  it("leaves views of the log itself out unless they are picked, and says so (SQA: its own loads filled the first page)", async () => {
    const fetchMock = serveLog();
    render(<AccessLogView />);
    await within(await screen.findByRole("table", { name: "Access log" })).findByText("Viewed a scorecard");
    const asked = new URL(String(fetchMock.mock.calls.find(([input]) => String(input).includes("access-log"))![0]), "http://localhost");
    expect(asked.searchParams.getAll("action")).toEqual(ACCESS_ACTIONS.filter((action) => action !== "access_log_view"));
    expect(screen.getAllByText(/entries/, { selector: "span[aria-live]" })[0]).toHaveTextContent("Views of this log are left out.");
  });

  it("asks for exactly the actions picked, views of the log included", async () => {
    const fetchMock = serveLog();
    render(<AccessLogView />, "?action=access_log_view");
    await screen.findByRole("table", { name: "Access log" });
    const asked = new URL(String(fetchMock.mock.calls.find(([input]) => String(input).includes("access-log"))![0]), "http://localhost");
    expect(asked.searchParams.getAll("action")).toEqual(["access_log_view"]);
  });

  it("never names the organisation's zone, in the summary or the period menu, nor reads its times in it", async () => {
    const chicago = { ...log, meta: { ...log.meta, report_timezone: "America/Chicago" } };
    serveLog({ first: chicago });
    render(<AccessLogView />);
    const table = await screen.findByRole("table", { name: "Access log" });
    await within(table).findByText("Viewed a scorecard");
    expect(document.body).not.toHaveTextContent(/Central Time|America\/Chicago/);
    // The organisation's zone cuts the days the filters name; a time is still the reader's.
    expect(within(table).getAllByRole("row")[1].querySelector("time")?.textContent).toBe(formatDateTime(log.entries[0].at));
    fireEvent.click(screen.getByRole("button", { name: /^Period:/ }));
    expect((await screen.findAllByText("Period")).length).toBeGreaterThan(0);
    expect(document.body).not.toHaveTextContent("America/Chicago");
  });

  it("offers everyone the whole log holds in its filters, on any board, not only the entries on screen", async () => {
    // A person on another board, and a viewer, that no entry on this page holds.
    const elsewhere = { id: "p0a1b2c3d4e5f", name: "Zainab Okoye", avatar: null };
    const facets = { viewers: [...log.facets!.viewers, { hash: "b".repeat(32), name: "Quinn Harper" }], subjects: [...log.facets!.subjects, elsewhere] };
    serveLog({ first: { ...log, facets } });
    render(<AccessLogView />);
    await within(await screen.findByRole("table", { name: "Access log" })).findByText("Viewed a scorecard");
    fireEvent.click(screen.getByRole("button", { name: /^Whose figures/ }));
    expect(await screen.findByRole("option", { name: "Zainab Okoye" })).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: /^Viewer/ }));
    expect(await screen.findByRole("option", { name: "Quinn Harper" })).toBeInTheDocument();
  });

  it("lists the actions as the page names them: the reads of people's figures, a person card among them, then the log's own", async () => {
    serveLog();
    render(<AccessLogView />);
    await within(await screen.findByRole("table", { name: "Access log" })).findByText("Viewed a scorecard");
    fireEvent.click(screen.getByRole("button", { name: /^Action/ }));
    const menu = await screen.findByRole("listbox");
    expect(within(menu).getAllByRole("option").map((option) => option.textContent)).toEqual([
      "Viewed a scorecard",
      "Compared people",
      "Viewed findings for a person",
      "Asked about people",
      "Viewed a person card",
      "Viewed the access log",
      "Exported the access log",
    ]);
  });

  it("names a person or viewer from the address that the log does not hold in plain words", async () => {
    serveLog({ first: { ...log, entries: [], next_cursor: null } });
    render(<AccessLogView />, `?person=p0123456789ab&viewer=${"0".repeat(32)}`);
    expect((await screen.findAllByText("No reads match these filters")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /^Whose figures/ })).toHaveTextContent("Whose figures Someone not in the log");
    expect(screen.getByRole("button", { name: /^Viewer/ })).toHaveTextContent("Viewer Someone not in the log");
    expect(document.body).not.toHaveTextContent(/filtered by/);
    // Nothing to order, so the summary claims no order.
    const summary = screen.getAllByText(/entries/, { selector: "span[aria-live]" })[0];
    expect(summary).toHaveTextContent(spaced(`0 entries, as of ${formatTime(log.meta.generated_at)}.`));
    expect(summary).not.toHaveTextContent("newest first");
  });

  it("says what it will hold while nothing is recorded, naming only the reads the service records", async () => {
    serveLog({ first: { ...log, entries: [], next_cursor: null } });
    render(<AccessLogView />);
    expect((await screen.findAllByText("Nothing recorded yet")).length).toBeGreaterThan(0);
    const said = screen.getAllByText(/Reads of people's figures will appear here/)[0];
    expect(said).toHaveTextContent("Reads of people's figures will appear here.");
    // Not "every read of a person's figures": the Overview's People panel and the @ list are not recorded.
    expect(document.body).not.toHaveTextContent(/every read of/i);
  });

  it("dims the entries and says it is updating while other filters load, never showing them as the new filter's", async () => {
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), "http://localhost");
        if (url.searchParams.get("viewer")) await held;
        return Response.json(log);
      }),
    );
    render(<AccessLogView />);
    const table = await screen.findByRole("table", { name: "Access log" });
    await within(table).findByText("Viewed a scorecard");
    fireEvent.click(within(table).getAllByRole("button", { name: "Morgan Ellis" })[0]);
    await waitFor(() => expect(screen.getAllByText("Updating…").length).toBeGreaterThan(0));
    expect(table.closest("[aria-busy='true']")).not.toBeNull();
    release?.();
    await waitFor(() => expect(screen.queryAllByText("Updating…")).toHaveLength(0));
    expect(table.closest("[aria-busy='true']")).toBeNull();
  });

  it("refreshes on request: the first page alone read again, so a read made meanwhile shows", async () => {
    const second: AccessLog = { ...log, entries: log.entries.map((entry, index) => ({ ...entry, id: `second${index}`, at: "2026-11-01T09:00:00.000Z" })), next_cursor: null, facets: null };
    const fetchMock = serveLog({ first: log, [log.next_cursor!]: second });
    render(<AccessLogView />);
    fireEvent.click(await screen.findByRole("button", { name: "Show 50 more" }));
    await waitFor(() => expect(within(logTable()).getAllByRole("row")).toHaveLength(1 + log.entries.length * 2));
    const before = fetchMock.mock.calls.length;
    fireEvent.click(screen.getAllByRole("button", { name: "Refresh" })[0]);
    await waitFor(() => expect(within(logTable()).getAllByRole("row")).toHaveLength(1 + log.entries.length));
    const asked = fetchMock.mock.calls.slice(before).map(([input]) => new URL(String(input), "http://localhost"));
    expect(asked).toHaveLength(1);
    expect(asked[0].searchParams.get("cursor")).toBeNull();
  });

  it("shows the local reader once: no 'Sign-in off' under 'Local (sign-in off)'", async () => {
    const local = { ...log.entries[1], viewer: { hash: "local", name: "Local (sign-in off)" } };
    serveLog({ first: { ...log, entries: [local], next_cursor: null } });
    render(<AccessLogView />);
    const table = await screen.findByRole("table", { name: "Access log" });
    const name = await within(table).findByText("Local (sign-in off)");
    expect(within(name.closest("tr")!).queryByText("Sign-in off")).toBeNull();
  });

  it("keeps the count of the rest with the last pill, so a '+n' never wraps onto a line of its own", async () => {
    serveLog();
    render(<AccessLogView />);
    const table = await screen.findByRole("table", { name: "Access log" });
    await within(table).findByText("Viewed a scorecard");
    const many = log.entries.findIndex((entry) => entry.subjects.length > 3);
    const row = within(table).getAllByRole("row").slice(1)[many];
    const count = within(row).getByText(`+${log.entries[many].subjects.length - 3}`);
    const tail = count.closest("[data-subjects-tail]");
    expect(tail).not.toBeNull();
    expect(within(tail as HTMLElement).getAllByRole("button").map((button) => button.textContent)).toEqual([log.entries[many].subjects[2].name]);
  });

  it("filters by a person or a viewer from the row itself, and the address keeps it", async () => {
    serveLog();
    const { url } = render(<AccessLogView />);
    const table = await screen.findByRole("table", { name: "Access log" });
    await within(table).findByText("Viewed a scorecard");
    fireEvent.click(within(within(table).getAllByRole("row")[2]).getByRole("button", { name: "Ada Brooks" }));
    await waitFor(() => expect(url().get("person")).toBe(log.entries[1].subjects[0].id));
    fireEvent.click(within(logTable()).getAllByRole("button", { name: "Morgan Ellis" })[0]);
    await waitFor(() => expect(url().get("viewer")).toBe(log.entries[0].viewer.hash));
    expect(screen.getByRole("button", { name: "Clear filters" })).toBeInTheDocument();
  });

  it("reads the next page from the service's cursor, on request", async () => {
    const second: AccessLog = { ...log, entries: log.entries.map((entry, index) => ({ ...entry, id: `second${index}`, at: "2026-11-01T09:00:00.000Z" })), next_cursor: null };
    const fetchMock = serveLog({ first: log, [log.next_cursor!]: second });
    render(<AccessLogView />);
    const more = await screen.findByRole("button", { name: "Show 50 more" });
    fireEvent.click(more);
    await waitFor(() => expect(within(logTable()).getAllByRole("row")).toHaveLength(1 + log.entries.length * 2));
    const asked = fetchMock.mock.calls.map(([input]) => new URL(String(input), "http://localhost")).filter((url) => url.pathname.endsWith("/access-log"));
    expect(asked.at(-1)?.searchParams.get("cursor")).toBe(log.next_cursor);
    expect(screen.queryByRole("button", { name: "Show 50 more" })).not.toBeInTheDocument();
  });

  it("exports every entry the filters keep as CSV, asking the service for an export, and says it was recorded", async () => {
    const fetchMock = serveLog();
    const ok = vi.spyOn(notify, "ok");
    const created = vi.fn(() => "blob:export");
    Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() });
    render(<AccessLogView />, "?action=scorecard_view");
    await within(await screen.findByRole("table", { name: "Access log" })).findByText("Viewed a scorecard");
    // The table's and the phone list's are one control each; jsdom lays out neither, so both are in the page.
    fireEvent.click(screen.getAllByRole("button", { name: "Export CSV" })[0]);
    await waitFor(() => expect(ok).toHaveBeenCalled());
    const exported = fetchMock.mock.calls.map(([input]) => new URL(String(input), "http://localhost")).find((url) => url.searchParams.get("export") === "true");
    expect(exported?.searchParams.getAll("action")).toEqual(["scorecard_view"]);
    expect(exported?.searchParams.get("limit")).toBe("10000");
    expect(created).toHaveBeenCalled();
    expect(ok.mock.calls[0][1]?.description).toMatch(/saved as/);
  });

  it("says when nothing matches, with the way back, and when nothing is recorded yet", async () => {
    serveLog({ first: { ...log, entries: [], next_cursor: null } });
    render(<AccessLogView />, "?action=access_log_export");
    expect((await screen.findAllByText("No reads match these filters")).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: "Clear filters" }).length).toBeGreaterThan(0);
  });

  it("says inline when the log cannot be read, the service's words included", async () => {
    stub((url) =>
      url.pathname.endsWith("/access-log")
        ? { status: 503, body: { error: "access_log_unavailable", message: "The access log could not record this read, so the figures were not shown." } }
        : { body: directoryJson },
    );
    render(<AccessLogView />);
    expect(await screen.findByText("The access log could not be read")).toBeInTheDocument();
    expect(screen.getByText(/HTTP 503 · access_log_unavailable/)).toBeInTheDocument();
  });
});

/* -------------------------------------------------------------- usage --- */

describe("the usage page", () => {
  it("shows today's figures in plain words and when the day resets, says no budget is set, and lists the last 7 days", async () => {
    stub(() => ({ body: usageJson }));
    render(<UsageView />);
    expect(await screen.findByText(/No daily AI budget is set/)).toBeInTheDocument();
    const tiles = screen.getByRole("region", { name: "Today's figures" });
    expect(within(tiles).getByText("Questions")).toBeInTheDocument();
    expect(tiles).toHaveTextContent(String(usageJson.today.questions));
    // SQA: one figure of AI use in plain words, never "Model calls", "Input tokens" or "Output tokens".
    expect(within(tiles).getByText("AI tokens used")).toBeInTheDocument();
    expect(tiles).toHaveTextContent(formatCount(usageJson.today.input_tokens + usageJson.today.output_tokens));
    expect(document.body).not.toHaveTextContent(/Model calls|Input tokens|Output tokens/);
    // The service's day is a UTC day: when it resets is said in the reader's own time, with no zone named.
    const reset = resetsAt(usageSchema.parse(usageJson))!;
    expect(reset).toBe(new Date(Date.parse(`${usageJson.last_7_days.at(-1)!.date}T00:00:00Z`) + 86_400_000).toISOString());
    expect(screen.getByRole("region", { name: "Today" })).toHaveTextContent(spaced(`Resets at ${formatTime(reset)}.`));
    const days = screen.getByRole("list", { name: "Tokens a day" });
    expect(within(days).getAllByRole("listitem")).toHaveLength(7);
    expect(within(days).getAllByRole("listitem").at(-1)).toHaveTextContent("Today");
  });

  it("with a budget, a meter of how much is used, amber once it is nearly gone", async () => {
    const tokens = usageJson.today.input_tokens + usageJson.today.output_tokens;
    stub(() => ({ body: { ...usageJson, today: { ...usageJson.today, budget_tokens: tokens, budget_used_pct: 100 } } }));
    render(<UsageView />);
    const meter = await screen.findByRole("meter", { name: "Today's AI budget" });
    expect(meter).toHaveAttribute("aria-valuenow");
    expect(screen.getByText(/Used up\./)).toBeInTheDocument();
  });

  it("past the budget, says how far past it: the tokens used and the share, never the budget as if it were the use", async () => {
    // As the service sends it once the last call took the day over: 7,500 tokens on a budget of 5,000.
    stub(() => ({
      body: { ...usageJson, today: { ...usageJson.today, input_tokens: 6000, output_tokens: 1500, budget_tokens: 5000, budget_used_pct: 150 } },
    }));
    render(<UsageView />);
    const meter = await screen.findByRole("meter", { name: "Today's AI budget" });
    expect(meter).toHaveAttribute("aria-valuetext", expect.stringMatching(/^150%, 7,500 of 5,000 tokens$/));
    expect(meter).toHaveAttribute("aria-valuenow", "5000");
    const block = meter.closest("[data-usage-budget]") as HTMLElement;
    expect(block).toHaveTextContent("150%");
    expect(block).toHaveTextContent("7,500 of 5,000 tokens");
    expect(screen.getByText(/Used up\./)).toBeInTheDocument();
  });

  it("says used up by the tokens, as the service does, never by a share rounded to 100%", async () => {
    // 99,960 of 100,000: the service still asks the model, though the share rounds to 100.0.
    stub(() => ({
      body: { ...usageJson, today: { ...usageJson.today, input_tokens: 90_000, output_tokens: 9_960, budget_tokens: 100_000, budget_used_pct: 100 } },
    }));
    render(<UsageView />);
    const block = (await screen.findByRole("meter", { name: "Today's AI budget" })).closest("[data-usage-budget]") as HTMLElement;
    expect(block).not.toHaveTextContent("Used up");
    expect(block).toHaveTextContent("40 tokens left today.");
  });

  it("shows the budget's share once, as a whole percentage, and what is left", async () => {
    stub(() => ({
      body: { ...usageJson, today: { ...usageJson.today, input_tokens: 150_000, output_tokens: 36_000, budget_tokens: 200_000, budget_used_pct: 93 } },
    }));
    render(<UsageView />);
    const block = (await screen.findByRole("meter", { name: "Today's AI budget" })).closest("[data-usage-budget]") as HTMLElement;
    expect(block).toHaveTextContent("14,000 tokens left today.");
    expect(block).not.toHaveTextContent("93.0%");
    expect(block.textContent?.match(/93%/g)).toHaveLength(1);
  });

  it("says plainly when nothing was asked all week, never 'the most on' a day of zero", async () => {
    const zero = usageJson.last_7_days.map((day) => ({ ...day, questions: 0, model_calls: 0, tokens: 0 }));
    stub(() => ({ body: { ...usageJson, today: { ...usageJson.today, questions: 0, model_calls: 0, input_tokens: 0, output_tokens: 0 }, last_7_days: zero } }));
    render(<UsageView />);
    expect(await screen.findByText("No questions in the last 7 days")).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(/the most on/);
  });

  it("with no AI model, says so and counts the questions a day rather than seven zeros of tokens", async () => {
    const days = usageJson.last_7_days.map((day, index) => ({ ...day, questions: index === 2 ? 30 : 4, model_calls: 0, tokens: 0 }));
    stub(() => ({
      body: { ...usageJson, ai_model: "off", today: { ...usageJson.today, questions: 4, model_calls: 0, input_tokens: 0, output_tokens: 0 }, last_7_days: days },
    }));
    render(<UsageView />);
    expect(await screen.findByText(/No AI model is set up/)).toBeInTheDocument();
    expect(screen.queryByText(/No daily AI budget is set\./)).toBeNull();
    const list = screen.getByRole("list", { name: "Questions a day" });
    expect(within(list).getAllByRole("listitem")[2]).toHaveTextContent("30");
    expect(document.body).toHaveTextContent(/54 questions over the last 7 days; the most on/);
    expect(document.body).not.toHaveTextContent(/0 tokens\./);
  });

  it("says inline when usage cannot be loaded", async () => {
    stub(() => ({ status: 503, body: { error: "upstream_unavailable", message: "The oversight service cannot be reached right now." } }));
    render(<UsageView />);
    expect(await screen.findByText("Usage could not be loaded")).toBeInTheDocument();
  });
});

describe("the access log on a phone", () => {
  it("lists one compact entry per read: the action, when, the viewer and board, the people read", async () => {
    serveLog();
    render(<AccessLogView />);
    const list = await screen.findByRole("list", { name: "Access log entries" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(log.entries.length);
    expect(items[1]).toHaveTextContent("Viewed a scorecard");
    expect(items[1]).toHaveTextContent("Last 90 days");
    expect(within(items[1]).getByRole("button", { name: "Morgan Ellis" })).toBeInTheDocument();
    expect(within(items[1]).getByRole("button", { name: "Ada Brooks" })).toBeInTheDocument();
    expect(items[0]).toHaveTextContent("Every board");
  });
});
