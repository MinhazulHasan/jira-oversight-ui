import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { AnswerSegment } from "@/lib/api/citations";

import { AnswerProse } from "../answer-prose";
import { markerRuns } from "../ledger-parts";

let marker = 0;
const text = (value: string): AnswerSegment => ({ kind: "text", text: value });
const cite = (value: string): AnswerSegment => {
  marker += 1;
  return { kind: "cite", text: value, citation: { marker, text: value, fact_ref: "F1", row_index: 0, column: "n" } };
};

function renderAnswer(segments: AnswerSegment[]) {
  marker = 0;
  render(<AnswerProse segments={segments} describe={(m) => `citation ${m}`} />);
  return document.querySelector("[data-answer-prose]") as HTMLElement;
}

describe("the analyst's answer", () => {
  it("renders Markdown: bold, bullet lists, and every cited key as a link to its page", () => {
    marker = 0;
    const prose = renderAnswer([
      text("Project AIL has **"),
      cite("20"),
      text(" epics**.\n\n- "),
      cite("AIL-18"),
      text(": QNA Bot\n- "),
      cite("AIL-743"),
      text(": Quick Wins"),
    ]);
    expect(prose).not.toHaveTextContent("**");
    expect(within(prose).getByText("20").closest("strong")).not.toBeNull();
    const items = within(prose).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("AIL-18: QNA Bot");
    expect(within(items[0]).getByRole("link", { name: "Open AIL-18" })).toHaveAttribute("href", "/issues/AIL-18");
    expect(within(items[1]).getByRole("link", { name: "Open AIL-743" })).toHaveAttribute("href", "/issues/AIL-743");
    // A figure is not a key: no link after it.
    expect(within(prose).getAllByRole("link")).toHaveLength(2);
  });

  it("renders tables with the cited figures in their cells", () => {
    const prose = renderAnswer([text("| Status | Issues |\n|---|---|\n| To Do | "), cite("12"), text(" |\n| Done | "), cite("877"), text(" |")]);
    const table = within(prose).getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(within(table).getByRole("cell", { name: /877/ })).toBeInTheDocument();
  });

  it("never renders raw HTML, images or the model's own links", () => {
    const prose = renderAnswer([
      text('Before <script>alert(1)</script> ![x](https://example.com/x.png) [site](https://example.com) after'),
    ]);
    expect(prose.querySelector("script")).toBeNull();
    expect(prose.querySelector("img")).toBeNull();
    expect(within(prose).queryByRole("link")).toBeNull();
    expect(prose).toHaveTextContent("site");
  });

  it("keeps plain prose answers (the catalogue's) as they were, line breaks included", () => {
    const prose = renderAnswer([text("Tickets sit longest in In Progress: a median of "), cite("47.2"), text(" h.")]);
    expect(prose).toHaveTextContent("Tickets sit longest in In Progress: a median of 47.2 h.");
    expect(screen.queryByRole("list")).toBeNull();
  });
});

describe("marker runs in a fact cell", () => {
  it("compress consecutive markers so the value stays in view", () => {
    expect(markerRuns([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21])).toEqual({
      shown: "2–21",
      spoken: "2 to 21",
    });
    expect(markerRuns([6, 15])).toEqual({ shown: "6,15", spoken: "6, 15" });
    expect(markerRuns([1, 2, 3, 7, 8])).toEqual({ shown: "1–3,7,8", spoken: "1 to 3, 7 to 8" });
    expect(markerRuns([4])).toEqual({ shown: "4", spoken: "4" });
  });
});
