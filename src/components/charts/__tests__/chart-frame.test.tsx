import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { renderKit } from "@/components/ui/__tests__/kit";

import { ChartFrame } from "../chart-frame";

const TABLE = {
  columns: [{ header: "Rule" }, { header: "Open", numeric: true }],
  rows: [
    ["R-EFF-01", "9"],
    ["R-FLOW-02", "8"],
  ],
} as const;

describe("ChartFrame", () => {
  it("names the figure, describes it for screen readers, and shows the chart with its legend", () => {
    renderKit(
      <ChartFrame title="Findings by rule" summary="R-EFF-01 has the most open findings, 9." legend={<p>Legend</p>} table={TABLE}>
        <div>The picture</div>
      </ChartFrame>,
    );
    const figure = screen.getByRole("figure", { name: "Findings by rule" });
    expect(figure).toHaveAccessibleDescription("R-EFF-01 has the most open findings, 9.");
    expect(screen.getByText("The picture")).toBeInTheDocument();
    expect(screen.getByText("Legend")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Chart" })).toHaveAttribute("aria-checked", "true");
  });

  it("switches to the same figures as a table, and back", async () => {
    const user = userEvent.setup();
    const onViewChange = vi.fn();
    renderKit(
      <ChartFrame title="Findings by rule" summary="Summary." legend={<p>Legend</p>} table={TABLE} onViewChange={onViewChange}>
        <div>The picture</div>
      </ChartFrame>,
    );

    await user.click(screen.getByRole("radio", { name: "Table" }));
    expect(onViewChange).toHaveBeenLastCalledWith("table");
    expect(screen.queryByText("The picture")).not.toBeInTheDocument();
    expect(screen.queryByText("Legend")).not.toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Findings by rule" });
    expect(table).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Open" })).toHaveAttribute("data-numeric", "true");
    expect(screen.getByRole("cell", { name: "R-FLOW-02" })).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Chart" }));
    expect(onViewChange).toHaveBeenLastCalledWith("chart");
    expect(screen.getByText("The picture")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("offers no switch when there is no table to switch to", () => {
    renderKit(
      <ChartFrame title="Time in status" summary="Summary.">
        <div>The picture</div>
      </ChartFrame>,
    );
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });

  it("holds its place while loading and says what is loading", () => {
    renderKit(
      <ChartFrame title="Findings by rule" summary="Summary." state="loading" loadingShape="bars" table={TABLE}>
        <div>The picture</div>
      </ChartFrame>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("Loading findings by rule");
    expect(screen.queryByText("The picture")).not.toBeInTheDocument();
    // Nothing to switch between until there is something to show.
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });

  it("says what was looked at when there is nothing to draw", () => {
    renderKit(
      <ChartFrame
        title="Findings by rule"
        summary="Summary."
        state="empty"
        emptyTitle="Nothing open in this epic"
        emptyDescription="All 9 findings in Partner API have been resolved."
      >
        <div>The picture</div>
      </ChartFrame>,
    );
    expect(screen.getByText("Nothing open in this epic")).toBeInTheDocument();
    expect(screen.getByText("All 9 findings in Partner API have been resolved.")).toBeInTheDocument();
  });

  it("fails inline, with a retry", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    renderKit(
      <ChartFrame title="Findings by rule" summary="Summary." state="error" errorDetail="HTTP 504" onRetry={onRetry}>
        <div>The picture</div>
      </ChartFrame>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("This chart could not be loaded");
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
