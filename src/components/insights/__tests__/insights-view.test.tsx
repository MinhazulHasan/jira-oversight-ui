import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import insightsSample from "../../../../docs/sample-responses/insights.json";
import { InsightsView } from "../insights-view";
import { renderWithQuery, stubApi } from "./render";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const NOT_FOUND = { status: 404, body: { error: "not_found", message: "No weekly briefing has been written yet." } };
const UNAVAILABLE = { status: 503, body: { error: "unavailable", message: "The oversight service did not answer." } };
const BRIEFING = { status: 200, body: insightsSample };

beforeEach(() => {
  vi.spyOn(navigator, "languages", "get").mockReturnValue(["en-GB"]);
});

describe("the Insights page's data region", () => {
  it("shows the sheet's shape while the briefing loads", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
    renderWithQuery(<InsightsView />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading the weekly briefing");
  });

  it("says plainly that no briefing exists yet, and points to the findings", async () => {
    stubApi({ "insights/latest": NOT_FOUND });
    renderWithQuery(<InsightsView />);
    expect(await screen.findByText("No briefing yet")).toBeInTheDocument();
    expect(screen.getByText("One is written each week.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See the findings" })).toHaveAttribute("href", "/findings");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("fails inline with the detail, and recovers on retry", async () => {
    const user = userEvent.setup();
    const fetch = stubApi({ "insights/latest": (call) => (call === 1 ? UNAVAILABLE : BRIEFING) });
    renderWithQuery(<InsightsView />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load the briefing");
    expect(alert).toHaveTextContent("HTTP 503 · insights/latest");

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Week of 2 Nov 2026" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith("insights/latest"))).toHaveLength(2);
  });

  it("says so when there was no answer at all", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
    renderWithQuery(<InsightsView />);
    expect(await screen.findByRole("alert")).toHaveTextContent("No response · insights/latest");
  });

  it("shows the briefing once it arrives", async () => {
    stubApi({ "insights/latest": BRIEFING });
    renderWithQuery(<InsightsView />);
    expect(await screen.findByRole("heading", { level: 2, name: "Week of 2 Nov 2026" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "The briefing" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Top problems" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "How this was written" })).toBeNull();
  });
});
