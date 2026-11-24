import { describe, expect, it } from "vitest";

import cardSample from "../../../../docs/sample-responses/person-card.json";
import memberSample from "../../../../docs/sample-responses/person-card-member.json";
import { normalizePersonCardQuery, parsePersonCardQuery, personCardSearchParams } from "../params";
import { ACCESS_ACTION_LABELS, ACCESS_ACTIONS, accessLogEntrySchema, personCardSchema, type PersonCard } from "../schemas";

const card = (): PersonCard => structuredClone(cardSample) as PersonCard;
const issues = (value: unknown) => {
  const parsed = personCardSchema.safeParse(value);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join("."));
};

describe("personCardSchema", () => {
  it("takes the documented cards exactly: someone who holds tickets, and a member who holds none", () => {
    expect(personCardSchema.parse(cardSample)).toStrictEqual(cardSample);
    expect(personCardSchema.parse(memberSample)).toStrictEqual(memberSample);
  });

  it("drops anything about a person the contract does not name", () => {
    const body = { ...card(), person: { ...card().person, emailAddress: "a@b.co", timeZone: "Europe/London", accountId: "557058:x" } };
    expect(personCardSchema.parse(body).person).toEqual(card().person);
  });

  it("refuses more in progress than open, and a list that is not the tickets in progress", () => {
    const more = card();
    more.work.in_progress = more.work.open_tickets + 1;
    expect(issues(more)).toContain("work.in_progress");
    const counted = card();
    counted.in_progress_more += 1;
    expect(issues(counted)).toContain("in_progress_more");
    const short = card();
    short.in_progress_now = short.in_progress_now.slice(0, 2);
    short.in_progress_more += 1;
    expect(issues(short)).toContain("in_progress_now");
  });

  it("refuses the tickets in progress in any order but the longest first, or one listed twice", () => {
    const reversed = card();
    reversed.in_progress_now.reverse();
    expect(issues(reversed)).toContain("in_progress_now.1.since");
    const twice = card();
    twice.in_progress_now[1] = { ...twice.in_progress_now[0] };
    expect(issues(twice)).toContain("in_progress_now.1.key");
    const four = card();
    four.in_progress_now.push({ ...four.in_progress_now[2], key: "DEMO-1" });
    expect(issues(four).length).toBeGreaterThan(0);
  });

  it("takes a ticket whose start the service does not know (since null) listed last, and refuses it before a dated one", () => {
    const unknown = card();
    unknown.in_progress_now[2] = { ...unknown.in_progress_now[2], since: null };
    expect(issues(unknown)).toEqual([]);
    expect(personCardSchema.parse(unknown).in_progress_now[2].since).toBeNull();
    const first = card();
    first.in_progress_now[0] = { ...first.in_progress_now[0], since: null };
    expect(issues(first)).toContain("in_progress_now.1.since");
  });

  it("refuses a process meter that does not add up, and one that compares nothing (that is null)", () => {
    const sum = card();
    sum.process = { ...sum.process!, measurable: sum.process!.measurable + 1 };
    expect(issues(sum)).toContain("process.measurable");
    const none = card();
    none.process = { closer: 0, level: 0, further: 0, too_few: 7, measurable: 7 };
    expect(issues(none)).toContain("process.closer");
    expect(issues({ ...card(), process: null })).toEqual([]);
  });

  it("refuses the board read among the other boards, a board twice, and an other board with no open tickets", () => {
    expect(issues({ ...card(), other_boards: [{ key: "DEMO", name: "Demo project", open_tickets: 2 }] })).toContain("other_boards.0.key");
    const twice = [
      { key: "OPS", name: "Operations", open_tickets: 2 },
      { key: "OPS", name: "Operations", open_tickets: 1 },
    ];
    expect(issues({ ...card(), other_boards: twice })).toContain("other_boards.1.key");
    expect(issues({ ...card(), other_boards: [{ key: "OPS", name: "Operations", open_tickets: 0 }] })).toContain("other_boards.0.open_tickets");
  });

  it("refuses figures for a member who holds no tickets, and another period than the scorecard's three", () => {
    const member = structuredClone(memberSample) as PersonCard;
    expect(issues({ ...member, work: { ...member.work, open_tickets: 1 } })).toContain("membership");
    expect(issues({ ...member, findings: { open_breaches: 1, open_warnings: 0 } })).toContain("membership");
    expect(issues({ ...card(), work: { ...card().work, days: 60 } })).toContain("work.days");
  });
});

describe("the card's parameters", () => {
  it("are the period (90 days unless said) and the board the page names, each checked", () => {
    expect(normalizePersonCardQuery()).toEqual({ days: 90 });
    expect(personCardSearchParams({ days: 90 }).toString()).toBe("");
    expect(personCardSearchParams({ days: 30, board: "OPS" }).toString()).toBe("days=30&board=OPS");
    expect(personCardSearchParams({ board: null }).toString()).toBe("");
    expect(parsePersonCardQuery(new URLSearchParams("days=180&board=WEB"))).toEqual({ ok: true, value: { days: 180, board: "WEB" } });
    for (const bad of ["days=45", "days=30&days=90", "board=web-1", "project=DEMO", "level=people", "person=pbc7fe62842ca"]) {
      expect(parsePersonCardQuery(new URLSearchParams(bad)).ok, bad).toBe(false);
    }
  });
});

describe("the access log's words for a card read", () => {
  it("are a seventh action, last in the catalogue's order, in plain words", () => {
    expect(ACCESS_ACTIONS.at(-1)).toBe("person_card_view");
    expect(ACCESS_ACTION_LABELS.person_card_view).toBe("Viewed a person card");
    const entry = {
      id: "e1",
      at: "2026-11-04T14:20:00Z",
      viewer: { hash: "local", name: "Local (sign-in off)" },
      level: "people",
      project: "DEMO",
      action: "person_card_view",
      subjects: [cardSample.person],
      detail: { days: 90 },
    };
    expect(accessLogEntrySchema.parse(entry).detail).toEqual({ days: 90, qa_id: null, entries: null });
  });
});
