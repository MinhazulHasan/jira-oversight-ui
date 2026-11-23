import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter, type OnUrlUpdateFunction } from "nuqs/adapters/testing";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { PeopleLevelProvider } from "@/components/shell/people-level";
import { renderKit } from "@/components/ui/__tests__/kit";

import rulesSample from "../../../../docs/sample-responses/rules.json";
import { ProcessView } from "../process-view";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Answer GET rules with whatever the test hands back; count the calls. */
function serve(answer: () => Response | Promise<Response>) {
  const fetchMock = vi.fn<typeof fetch>(async () => answer());
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderProcess(searchParams = "", { peopleLevel = false }: { peopleLevel?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const onUrlUpdate = vi.fn<OnUrlUpdateFunction>();
  renderKit(
    <QueryClientProvider client={client}>
      <NuqsTestingAdapter searchParams={searchParams} onUrlUpdate={onUrlUpdate} hasMemory>
        <PeopleLevelProvider peopleLevel={peopleLevel}>
          <ProcessView />
        </PeopleLevelProvider>
      </NuqsTestingAdapter>
    </QueryClientProvider>,
  );
  return { onUrlUpdate };
}

function lastSearch(onUrlUpdate: ReturnType<typeof vi.fn<OnUrlUpdateFunction>>): string {
  return onUrlUpdate.mock.calls.at(-1)?.[0].queryString ?? "";
}

function catalogueRows(): HTMLElement[] {
  return within(screen.getByRole("table", { name: "Rules" })).getAllByRole("row").slice(1);
}

describe("the process map", () => {
  it("shows every stage in order with the statuses that record it and its evidence", async () => {
    serve(() => json(rulesSample));
    renderProcess();

    const map = await screen.findByRole("list", { name: "The agreed process, in order" });
    const stages = Array.from(map.querySelectorAll<HTMLElement>(":scope > li"));
    expect(stages.map((stage) => stage.dataset.stage)).toEqual([
      "backlog",
      "estimate",
      "development",
      "code_review",
      "dev_signoff",
      "testing",
      "test_review",
      "test_signoff",
      "done",
    ]);
    expect(stages.map((stage) => stage.dataset.evidence)).toEqual([
      "status",
      "field",
      "status",
      "none",
      "none",
      "none",
      "none",
      "none",
      "status",
    ]);

    const development = stages[2];
    expect(within(development).getByText("Development")).toBeInTheDocument();
    expect(within(development).getByText("Tracked by status")).toBeInTheDocument();
    expect(within(development).getByRole("list", { name: "Jira statuses for Development" })).toHaveTextContent("In Progress");

    const estimate = stages[1];
    expect(estimate).toHaveTextContent("Story points");
    expect(estimate).toHaveTextContent(/8\.0\sh per point/);

    const review = stages[3];
    expect(within(review).getByText("Not measurable")).toBeInTheDocument();
    expect(review).toHaveTextContent("No status or field");
  });

  it("names the rules the missing evidence stops, and says the steps once, in the strip (SQA)", async () => {
    serve(() => json(rulesSample));
    renderProcess();

    const callout = (await screen.findByText("These rules can't run: Jira doesn't record the steps they need.")).closest("aside");
    expect(callout).not.toBeNull();
    const panel = within(callout as HTMLElement);
    expect(panel.getByRole("button", { name: /R-FLOW-01/ })).toBeInTheDocument();
    expect(panel.getByRole("button", { name: /W-REV-01/ })).toBeInTheDocument();
    // Regression: the five steps marked "Not measurable" in the strip were listed again in a box under it.
    for (const label of ["Code review", "Dev sign-off", "Testing", "Test review", "Test sign-off"]) {
      expect(panel.queryByText(label)).toBeNull();
    }
    expect(screen.queryByText(/Jira cannot prove these steps/)).toBeNull();
    // No version column: every rule carries the same one (SQA).
    expect(screen.queryByRole("columnheader", { name: /Version/ })).toBeNull();
  });

  it("holds the final shape while loading, then says what it looked at when empty", async () => {
    let release: (response: Response) => void = () => undefined;
    serve(() => new Promise<Response>((resolve) => (release = resolve)));
    renderProcess();

    expect(screen.getByText("Loading the agreed process")).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Rules" })).toHaveAttribute("aria-busy", "true");

    release(json({ ...rulesSample, rules: [], process: { ...rulesSample.process, stages: [] } }));
    expect(await screen.findByText("No stages in the agreed process")).toBeInTheDocument();
    expect(screen.getByText(/No stages are mapped to Jira yet/)).toBeInTheDocument();
    expect(screen.getByText("No rules in the catalogue")).toBeInTheDocument();
  });

  it("says once, inline, when the rules cannot be loaded, and tries again", async () => {
    const user = userEvent.setup();
    let fail = true;
    const fetchMock = serve(() =>
      fail ? json({ error: "upstream_error", message: "The oversight service failed." }, 502) : json(rulesSample),
    );
    renderProcess();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load the process and its rules");
    expect(alert).toHaveTextContent("HTTP 502 · upstream_error");
    expect(screen.getAllByRole("alert")).toHaveLength(1);

    fail = false;
    await user.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("list", { name: "The agreed process, in order" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("the rule catalogue", () => {
  it("lists every rule, with open findings linked and gaps marked rather than counted", async () => {
    serve(() => json(rulesSample));
    renderProcess();

    await screen.findByRole("list", { name: "The agreed process, in order" });
    const rows = catalogueRows();
    expect(rows).toHaveLength(12);

    const estimate = rows[0];
    expect(estimate).toHaveTextContent("R-EST-01");
    expect(estimate).toHaveTextContent("Work started without an estimate");
    expect(within(estimate).getByRole("link", { name: "270 open findings for R-EST-01" })).toHaveAttribute(
      "href",
      "/findings?rule=R-EST-01",
    );

    const review = rows.find((row) => row.textContent?.includes("R-FLOW-01"));
    expect(review).toBeDefined();
    expect(review).toHaveTextContent("code review and testing");
    expect(within(review as HTMLElement).queryByRole("link")).toBeNull();
    expect(review).toHaveTextContent("not measured");

    const summary = "7 rules and 5 early warnings, in catalogue order";
    expect(screen.getByText((_, element) => element?.tagName === "DIV" && element.textContent === summary)).toBeVisible();
  });

  it("keeps the sort in the URL", async () => {
    const user = userEvent.setup();
    serve(() => json(rulesSample));
    const { onUrlUpdate } = renderProcess();

    await screen.findByRole("list", { name: "The agreed process, in order" });
    await user.click(screen.getByRole("button", { name: "Open" }));

    await waitFor(() => expect(lastSearch(onUrlUpdate)).toBe("?sort=open&order=desc"));
    const firstIds = catalogueRows()
      .slice(0, 3)
      .map((row) => within(row).getAllByRole("cell")[0].textContent);
    expect(firstIds).toEqual(["R-EST-01", "R-EST-02", "R-FLOW-02"]);
    expect(screen.getByRole("button", { name: "Open" }).closest("th")).toHaveAttribute("aria-sort", "descending");
  });
});

describe("the rule drawer", () => {
  it("opens from a row, puts the rule in the URL and steps to the next rule", async () => {
    const user = userEvent.setup();
    serve(() => json(rulesSample));
    const { onUrlUpdate } = renderProcess();

    await screen.findByRole("list", { name: "The agreed process, in order" });
    await user.click(within(catalogueRows()[0]).getByText("Work started without an estimate"));

    const drawer = await screen.findByRole("dialog", { name: "Work started without an estimate" });
    expect(lastSearch(onUrlUpdate)).toBe("?rule=R-EST-01");
    expect(drawer).toHaveTextContent("The issue entered development (or a later stage) and has no estimate");
    expect(within(drawer).getByRole("link", { name: /View findings/ })).toHaveAttribute("href", "/findings?rule=R-EST-01");
    expect(drawer).toHaveTextContent("1 of 12 rules");

    await user.click(within(drawer).getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("dialog", { name: "Estimate first set after work started" })).toBeInTheDocument();
    expect(lastSearch(onUrlUpdate)).toBe("?rule=R-EST-02");
  });

  it("opens a not measurable warning from the URL, says why, and follows its escalation", async () => {
    const user = userEvent.setup();
    serve(() => json(rulesSample));
    renderProcess("?rule=W-REV-01");

    const drawer = await screen.findByRole("dialog", { name: "No review evidence yet" });
    expect(drawer).toHaveTextContent("Jira holds no code review evidence");
    expect(within(drawer).getByRole("button", { name: /View findings/ })).toHaveAttribute("aria-disabled", "true");
    expect(drawer).toHaveTextContent("Not measured");

    await user.click(within(drawer).getByRole("button", { name: /R-FLOW-01/ }));
    expect(await screen.findByRole("dialog", { name: "Reached testing without code review" })).toBeInTheDocument();
  });
});

describe("the board's own rule settings (JO-15)", () => {
  /** The catalogue as a board runs it after an admin turned W-AGE-01 off and moved R-EFF-01's threshold to 2. */
  const boardRules = {
    ...rulesSample,
    rules: rulesSample.rules.map((rule) =>
      rule.rule_id === "W-AGE-01"
        ? { ...rule, enabled: false, customised: true, open: 0 }
        : rule.rule_id === "R-EFF-01"
          ? { ...rule, threshold: "2×", customised: true }
          : rule,
    ),
  };

  it("offers an admin the way to change them beside the catalogue's heading, and a user nothing", async () => {
    serve(() => json(rulesSample));
    renderProcess("", { peopleLevel: true });
    await screen.findByRole("list", { name: "The agreed process, in order" });
    const catalogue = screen.getByRole("region", { name: "Rules" });
    expect(within(catalogue).getByRole("link", { name: "Edit rule settings" })).toHaveAttribute("href", "/governance/rules");
  });

  it("is never offered to a reader at team level", async () => {
    serve(() => json(rulesSample));
    renderProcess();
    await screen.findByRole("list", { name: "The agreed process, in order" });
    expect(screen.queryByRole("link", { name: "Edit rule settings" })).toBeNull();
  });

  it("shows a rule that is off muted, 'Off on this board', with no open findings counted; a customised rule says so", async () => {
    serve(() => json(boardRules));
    renderProcess();
    await screen.findByRole("list", { name: "The agreed process, in order" });
    const rows = catalogueRows();
    const off = rows.find((row) => row.textContent?.includes("W-AGE-01"))!;
    expect(within(off).getByText("Off on this board")).toBeInTheDocument();
    expect(within(off).getByText("Stuck in a status")).toHaveClass("text-ink-low");
    // Muted across the row, not in its title alone: no column reads as a rule in force.
    expect(within(off).getByText("Early warning")).toHaveClass("text-ink-low");
    expect(off.querySelector("[data-severity-off]")).toHaveTextContent("Warning");
    expect(within(off).getByText("Slower than 90% of finished work in the status")).toHaveClass("text-ink-low");
    expect(within(off).getByText("Yes").closest("span")).toHaveClass("text-ink-low");
    expect(within(off).queryByRole("link")).toBeNull();
    expect(off).toHaveTextContent("off on this board");
    // A rule that runs keeps its severity badge, its words in their own ink.
    const running = rows.find((row) => row.textContent?.includes("W-SPR-01"))!;
    expect(running.querySelector("[data-severity-off]")).toBeNull();
    const effort = rows.find((row) => row.textContent?.includes("R-EFF-01"))!;
    expect(within(effort).getByText("Customised")).toBeInTheDocument();
    expect(effort).toHaveTextContent("2×");
    expect(rows.filter((row) => row.textContent?.includes("Customised"))).toHaveLength(2);
    const summary = "7 rules and 5 early warnings (1 off on this board), in catalogue order";
    expect(screen.getByText((_, element) => element?.tagName === "DIV" && element.textContent === summary)).toBeVisible();
  });

  it("says in the drawer how the board runs a rule, and why a rule that is off has no findings to view", async () => {
    serve(() => json(boardRules));
    renderProcess("?rule=W-AGE-01", { peopleLevel: true });
    const drawer = await screen.findByRole("dialog", { name: "Stuck in a status" });
    expect(drawer).toHaveTextContent("On this boardOff");
    expect(drawer).toHaveTextContent("Off on this board");
    expect(within(drawer).getByRole("button", { name: /View findings/ })).toHaveAttribute("aria-disabled", "true");
    expect(within(drawer).getByRole("link", { name: "Edit rule settings" })).toHaveAttribute("href", "/governance/rules");
  });
});

describe("a board's own rules (JO-20)", () => {
  /** The catalogue as a board runs it after an admin added a rule of its own, after the catalogue's. */
  const withCustom = {
    ...rulesSample,
    rules: [
      ...rulesSample.rules,
      {
        rule_id: "R-CUS-01",
        title: "Bugs in progress over 3 days",
        description: "A ticket stays in one of the chosen statuses for longer than the limit.",
        kind: "rule",
        severity: "breach",
        version: "c1",
        threshold: "72 h",
        needs: ["Status changes"],
        measurable: true,
        missing_evidence: [],
        open: 2,
        escalates_to: null,
        enabled: true,
        customised: false,
        custom: true,
        check_label: "Time in a status",
      },
    ],
  };

  it("lists it after the catalogue's, marked Custom with its check, and leads to its findings like any other", async () => {
    serve(() => json(withCustom));
    renderProcess();
    await screen.findByRole("list", { name: "The agreed process, in order" });
    const own = catalogueRows().at(-1)!;
    expect(own).toHaveTextContent("R-CUS-01");
    expect(own.querySelector("[data-rule-custom]")).toHaveTextContent("Custom");
    expect(within(own).getByText("Time in a status")).toBeInTheDocument();
    expect(within(own).getByText("Bugs in progress over 3 days")).toBeInTheDocument();
    expect(within(own).getByRole("link", { name: /2/ })).toHaveAttribute("href", "/findings?rule=R-CUS-01");
    // Never "Customised": a board's own rule has no catalogue to differ from.
    expect(own).not.toHaveTextContent("Customised");
  });

  it("says in the drawer that it is the board's own, by its check", async () => {
    serve(() => json(withCustom));
    renderProcess("?rule=R-CUS-01", { peopleLevel: true });
    const drawer = await screen.findByRole("dialog", { name: "Bugs in progress over 3 days" });
    expect(drawer).toHaveTextContent("Custom ruleTime in a status");
  });
});
