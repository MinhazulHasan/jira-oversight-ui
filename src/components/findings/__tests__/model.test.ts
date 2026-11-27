import { describe, expect, it } from "vitest";

import { matchesQuery } from "@/components/ui/combobox";
import { findingDetailSchema, findingsPageSchema } from "@/lib/api/schemas";
import { formatRelative } from "@/lib/format";

import findingSample from "../../../../docs/sample-responses/finding.json";
import sprintSample from "../../../../docs/sample-responses/finding-sprint.json";
import findingsSample from "../../../../docs/sample-responses/findings.json";
import { changelogRows, evidenceText, timelineModel, turnsOn } from "../evidence";
import { personOptions } from "../filter-bar";
import {
  FINDINGS_CSV,
  NO_ONES_LABEL,
  RULES_CLOCK,
  describeFilters,
  findingAgeMs,
  findingClock,
  findingStatus,
  formatAge,
  noOnesReason,
  personFilterName,
  resultSentence,
  resultSummary,
  STATUS_LABEL,
} from "../model";
import { hasActiveFilters, normaliseFindingId, toFindingsQuery, type FindingsFilters } from "../url-state";

const PAGE = findingsPageSchema.parse(findingsSample);
const DETAIL = findingDetailSchema.parse(findingSample);
const SPRINT = findingDetailSchema.parse(sprintSample);

const DEFAULTS: FindingsFilters = {
  q: "",
  severity: null,
  state: "open",
  rule: [],
  epic: [],
  person: [],
  first_seen: "all",
  sort: "first_seen_at",
  order: "desc",
  page: 1,
};

const HOUR = 3_600_000;

describe("how long a finding has been open", () => {
  it("runs from first seen to last seen while open, and to resolution once resolved", () => {
    expect(findingAgeMs(DETAIL.finding)).toBe(4 * HOUR);
    expect(
      findingAgeMs({
        first_seen_at: "2026-10-01T10:00:00.000Z",
        last_seen_at: "2026-10-09T10:00:00.000Z",
        resolved_at: "2026-10-03T22:00:00.000Z",
      }),
    ).toBe(60 * HOUR);
  });

  it("reads in the nearest whole hour under two days and the nearest whole day after", () => {
    expect(formatAge(20 * 60_000, "en-GB")).toBe("<1 h");
    expect(formatAge(44 * 60_000, "en-GB")).toBe("<1 h");
    expect(formatAge(45 * 60_000, "en-GB")).toBe("1 h");
    expect(formatAge(4 * HOUR + 29 * 60_000, "en-GB")).toBe("4 h");
    expect(formatAge(4 * HOUR + 59 * 60_000, "en-GB")).toBe("5 h");
    expect(formatAge(47 * HOUR, "en-GB")).toBe("47 h");
    expect(formatAge(47 * HOUR + 31 * 60_000, "en-GB")).toBe("2 d");
    expect(formatAge(48 * HOUR, "en-GB")).toBe("2 d");
    expect(formatAge(9.6 * 24 * HOUR, "en-GB")).toBe("10 d");
    expect(formatAge(1_500 * 24 * HOUR, "en-GB")).toBe("1,500 d");
  });

  it("rounds a span as 'First seen … ago' does, so the two never read one span apart", () => {
    // Regression: "First seen 6 h ago" beside "Open for 5 h" on one clock (5 h 33 min: one rounded, one cut down).
    const now = Date.parse("2026-11-04T14:32:00.000Z");
    for (let minutes = 45; minutes < 22 * 60; minutes += 7) {
      const ms = minutes * 60_000;
      expect(`${formatAge(ms, "en-GB")} ago`).toBe(formatRelative(new Date(now - ms), { now, locale: "en-GB" }));
    }
    for (let hours = 48; hours < 26 * 24; hours += 5) {
      const ms = hours * HOUR + 17 * 60_000;
      expect(`${formatAge(ms, "en-GB")} ago`).toBe(formatRelative(new Date(now - ms), { now, locale: "en-GB" }));
    }
  });

  it("calls a finding a newer rules version replaced superseded, not resolved", () => {
    expect(findingStatus({ state: "open", resolved_why: null })).toBe("open");
    expect(findingStatus({ state: "resolved", resolved_why: "cleared" })).toBe("resolved");
    expect(findingStatus({ state: "resolved", resolved_why: "superseded" })).toBe("superseded");
  });

  it("calls a finding the board's rule settings closed just that, never resolved, in the page and its export (JO-15)", () => {
    expect(findingStatus({ state: "resolved", resolved_why: "settings_changed" })).toBe("settings_changed");
    expect(STATUS_LABEL.settings_changed).toBe("Closed: rule settings changed");
    const closed = { ...PAGE.items[0], state: "resolved" as const, resolved_at: "2026-11-04T14:31:00.000Z", resolved_why: "settings_changed" as const };
    const state = FINDINGS_CSV.find((column) => column.header === "State")!;
    expect(state.value(closed)).toBe("Closed: rule settings changed");
  });
});

describe("the clock a finding's age is read on (one for the page)", () => {
  const SYNCED = "2026-11-04T14:28:00.000Z";
  const open = { first_seen_at: "2026-11-04T08:59:00.000Z", last_seen_at: "2026-11-04T14:29:00.000Z", resolved_at: null };

  it("is now while the board's last sync is fresh, so an open finding's age is the time since it was first seen", () => {
    const now = Date.parse("2026-11-04T14:32:00.000Z");
    const clock = findingClock(SYNCED, now);
    expect(clock).toEqual({ now, stale: false, syncedAt: SYNCED });
    expect(findingAgeMs(open, clock.now)).toBe(now - Date.parse(open.first_seen_at));
    expect(formatAge(findingAgeMs(open, clock.now), "en-GB")).toBe("6 h");
    expect(formatRelative(open.first_seen_at, { now, locale: "en-GB" })).toBe("6 h ago");
  });

  it("stops at the last run that saw it once the sync is stale, and says the page is stale", () => {
    // Regression: "First seen 9 d ago" beside "Open for 2 h" on a board last synced nine days before, with nothing said.
    const now = Date.parse("2026-11-13T09:00:00.000Z");
    const clock = findingClock(SYNCED, now);
    expect(clock).toEqual({ now: null, stale: true, syncedAt: SYNCED });
    expect(findingAgeMs(open, clock.now)).toBe(5.5 * HOUR);
  });

  it("is the rules runs alone while the sync time or the reader's clock is not known", () => {
    expect(findingClock(null, Date.parse("2026-11-04T14:32:00.000Z"))).toEqual(RULES_CLOCK);
    expect(findingClock(SYNCED, null)).toEqual({ ...RULES_CLOCK, syncedAt: SYNCED });
    expect(findingAgeMs(open)).toBe(5.5 * HOUR);
  });

  it("never runs an open finding's age short of its last run, and leaves a resolved one's alone", () => {
    expect(findingAgeMs(open, Date.parse("2026-11-04T14:00:00.000Z"))).toBe(5.5 * HOUR);
    const resolved = { ...open, resolved_at: "2026-11-04T10:59:00.000Z" };
    expect(findingAgeMs(resolved, Date.parse("2026-11-04T14:32:00.000Z"))).toBe(2 * HOUR);
  });
});

describe("the result line", () => {
  it("counts the findings and, with both severities shown, the breaches among them", () => {
    const summary = resultSummary(PAGE, DEFAULTS);
    expect(summary).toEqual({ total: 809, noun: "open findings", breaches: 523 });
    expect(resultSentence(summary, "en-GB")).toBe("809 open findings · 523 breaches");
  });

  it("names the severity when one is chosen, and leaves the breach count out", () => {
    const breaches = resultSummary({ ...PAGE, total: 1 }, { state: "resolved", severity: "breach" });
    expect(resultSentence(breaches, "en-GB")).toBe("1 resolved breach");
    const warnings = resultSummary(PAGE, { state: "all", severity: "warning" });
    expect(resultSentence(warnings, "en-GB")).toBe("809 warnings");
  });

  it("leaves the breach count out when nothing was found", () => {
    expect(resultSentence(resultSummary({ ...PAGE, total: 0 }, { state: "open", severity: null }), "en-GB")).toBe(
      "0 open findings",
    );
  });
});

describe("what was looked at", () => {
  it("says the filters in words", () => {
    const filters: FindingsFilters = {
      ...DEFAULTS,
      q: " webhook ",
      severity: "breach",
      rule: ["R-EST-01"],
      epic: ["DEMO-763"],
      first_seen: "7d",
    };
    expect(describeFilters(filters, ["DEMO"], { rules: PAGE.facets.rules, epics: PAGE.facets.epics })).toBe(
      "open breaches in DEMO, rule R-EST-01, epic Integrations API, first seen in the last 7 days, matching “webhook”",
    );
  });

  it("names work outside every epic, and counts long lists", () => {
    expect(describeFilters({ ...DEFAULTS, state: "all", epic: ["none"] }, ["DEMO"])).toBe(
      "findings, open, resolved or ignored in DEMO, outside every epic",
    );
    const rules = ["R-EST-01", "R-EST-02", "R-EFF-01", "R-FLOW-02"];
    expect(describeFilters({ ...DEFAULTS, rule: rules }, [])).toBe("open findings, 4 rules");
  });

  it("names the people by name, the unassigned tickets as such, and never by id", () => {
    const names = { rules: PAGE.facets.rules, epics: PAGE.facets.epics, people: PAGE.facets.people };
    const ada = "pbc7fe62842ca";
    const ben = "p7614b22410ea";
    expect(describeFilters({ ...DEFAULTS, person: [ada] }, ["DEMO"], names)).toBe("open findings in DEMO, assigned to Ada Brooks");
    expect(describeFilters({ ...DEFAULTS, person: ["unassigned"] }, ["DEMO"], names)).toBe(
      "open findings in DEMO, on unassigned tickets",
    );
    expect(describeFilters({ ...DEFAULTS, person: [ada, "unassigned"] }, ["DEMO"], names)).toBe(
      "open findings in DEMO, assigned to Ada Brooks or nobody",
    );
    expect(describeFilters({ ...DEFAULTS, person: ["p000000000000"] }, ["DEMO"], names)).toBe(
      "open findings in DEMO, assigned to someone not on this board",
    );
    expect(describeFilters({ ...DEFAULTS, person: [ada, ben, "p000000000000", "unassigned"] }, ["DEMO"], names)).toBe(
      "open findings in DEMO, assigned to any of 4 people",
    );
    expect(personFilterName("unassigned")).toBe("Unassigned");
  });
});

describe("the Person menu", () => {
  it("lists everyone by name with their counts, then Unassigned last", () => {
    const options = personOptions(PAGE.facets.people, [], "en-GB");
    expect(options.map((option) => option.label)).toEqual([
      "Ada Brooks",
      "Ben Okafor",
      "Carmen Ruiz",
      "Dev Malhotra",
      "Elif Aydin",
      "Finn Gallagher",
      "Grace Lindqvist",
      "Hana Mori",
      "Unassigned",
    ]);
    expect(options[0]).toMatchObject({ value: "pbc7fe62842ca", hint: "149" });
    expect(options.at(-1)).toMatchObject({ value: "unassigned", hint: "16" });
  });

  it("holds a board of many people, Unassigned still last, each found by any part of their name", () => {
    const many = Array.from({ length: 60 }, (_, index) => ({
      value: `p${index.toString(16).padStart(12, "0")}`,
      label: `Person ${String(index + 1).padStart(2, "0")} Surname`,
      count: index,
      avatar: null,
    }));
    const options = personOptions([...many, { value: "unassigned", label: "Unassigned", count: 3, avatar: null }], [], "en-GB");
    expect(options).toHaveLength(61);
    expect(options.at(-1)).toMatchObject({ value: "unassigned", label: "Unassigned", hint: "3" });
    expect(options.filter((option) => matchesQuery(option, "person 42")).map((option) => option.label)).toEqual([
      "Person 42 Surname",
    ]);
    expect(options.filter((option) => matchesQuery(option, "nobody")).map((option) => option.value)).toEqual(["unassigned"]);
  });

  it("keeps a chosen person the board does not list, named plainly rather than by id", () => {
    const options = personOptions(PAGE.facets.people, ["p000000000000"], "en-GB");
    expect(options.at(-2)).toMatchObject({ value: "p000000000000", label: "Not on this board", hint: "0" });
    expect(personOptions(undefined, ["p000000000000", "unassigned"], "en-GB").map((option) => option.label)).toEqual([
      "Loading",
      "Unassigned",
    ]);
  });
});

describe("whose a finding is", () => {
  const unassigned = PAGE.items.find((item) => item.scope === "issue" && item.assignee === null)!;
  const assigned = PAGE.items.find((item) => item.assignee !== null)!;

  it("is its issue's assignee's, or Unassigned's, while the ticket is in the synced data", () => {
    expect(noOnesReason(assigned)).toBeNull();
    expect(noOnesReason(unassigned)).toBeNull();
  });

  it("is no one's for a sprint finding, and for one whose ticket has left the synced data", () => {
    expect(noOnesReason(SPRINT.finding)).toBe("sprint");
    // The API sends such a finding with its key but without the issue's summary or type (and no assignee).
    const gone = { ...unassigned, issue_summary: null, issue_type: null };
    expect(noOnesReason(gone)).toBe("gone");
    expect(NO_ONES_LABEL.gone).toBe("No one: the ticket is no longer in the synced data");
    // A live ticket with an empty summary is still somebody's (or Unassigned's): Jira always gives it a type.
    expect(noOnesReason({ ...unassigned, issue_summary: null })).toBeNull();
  });
});

describe("the URL", () => {
  it("knows when anything narrows the list", () => {
    expect(hasActiveFilters(DEFAULTS)).toBe(false);
    expect(hasActiveFilters({ ...DEFAULTS, sort: "severity", page: 3 })).toBe(false);
    expect(hasActiveFilters({ ...DEFAULTS, q: "  " })).toBe(false);
    expect(hasActiveFilters({ ...DEFAULTS, state: "all" })).toBe(true);
    expect(hasActiveFilters({ ...DEFAULTS, epic: ["none"] })).toBe(true);
    expect(hasActiveFilters({ ...DEFAULTS, person: ["unassigned"] })).toBe(true);
  });

  it("asks the API only for what it accepts", () => {
    const query = toFindingsQuery({ ...DEFAULTS, q: `  ${"x".repeat(140)} `, page: 0 });
    expect(query.q).toHaveLength(100);
    expect(query.page).toBe(1);
    expect(toFindingsQuery({ ...DEFAULTS, page: 99_999 }).page).toBe(10_000);
    expect(toFindingsQuery(DEFAULTS, "   ").q).toBeUndefined();
    expect(toFindingsQuery({ ...DEFAULTS, severity: "warning" }).severity).toBe("warning");
    expect(toFindingsQuery({ ...DEFAULTS, person: ["unassigned"] }).person).toEqual(["unassigned"]);
    const many = Array.from({ length: 60 }, (_, index) => `p${index.toString(16).padStart(12, "0")}`);
    expect(toFindingsQuery({ ...DEFAULTS, person: many }).person).toHaveLength(50);
  });

  it("reads a finding id in any case, and nothing else", () => {
    expect(normaliseFindingId(" 0B7B3B0F61C477E61699982F24892735 ")).toBe("0b7b3b0f61c477e61699982f24892735");
    expect(normaliseFindingId("DEMO-1")).toBeNull();
    expect(normaliseFindingId(null)).toBeNull();
  });
});

describe("the evidence drawer", () => {
  it("formats each evidence value by its unit and says None for a missing one", () => {
    const [started, points] = DETAIL.finding.evidence;
    expect(evidenceText(started, "en-GB")).toEqual({ text: "To Do → In Progress", none: false });
    expect(evidenceText(points, "en-GB")).toEqual({ text: "None", none: true });
    const [, days, , , share] = SPRINT.finding.evidence;
    expect(evidenceText(days, "en-GB").text).toBe("1.9 d");
    expect(evidenceText(share, "en-GB").text).toBe("35%");
  });

  it("marks the value the rule turned on", () => {
    const [started, points] = DETAIL.finding.evidence;
    expect(turnsOn(DETAIL.finding, started)).toBe(false);
    expect(turnsOn(DETAIL.finding, points)).toBe(true);
    // "≤ 2 days left, > 30% not started": the days left and the share, not the counts.
    const marked = SPRINT.finding.evidence.filter((item) => turnsOn(SPRINT.finding, item)).map((item) => item.label);
    expect(marked).toEqual(["Days left", "Share not started"]);
    const burning = PAGE.items.find((item) => item.rule_id === "W-EFF-01");
    expect(burning?.evidence.filter((item) => turnsOn(burning, item)).map((item) => item.label)).toEqual(["Effort ratio"]);
  });

  it("lists the changelog entries the rule read, oldest first", () => {
    expect(changelogRows(DETAIL.finding.evidence)).toEqual([
      {
        id: "318706-0",
        at: "2026-11-04T10:11:00.000Z",
        label: "Work started",
        kind: "status_change",
        from: "To Do",
        to: "In Progress",
        value: "To Do → In Progress",
        changelogId: "318706",
      },
    ]);
    expect(changelogRows(SPRINT.finding.evidence)).toEqual([]);
  });

  it("draws a lane per stage the issue sat in, in process order, and one per unmapped status", () => {
    const model = timelineModel([
      ...DETAIL.timeline,
      {
        status: "Blocked",
        stage: null,
        status_category: "indeterminate",
        entered_at: "2026-11-04T12:00:00.000Z",
        left_at: null,
        hours: null,
      },
    ]);
    expect(model.lanes.map((lane) => [lane.id, lane.label, lane.stage])).toEqual([
      ["backlog", "Backlog", "backlog"],
      ["development", "Development", "development"],
      ["status:Blocked", "Blocked", "development"],
    ]);
    expect(model.intervals.map((interval) => [interval.lane, interval.status, interval.end])).toEqual([
      ["backlog", "To Do", "2026-11-04T10:11:00.000Z"],
      ["development", "In Progress", null],
      ["status:Blocked", "Blocked", null],
    ]);
    expect(timelineModel(SPRINT.timeline)).toEqual({ lanes: [], intervals: [] });
  });
});

describe("the CSV export", () => {
  it("writes every row as the API gave it, with the age in hours", () => {
    const row = Object.fromEntries(FINDINGS_CSV.map((column) => [column.header, column.value(DETAIL.finding)]));
    expect(row).toMatchObject({
      Severity: "breach",
      Rule: "R-EST-01",
      Issue: "DEMO-1098",
      Epic: "DEMO-763",
      "First seen (UTC)": "2026-11-04T10:29:00.000Z",
      "Open for (hours)": 4,
      State: "Open",
      "Resolved (UTC)": null,
      Assignee: "Grace Lindqvist",
    });
    // A sprint finding belongs to no one: the cell is left empty, never "Unassigned".
    const sprint = FINDINGS_CSV.find((column) => column.header === "Assignee")!.value(SPRINT.finding);
    expect(sprint).toBeUndefined();
  });
});
