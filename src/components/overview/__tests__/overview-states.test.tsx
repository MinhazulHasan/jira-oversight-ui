import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import type * as TrendLineModule from "@/components/charts/trend-line";
import { ApiError } from "@/lib/api/client";

import { overviewFixture, peopleFixture } from "./fixture";
import { renderOverview } from "./render";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/api/hooks", () => ({ useOverview: vi.fn(), usePeople: vi.fn() }));

// Recharts measures its container, which jsdom cannot; the line is drawn in the browser tests.
vi.mock("@/components/charts/trend-line", async (importOriginal) => ({
  ...(await importOriginal<typeof TrendLineModule>()),
  TrendLine: ({ title }: { title: string }) => <div data-testid="trend-line">{title}</div>,
}));

const SECTIONS = ["Hot spots", "Findings by rule", "Coverage", "Trends", "Where work sits now", "Latest insight"];

describe("Overview states", () => {
  it("keeps every region in its final shape while the figures load, and says what is loading", () => {
    renderOverview();

    for (const name of SECTIONS) expect(screen.getByRole("heading", { level: 2, name })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Headline figures" })).toBeInTheDocument();
    expect(screen.getAllByText("Loading", { selector: ".sr-only" })).toHaveLength(4);
    for (const label of [
      "Loading open findings by epic",
      "Loading open findings by rule",
      "Loading the coverage",
      "Loading median cycle time",
      "Loading median effort ratio",
      "Loading where work sits now",
      "Loading the latest insight",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // Nothing leads anywhere until there is something behind it.
    expect(screen.queryByRole("link", { name: /Open breaches/ })).not.toBeInTheDocument();
  });

  it("shows one inline error with a retry when the overview cannot be loaded", async () => {
    const user = userEvent.setup();
    const { refetch } = renderOverview({
      error: new ApiError(503, "upstream_unavailable", "The oversight service did not answer."),
    });

    const alert = screen.getByRole("alert");
    expect(within(alert).getByText("The overview could not be loaded")).toBeInTheDocument();
    expect(within(alert).getByText(/The oversight service did not answer\./)).toBeInTheDocument();
    expect(within(alert).getByText("HTTP 503 · upstream_unavailable")).toBeInTheDocument();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "Hot spots" })).not.toBeInTheDocument();

    await user.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("names a dropped connection without inventing an HTTP status", () => {
    renderOverview({ error: new ApiError(0, "network_error", "The dashboard's server could not be reached.") });
    expect(screen.getByText("network_error")).toBeInTheDocument();
  });

  it("keeps the last figures up when a refresh fails, and says so", async () => {
    const user = userEvent.setup();
    const { refetch } = renderOverview({
      data: overviewFixture(),
      error: new ApiError(504, "upstream_timeout", "The oversight service took too long to answer."),
    });

    expect(screen.getByText("The overview could not be refreshed")).toBeInTheDocument();
    expect(screen.getByText(/took too long to answer/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open breaches/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("loads the people on their own: their failure is one inline error that leaves the figures up", async () => {
    const user = userEvent.setup();
    const { refetchPeople } = renderOverview({
      data: overviewFixture(),
      people: { error: new ApiError(503, "upstream_unavailable", "The oversight service did not answer.") },
    });

    const alert = screen.getByRole("alert");
    expect(within(alert).getByText("Couldn't load the people")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Open breaches/ })).toBeInTheDocument();
    expect(screen.queryByText("The overview could not be refreshed")).not.toBeInTheDocument();
    await user.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(refetchPeople).toHaveBeenCalledTimes(1);
  });

  it("puts the people between the hot spots and the coverage, once they have loaded", () => {
    renderOverview({ data: overviewFixture(), people: { data: peopleFixture() } });
    const headings = screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent);
    expect(headings.indexOf("People")).toBe(headings.indexOf("Findings by rule") + 1);
    expect(headings.indexOf("Coverage")).toBe(headings.indexOf("People") + 1);
    const people = screen.getByRole("region", { name: "People" });
    expect(within(people).getAllByRole("link", { name: /breaches and/ })).toHaveLength(9);
  });

  it("says what was looked at when there is nothing to show", () => {
    renderOverview({
      data: overviewFixture((draft) => {
        draft.hot_spots = [];
        draft.latest_insight = null;
        for (const card of Object.values(draft.trend_cards)) {
          card.points = card.points.map((point) => ({ ...point, value: null }));
          card.current = null;
          card.previous = null;
        }
      }),
    });

    // One line each, never the title said again under it (SQA).
    expect(screen.getByText("No open findings in any epic")).toBeInTheDocument();
    expect(screen.queryByText("Nothing is open.")).toBeNull();
    expect(screen.getByText("No weekly briefing yet")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Read the briefing/ })).not.toBeInTheDocument();
    // Four empty charts say so once, for the section.
    expect(screen.getByText("Nothing finished in the last 12 weeks")).toBeInTheDocument();
    expect(screen.queryByText("Nothing finished in these weeks")).toBeNull();
    expect(screen.queryByTestId("trend-line")).not.toBeInTheDocument();
  });
});
