import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { Combobox, ComboboxPanel, matchesQuery, summarise, toggleValue, type ComboboxOption } from "../combobox";
import { renderKit } from "./kit";

const OPTIONS: ComboboxOption[] = [
  { value: "R-EFF-01", label: "R-EFF-01", description: "Effort far beyond the estimate", mono: true },
  { value: "R-FLOW-02", label: "R-FLOW-02", description: "Skipped a stage", mono: true },
  { value: "W-AGE-01", label: "W-AGE-01", description: "Stuck in a status", keywords: ["stale"], mono: true },
  { value: "R-FLOW-01", label: "R-FLOW-01", description: "Reached testing without code review", mono: true },
];

describe("combobox helpers", () => {
  it("matches every word against the value, label, description and keywords", () => {
    expect(matchesQuery(OPTIONS[1], "flow skipped")).toBe(true);
    expect(matchesQuery(OPTIONS[2], "STALE")).toBe(true);
    expect(matchesQuery(OPTIONS[0], "flow")).toBe(false);
    expect(matchesQuery(OPTIONS[0], "  ")).toBe(true);
  });

  it("summarises the choice for the trigger", () => {
    expect(summarise(OPTIONS, [], "Any")).toBe("Any");
    expect(summarise(OPTIONS, ["R-FLOW-02"], "Any")).toBe("R-FLOW-02");
    expect(summarise(OPTIONS, ["R-FLOW-02", "R-EFF-01"], "Any")).toBe("R-FLOW-02 +1");
  });

  it("keeps the options' order whatever order they are ticked in", () => {
    expect(toggleValue(OPTIONS, ["R-FLOW-01"], "R-EFF-01")).toEqual(["R-EFF-01", "R-FLOW-01"]);
    expect(toggleValue(OPTIONS, ["R-EFF-01", "R-FLOW-01"], "R-EFF-01")).toEqual(["R-FLOW-01"]);
  });
});

function PanelHarness({ onChange }: { onChange: (value: string[]) => void }) {
  const [value, setValue] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  return (
    <ComboboxPanel
      label="Rule"
      options={OPTIONS}
      value={value}
      onValueChange={(next) => {
        setValue(next);
        onChange(next);
      }}
      query={query}
      onQueryChange={setQuery}
    />
  );
}

describe("ComboboxPanel", () => {
  it("filters by typing and ticks with the arrow keys and Enter, keeping focus in the field", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderKit(<PanelHarness onChange={onChange} />);
    const field = screen.getByRole("combobox", { name: "Search rule" });

    await user.click(field);
    await user.keyboard("flow");
    const listbox = screen.getByRole("listbox", { name: "Rule" });
    expect(listbox).toHaveAttribute("aria-multiselectable", "true");
    expect(within(listbox).getAllByRole("option")).toHaveLength(2);

    // The first match is active; the second is one ArrowDown away.
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onChange).toHaveBeenLastCalledWith(["R-FLOW-01"]);
    await user.keyboard("{ArrowUp}{Enter}");
    expect(onChange).toHaveBeenLastCalledWith(["R-FLOW-02", "R-FLOW-01"]);
    expect(field).toHaveFocus();

    const active = field.getAttribute("aria-activedescendant");
    expect(active).toBeTruthy();
    expect(document.getElementById(active ?? "")).toHaveTextContent("R-FLOW-02");
    expect(within(listbox).getByRole("option", { name: /R-FLOW-02/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("2 selected")).toBeInTheDocument();
  });

  it("says when nothing matches, and clears the choice", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderKit(<PanelHarness onChange={onChange} />);
    await user.click(screen.getByRole("option", { name: /R-EFF-01/ }));
    expect(onChange).toHaveBeenLastCalledWith(["R-EFF-01"]);

    await user.type(screen.getByRole("combobox"), "zzz");
    expect(screen.getByText("Nothing matches that.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});

describe("Combobox", () => {
  it("opens from its trigger, and Escape clears the search before it closes", async () => {
    const user = userEvent.setup();
    function Harness() {
      const [value, setValue] = useState<string[]>(["R-FLOW-02"]);
      return <Combobox label="Rule" options={OPTIONS} value={value} onValueChange={setValue} />;
    }
    renderKit(<Harness />);

    const trigger = screen.getByRole("button", { name: "Rule R-FLOW-02" });
    await user.click(trigger);
    const field = screen.getByRole("combobox", { name: "Search rule" });
    expect(field).toHaveFocus();
    expect(screen.getByRole("dialog", { name: "Rule" })).toBeInTheDocument();

    await user.keyboard("age");
    expect(field).toHaveValue("age");
    await user.keyboard("{Escape}");
    expect(field).toHaveValue("");
    expect(screen.getByRole("dialog", { name: "Rule" })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Rule" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("can be opened from outside, and tells its owner when it closes", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <Combobox
          label="Rule"
          options={OPTIONS}
          value={[]}
          onValueChange={() => {}}
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            onOpenChange(next);
          }}
        />
      );
    }
    renderKit(<Harness />);

    expect(screen.getByRole("dialog", { name: "Rule" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Search rule" })).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(screen.queryByRole("dialog", { name: "Rule" })).not.toBeInTheDocument();
  });
});
