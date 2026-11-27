import { describe, expect, it } from "vitest";

import { FINDINGS_CSV, describeFilters, findingStatus, ignoreSentence, STATUS_LABEL } from "../model";
import { actionable, isSelected, NO_SELECTION, pageState } from "../selection";
import { hasActiveFilters, ignoreQueryOf, toFindingsQuery, type FindingsFilters } from "../url-state";
import { SAMPLE } from "./harness";

const DEFAULTS: FindingsFilters = {
  q: "",
  severity: null,
  state: "open",
  rule: [],
  epic: [],
  person: [],
  first_seen: "all",
  ticket: null,
  sort: "first_seen_at",
  order: "desc",
  page: 1,
};

const ITEMS = SAMPLE.findings.items as unknown as Parameters<typeof actionable>[0][];
const AT = "2026-11-04T14:30:00.000Z";

describe("an ignored finding in words", () => {
  it("is its own state, neither open nor resolved", () => {
    expect(findingStatus({ state: "ignored", resolved_why: "ignored" })).toBe("ignored");
    expect(STATUS_LABEL.ignored).toBe("Ignored");
  });

  it("says who ignored it only where the API named them, the date in the reader's form, and why", () => {
    const options = { locale: "en-GB", timeZone: "UTC" };
    expect(ignoreSentence({ by: "Morgan Ellis", at: AT, reason: "Closed long ago" }, options)).toBe("Ignored by Morgan Ellis on 4 Nov 2026: Closed long ago");
    expect(ignoreSentence({ by: null, at: AT, reason: null }, options)).toBe("Ignored on 4 Nov 2026");
    expect(ignoreSentence({ by: "Morgan Ellis", at: AT, reason: null }, { locale: "en-US", timeZone: "UTC" })).toBe("Ignored by Morgan Ellis on Nov 4, 2026");
  });

  it("exports who ignored it, when and why", () => {
    const headers = FINDINGS_CSV.map((column) => column.header);
    expect(headers.slice(-3)).toEqual(["Ignored by", "Ignored (UTC)", "Ignore reason"]);
    const ignored = { ...ITEMS[1], state: "ignored", ignore: { scope: "finding", rule_id: ITEMS[1].rule_id, reason: "Old", by: "Morgan Ellis", at: AT } } as typeof ITEMS[number];
    expect(FINDINGS_CSV.slice(-3).map((column) => column.value(ignored))).toEqual(["Morgan Ellis", AT, "Old"]);
    expect(FINDINGS_CSV.slice(-3).map((column) => column.value(ITEMS[1]))).toEqual([undefined, undefined, undefined]);
  });
});

describe("the Ticket filter", () => {
  it("narrows the list, travels to the API and is said in the print line", () => {
    const finished = { ...DEFAULTS, ticket: "finished" as const };
    expect(hasActiveFilters(finished)).toBe(true);
    expect(toFindingsQuery(finished).ticket).toBe("finished");
    expect(toFindingsQuery(DEFAULTS).ticket).toBeUndefined();
    expect(describeFilters({ ...finished, state: "ignored" }, ["DEMO"])).toBe("ignored findings in DEMO, on finished tickets");
  });

  it("names every open finding the filters match as an ignore's target, nothing that does not narrow", () => {
    expect(ignoreQueryOf(DEFAULTS)).toEqual({});
    expect(ignoreQueryOf({ ...DEFAULTS, severity: "breach", rule: ["R-EST-01"], ticket: "finished", q: " DEMO-12 ", state: "all", page: 3 })).toEqual({
      severity: "breach",
      rule: ["R-EST-01"],
      ticket: "finished",
      q: "DEMO-12",
    });
  });
});

describe("a selection", () => {
  it("takes open findings on tickets and ignored ones; never a sprint's or a resolved one", () => {
    const sprint = ITEMS.find((finding) => finding.scope === "sprint")!;
    const open = ITEMS.find((finding) => finding.scope === "issue")!;
    expect(actionable(sprint)).toBe(false);
    expect(actionable(open)).toBe(true);
    expect(actionable({ ...open, state: "resolved" })).toBe(false);
    expect(actionable({ ...open, state: "ignored" })).toBe(true);
  });

  it("says whether the page is picked whole, in part or not at all", () => {
    const rows = ITEMS.filter(actionable);
    expect(pageState(NO_SELECTION, ITEMS)).toBe("none");
    expect(pageState({ kind: "rows", ids: new Set([rows[0].finding_id]) }, ITEMS)).toBe("some");
    expect(pageState({ kind: "rows", ids: new Set(rows.map((finding) => finding.finding_id)) }, ITEMS)).toBe("all");
    expect(pageState({ kind: "matching" }, ITEMS)).toBe("all");
    expect(isSelected({ kind: "matching" }, ITEMS.find((finding) => finding.scope === "sprint")!)).toBe(false);
  });
});
