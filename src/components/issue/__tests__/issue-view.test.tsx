import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter, type OnUrlUpdateFunction } from "nuqs/adapters/testing";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderKit } from "@/components/ui/__tests__/kit";

import health from "../../../../docs/sample-responses/health.json";
import { IssueView } from "../issue-view";
import { DEMO_1, RULES, SKIPPER, demo1With } from "./fixtures";

const router = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ ...router, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/issues/DEMO-1",
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

type Answer = { status: number; body: unknown } | Promise<never>;

/** A fetch that answers by path; an unknown path is a 404. */
function serve(routes: Record<string, () => Answer>) {
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const path = String(input).replace(/^\/api\/oversight\//, "");
    const answer = await (routes[path]?.() ?? { status: 404, body: { error: "not_found", message: "none" } });
    return new Response(JSON.stringify(answer.body), { status: answer.status });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const ok = (body: unknown) => () => ({ status: 200, body });

function renderIssue(issueKey = "DEMO-1", searchParams = "") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const onUrlUpdate = vi.fn<OnUrlUpdateFunction>();
  renderKit(
    <QueryClientProvider client={client}>
      <NuqsTestingAdapter searchParams={searchParams} onUrlUpdate={onUrlUpdate} hasMemory>
        <IssueView issueKey={issueKey} />
      </NuqsTestingAdapter>
    </QueryClientProvider>,
  );
  return { onUrlUpdate };
}

function rowsOf(name: string): HTMLElement[] {
  return within(screen.getByRole("table", { name })).getAllByRole("row").slice(1);
}

beforeEach(() => {
  // British conventions, as the sample's readers see them ("10 Nov 2025").
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-GB"]);
  router.push.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the Issue page", () => {
  it("tells DEMO-1's story: the facts, each tied to the finding that fired on it", async () => {
    serve({ "issues/DEMO-1/timeline": ok(DEMO_1), rules: ok(RULES), health: ok(health) });
    renderIssue();

    expect(await screen.findByRole("heading", { level: 1, name: "DEMO-1 Document help tooltips" })).toBeInTheDocument();
    const facts = screen.getByRole("region", { name: "Facts" });
    expect(within(facts).getByText("24.0 h at 8 h a point")).toBeInTheDocument();
    expect(within(facts).getByText("Over the 1.50× threshold")).toHaveClass("text-breach-ink");
    expect(within(facts).getByText("43.8 h ÷ 24.0 h")).toBeInTheDocument();
    expect(within(facts).getByRole("link", { name: /Open the finding: Effort far beyond the estimate/ })).toHaveAttribute(
      "href",
      "/findings?finding=45834de40a31472113e2898410f13062",
    );
    expect(within(facts).getByRole("link", { name: /Open the finding: Reopened after Done/ })).toHaveTextContent(
      "Done → In Progress",
    );
    const late = within(facts).getByRole("link", { name: /Open the finding: Estimate first set after work started/ });
    // The tile sets the unit apart from the figure ("120.4" then a smaller "h").
    expect(late).toHaveTextContent(/Estimate set\s*120\.4\s*h/);
    expect(late).toHaveTextContent("After work began");
    expect(late).toHaveTextContent("Set 17 Nov 2025");
    // When work began sits on the Cycle time tile, beside it.
    expect(facts).toHaveTextContent("12.9 days to Done");
    expect(facts).toHaveTextContent("Work began 12 Nov 2025");

    expect(screen.getByRole("link", { name: /DEMO-4 Onboarding flow/ })).toHaveAttribute("href", "/findings?epic=DEMO-4");
  });

  it("keeps Open in Jira in place for sample data, dimmed, and says why", async () => {
    serve({ "issues/DEMO-1/timeline": ok(DEMO_1), rules: ok(RULES) });
    renderIssue();
    await screen.findByRole("heading", { level: 1, name: /Document help tooltips/ });

    const open = screen.getByRole("button", { name: "Open in Jira" });
    expect(open).toHaveAttribute("aria-disabled", "true");
    await userEvent.hover(open);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Sample data: no Jira link");
  });

  it("lists the findings, and a row opens the finding's evidence", async () => {
    serve({ "issues/DEMO-1/timeline": ok(DEMO_1), rules: ok(RULES) });
    renderIssue();
    await screen.findByRole("table", { name: "Findings on DEMO-1" });

    const rows = rowsOf("Findings on DEMO-1");
    expect(rows.map((row) => within(row).getAllByRole("cell")[0].textContent)).toEqual(["Warning", "Warning", "Breach"]);
    await userEvent.click(within(rows[2]).getByText("Effort far beyond the estimate"));
    expect(router.push).toHaveBeenCalledWith("/findings?finding=45834de40a31472113e2898410f13062");
  });

  it("says a finding the board's rule settings closed was closed for that, never resolved (JO-15)", async () => {
    const closed = demo1With((data) => {
      const effort = data.findings.find((finding) => finding.rule_id === "R-EFF-01")!;
      Object.assign(effort, { state: "resolved", resolved_at: "2026-11-04T14:31:00.000Z", resolved_why: "settings_changed" });
    });
    serve({ "issues/DEMO-1/timeline": ok(closed), rules: ok(RULES) });
    renderIssue();
    await screen.findByRole("table", { name: "Findings on DEMO-1" });
    const effort = rowsOf("Findings on DEMO-1").find((row) => row.textContent?.includes("R-EFF-01"))!;
    expect(effort).toHaveTextContent(/Closed:\s*rule settings changed 4 Nov 2026/);
    expect(effort).not.toHaveTextContent("Resolved");
  });

  it("shows the changelog with what cites it, the weekly time and the axis cut", async () => {
    serve({ "issues/DEMO-1/timeline": ok(DEMO_1), rules: ok(RULES) });
    const { onUrlUpdate } = renderIssue();
    await screen.findByRole("table", { name: "Changelog of DEMO-1" });

    const rows = rowsOf("Changelog of DEMO-1");
    expect(rows).toHaveLength(6);
    // Found by what they say: Jira's changelog ids are no longer a column (SQA).
    const reopen = rows.find((row) => /Done\s→\sIn Progress/.test(row.textContent ?? ""));
    expect(reopen).toHaveTextContent("R-FLOW-03");
    expect(reopen).not.toHaveTextContent("310131");
    expect(rows.find((row) => /Unassigned\s→\sAssigned/.test(row.textContent ?? ""))).toBeDefined();

    expect(screen.getByText("Week of 17 Nov 2025")).toBeInTheDocument();
    expect(screen.getByText("Total 43.8 h.")).toBeInTheDocument();
    expect(screen.getByTestId("timeline-cut")).toHaveTextContent(/Axis shortened after 27 Nov 2025: the 342 days since/);

    await userEvent.click(within(rows[2]).getByText("Story points"));
    await waitFor(() => expect(onUrlUpdate.mock.calls.at(-1)?.[0].queryString).toBe("?change=310037"));
  });

  it("opens a changelog entry from the URL, with what it meant and who cites it", async () => {
    serve({ "issues/DEMO-1/timeline": ok(DEMO_1), rules: ok(RULES) });
    const { onUrlUpdate } = renderIssue("DEMO-1", "?change=310131");

    const drawer = await screen.findByRole("dialog", { name: "Done → In Progress" });
    expect(within(drawer).getByText("Time in Done before").nextSibling).toHaveTextContent("171.1 h");
    expect(within(drawer).getByText("Reopened")).toBeInTheDocument();
    expect(within(drawer).getByRole("link", { name: /R-FLOW-03 Reopened after Done/ })).toHaveAttribute(
      "href",
      "/findings?finding=2c137fdcd942189c29aa2b5509afeb7c",
    );
    await userEvent.click(within(drawer).getByRole("button", { name: "Later" }));
    await waitFor(() => expect(onUrlUpdate.mock.calls.at(-1)?.[0].queryString).toBe("?change=310135"));
  });

  it("says calmly when the snapshot has no such issue, and shows the ways back", async () => {
    serve({ health: ok(health) });
    renderIssue("DEMO-9999");

    expect(await screen.findByRole("heading", { level: 2, name: "No issue DEMO-9999" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "DEMO-9999" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Go to Overview/ })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Browse findings" })).toHaveAttribute("href", "/findings");
    expect(await screen.findByText(/Not in the last sync/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open in Jira" })).not.toBeInTheDocument();
  });

  it("fails inline with a retry that brings the issue back", async () => {
    let failing = true;
    serve({
      "issues/DEMO-1/timeline": () =>
        failing ? { status: 503, body: { error: "upstream_unavailable", message: "down" } } : { status: 200, body: DEMO_1 },
      rules: ok(RULES),
    });
    renderIssue();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load DEMO-1");
    expect(alert).toHaveTextContent("upstream_unavailable · HTTP 503");
    failing = false;
    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 1, name: /Document help tooltips/ })).toBeInTheDocument();
  });

  it("holds the page's shape while it loads", () => {
    serve({ "issues/DEMO-1/timeline": () => new Promise<never>(() => {}), rules: () => new Promise<never>(() => {}) });
    renderIssue();

    expect(screen.getByRole("heading", { level: 1, name: "DEMO-1" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Facts" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("table", { name: "Findings" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Loading status by stage")).toBeInTheDocument();
  });

  it("says what was looked at when an issue has no findings and no time logged", async () => {
    serve({ "issues/DEMO-3/timeline": ok(SKIPPER), rules: ok(RULES) });
    renderIssue("DEMO-3");

    expect(await screen.findByText("No findings on DEMO-3")).toBeInTheDocument();
    expect(screen.getByText("No time logged on DEMO-3")).toBeInTheDocument();
    const facts = screen.getByRole("region", { name: "Facts" });
    expect(within(facts).getByText("Done without development")).toBeInTheDocument();
    expect(within(facts).getByText("Nothing logged")).toBeInTheDocument();
    expect(screen.queryByTestId("timeline-cut")).toBeInTheDocument();
  });
});

describe("the Issue page's assignee", () => {
  it("names who has the issue now, leading to their open findings", async () => {
    serve({ "issues/DEMO-1/timeline": ok(DEMO_1), rules: ok(RULES) });
    renderIssue();
    await screen.findByRole("heading", { level: 1, name: /Document help tooltips/ });

    const link = screen.getByRole("link", { name: "Ada Brooks: show their open findings" });
    expect(link).toHaveAttribute("href", "/findings?person=pbc7fe62842ca");
    expect(link).toHaveTextContent("Ada Brooks");
    expect(link.closest("[data-assignee]")).toHaveTextContent(/^Assignee\s*Ada Brooks$/);
  });

  it("underlines the name alone on hover: a link's own underline would run on through the avatar's initials", async () => {
    serve({ "issues/DEMO-1/timeline": ok(DEMO_1), rules: ok(RULES) });
    renderIssue();
    await screen.findByRole("heading", { level: 1, name: /Document help tooltips/ });

    const link = screen.getByRole("link", { name: "Ada Brooks: show their open findings" });
    // A decoration set on the link reaches every descendant's text, initials drawn by ::before included, and no
    // descendant can take it off; so the link carries none, and the name's own span takes it from the group.
    expect([...link.classList].filter((name) => /(^|:)underline$/.test(name))).toEqual([]);
    expect(link).toHaveClass("group");
    expect(within(link).getByText("Ada Brooks")).toHaveClass("group-hover:underline");
    expect(link.querySelector(".jo-avatar")?.className).not.toMatch(/underline/);
  });

  it("parts the facts with dots only where they share a line: on a phone the line wraps, with no dot", async () => {
    serve({ "issues/DEMO-1/timeline": ok(DEMO_1), rules: ok(RULES) });
    renderIssue();
    await screen.findByRole("heading", { level: 1, name: /Document help tooltips/ });
    const dots = document.querySelectorAll("[data-separator]");
    expect(dots).toHaveLength(2);
    for (const dot of dots) {
      expect(dot).toHaveAttribute("aria-hidden");
      expect(dot).toHaveClass("hidden", "sm:inline");
      // Each dot travels with the fact after it, so a wrapped line never ends on one (SQA).
      expect(dot.nextElementSibling).not.toBeNull();
      expect(dot.parentElement).toHaveClass("inline-flex");
    }
    expect(dots[0].nextElementSibling).toHaveTextContent(/^(Epic|No epic)/);
    // No column of Jira's own changelog ids (SQA).
    const changelog = await screen.findByRole("table", { name: "Changelog of DEMO-1" });
    expect(within(changelog).queryByRole("columnheader", { name: /Changelog/ })).toBeNull();
  });

  it("says Unassigned, in the secondary ink, when nobody has it", async () => {
    const unassigned = demo1With((data) => {
      data.issue.assignee = null;
    });
    serve({ "issues/DEMO-1/timeline": ok(unassigned), rules: ok(RULES) });
    renderIssue();
    await screen.findByRole("heading", { level: 1, name: /Document help tooltips/ });

    const header = screen.getByRole("heading", { level: 1 }).closest("header") ?? document.body;
    const assignee = header.querySelector("[data-assignee]");
    expect(assignee).toHaveTextContent(/^Unassigned$/);
    expect(assignee).toHaveClass("text-ink-low");
    expect(screen.queryByRole("link", { name: /show their open findings/ })).not.toBeInTheDocument();
  });

  it("cuts a long name short on screen and keeps it whole for screen readers", async () => {
    const name = `Maximiliana ${"Featherstonehaugh-".repeat(7)}`.slice(0, 128);
    const long = demo1With((data) => {
      data.issue.assignee = { id: "p0123456789ab", name, avatar: null };
    });
    serve({ "issues/DEMO-1/timeline": ok(long), rules: ok(RULES) });
    renderIssue();
    await screen.findByRole("heading", { level: 1, name: /Document help tooltips/ });

    const link = screen.getByRole("link", { name: `${name}: show their open findings` });
    expect(within(link).getByText(name)).toHaveClass("truncate");
  });
});
