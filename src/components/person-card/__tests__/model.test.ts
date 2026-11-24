import { describe, expect, it } from "vitest";

import { UNNAMED_ACCOUNT, type PersonCard } from "@/lib/api/schemas";

import cardSample from "../../../../docs/sample-responses/person-card.json";
import memberSample from "../../../../docs/sample-responses/person-card-member.json";
import {
  askAboutHref,
  boardsText,
  boardsThatFit,
  FINDINGS_LABEL,
  findingsHref,
  findingsText,
  firstName,
  headerLine,
  idleLine,
  inProgressFor,
  issueHref,
  meterSummary,
  moreText,
  noComparisonLine,
  processSentence,
  processSentenceParts,
  scorecardLink,
  workingOnHref,
} from "../model";

const ada = cardSample as PersonCard;
const noor = memberSample as PersonCard;

describe("the header's plain line", () => {
  it("says how many open tickets they hold on the board, or that they are a member who holds none", () => {
    expect(headerLine(ada, "en-GB").text).toBe(`Holds ${ada.work.open_tickets} open tickets on Demo project`);
    expect(headerLine({ ...ada, work: { ...ada.work, open_tickets: 1 } }, "en-GB").text).toBe("Holds 1 open ticket on Demo project");
    expect(headerLine({ ...ada, work: { ...ada.work, open_tickets: 1234, in_progress: 0 } }, "en-GB").text).toBe("Holds 1,234 open tickets on Demo project");
    // Holds tickets, all of them finished: nothing open, but not a member who holds none.
    expect(headerLine({ ...ada, work: { ...ada.work, open_tickets: 0, in_progress: 0 } }, "en-GB").text).toBe("No open tickets on Demo project");
    expect(headerLine(noor, "en-GB").text).toBe("Member of Demo project · no tickets");
  });

  it("names the board as the top bar does, by its name (the brief's 'on AILED'), its key in the tooltip", () => {
    const ailed = { ...ada, board: { key: "AIL", name: "AILED" }, work: { ...ada.work, open_tickets: 8 } };
    const line = headerLine(ailed, "en-GB");
    expect(line.text).toBe("Holds 8 open tickets on AILED");
    expect(line.board).toBe("AILED");
    expect(line.title).toBe("Holds 8 open tickets on AILED (AIL)");
    expect(headerLine({ ...noor, board: { key: "AIL", name: "AILED" } }, "en-GB").text).toBe("Member of AILED · no tickets");
    // A board with no name of its own goes by its key, said once.
    const bare = headerLine({ ...ada, board: { key: "AIL", name: "AIL" } }, "en-GB");
    expect([bare.text, bare.title]).toEqual([`Holds ${ada.work.open_tickets} open tickets on AIL`, `Holds ${ada.work.open_tickets} open tickets on AIL`]);
  });
});

describe("the process meter's words", () => {
  it("say what the scorecard says, counting the measures they were compared on", () => {
    expect(processSentence({ closer: 5, level: 1, further: 2, too_few: 2, measurable: 10 }, "en-GB")).toBe(
      "Closer to the process than the board on 5 of 8 measures.",
    );
    expect(processSentence({ closer: 0, level: 1, further: 0, too_few: 6, measurable: 7 }, "en-GB")).toBe(
      "Closer to the process than the board on 0 of 1 measure.",
    );
    // In parts, for the card to set the figures in Plex Mono: the same words.
    expect(processSentenceParts({ closer: 5, level: 1, further: 2, too_few: 2, measurable: 10 }, "en-GB")).toEqual({
      lead: "Closer to the process than the board",
      closer: "5",
      compared: "8",
      noun: "measures",
    });
    expect(meterSummary({ closer: 5, level: 1, further: 2, too_few: 2, measurable: 10 }, "en-GB")).toBe(
      "5 closer, 1 level, 2 further and 2 with too few tickets, of 10 measures",
    );
  });

  it("say why there is no meter: no tickets here at all, or too few on every measure", () => {
    expect(noComparisonLine(noor)).toBe("Nothing to compare: no tickets on this board.");
    expect(noComparisonLine(ada)).toBe("Too few tickets to compare with the board on any measure.");
    // And when nothing is in progress: a holder now, a member on this board at all.
    expect(idleLine(ada)).toBe("Nothing in progress now.");
    expect(idleLine(noor)).toBe("Nothing in progress on this board.");
  });
});

describe("the rest of the card's words", () => {
  it("say how long a ticket has been in progress, as of the snapshot, in whole units", () => {
    const asOf = "2026-11-04T14:28:00Z";
    expect(inProgressFor("2026-11-04T14:00:00Z", asOf)).toBe("for less than an hour");
    expect(inProgressFor("2026-11-04T13:28:00Z", asOf)).toBe("for 1 hour");
    expect(inProgressFor("2026-11-04T09:00:00Z", asOf)).toBe("for 5 hours");
    expect(inProgressFor("2026-11-03T14:28:00Z", asOf)).toBe("for 1 day");
    expect(inProgressFor("2026-11-01T10:00:00Z", asOf)).toBe("for 3 days");
    // A clock a little ahead of the snapshot never reads as a negative time.
    expect(inProgressFor("2026-11-04T15:00:00Z", asOf)).toBe("for less than an hour");
    // A start the service does not know (the contract's null): no time at all, never a made-up one.
    expect(inProgressFor(null, asOf)).toBeNull();
  });

  it("count the tickets beyond the three, the findings, and name the person for Ask by their first name", () => {
    expect(moreText(0)).toBeNull();
    expect(moreText(4, "en-GB")).toBe("and 4 more");
    // Under a label that says they are open, and on every ticket they hold, done ones too (the scorecard's words).
    expect(FINDINGS_LABEL).toBe("Open findings on all their tickets");
    expect(findingsText(1, "breach", "en-GB")).toBe("1 breach");
    expect(findingsText(82, "warning", "en-GB")).toBe("82 warnings");
    expect(firstName("Ada Brooks")).toBe("Ada");
    expect(firstName("  Tomás Ferreira ")).toBe("Tomás");
    expect(firstName("Cher")).toBe("Cher");
    expect(firstName(UNNAMED_ACCOUNT)).toBe("them");
  });
});

describe("the other boards' line", () => {
  it("lists every board that fits whole, and else as many as fit before '+N more', never none", () => {
    // "Also on" takes 50; boards of 120, 110, 90 and 80; "+N more" takes 60.
    const widths = [120, 110, 90, 80];
    expect(boardsThatFit(50, widths, 60, 460)).toBe(4);
    expect(boardsThatFit(50, widths, 60, 450)).toBe(4);
    // Not all: as many as leave room for "+N more" after them.
    expect(boardsThatFit(50, widths, 60, 449)).toBe(3);
    expect(boardsThatFit(50, widths, 60, 308)).toBe(1);
    expect(boardsThatFit(50, widths, 60, 340)).toBe(2);
    // However narrow, the first board is listed (the line then ends in an ellipsis).
    expect(boardsThatFit(50, widths, 60, 100)).toBe(1);
    // Half a pixel of rounding is no reason to leave one out.
    expect(boardsThatFit(50, [120, 110], 60, 279.6)).toBe(2);
    // No layout to measure (a test's document): every board.
    expect(boardsThatFit(0, [0, 0, 0], 0, 0)).toBe(3);
  });

  it("names the ones left out, for the tooltip and a screen reader", () => {
    expect(boardsText([{ key: "OPS", open_tickets: 2 }], "en-GB")).toBe("OPS (2 open)");
    expect(boardsText([{ key: "OPS", open_tickets: 2 }, { key: "WEB", open_tickets: 1 }], "en-GB")).toBe("OPS (2 open) and WEB (1 open)");
    expect(boardsText([{ key: "A", open_tickets: 1 }, { key: "B", open_tickets: 1200 }, { key: "C", open_tickets: 3 }], "en-GB")).toBe(
      "A (1 open), B (1,200 open) and C (3 open)",
    );
  });
});

describe("the card's ways on", () => {
  it("lead to their scorecard over the card's period, their findings, Ask with them in the box, and what they work on", () => {
    const id = ada.person.id;
    expect(scorecardLink(id, 90)).toBe(`/people?person=${id}`);
    expect(scorecardLink(id, 30)).toBe(`/people?days=30&person=${id}`);
    expect(findingsHref(id)).toBe(`/findings?person=${id}`);
    expect(askAboutHref(id)).toBe(`/ask?about=${id}`);
    expect(workingOnHref(ada.person)).toBe(`/ask?${new URLSearchParams({ q: "What is @Ada Brooks working on?", m: id }).toString()}`);
    expect(issueHref("DEMO-1038")).toBe("/issues/DEMO-1038");
  });
});
