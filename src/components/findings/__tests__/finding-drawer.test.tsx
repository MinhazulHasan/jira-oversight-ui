import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { notify } from "@/lib/notify";

import { BREACH_ID, SAMPLE, SPRINT_ID, renderFindings, stubApi } from "./harness";

afterEach(() => {
  vi.unstubAllGlobals();
});

const ITEMS = SAMPLE.findings.items;
const lastHistory = (view: ReturnType<typeof renderFindings>) =>
  (view.onUrlUpdate.mock.calls.at(-1)?.[0] as { options?: { history?: string } } | undefined)?.options?.history;

async function drawer(name: string | RegExp) {
  return screen.findByRole("dialog", { name });
}

describe("the evidence drawer", () => {
  it("shows why the rule fired: the claim, the rule, the evidence, the changelog and the escalation", async () => {
    stubApi();
    renderFindings(`?finding=${BREACH_ID}`);
    const panel = await drawer("Work started without an estimate");

    expect(within(panel).getByText("DEMO-1098")).toBeInTheDocument();
    expect(within(panel).getByText("Started on 4 Nov 2026 with no estimate (story points)")).toBeInTheDocument();
    // What the rule fires on comes from the catalogue.
    expect(
      await within(panel).findByText(/entered development \(or a later stage\) and has no estimate/),
    ).toBeInTheDocument();

    const facts = within(panel).getByRole("heading", { name: "Why the rule fired" }).closest("section")!;
    const value = (label: string) => within(facts).getByText(label, { selector: "dt" }).nextElementSibling;
    expect(value("Rule")).toHaveTextContent("R-EST-01 version 0.1.0");
    expect(value("Threshold")).toHaveTextContent("None: the condition alone");
    expect(value("Work started")).toHaveTextContent("To Do → In Progress");
    // The missing estimate is the evidence, so it is said and marked.
    expect(value("Story points")).toHaveTextContent("None");
    expect(value("Story points")?.parentElement).toHaveClass("bg-cite-tint");
    expect(value("Open for")).toHaveTextContent("4 h");
    expect(value("Resolved")).toHaveTextContent("Not yet");

    const changelog = within(panel).getByRole("table", { name: "Changelog entries the rule read on DEMO-1098" });
    const [entry] = within(changelog).getAllByRole("row").slice(1);
    expect(entry).toHaveTextContent("To Do → In Progress");
    expect(entry).toHaveTextContent("318706");

    expect(within(panel).getByText("Warned before")).toBeInTheDocument();
    expect(within(panel).getByText("12 days later")).toBeInTheDocument();
    expect(within(panel).getByRole("button", { name: "Open the warning W-EST-01" })).toBeInTheDocument();

    expect(within(panel).getByRole("heading", { name: "Status timeline" })).toBeInTheDocument();
    expect(within(panel).getByText("on this page", { exact: false })).toHaveTextContent("2 of 25 on this page");
  });

  it("reads the age on the table's clock, so a row and its drawer give one figure; stale, it says as at the last sync", async () => {
    // An hour and a half after the sample's sync (still fresh): DEMO-1098's breach was first seen five and a half
    // hours ago, at 10:29, and last seen at the 14:29 run.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-04T15:59:00.000Z"));
    try {
      stubApi();
      const view = renderFindings(`?finding=${BREACH_ID}`);
      let panel = await drawer("Work started without an estimate");
      const openFor = () => within(panel).getByText("Open for", { selector: "dt" }).nextElementSibling;
      expect(openFor()).toHaveTextContent(/^6\sh$/);
      const table = screen.getByRole("table", { name: "Findings", hidden: true });
      const row = within(table).getAllByRole("row", { hidden: true }).find((candidate) => candidate.textContent?.includes("DEMO-1098"));
      expect(row).toHaveTextContent(/6\sh ago/);
      expect(row).toHaveTextContent(/6\shOpen/);
      view.unmount();

      // Nine days on, the board's data is stale: the age stops at the last run that saw it, and says so.
      vi.setSystemTime(new Date("2026-11-13T09:00:00.000Z"));
      stubApi();
      renderFindings(`?finding=${BREACH_ID}`);
      panel = await drawer("Work started without an estimate");
      expect(openFor()).toHaveTextContent(/^4\sh at last sync$/);
      expect(openFor()?.querySelector("[title]")?.getAttribute("title")).toMatch(/^As at the last sync, /);
    } finally {
      vi.useRealTimers();
    }
  });

  it("steps through the page with Previous, Next, j and k, replacing the finding in the URL", async () => {
    const user = userEvent.setup();
    stubApi();
    const view = renderFindings(`?finding=${BREACH_ID}`);
    const panel = await drawer("Work started without an estimate");

    await user.click(within(panel).getByRole("button", { name: "Next" }));
    await waitFor(() => expect(view.url().get("finding")).toBe(ITEMS[2].finding_id));
    expect(lastHistory(view)).toBe("replace");
    await drawer(ITEMS[2].rule_title);

    await user.keyboard("k");
    await waitFor(() => expect(view.url().get("finding")).toBe(ITEMS[1].finding_id));
    await user.keyboard("k");
    await waitFor(() => expect(view.url().get("finding")).toBe(ITEMS[0].finding_id));
    expect(within(await drawer("Sprint at risk")).getByRole("button", { name: "Previous" })).toBeDisabled();
    await user.keyboard("j");
    await waitFor(() => expect(view.url().get("finding")).toBe(ITEMS[1].finding_id));
  });

  it("closes with Escape, and opens the warning that came first as a step of its own", async () => {
    const user = userEvent.setup();
    stubApi();
    const view = renderFindings(`?finding=${BREACH_ID}&severity=breach`);
    const panel = await drawer("Work started without an estimate");

    await user.click(within(panel).getByRole("button", { name: "Open the warning W-EST-01" }));
    await waitFor(() => expect(view.url().get("finding")).toBe("a59f6d27db353a9c64e3667e6e1e4e86"));
    expect(lastHistory(view)).toBe("push");
    // This stub serves only the first page's findings, so here the warning is one the drawer cannot find.
    expect(await screen.findByText("No finding has that id")).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => expect(view.url().has("finding")).toBe(false));
    expect(view.url().get("severity")).toBe("breach");
  });

  it("shows a sprint finding's sprint, with no issue to open and no timeline", async () => {
    stubApi();
    renderFindings(`?finding=${SPRINT_ID}`);
    const panel = await drawer("Sprint at risk");

    expect(within(panel).getByText("4426")).toBeInTheDocument();
    expect(within(panel).getByText(/reads sprint figures/)).toBeInTheDocument();
    expect(within(panel).queryByRole("heading", { name: "Status timeline" })).not.toBeInTheDocument();
    expect(within(panel).queryByRole("link", { name: /Open issue/ })).not.toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: "Open in Jira" })).not.toBeInTheDocument();
    // "≤ 2 days left, > 30% not started": the days left and the share are what the rule turned on.
    expect(within(panel).getByText("Days left", { selector: "dt" }).parentElement).toHaveClass("bg-cite-tint");
  });

  it("keeps Open in Jira in sample mode, disabled, with the reason on focus", async () => {
    const user = userEvent.setup();
    stubApi();
    renderFindings(`?finding=${BREACH_ID}`);
    const panel = await drawer("Work started without an estimate");

    expect(within(panel).getByRole("link", { name: /Open issue/ })).toHaveAttribute("href", "/issues/DEMO-1098");
    const jira = within(panel).getByRole("button", { name: "Open in Jira" });
    expect(jira).toHaveAttribute("aria-disabled", "true");
    await act(async () => jira.focus());
    await user.keyboard("{Shift>}{Tab}{/Shift}{Tab}");
    expect((await screen.findAllByText("Sample data: no Jira link")).length).toBeGreaterThan(0);
  });

  it("copies a link that reopens this finding, and says so", async () => {
    const user = userEvent.setup();
    stubApi();
    const ok = vi.spyOn(notify, "ok");
    renderFindings(`?finding=${BREACH_ID}&rule=R-EST-01`);
    const panel = await drawer("Work started without an estimate");

    await user.click(within(panel).getByRole("button", { name: "Copy link to this finding" }));
    const copied = await navigator.clipboard.readText();
    expect(new URL(copied).searchParams.get("finding")).toBe(BREACH_ID);
    expect(ok).toHaveBeenCalledWith("Copied link to this finding", expect.anything());
  });

  it("says plainly when a link names no finding", async () => {
    stubApi();
    renderFindings("?finding=not-a-finding");
    const panel = await drawer("Finding not found");
    expect(within(panel).getByText(/That link is not a finding/)).toBeInTheDocument();
  });

  it("waits in the drawer's shape for a finding from another page, and retries a failure", async () => {
    const user = userEvent.setup();
    const id = "f".repeat(32);
    let failing = true;
    stubApi((path) => {
      if (path !== `findings/${id}`) return undefined;
      if (failing) return { status: 500, body: { error: "upstream_error", message: "Broken." } };
      return { body: { ...SAMPLE.finding, finding: { ...SAMPLE.finding.finding, finding_id: id } } };
    });
    renderFindings(`?finding=${id}`);

    const panel = await drawer("Couldn't load the finding");
    expect(within(panel).getByText("HTTP 500 · upstream_error")).toBeInTheDocument();
    expect(within(panel).getByText("Not on this page of the list")).toBeInTheDocument();
    failing = false;
    await user.click(within(panel).getByRole("button", { name: "Try again" }));
    expect(await drawer("Work started without an estimate")).toBeInTheDocument();
  });
});

describe("the drawer's assignee", () => {
  const assignee = async (name: string, findingId: string) => {
    renderFindings(`?finding=${findingId}`);
    const panel = await drawer(name);
    const facts = within(panel).getByRole("heading", { name: "Why the rule fired" }).closest("section")!;
    return within(facts).getByText("Assignee", { selector: "dt" }).nextElementSibling;
  };

  it("names who has the issue now", async () => {
    stubApi();
    expect(await assignee("Work started without an estimate", BREACH_ID)).toHaveTextContent("Grace Lindqvist");
  });

  it("says Unassigned when nobody has it", async () => {
    stubApi();
    const unassigned = ITEMS.find((item) => item.scope === "issue" && item.assignee === null)!;
    const value = await assignee(unassigned.rule_title, unassigned.finding_id);
    expect(value).toHaveTextContent("Unassigned");
    expect(within(value as HTMLElement).getByText("Unassigned")).toHaveClass("text-ink-low");
  });

  it("gives a sprint finding to no one", async () => {
    stubApi();
    expect(await assignee("Sprint at risk", SPRINT_ID)).toHaveTextContent("No one: a sprint finding");
  });

  it("gives a finding whose ticket has left the synced data to no one, never to Unassigned", async () => {
    const unassigned = ITEMS.find((item) => item.scope === "issue" && item.assignee === null)!;
    const gone = { ...unassigned, issue_summary: null, issue_type: null, assignee: null };
    const items = ITEMS.map((item) => (item.finding_id === gone.finding_id ? gone : item));
    stubApi((path) =>
      path === "findings"
        ? { body: { ...SAMPLE.findings, items } }
        : path === `findings/${gone.finding_id}`
          ? { body: { meta: SAMPLE.findings.meta, finding: gone, timeline: [] } }
          : undefined,
    );
    const value = await assignee(gone.rule_title, gone.finding_id);
    expect(value).toHaveTextContent("No one: the ticket is no longer in the synced data");
    expect(value).not.toHaveTextContent("Unassigned");
  });
});

describe("a finding the board's rule settings closed (JO-15)", () => {
  it("reads 'Closed: rule settings changed' in its row, in the drawer and beside when, never as resolved", async () => {
    const closedAt = "2026-11-04T14:31:00.000Z";
    const close = <T extends { state: string; resolved_at: string | null; resolved_why: string | null }>(finding: T): T => ({
      ...finding,
      state: "resolved",
      resolved_at: closedAt,
      resolved_why: "settings_changed",
    });
    const page = { ...SAMPLE.findings, items: SAMPLE.findings.items.map((item) => (item.finding_id === BREACH_ID ? close(item) : item)) };
    const detail = { ...SAMPLE.finding, finding: close(SAMPLE.finding.finding) };
    stubApi((path) => (path === "findings" ? { body: page } : path === `findings/${BREACH_ID}` ? { body: detail } : undefined));
    renderFindings(`?finding=${BREACH_ID}`);
    const panel = await drawer("Work started without an estimate");

    expect(within(panel).getByText("Closed: rule settings changed")).toBeInTheDocument();
    expect(within(panel).queryByText("Resolved", { selector: "span" })).toBeNull();
    const resolved = within(panel).getByText("Resolved", { selector: "dt" }).nextElementSibling;
    expect(resolved).toHaveTextContent("closed: rule settings changed");

    const table = screen.getByRole("table", { name: "Findings", hidden: true });
    const row = within(table).getAllByRole("row", { hidden: true }).find((candidate) => candidate.textContent?.includes("DEMO-1098"))!;
    const state = row.querySelector<HTMLElement>('[data-state="settings_changed"]')!;
    expect(state).toHaveTextContent("Closed: rule settings changed");
    expect(state).toHaveAttribute("title", "Closed because the rule settings changed");
    // The column shows "settings changed" under "Closed" on one line, whole; "rule" is heard, not shown.
    const why = state.lastElementChild as HTMLElement;
    expect(why).toHaveClass("whitespace-nowrap");
    expect(why.querySelector(".sr-only")).toHaveTextContent("rule");
    expect([...why.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent).join("")).toBe("settings changed");
  });
});
