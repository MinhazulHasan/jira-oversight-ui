import { describe, expect, it } from "vitest";

import { segmentAnswer } from "../citations";
import type { Citation } from "../schemas";

function cite(marker: number, text: string, column = "value"): Citation {
  return { marker, text, fact_ref: "F1", row_index: 0, column };
}

const rendered = (answer: string, citations: Citation[]) =>
  segmentAnswer(answer, citations)
    .map((segment) => (segment.kind === "cite" ? `[${segment.citation.marker}:${segment.text}]` : segment.text))
    .join("");

describe("segmentAnswer", () => {
  it("splits an answer into prose and cited values, in order", () => {
    const answer = "DEMO-704 Data import pipeline has 73 open breaches, up from 71 a week ago.";
    expect(rendered(answer, [cite(1, "DEMO-704", "epic_key"), cite(2, "73"), cite(3, "71")])).toBe(
      "[1:DEMO-704] Data import pipeline has [2:73] open breaches, up from [3:71] a week ago.",
    );
  });

  it("binds a value written twice to the occurrence its order points at", () => {
    const answer = "6 tickets went straight to Done; the table lists all 6.";
    expect(rendered(answer, [cite(1, "6"), cite(2, "6")])).toBe("[1:6] tickets went straight to Done; the table lists all [2:6].");
  });

  it("never lands inside a rule id, a key or a longer number", () => {
    expect(rendered("R-FLOW-02 fired on 2 issues.", [cite(1, "2")])).toBe("R-FLOW-02 fired on [1:2] issues.");
    expect(rendered("DEMO-15 took 1.5 hours, about 15 in all.", [cite(1, "DEMO-15", "issue_key"), cite(2, "1.5"), cite(3, "15")])).toBe(
      "[1:DEMO-15] took [2:1.5] hours, about [3:15] in all.",
    );
    expect(rendered("A ratio of 1.42× against 1.", [cite(1, "1")])).toBe("A ratio of 1.42× against [1:1].");
  });

  it("keeps units and signs outside the cited value", () => {
    expect(rendered("a median of 41.2 h, 16% of them, 1.42× the estimate", [cite(1, "41.2"), cite(2, "16%"), cite(3, "1.42")])).toBe(
      "a median of [1:41.2] h, [2:16%] of them, [3:1.42]× the estimate",
    );
  });

  it("follows markers, not array order, and leaves out what it cannot find", () => {
    const answer = "Seen on 26 Oct 2026, 12 times.";
    expect(rendered(answer, [cite(2, "12"), cite(1, "26 Oct 2026", "week_of"), cite(3, "99")])).toBe(
      "Seen on [1:26 Oct 2026], [2:12] times.",
    );
  });

  it("returns the answer whole when nothing is cited", () => {
    expect(segmentAnswer("Nothing to cite here.", [])).toEqual([{ kind: "text", text: "Nothing to cite here." }]);
  });
});
