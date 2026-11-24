import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { SegmentedControl } from "../segmented-control";
import { renderKit } from "./kit";

type Period = "7d" | "30d" | "90d" | "all";

const OPTIONS = [
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
  { value: "all", label: "All" },
] as const;

function Harness({ onChange }: { onChange: (value: Period) => void }) {
  const [value, setValue] = useState<Period>("30d");
  return (
    <SegmentedControl
      label="Period"
      options={OPTIONS}
      value={value}
      onValueChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

describe("SegmentedControl", () => {
  it("is a named radio group with the choice checked", () => {
    renderKit(<Harness onChange={() => {}} />);
    expect(screen.getByRole("radiogroup", { name: "Period" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(4);
    expect(screen.getByRole("radio", { name: "30d" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "7d" })).toHaveAttribute("aria-checked", "false");
  });

  it("chooses on a press", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderKit(<Harness onChange={onChange} />);
    await user.click(screen.getByRole("radio", { name: "90d" }));
    expect(onChange).toHaveBeenCalledWith("90d");
    expect(screen.getByRole("radio", { name: "90d" })).toHaveAttribute("aria-checked", "true");
  });

  it("moves and chooses with the arrow keys, from one tab stop", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderKit(<Harness onChange={onChange} />);
    const checked = screen.getByRole("radio", { name: "30d" });
    act(() => checked.focus());
    const press = async (key: string, expected: Period) => {
      await user.keyboard(`{${key}>}`);
      await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(expected));
      await user.keyboard(`{/${key}}`);
    };
    await press("ArrowRight", "90d");
    expect(screen.getByRole("radio", { name: "90d" })).toHaveFocus();
    await press("ArrowLeft", "30d");
    await press("ArrowLeft", "7d");
  });

  it("names an icon-only option by its label", () => {
    renderKit(
      <SegmentedControl
        label="Show as"
        value="chart"
        onValueChange={() => {}}
        options={[
          { value: "chart", label: "Chart", iconOnly: true },
          { value: "table", label: "Table", iconOnly: true },
        ]}
      />,
    );
    expect(screen.getByRole("radio", { name: "Table" })).toBeInTheDocument();
  });
});
