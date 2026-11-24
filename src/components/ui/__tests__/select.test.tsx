import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Select } from "../select";
import { renderKit } from "./kit";

const CHECKS = [
  { value: "time_in_status_over", label: "Time in a status" },
  { value: "open_longer_than", label: "Open too long" },
] as const;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Select", () => {
  it("opens a list at least as wide as its trigger, measured as it opens, and picks from it", async () => {
    // The trigger is a form's full width; jsdom lays nothing out, so its width is said here.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return DOMRect.fromRect({ width: this.getAttribute("role") === "combobox" ? 552 : 0, height: 32 });
    });
    const picked = vi.fn();
    const user = userEvent.setup();
    renderKit(<Select label="What to check" options={CHECKS} value={undefined} onValueChange={picked} placeholder="Pick a check" />);

    await user.click(screen.getByRole("combobox", { name: "What to check" }));
    const list = await screen.findByRole("listbox");
    expect(list.style.minWidth).toBe("552px");
    expect(list.className).not.toContain("--radix-select-trigger-width");
    await user.click(screen.getByRole("option", { name: "Open too long" }));
    expect(picked).toHaveBeenCalledWith("open_longer_than");
  });
});
