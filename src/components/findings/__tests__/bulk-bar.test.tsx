import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import findingsJson from "../../../../docs/sample-responses/findings.json";
import { findingsPageSchema } from "@/lib/api/schemas";

import { BulkBar } from "../bulk-bar";
import type { Selection } from "../selection";

vi.mock("@/components/shell/kbd", () => ({ Keys: () => null }));

const ROWS = findingsPageSchema.parse(findingsJson).items.filter((finding) => finding.issue_key !== null);

function bar(matchState: "open" | "ignored" | "resolved" | "all", selection: Selection) {
  render(
    <BulkBar
      selection={selection}
      rows={ROWS}
      total={329}
      matchState={matchState}
      onSelectMatching={vi.fn()}
      onClear={vi.fn()}
      onIgnore={vi.fn()}
      onRestore={vi.fn()}
    />,
  );
}

const PAGE: Selection = { kind: "rows", ids: new Set(ROWS.map((finding) => finding.finding_id)) };

describe("the selection's bar", () => {
  it("offers every match in the ignored view, and its name carries the words it shows", () => {
    bar("ignored", PAGE);
    const button = screen.getByRole("button", { name: /matching/ });
    expect(button).not.toHaveAttribute("aria-label");
    expect(button.textContent).toContain("329 matching");
  });

  it("offers no ignore of every match where the filters list something else", () => {
    bar("resolved", PAGE);
    expect(screen.queryByRole("button", { name: /matching/ })).toBeNull();
  });

  it("restores, and does not ignore, when every match of the ignored view is picked", () => {
    bar("ignored", { kind: "matching" });
    expect(screen.getByRole("button", { name: "Restore" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ignore" })).toBeNull();
  });
});
