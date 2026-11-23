import { screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BaselineView } from "../baseline-view";
import { asReader, renderWithData, SAMPLE, serve, json } from "./render";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

beforeEach(() => {
  asReader();
  serve(() => json(SAMPLE));
});

async function report() {
  renderWithData(<BaselineView />);
  return screen.findByLabelText("About this report");
}

function meter(name: string | RegExp): HTMLElement {
  return screen.getByRole("meter", { name });
}

describe("the baseline report", () => {
  it("dates the report: the window in its own zone, the sync and when it was written, and nothing a developer reads", async () => {
    const strip = await report();
    expect(strip).toHaveTextContent("6 Aug 2026 – 3 Nov 2026");
    expect(strip).toHaveTextContent("90 days");
    expect(strip.querySelector('time[datetime="2026-11-04T14:28:00.000Z"]')).not.toBeNull();
    expect(within(strip).getByText("Generated")).toBeInTheDocument();
    expect(screen.queryByText("The derived metrics predate the sync")).toBeNull();
    // Go-live (SQA): no audit comparison, run id or process version, which only the prototype needed.
    expect(strip).not.toHaveTextContent(/audit|run 996e1dde|process 0\.1\.0/i);
    expect(document.body).not.toHaveTextContent(/reference audit|figures match|ticket 4/i);
    expect(screen.queryByRole("table", { name: /audit/i })).toBeNull();
  });

  it("shows the snapshot totals, by type and by status category", async () => {
    await report();
    const totals = screen.getByRole("region", { name: "Snapshot totals" });
    expect(totals).toHaveTextContent("Issues1,150");
    expect(totals).toHaveTextContent("Created before the window closed1,145");
    expect(totals).toHaveTextContent("Created by the end of 3 Nov 2026");

    const types = screen.getByRole("list", { name: "By type" });
    expect(within(types).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Task685 issues",
      "Bug219 issues",
      "Subtask150 issues",
      "Test82 issues",
      "Epic14 issues",
    ]);
    expect(screen.getByRole("list", { name: "By status category" })).toHaveTextContent("Done1,074 issues");
  });

  it("measures coverage of resolved work, logged time once", async () => {
    await report();
    expect(meter("Original estimates")).toHaveAttribute("aria-valuetext", "0%, 0 of 308 issues");
    expect(meter("Story points")).toHaveAttribute("aria-valuetext", "62%, 192 of 308 issues");
    expect(meter("Logged time")).toHaveAttribute("aria-valuetext", "84%, 260 of 308 issues");
    expect(screen.queryByText(/counted three ways/)).toBeNull();

    expect(meter("Straight from To Do to Done")).toHaveAttribute("aria-valuetext", "10%, 30 of 308 issues");
    expect(meter("Created in Done")).toHaveAttribute("aria-valuetext", "0%, 0 of 308 issues");
  });

  it("reads hours per point, time in status, cycle time, reopens and the worklog totals", async () => {
    await report();
    const perPoint = screen.getByRole("region", { name: "The spread of hours per story point" });
    expect(perPoint).toHaveTextContent(/25th percentile7\.3\s?h/);
    expect(perPoint).toHaveTextContent(/Median8\.3\s?h/);
    expect(perPoint).toHaveTextContent(/75th percentile11\.0\s?h/);
    // Hours carry a no-break space before the unit.
    expect(meter(/^Within 25% of 8\.0\sh per point$/)).toHaveAttribute("aria-valuetext", "57%, 100 of 174 issues");
    expect(meter("Estimate set after work started")).toHaveAttribute("aria-valuetext", "30%, 54 of 178 estimated issues");

    const statuses = screen.getByRole("table", { name: "Hours in each status" });
    const rows = within(statuses).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getByRole("rowheader").textContent)).toEqual([
      "To DoBacklog · 319 intervals",
      "In ProgressDevelopment · 284 intervals",
      "DoneDone · 7 intervals",
    ]);
    expect(rows[0]).toHaveTextContent(/161\.6\sh/);

    const flow = screen.getByRole("region", { name: "Cycle time and reopens" });
    expect(flow).toHaveTextContent(/Cycle time100\.8\s?h/);
    expect(flow).toHaveTextContent("Reopened after Done8");
    expect(flow).toHaveTextContent("3% of resolved work");
    expect(screen.getByText("People who logged time").closest("div")).toHaveTextContent("1");
    // Go-live (SQA): no account shares or time-tracking app figures, which read as jargon.
    expect(document.body).not.toHaveTextContent(/time-tracking app|Largest single account|Accounts that logged time/);
  });

  it("lists links by type and the steps Jira cannot measure", async () => {
    await report();
    expect(screen.getByRole("list", { name: "Links by type" })).toHaveTextContent("relates to592 links");
    expect(screen.getByText("Links to other systems").closest("div")).toHaveTextContent("0");

    const gaps = screen.getByText("Jira holds no evidence for 5 steps of the agreed process").closest("aside");
    expect(gaps).not.toBeNull();
    for (const step of ["Code review", "Dev sign-off", "Testing", "Test review", "Test sign-off"]) {
      expect(within(gaps as HTMLElement).getByText(step)).toBeInTheDocument();
    }
    expect(within(gaps as HTMLElement).getByRole("link", { name: /See the agreed process/ })).toHaveAttribute(
      "href",
      "/process#process-map",
    );
  });
});
