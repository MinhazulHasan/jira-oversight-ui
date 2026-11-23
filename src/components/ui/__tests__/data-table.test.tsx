import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DataTable, dataTableColumns, tableMinWidth } from "../data-table";
import { renderKit } from "./kit";

type Row = { id: string; key: string; age: number; ratio: number | null };

const ROWS: Row[] = [
  { id: "a", key: "DEMO-2", age: 5, ratio: 1.2 },
  { id: "b", key: "DEMO-10", age: 50, ratio: null },
  { id: "c", key: "DEMO-1", age: 12, ratio: 0.8 },
];

const col = dataTableColumns<Row>();
const COLUMNS = col.columns([
  col.accessor("key", { header: "Issue" }),
  col.accessor("age", { header: "Age", meta: { numeric: true } }),
  col.accessor((row) => row.ratio ?? undefined, { id: "ratio", header: "Effort", meta: { numeric: true } }),
]);

function bodyRows(): HTMLElement[] {
  return screen.getAllByRole("row").slice(1);
}

function keysInOrder(): (string | null)[] {
  return bodyRows().map((row) => within(row).getAllByRole("cell")[0].textContent);
}

function header(name: string): HTMLElement {
  return screen.getByRole("columnheader", { name });
}

describe("DataTable sorting", () => {
  it("sorts by a header, says so with aria-sort, and keeps the reading order natural", async () => {
    const user = userEvent.setup();
    renderKit(<DataTable caption="Findings" data={ROWS} columns={COLUMNS} getRowId={(row) => row.id} />);

    expect(keysInOrder()).toEqual(["DEMO-2", "DEMO-10", "DEMO-1"]);
    expect(header("Issue")).not.toHaveAttribute("aria-sort");

    await user.click(screen.getByRole("button", { name: "Issue" }));
    // Issue keys sort as people read them: DEMO-2 before DEMO-10.
    expect(keysInOrder()).toEqual(["DEMO-1", "DEMO-2", "DEMO-10"]);
    expect(header("Issue")).toHaveAttribute("aria-sort", "ascending");

    await user.click(screen.getByRole("button", { name: "Issue" }));
    expect(keysInOrder()).toEqual(["DEMO-10", "DEMO-2", "DEMO-1"]);
    expect(header("Issue")).toHaveAttribute("aria-sort", "descending");
  });

  it("sorts a figure column largest first, and only one column at a time", async () => {
    const user = userEvent.setup();
    renderKit(<DataTable caption="Findings" data={ROWS} columns={COLUMNS} getRowId={(row) => row.id} />);

    await user.click(screen.getByRole("button", { name: "Issue" }));
    await user.click(screen.getByRole("button", { name: "Age" }));
    expect(keysInOrder()).toEqual(["DEMO-10", "DEMO-1", "DEMO-2"]);
    expect(header("Age")).toHaveAttribute("aria-sort", "descending");
    expect(header("Issue")).not.toHaveAttribute("aria-sort");
  });

  it("puts a missing figure last in both directions", async () => {
    const user = userEvent.setup();
    renderKit(<DataTable caption="Findings" data={ROWS} columns={COLUMNS} getRowId={(row) => row.id} />);

    await user.click(screen.getByRole("button", { name: "Effort" }));
    expect(keysInOrder()).toEqual(["DEMO-2", "DEMO-1", "DEMO-10"]);
    await user.click(screen.getByRole("button", { name: "Effort" }));
    expect(keysInOrder()).toEqual(["DEMO-1", "DEMO-2", "DEMO-10"]);
  });

  it("reports sorting to its owner when the URL holds it", async () => {
    const user = userEvent.setup();
    const onSortingChange = vi.fn();
    renderKit(
      <DataTable
        caption="Findings"
        data={ROWS}
        columns={COLUMNS}
        getRowId={(row) => row.id}
        sorting={[]}
        onSortingChange={onSortingChange}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Age" }));
    expect(onSortingChange).toHaveBeenCalledWith([{ id: "age", desc: true }]);
    // Controlled: nothing moves until the owner passes the new sorting back.
    expect(keysInOrder()).toEqual(["DEMO-2", "DEMO-10", "DEMO-1"]);
  });
});

describe("DataTable keyboard and opening", () => {
  it("keeps one tab stop and moves it with j, k, Home and End", async () => {
    const user = userEvent.setup();
    renderKit(<DataTable caption="Findings" data={ROWS} columns={COLUMNS} getRowId={(row) => row.id} onRowOpen={() => {}} />);
    const [first, second, third] = bodyRows();

    expect(first).toHaveAttribute("tabindex", "0");
    expect(second).toHaveAttribute("tabindex", "-1");

    act(() => first.focus());
    await user.keyboard("j");
    expect(second).toHaveFocus();
    expect(second).toHaveAttribute("tabindex", "0");
    expect(first).toHaveAttribute("tabindex", "-1");

    await user.keyboard("k");
    expect(first).toHaveFocus();
    await user.keyboard("{End}");
    expect(third).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(second).toHaveFocus();
    await user.keyboard("{Home}");
    expect(first).toHaveFocus();
  });

  it("opens a row with Enter or a click, and marks the open row as current", async () => {
    const user = userEvent.setup();
    const onRowOpen = vi.fn();
    const { rerender } = renderKit(
      <DataTable caption="Findings" data={ROWS} columns={COLUMNS} getRowId={(row) => row.id} onRowOpen={onRowOpen} />,
    );
    const [first, second] = bodyRows();

    act(() => first.focus());
    await user.keyboard("{Enter}");
    expect(onRowOpen).toHaveBeenLastCalledWith(ROWS[0]);

    await user.click(within(second).getByText("DEMO-10"));
    expect(onRowOpen).toHaveBeenLastCalledWith(ROWS[1]);

    rerender(
      <DataTable
        caption="Findings"
        data={ROWS}
        columns={COLUMNS}
        getRowId={(row) => row.id}
        onRowOpen={onRowOpen}
        selectedRowId="b"
      />,
    );
    expect(bodyRows()[1]).toHaveAttribute("aria-current", "true");
    expect(bodyRows()[0]).not.toHaveAttribute("aria-current");
  });

  it("lets j reach the page's main table from anywhere outside a field", async () => {
    const user = userEvent.setup();
    renderKit(
      <DataTable
        caption="Findings"
        data={ROWS}
        columns={COLUMNS}
        getRowId={(row) => row.id}
        onRowOpen={() => {}}
        keyboardScope="page"
      />,
    );
    await user.keyboard("j");
    expect(bodyRows()[0]).toHaveFocus();
    await user.keyboard("j");
    expect(bodyRows()[1]).toHaveFocus();
  });
});

describe("DataTable states", () => {
  it("keeps the real head over placeholder rows while loading, and says so once", () => {
    renderKit(<DataTable caption="Findings" data={[]} columns={COLUMNS} getRowId={(row) => row.id} loading loadingRows={3} />);
    expect(screen.getByRole("columnheader", { name: "Issue" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Loading findings");
    expect(screen.getByRole("table")).toHaveAttribute("aria-busy", "true");
  });

  it("shows what was looked at when there are no rows", () => {
    renderKit(
      <DataTable
        caption="Findings"
        data={[]}
        columns={COLUMNS}
        getRowId={(row) => row.id}
        empty={<p>No findings match these filters</p>}
      />,
    );
    expect(screen.getByText("No findings match these filters")).toBeInTheDocument();
  });

  it("keeps the empty state to the visible width of a table that scrolls sideways", () => {
    renderKit(
      <DataTable
        caption="Findings"
        data={[]}
        columns={COLUMNS}
        getRowId={(row) => row.id}
        minWidth="66rem"
        empty={<p>No findings match these filters</p>}
      />,
    );
    // The scroller is the container the empty state measures; the message sticks to its left edge at its width.
    const holder = screen.getByText("No findings match these filters").closest("[data-empty-state]");
    expect(holder).toHaveClass("sticky", "left-0", "w-[100cqi]");
    expect(holder?.closest(".jo-scroller")).toHaveClass("@container");
    // The cell lets go of its overflow, which would otherwise hold the sticky part in place.
    expect(holder?.closest("td")).toHaveClass("!overflow-visible", "!px-0");
  });

  it("measures nothing while there are rows", () => {
    renderKit(<DataTable caption="Findings" data={ROWS} columns={COLUMNS} getRowId={(row) => row.id} minWidth="66rem" />);
    expect(document.querySelector(".jo-scroller")).not.toHaveClass("@container");
    expect(document.querySelector("[data-empty-state]")).toBeNull();
  });

  it("can be scrolled by keyboard while no row takes focus (loading, empty): its frame is a named stop; with rows, the row is", () => {
    // axe's scrollable-region-focusable: a table wider than its frame (a phone, a zoomed window) must be reachable.
    const scroller = () => document.querySelector(".jo-scroller") as HTMLElement;
    const loading = renderKit(<DataTable caption="Findings" data={[]} columns={COLUMNS} getRowId={(row) => row.id} minWidth="66rem" loading />);
    expect(scroller()).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("region", { name: "Findings" })).toBe(scroller());
    loading.unmount();

    const empty = renderKit(<DataTable caption="Findings" data={[]} columns={COLUMNS} getRowId={(row) => row.id} minWidth="66rem" empty={<p>None</p>} />);
    expect(scroller()).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("region", { name: "Findings" })).toBe(scroller());
    empty.unmount();

    // With rows, one row is the table's stop: the frame is no second one before it.
    renderKit(<DataTable caption="Findings" data={ROWS} columns={COLUMNS} getRowId={(row) => row.id} minWidth="66rem" />);
    expect(scroller()).not.toHaveAttribute("tabindex");
    expect(scroller()).not.toHaveAttribute("role");
    expect(bodyRows().filter((row) => row.getAttribute("tabindex") === "0")).toHaveLength(1);
  });
});

describe("DataTable width (JO-14)", () => {
  it("keeps its least width on a desktop and takes its scroll width once its frame is narrower, as it scrolls anyway", () => {
    expect(tableMinWidth("62rem")).toBe("62rem");
    // A step at the frame's width (100cqw, the scroller being a container): at or above 62rem the table fits the
    // frame; below it, 68rem, room for the titles a 62rem table squeezed to 80 px on a phone.
    expect(tableMinWidth("62rem", "68rem")).toBe("clamp(62rem, calc(62rem + (62rem - 100cqw) * 1000), 68rem)");
  });

  it("makes its scroller a container only when it has a scroll width", () => {
    const col = dataTableColumns<{ id: string; name: string }>();
    const columns = col.columns([col.accessor("name", { header: "Name" })]);
    const rows = [{ id: "a", name: "Ada" }];
    const { unmount } = renderKit(<DataTable caption="Plain" data={rows} columns={columns} getRowId={(row) => row.id} minWidth="40rem" />);
    expect(screen.getByRole("table", { name: "Plain" }).parentElement).not.toHaveClass("@container");
    unmount();
    renderKit(<DataTable caption="Wide" data={rows} columns={columns} getRowId={(row) => row.id} minWidth="40rem" scrollWidth="48rem" />);
    expect(screen.getByRole("table", { name: "Wide" }).parentElement).toHaveClass("@container");
  });
});
