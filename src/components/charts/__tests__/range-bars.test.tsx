import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { renderKit } from "@/components/ui/__tests__/kit";
import { KeyValueList } from "@/components/ui/key-value";

import { RangeBars, type RangeRow } from "../range-bars";

const ROWS: RangeRow[] = [
  { id: "todo", label: "To Do", detail: "Backlog", count: 319, median: 161.6, p75: 396, p90: 533.3 },
  { id: "progress", label: "In Progress", detail: "Development", count: 284, median: 96.4, p75: 174.4, p90: 336.4 },
  { id: "review", label: "Awaiting Deployment Approval", detail: "Not mapped to a stage", count: 1234, median: 71.7, p75: 225.4, p90: 361.4 },
];

function render() {
  renderKit(<RangeBars rows={ROWS} title="Hours in each status" />);
  return screen.getByRole("table", { name: "Hours in each status" });
}

describe("RangeBars", () => {
  it("reads each status once, with what it maps to, and its three figures: the narrow lines are pictures only", () => {
    const table = render();
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(1 + ROWS.length);
    expect(within(table).getAllByRole("rowheader").map((header) => header.textContent)).toEqual([
      "To DoBacklog · 319 intervals",
      "In ProgressDevelopment · 284 intervals",
      "Awaiting Deployment ApprovalNot mapped to a stage · 1,234 intervals",
    ]);
    expect(rows[1]).toHaveTextContent(/161\.6\sh396\.0\sh533\.3\sh/);
    // The scale and each status's bar line, drawn again for a narrow frame, are hidden from assistive technology.
    const narrow = table.querySelectorAll("[data-range-scale], [data-range-bar]");
    expect(narrow).toHaveLength(1 + ROWS.length);
    for (const line of narrow) expect(line).toHaveAttribute("aria-hidden", "true");
  });

  it("below a 42rem frame, draws each bar across the table under one scale, and the wide column's picture not at all", () => {
    // jsdom lays nothing out: the container queries are the contract, as the e2e at 390 px measures them.
    const table = render();
    const frame = table.parentElement!;
    expect(frame).toHaveClass("@container");
    const [status, distribution] = table.querySelectorAll("col");
    expect(status).toHaveClass("w-[30%]", "@max-[42rem]:w-auto");
    expect(distribution).toHaveClass("@max-[42rem]:w-0");
    expect(table.querySelector("[data-range-scale]")).toHaveClass("hidden", "@max-[42rem]:table-row");
    for (const row of ROWS) {
      const line = table.querySelector(`[data-range-bar="${row.id}"]`)!;
      expect(line).toHaveClass("hidden", "@max-[42rem]:table-row");
      expect(line.querySelector("td")).toHaveAttribute("colspan", "5");
      expect(line.querySelectorAll(".jo-segment")).toHaveLength(3);
    }
    // The header's scale and the column's bars give way there; the stage under each status moves to the bar's line.
    const head = within(table).getAllByRole("columnheader")[1];
    expect(head.querySelector("[aria-hidden]")).toHaveClass("@max-[42rem]:hidden");
    for (const header of within(table).getAllByRole("rowheader")) {
      expect(header.lastElementChild).toHaveClass("@max-[42rem]:sr-only");
      expect(header.nextElementSibling?.firstElementChild).toHaveClass("@max-[42rem]:hidden");
    }
  });

  it("cuts nothing short: a long status or stage wraps, on a frame of any width", () => {
    const table = render();
    expect(table.querySelectorAll(".truncate")).toHaveLength(0);
    for (const header of within(table).getAllByRole("rowheader")) {
      for (const line of header.children) expect(line).toHaveClass("break-words");
    }
  });
});

describe("KeyValueList", () => {
  it("never cuts a label short: it wraps beside its value", () => {
    renderKit(
      <KeyValueList
        items={[
          { id: "aggregate", label: "Aggregate, with sub-tasks", value: "260 · 84%", mono: true },
          { id: "app", label: "The time-tracking app's account", value: "100% of hours", mono: true },
        ]}
      />,
    );
    for (const label of ["Aggregate, with sub-tasks", "The time-tracking app's account"]) {
      const term = screen.getByText(label, { selector: "dt" });
      expect(term).not.toHaveClass("truncate");
      expect(term).toHaveClass("min-w-0", "break-words");
    }
  });
});
