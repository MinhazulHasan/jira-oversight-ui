import { screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type * as TrendLineModule from "@/components/charts/trend-line";

import { overviewFixture } from "./fixture";
import { renderOverview } from "./render";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/api/hooks", () => ({ useOverview: vi.fn(), usePeople: vi.fn() }));

// Recharts measures its container, which jsdom cannot; the stub shows what it was asked to draw.
vi.mock("@/components/charts/trend-line", async (importOriginal) => ({
  ...(await importOriginal<typeof TrendLineModule>()),
  TrendLine: ({ title, threshold }: { title: string; threshold?: { label: string } }) => (
    <div data-testid="trend-line" data-title={title}>
      {threshold?.label}
    </div>
  ),
}));

// Testing Library collapses white space, the no-break space included, into one plain space when it matches text.
const MINUS = "−";

function region(name: string) {
  return screen.getByRole("region", { name });
}

describe("Overview figures", () => {
  it("shows the four headline figures, each opening the findings behind it, and no constant fifth (SQA)", () => {
    renderOverview({ data: overviewFixture() });
    const tiles = region("Headline figures");
    const links = within(tiles).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/findings?severity=breach&state=open",
      "/findings?severity=warning&state=open",
      "/findings?state=all&first_seen=7d",
      "/findings?state=resolved&sort=resolved_at",
    ]);
    expect(tiles).not.toHaveTextContent("Rules not measurable");
    expect(links[0]).toHaveTextContent("Open breaches");
    expect(links[0]).toHaveTextContent("523");
    expect(within(links[0]).getByText("+10")).toBeInTheDocument();
    expect(within(links[0]).getByText(", worse")).toBeInTheDocument();
    expect(within(links[2]).getByText(`${MINUS}32`)).toBeInTheDocument();
    expect(within(links[2]).getByText(", better")).toBeInTheDocument();
    expect(within(links[3]).getByText(", worse")).toBeInTheDocument();
  });

  it("says tracking has just begun instead of a change when the rules first ran this week", () => {
    renderOverview({
      data: overviewFixture((draft) => {
        const lastWindowStart = draft.totals.open_breaches.series.at(-2)!.end_at;
        draft.tracking_since = new Date(Date.parse(lastWindowStart) + 3_600_000).toISOString();
      }),
    });
    const links = within(region("Headline figures")).getAllByRole("link");
    expect(links).toHaveLength(4);
    for (const link of links) {
      expect(link).toHaveTextContent(/Tracked since .+/);
      expect(link).not.toHaveTextContent("vs last week");
    }
  });

  it("compares this week's new findings with nothing while last week was the first tracked one (SQA)", () => {
    // Regression: "New this week 13, −202 vs last week", shown as better: last week counted every finding as new.
    renderOverview({
      data: overviewFixture((draft) => {
        const lastWindowEnd = Date.parse(draft.totals.new_7d.series.at(-2)!.end_at);
        draft.tracking_since = new Date(lastWindowEnd - 3 * 86_400_000).toISOString();
      }),
    });
    const links = within(region("Headline figures")).getAllByRole("link");
    expect(links[2]).toHaveTextContent("New this week");
    expect(links[2]).not.toHaveTextContent("vs last week");
    expect(links[2]).toHaveTextContent(/Tracked since .+/);
    // The open and resolved figures compare as usual: last week's were real.
    expect(links[0]).toHaveTextContent("vs last week");
    expect(links[3]).toHaveTextContent("vs last week");
  });

  it("compares weeks as usual when tracking began before last week", () => {
    renderOverview({
      data: overviewFixture((draft) => {
        draft.tracking_since = draft.totals.open_breaches.series[0].end_at;
      }),
    });
    const links = within(region("Headline figures")).getAllByRole("link");
    expect(links[0]).toHaveTextContent("vs last week");
    expect(links[0]).not.toHaveTextContent("Tracking since");
  });

  it("ranks the hot spots by open breaches, each opening exactly its epic's open findings", () => {
    renderOverview({ data: overviewFixture() });
    const list = within(region("Hot spots")).getByRole("list", { name: "Open findings by epic" });
    const rows = within(list).getAllByRole("link");
    expect(rows).toHaveLength(5);
    expect(rows[0]).toHaveAttribute("href", "/findings?state=open&epic=DEMO-704");
    expect(rows[0]).toHaveTextContent("DEMO-704");
    expect(rows[0]).toHaveTextContent("Data import pipeline");
    expect(within(rows[0]).getByText("73 breaches and 27 warnings")).toBeInTheDocument();
    expect(screen.getByText("Together they hold 51% of the 809 open findings.")).toBeInTheDocument();
  });

  it("sends work outside every epic to epic=none", () => {
    renderOverview({
      data: overviewFixture((draft) => {
        draft.hot_spots[4] = { ...draft.hot_spots[4], epic_key: null, epic_title: "(no epic)" };
      }),
    });
    const rows = within(region("Hot spots")).getAllByRole("link", { name: /\(no epic\)/ });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveAttribute("href", "/findings?state=open&epic=none");
  });

  it("ranks the rules by open findings and puts the ones Jira cannot evaluate last, hatched, with what they lack", () => {
    renderOverview({ data: overviewFixture() });
    const list = within(region("Findings by rule")).getByRole("list", { name: "Open findings by rule" });
    const rows = within(list).getAllByRole("link");
    expect(rows.map((row) => row.getAttribute("href"))).toEqual([
      "/findings?rule=R-EST-01",
      "/findings?rule=R-EST-02",
      "/findings?rule=R-FLOW-02",
      "/findings?rule=R-EFF-01",
      "/findings?rule=R-FLOW-03",
      "/findings?rule=W-EST-01",
      "/findings?rule=W-AGE-01",
      "/findings?rule=W-EFF-01",
      "/findings?rule=R-HYG-01",
      "/findings?rule=W-SPR-01",
      "/process",
      "/process",
    ]);
    expect(rows[0]).toHaveTextContent("R-EST-01Work started without an estimate270 open breaches");
    expect(rows[1]).toHaveTextContent("180 open warnings");
    expect(rows[9]).toHaveTextContent("1 open warning");
    expect(rows[10]).toHaveTextContent("R-FLOW-01Reached testing without code reviewNo code review or testing in Jira");
    expect(rows[10]).toHaveTextContent("not measurable");
    expect(rows[10].querySelector(".hatch")).not.toBeNull();
    expect(rows[11]).toHaveTextContent("No code review in Jira");
    expect(screen.getByText("12 rules, most findings first; 2 cannot be measured")).toBeInTheDocument();
  });

  it("shows coverage as shares of the work, and the steps Jira holds no evidence for as not measurable", () => {
    renderOverview({ data: overviewFixture() });
    const coverage = region("Coverage");
    expect(within(coverage).getByText("Work created in the last 90 days, Epics left out: 309 issues.")).toBeInTheDocument();
    expect(within(coverage).getByRole("meter", { name: "Estimates" })).toHaveAttribute("aria-valuetext", "61%, 187 of 309 issues");
    expect(within(coverage).getByRole("meter", { name: "Time logged" })).toHaveAttribute("aria-valuetext", "76%, 234 of 309 issues");
    expect(within(coverage).getAllByRole("meter")).toHaveLength(3);
    expect(within(coverage).getAllByText("Not measurable")).toHaveLength(2);
    expect(within(coverage).getByText("Jira records no testing for DEMO, so it cannot be counted.")).toBeInTheDocument();
    expect(within(coverage).getByRole("link", { name: /Estimates/ })).toHaveAttribute("href", "/findings?rule=R-EST-01");
  });

  it("draws four weekly trends with their change since last week, and the effort ratio against its breach line", () => {
    renderOverview({ data: overviewFixture() });
    const trends = region("Trends");
    expect(within(trends).getAllByTestId("trend-line").map((line) => line.dataset.title)).toEqual([
      "Median cycle time",
      "Median effort ratio",
      "Skipped a stage",
      "Reopen rate",
    ]);
    expect(within(trends).getByText("Breach at 1.50× (R-EFF-01)")).toBeInTheDocument();

    const cycle = within(trends).getByRole("figure", { name: "Median cycle time" });
    expect(within(cycle).getByText(`${MINUS}30.2 h`)).toBeInTheDocument();
    expect(within(cycle).getByText(", better")).toBeInTheDocument();
    expect(cycle).toHaveAccessibleDescription(
      /Median cycle time was 113\.4\sh in the week of .+ to date, down from 143\.6\sh the week before\./,
    );
    const ratio = within(trends).getByRole("figure", { name: "Median effort ratio" });
    expect(ratio).toHaveAccessibleDescription(/The breach threshold is 1\.50×; 1 week reached it\./);
    const reopen = within(trends).getByRole("figure", { name: "Reopen rate" });
    expect(within(reopen).getByText("0 pts")).toBeInTheDocument();
  });

  it("shows where the work sits now, open work first", () => {
    renderOverview({ data: overviewFixture() });
    const mix = region("Where work sits now");
    expect(within(mix).getByText("68 of 1,136 issues are open: 39 not started, 29 in progress.")).toBeInTheDocument();
    const items = within(within(mix).getByRole("list", { name: "Issues by status" })).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "To DoBacklog stage393%",
      "In ProgressDevelopment stage293%",
      "DoneDone stage1,06894%",
    ]);
  });

  it("opens the latest briefing with its tone marked in words, and leads to it", () => {
    renderOverview({ data: overviewFixture() });
    const insight = region("Latest insight");
    expect(within(insight).getByText(/DEMO-704 Data import pipeline has 73 open breaches/)).toBeInTheDocument();
    expect(within(insight).getAllByText("Serious:", { exact: false })).toHaveLength(2);
    // Go-live (SQA): no self-praising badge, and none of the prototype's tone words.
    expect(insight).not.toHaveTextContent(/Every figure checked|Blatantly bad|On its way to being bad/);
    expect(within(insight).getByRole("link", { name: /Read the briefing/ })).toHaveAttribute("href", "/insights");
    expect(within(insight).getByText(/Week of/)).toHaveTextContent(/2026/);
  });
});
