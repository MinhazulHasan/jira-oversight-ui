import { fireEvent, screen } from "@testing-library/react";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";

import type * as MentionMenu from "@/components/ask/mention-menu";
import { renderKit } from "@/components/ui/__tests__/kit";
import type { DirectoryEntry } from "@/lib/api/schemas";

import directoryJson from "../../../../docs/sample-responses/people-directory.json";
import { pickerGroups, PersonPicker } from "../person-picker";

vi.mock("@/components/ask/mention-menu", async (importOriginal) => {
  const actual = await importOriginal<typeof MentionMenu>();
  const { useLayoutEffect, useState } = await import("react");
  return {
    ...actual,
    // As a browser fits it: a height worked out after the list is laid out, which draws the list again on its own.
    useFittedHeight: () => {
      const [height, setHeight] = useState<number | null>(null);
      useLayoutEffect(() => setHeight(200), []);
      return height;
    },
  };
});

const directory = directoryJson.people as DirectoryEntry[];

async function blocking(): Promise<string[]> {
  const results = await axe.run(document.body, {
    runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
    rules: { region: { enabled: false } },
  });
  return results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical").map((violation) => violation.id);
}

describe("the person picker, its list fitted (the JO-11 check)", () => {
  it("names a row that is there, highlighted, from the moment it opens, through the arrow keys, and passes axe", async () => {
    const order = pickerGroups(directory, "").flatMap((group) => group.entries.map((entry) => entry.person.name));
    renderKit(<PersonPicker entries={directory} state="success" onRetry={vi.fn()} value={null} onValueChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Person: choose someone/ }));
    const field = screen.getByRole("combobox", { name: "Search people" });
    const active = () => document.getElementById(field.getAttribute("aria-activedescendant") ?? "");

    // Every row's id is its place in the one list the keys run through, once each, however often the list is drawn.
    const options = screen.getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(order.map((name) => expect.stringContaining(name)));
    expect(options.map((option) => option.id.replace(/^.*-option-/, ""))).toEqual(order.map((_, index) => String(index)));

    expect(active()).not.toBeNull();
    expect(active()).toHaveAttribute("data-active", "true");
    expect(active()).toHaveTextContent(order[0]);
    expect(options.filter((option) => option.hasAttribute("data-active"))).toHaveLength(1);
    expect(await blocking()).toEqual([]);

    fireEvent.keyDown(field, { key: "ArrowDown" });
    expect(active()).toHaveTextContent(order[1]);
    fireEvent.keyDown(field, { key: "End" });
    expect(active()).toHaveTextContent(order.at(-1)!);
    expect(await blocking()).toEqual([]);
  });
});
