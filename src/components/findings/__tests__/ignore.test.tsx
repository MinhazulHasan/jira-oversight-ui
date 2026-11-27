import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PeopleLevelProvider } from "@/components/shell/people-level";
import { renderKit } from "@/components/ui/__tests__/kit";
import type { Finding, FindingsPage } from "@/lib/api/schemas";
import { notify } from "@/lib/notify";

import { FindingsView } from "../findings-view";
import { BREACH_ID, SAMPLE } from "./harness";

afterEach(() => {
  vi.unstubAllGlobals();
});

const PAGE = SAMPLE.findings as unknown as FindingsPage;
const ITEMS = PAGE.items;
const ON_TICKETS = ITEMS.filter((finding) => finding.issue_key !== null);
const IGNORE_ID = "a1".repeat(16);
const AT = "2026-11-04T14:30:00.000Z";
const META = PAGE.meta;

function ignoredOf(finding: Finding, ignoreId: string | null = IGNORE_ID, scope: "finding" | "ticket" = "finding"): Finding {
  return {
    ...finding,
    state: "ignored",
    resolved_at: AT,
    resolved_why: "ignored",
    ignore: {
      scope,
      rule_id: scope === "ticket" ? null : finding.rule_id,
      reason: "Closed long ago",
      by: "Morgan Ellis",
      at: AT,
      ...(ignoreId ? { ignore_id: ignoreId } : {}),
    },
  };
}

interface Call {
  path: string;
  method: string;
  url: URL;
  body: unknown;
}

/** The API as the sample answers it, the ignore routes too; every call kept, its body read. */
function stubApi(answer: (call: Call) => unknown = () => undefined) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    const path = url.pathname.replace(/^\/api\/oversight\//, "");
    const call = { path, method: init?.method ?? "GET", url, body: init?.body ? JSON.parse(String(init.body)) : null };
    calls.push(call);
    const reply = answer(call) ?? defaultReply(call);
    return new Response(JSON.stringify(reply), { status: 200, headers: { "content-type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

function defaultReply({ path, body }: Call): unknown {
  if (path === "findings") return PAGE;
  if (path === "rules") return SAMPLE.rules;
  if (path === "findings/ignore/preview") {
    const target = (body as { target: { finding_ids?: string[] } }).target;
    const named = target.finding_ids ? ITEMS.filter((finding) => target.finding_ids!.includes(finding.finding_id)) : ON_TICKETS;
    const rules = [...new Set(named.map((finding) => finding.rule_id))];
    return {
      meta: META,
      findings: named.length,
      tickets: new Set(named.map((finding) => finding.issue_key)).size,
      by_rule: rules.map((rule) => ({ rule_id: rule, rule_title: named.find((finding) => finding.rule_id === rule)!.rule_title, findings: named.filter((finding) => finding.rule_id === rule).length })),
      already_ignored: 0,
    };
  }
  if (path === "findings/ignore") return { meta: META, ignored: { findings: 2, tickets: 2 }, ignore_ids: [IGNORE_ID] };
  if (path === "findings/restore") return { meta: META, restored: 1, recheck: { state: "succeeded", started_at: AT, finished_at: AT, message: null } };
  if (path.startsWith("findings/")) {
    const item = ITEMS.find((finding) => finding.finding_id === path.slice("findings/".length));
    if (item) return { meta: META, finding: item, timeline: [] };
  }
  return { meta: META };
}

const bodiesOf = (calls: Call[], path: string) => calls.filter((call) => call.path === path && call.method === "POST").map((call) => call.body);

function renderFindings(search = "", peopleLevel = true) {
  let current = new URLSearchParams(search);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = renderKit(
    <QueryClientProvider client={client}>
      <NuqsTestingAdapter
        searchParams={search}
        onUrlUpdate={(event) => {
          current = new URLSearchParams(event.searchParams);
        }}
        hasMemory
      >
        <PeopleLevelProvider peopleLevel={peopleLevel}>
          <FindingsView />
        </PeopleLevelProvider>
      </NuqsTestingAdapter>
    </QueryClientProvider>,
  );
  return { ...view, url: () => current };
}

async function bodyRows() {
  const table = await screen.findByRole("table", { name: "Findings" });
  await within(table).findAllByText("DEMO-1098");
  return within(table).getAllByRole("row").slice(1);
}

const box = (finding: Finding) => screen.getByRole("checkbox", { name: `Select ${finding.issue_key}, ${finding.rule_title}` });
const bar = () => screen.getByRole("region", { name: "Selected findings" });

describe("selecting findings and ignoring them", { timeout: 30_000 }, () => {
  it("picks rows, says how many, previews them in the dialog and ignores them with the reason, then undoes", async () => {
    const user = userEvent.setup();
    const ok = vi.spyOn(notify, "ok");
    const calls = stubApi();
    renderFindings();
    const rows = await bodyRows();

    // A sprint's finding is on no ticket: nothing to ignore there.
    expect(within(rows[0]).queryByRole("checkbox")).toBeNull();
    const [first, second] = ON_TICKETS;
    await user.click(box(first));
    await user.click(box(second));
    expect(bar()).toHaveTextContent("2 selected");

    await user.click(within(bar()).getByRole("button", { name: "Ignore" }));
    const dialog = await screen.findByRole("dialog", { name: "Ignore 2 findings?" });
    expect(within(dialog).getByRole("radio", { name: "Only these rules" })).toBeChecked();
    await waitFor(() => expect(within(dialog).getByRole("radio", { name: "Only these rules" })).toHaveFocus());
    await waitFor(() => expect(dialog.querySelector("[data-ignore-preview] [role=status]")).toHaveTextContent("2 open findings on 2 tickets"));
    expect(bodiesOf(calls, "findings/ignore/preview").at(-1)).toEqual({ target: { finding_ids: [first.finding_id, second.finding_id] }, scope: "finding" });

    await user.click(within(dialog).getByLabelText(/Reason/));
    await user.paste("Closed before the rules ran");
    await user.click(within(dialog).getByRole("button", { name: "Ignore 2 findings" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Ignore/ })).toBeNull());
    expect(bodiesOf(calls, "findings/ignore")).toEqual([
      { target: { finding_ids: [first.finding_id, second.finding_id] }, scope: "finding", reason: "Closed before the rules ran" },
    ]);
    // The selection is let go once its findings are ignored.
    expect(screen.queryByRole("region", { name: "Selected findings" })).toBeNull();
    const toast = ok.mock.calls.find(([title]) => title === "Ignored 2 findings");
    expect(toast?.[1]).toMatchObject({ description: "On 2 tickets. State: Ignored lists them.", action: { label: "Undo" } });

    act(() => toast?.[1]?.action?.onClick());
    await waitFor(() => expect(bodiesOf(calls, "findings/restore")).toEqual([{ ignore_ids: [IGNORE_ID] }]));
    await waitFor(() => expect(ok).toHaveBeenCalledWith("Undone", expect.anything()));
  });

  it("takes every match at once: the page first, then all that match the filters, as one query", async () => {
    const user = userEvent.setup();
    const calls = stubApi();
    renderFindings("?severity=breach");
    await bodyRows();

    await user.click(screen.getByRole("checkbox", { name: "Select every finding on this page" }));
    expect(bar()).toHaveTextContent(`${ON_TICKETS.length} selected`);
    await user.click(within(bar()).getByRole("button", { name: /Select all.*809 matching/ }));
    expect(bar()).toHaveTextContent("All 809 matching");

    await user.click(within(bar()).getByRole("button", { name: "Ignore" }));
    await screen.findByRole("dialog", { name: /Ignore/ });
    expect(bodiesOf(calls, "findings/ignore/preview").at(-1)).toEqual({ target: { query: { severity: "breach" } }, scope: "finding" });
  });

  it("picks the row in focus with x or Space, and lets go of the selection with Escape", async () => {
    const user = userEvent.setup();
    stubApi();
    renderFindings();
    const rows = await bodyRows();

    act(() => rows[1].focus());
    await user.keyboard("x");
    expect(bar()).toHaveTextContent("1 selected");
    await user.keyboard(" ");
    expect(screen.queryByRole("region", { name: "Selected findings" })).toBeNull();
    await user.keyboard("x");
    expect(bar()).toHaveTextContent("1 selected");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("region", { name: "Selected findings" })).toBeNull();
  });

  it("opens a row's actions with Shift+F10, and the ticket's scope from its second item", async () => {
    const user = userEvent.setup();
    const calls = stubApi();
    renderFindings();
    const rows = await bodyRows();
    const row = rows[1];

    act(() => row.focus());
    await user.keyboard("{Shift>}{F10}{/Shift}");
    const menu = await screen.findByRole("menu");
    await user.click(within(menu).getByRole("menuitem", { name: "Ignore every rule on this ticket" }));
    const dialog = await screen.findByRole("dialog", { name: /Ignore/ });
    expect(within(dialog).getByRole("radio", { name: "Every rule on this ticket" })).toBeChecked();
    expect(within(dialog).getByText(`All of ${ITEMS[1].issue_key}'s findings, now and later.`)).toBeInTheDocument();
    expect(bodiesOf(calls, "findings/ignore/preview").at(-1)).toEqual({ target: { finding_ids: [ITEMS[1].finding_id] }, scope: "ticket" });

    // The other scope asks again.
    await user.click(within(dialog).getByRole("radio", { name: "Only this rule" }));
    await waitFor(() => expect(bodiesOf(calls, "findings/ignore/preview").at(-1)).toMatchObject({ scope: "finding" }));
  });

  it("lists every rule on finished tickets without touching the list: tick to ignore, untick to restore, one Save", async () => {
    const user = userEvent.setup();
    const ok = vi.spyOn(notify, "ok");
    const [first, second] = [...new Set(ON_TICKETS.map((finding) => finding.rule_id))];
    const held = ON_TICKETS.find((finding) => finding.rule_id === second)!;
    const record = {
      ignore_id: "d4".repeat(16),
      scope: "finding",
      issue_key: held.issue_key,
      issue_summary: null,
      issue_type: "Task",
      status: "Done",
      status_category: "done",
      rule_id: second,
      rule_title: held.rule_title,
      findings: 3,
      reason: null,
      by: "Morgan Ellis",
      at: AT,
    };
    const calls = stubApi(({ path }) => (path === "findings/ignored" ? { meta: META, items: [record], total: 1, page: 1, page_size: 100 } : undefined));
    const view = renderFindings("?state=resolved&rule=R-EST-01");
    await bodyRows();

    await user.click(screen.getByRole("button", { name: "Ignore findings on finished tickets…" }));

    const dialog = await screen.findByRole("dialog", { name: "Findings on finished tickets" });
    expect([view.url().get("ticket"), view.url().get("state"), view.url().get("rule")]).toEqual([null, "resolved", "R-EST-01"]);
    // Every rule's open findings on every finished ticket: not the list's filters.
    expect(bodiesOf(calls, "findings/ignore/preview").at(-1)).toEqual({ target: { query: { ticket: "finished" } }, scope: "finding" });
    const ruleBox = (ruleId: string) => within(dialog).getByRole("checkbox", { name: new RegExp(`^${ruleId} `) });
    await waitFor(() => expect(ruleBox(first)).toBeEnabled());
    expect(ruleBox(first)).toHaveAttribute("data-state", "unchecked");
    // Ignored by rule on some finished tickets and still open on others: part ticked.
    expect(ruleBox(second)).toHaveAttribute("data-state", "indeterminate");
    const save = () => within(dialog).getByRole("button", { name: /^(Save|Ignore|Restore)/ });
    expect(save()).toBeDisabled();

    await user.click(ruleBox(first));
    await user.click(ruleBox(second));
    await user.click(ruleBox(second));
    const opened = ON_TICKETS.filter((finding) => finding.rule_id === first).length;
    expect(save()).toHaveTextContent(`Ignore ${opened}, restore 3`);
    await user.click(save());

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Findings on finished tickets" })).toBeNull());
    expect(bodiesOf(calls, "findings/ignore").at(-1)).toEqual({ target: { query: { ticket: "finished", rule: [first] } }, scope: "finding", reason: null });
    expect(bodiesOf(calls, "findings/restore").at(-1)).toEqual({ ignore_ids: [record.ignore_id] });
    expect(ok).toHaveBeenCalledWith("Saved", expect.objectContaining({ description: "2 findings ignored, 3 counting again." }));
  });

  it("offers nothing of it to a reader below the people level", async () => {
    stubApi();
    renderFindings("", false);
    await bodyRows();
    expect(screen.queryAllByRole("checkbox")).toEqual([]);
    expect(screen.queryByRole("button", { name: /^Actions for/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Ignore findings on finished tickets…" })).toBeNull();
  });
});

describe("the Ignored state", () => {
  const ignoredPage = (items: Finding[]): FindingsPage => ({
    ...PAGE,
    items,
    total: items.length,
    facets: { ...PAGE.facets, state: [...PAGE.facets.state.filter((entry) => entry.value !== "ignored"), { value: "ignored", label: "Ignored", count: items.length }] },
  });

  it("marks each ignored row with who, when and why, and restores several after saying what comes back", async () => {
    const user = userEvent.setup();
    const ok = vi.spyOn(notify, "ok");
    const items = [ignoredOf(ON_TICKETS[0], "b2".repeat(16)), ignoredOf(ON_TICKETS[1], "c3".repeat(16), "ticket")];
    const calls = stubApi(({ path }) => (path === "findings" ? ignoredPage(items) : undefined));
    renderFindings("?state=ignored");
    const table = await screen.findByRole("table", { name: "Findings" });

    // The date in the reader's own form: "4 Nov 2026" or "Nov 4, 2026".
    await waitFor(() => expect(within(table).getAllByText(/^Ignored by Morgan Ellis on (4 Nov|Nov 4,) 2026: Closed long ago$/)).toHaveLength(2));
    expect(screen.getByRole("radio", { name: "Ignored, 2" })).toBeChecked();

    await user.click(screen.getByRole("checkbox", { name: "Select every finding on this page" }));
    expect(within(bar()).queryByRole("button", { name: "Ignore" })).toBeNull();
    await user.click(within(bar()).getByRole("button", { name: "Restore" }));
    const dialog = await screen.findByRole("dialog", { name: "Restore 2 findings?" });
    expect(within(dialog).getByText(/ignored with every rule on its ticket/)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Keep ignored" })).toHaveFocus();

    await user.click(within(dialog).getByRole("button", { name: "Restore 2 findings" }));
    await waitFor(() => expect(bodiesOf(calls, "findings/restore")).toEqual([{ ignore_ids: ["b2".repeat(16), "c3".repeat(16)] }]));
    await waitFor(() => expect(ok).toHaveBeenCalledWith("Restored 2 findings", expect.anything()));
  });

  it("looks the ignore up by its ticket when the service gave no id, and restores one at once", async () => {
    const user = userEvent.setup();
    const target = ignoredOf(ON_TICKETS[0], null);
    const calls = stubApi(({ path, url }) => {
      if (path === "findings") return ignoredPage([target]);
      if (path === "findings/ignored") {
        expect(Object.fromEntries(url.searchParams)).toEqual({ q: target.issue_key, page_size: "100" });
        const item = (ruleId: string | null, id: string) => ({
          ignore_id: id,
          scope: ruleId === null ? "ticket" : "finding",
          issue_key: target.issue_key,
          issue_summary: target.issue_summary,
          issue_type: target.issue_type,
          status: "Done",
          status_category: "done",
          rule_id: ruleId,
          rule_title: ruleId === null ? null : target.rule_title,
          findings: 1,
          reason: null,
          by: "Morgan Ellis",
          at: AT,
        });
        return { meta: META, items: [item(null, "d4".repeat(16)), item(target.rule_id, "e5".repeat(16))], total: 2, page: 1, page_size: 100 };
      }
      return undefined;
    });
    renderFindings("?state=ignored");
    const table = await screen.findByRole("table", { name: "Findings" });
    await within(table).findByText(target.issue_key!);
    const rows = within(table).getAllByRole("row");

    act(() => rows[1].focus());
    await user.keyboard("{Shift>}{F10}{/Shift}");
    await user.click(within(await screen.findByRole("menu")).getByRole("menuitem", { name: "Restore" }));

    await waitFor(() => expect(bodiesOf(calls, "findings/restore")).toEqual([{ ignore_ids: ["e5".repeat(16)] }]));
  });
});

describe("the drawer", () => {
  it("ignores the finding it shows, naming its rule and ticket in the choice", async () => {
    const user = userEvent.setup();
    stubApi();
    renderFindings(`?finding=${BREACH_ID}`);
    const panel = await screen.findByRole("dialog", { name: "Work started without an estimate" });

    await user.click(within(panel).getByRole("button", { name: "Ignore" }));

    const dialog = await screen.findByRole("dialog", { name: /Ignore 1 finding\?/ });
    expect(within(dialog).getByRole("radio", { name: "Only this rule" })).toBeChecked();
    expect(within(dialog).getByText("R-EST-01 on DEMO-1098, now and if it fires again.")).toBeInTheDocument();
  });

  it("says who ignored an ignored finding, when and why, and restores it", async () => {
    const user = userEvent.setup();
    const breach = ITEMS.find((finding) => finding.finding_id === BREACH_ID)!;
    const ignored = ignoredOf(breach);
    const calls = stubApi(({ path }) => {
      if (path === `findings/${BREACH_ID}`) return { meta: META, finding: ignored, timeline: [] };
      if (path === "findings") return { ...PAGE, items: ITEMS.map((finding) => (finding.finding_id === BREACH_ID ? ignored : finding)) };
      return undefined;
    });
    renderFindings(`?finding=${BREACH_ID}`);
    const panel = await screen.findByRole("dialog", { name: "Work started without an estimate" });

    const banner = await within(panel).findByText("Ignored by Morgan Ellis on", { exact: false });
    expect(banner.closest("[data-ignored-banner]")).toHaveTextContent("“Closed long ago”");
    expect(within(panel).getByText("Ignored", { selector: "[data-state]" })).toBeInTheDocument();

    await user.click(within(panel).getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(bodiesOf(calls, "findings/restore")).toEqual([{ ignore_ids: [IGNORE_ID] }]));
  });
});
