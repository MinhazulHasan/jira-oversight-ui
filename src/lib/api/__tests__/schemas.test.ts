import { describe, expect, it } from "vitest";

import findingsSample from "../../../../docs/sample-responses/findings.json";
import issueSample from "../../../../docs/sample-responses/issue-DEMO-1.json";
import askNoTicketsSample from "../../../../docs/sample-responses/ask-person-no-tickets.json";
import askPersonSample from "../../../../docs/sample-responses/ask-person.json";
import directorySample from "../../../../docs/sample-responses/people-directory.json";
import peopleSample from "../../../../docs/sample-responses/people.json";
import {
  API_ERROR_CODES,
  ASK_MAX_MENTIONS,
  askLevelSchema,
  askRequestSchema,
  askResponseSchema,
  AVATAR_VERSION_PATTERN,
  findingSchema,
  findingsPageSchema,
  healthSchema,
  ISSUE_KEY_PATTERN,
  isoDateTime,
  issueTimelineSchema,
  noTicketsSentence,
  peopleDirectorySchema,
  peopleSchema,
  PERSON_ID_PATTERN,
  personFacetEntrySchema,
  personSchema,
  type Finding,
} from "../schemas";

/** A made-up person: the id is "p" and 12 hex characters, never the account id; no picture. */
const PERSON = { id: "p3f9a2c41b0de", name: "Ada Brooks", avatar: null };
/** A made-up person with a picture: its version, the first 12 hex characters of sha256 of its bytes. */
const PICTURED = { id: "p65b14f7daa03", name: "Grace Lindqvist", avatar: "0a1b2c3d4e5f" };

const FINDING: Finding = {
  finding_id: "0123456789abcdef0123456789abcdef",
  rule_id: "R-EFF-01",
  rule_title: "Effort far beyond the estimate",
  rule_version: "0.1.0",
  kind: "rule",
  severity: "breach",
  state: "open",
  message: "Logged 18.0 h against an estimate of 8.0 h (2.25×, threshold 1.5×)",
  scope: "issue",
  issue_key: "DEMO-12",
  issue_summary: "Add saved searches",
  issue_type: "Task",
  epic_key: "DEMO-4",
  epic_title: "Search and filtering",
  assignee: PERSON,
  sprint: null,
  first_seen_at: "2026-10-03T16:00:00.000Z",
  last_seen_at: "2026-11-04T14:29:00.000Z",
  resolved_at: null,
  resolved_why: null,
  threshold: "1.5×",
  evidence: [],
  warned_before: null,
  ignore: null,
};

describe("the contract's schemas", () => {
  it("parse the bare health body the screenshot stubs send", () => {
    const health = healthSchema.parse({
      status: "ok",
      data_mode: "sample",
      read_only: true,
      api_version: "0.1.0",
      last_synced_at: "2026-11-04T11:02:00.000Z",
      projects: ["DEMO"],
      report_timezone: "Europe/London",
    });
    expect(health.message).toBeNull();
    expect(health.meta).toBeUndefined();
  });

  it("insist that health is read-only", () => {
    expect(healthSchema.safeParse({ status: "ok", data_mode: "live", read_only: false, api_version: "1", last_synced_at: "2026-11-04T11:02:00Z", projects: ["DEMO"], report_timezone: "UTC" }).success).toBe(false);
  });

  it("accept UTC with Z and, so a Python isoformat slip is not an outage, an offset", () => {
    expect(isoDateTime.safeParse("2026-11-04T14:28:00.000Z").success).toBe(true);
    expect(isoDateTime.safeParse("2026-11-04T14:28:00+00:00").success).toBe(true);
    expect(isoDateTime.safeParse("2026-11-04 14:28").success).toBe(false);
    expect(isoDateTime.safeParse("04/11/2026").success).toBe(false);
  });

  it("know an issue key when they see one", () => {
    expect(ISSUE_KEY_PATTERN.test("DEMO-1")).toBe(true);
    expect(ISSUE_KEY_PATTERN.test("AB_C2-1234")).toBe(true);
    expect(ISSUE_KEY_PATTERN.test("demo-1")).toBe(false);
    expect(ISSUE_KEY_PATTERN.test("DEMO-0")).toBe(false);
    expect(ISSUE_KEY_PATTERN.test("D-1")).toBe(false);
  });

  it("keep a finding's state and its resolution in step", () => {
    expect(findingSchema.safeParse(FINDING).success).toBe(true);
    expect(findingSchema.safeParse({ ...FINDING, state: "resolved" }).success).toBe(false);
    expect(findingSchema.safeParse({ ...FINDING, resolved_at: "2026-11-01T10:01:00.000Z" }).success).toBe(false);
    expect(
      findingSchema.safeParse({ ...FINDING, state: "resolved", resolved_at: "2026-11-01T10:01:00.000Z", resolved_why: "cleared" }).success,
    ).toBe(true);
  });

  it("require an issue for an issue finding and a sprint for a sprint finding", () => {
    expect(findingSchema.safeParse({ ...FINDING, issue_key: null }).success).toBe(false);
    expect(findingSchema.safeParse({ ...FINDING, scope: "sprint", issue_key: null, sprint: null }).success).toBe(false);
    expect(
      findingSchema.safeParse({
        ...FINDING,
        scope: "sprint",
        issue_key: null,
        issue_summary: null,
        assignee: null,
        sprint: { sprint_id: 4426, name: "Sprint 26" },
      }).success,
    ).toBe(true);
  });

  it("drop fields the contract does not name, so nothing unexpected reaches a page", () => {
    const parsed = findingSchema.parse({ ...FINDING, reporter: "someone", internal_score: 3 });
    expect(parsed).not.toHaveProperty("reporter");
    expect(parsed).not.toHaveProperty("internal_score");
  });
});

describe("people in the contract", () => {
  it("know a person id when they see one", () => {
    expect(PERSON_ID_PATTERN.test("p3f9a2c41b0de")).toBe(true);
    for (const id of ["3f9a2c41b0de", "p3f9a2c41b0d", "p3f9a2c41b0de0", "P3F9A2C41B0DE", "p3f9a2c41b0dg", "acc-01", "557058:0e7d3f6c-1d2b-4c5e-9f00-123456789abc"]) {
      expect(PERSON_ID_PATTERN.test(id), id).toBe(false);
    }
  });

  it("keep a person to an id, a display name and a picture's version, dropping anything else about them", () => {
    for (const person of [PERSON, PICTURED]) {
      const parsed = personSchema.parse({
        ...person,
        accountId: "acc-01",
        emailAddress: "ada@example.com",
        avatarUrls: { "48x48": "https://avatar-management--avatars.us-west-2.prod.public.atl-paas.net/initials/AB-5.png" },
        timeZone: "Europe/London",
        active: true,
      });
      expect(parsed).toStrictEqual(person);
    }
  });

  it("take a picture's version, never a URL, and never leave it out", () => {
    expect(AVATAR_VERSION_PATTERN.test("0a1b2c3d4e5f")).toBe(true);
    for (const avatar of [
      "0A1B2C3D4E5F",
      "0a1b2c3d4e5",
      "0a1b2c3d4e5f0",
      "0a1b2c3d4e5g",
      "https://secure.gravatar.com/avatar/0a1b2c3d4e5f",
      "/api/oversight/people/p65b14f7daa03/avatar?v=0a1b2c3d4e5f",
      "",
    ]) {
      expect(personSchema.safeParse({ ...PICTURED, avatar }).success, avatar).toBe(false);
    }
    expect(personSchema.safeParse({ ...PICTURED, avatar: { "48x48": "https://example.com/a.png" } }).success).toBe(false);
    const { avatar: _avatar, ...without } = PICTURED;
    expect(personSchema.safeParse(without).success).toBe(false);
    expect(personSchema.safeParse({ ...PICTURED, avatar: null }).success).toBe(true);
  });

  it("take a name of 1 to 128 characters, counted as the service counts them", () => {
    expect(personSchema.safeParse({ ...PERSON, name: "" }).success).toBe(false);
    expect(personSchema.safeParse({ ...PERSON, name: "x".repeat(128) }).success).toBe(true);
    expect(personSchema.safeParse({ ...PERSON, name: "x".repeat(129) }).success).toBe(false);
    // 128 characters outside the Basic Multilingual Plane are 256 UTF-16 units, and still 128 characters.
    expect(personSchema.safeParse({ ...PERSON, name: "😀".repeat(128) }).success).toBe(true);
    expect(personSchema.safeParse({ ...PERSON, name: "😀".repeat(129) }).success).toBe(false);
    expect(personSchema.safeParse({ ...PERSON, name: "Unnamed account" }).success).toBe(true);
  });

  it("never let an email address through as a name: it reads Unnamed account", () => {
    for (const name of ["someone@example.com", " Someone.Else+jira@Example.co.uk", "Jo Bloggs (jo@corp.example)", "<jo@corp.example>"]) {
      expect(personSchema.parse({ ...PERSON, name }), name).toStrictEqual({ ...PERSON, name: "Unnamed account" });
    }
    // An at sign alone is not an address.
    for (const name of ["Ops @ Night", "Team@Home", "Ada Brooks"]) {
      expect(personSchema.parse({ ...PERSON, name }).name, name).toBe(name);
    }
    // Nor in a facet's label, which the Person menu and the filter's toast show.
    const facets = findingsPageSchema.parse({
      ...findingsSample,
      facets: {
        ...findingsSample.facets,
        people: findingsSample.facets.people.map((entry) => (entry.label === "Ada Brooks" ? { ...entry, label: "ada@example.com" } : entry)),
      },
    }).facets.people;
    expect(facets.map((entry) => entry.label)).not.toContain("ada@example.com");
    expect(facets[0].label).toBe("Unnamed account");
  });

  it("refuse an account id where a person id goes", () => {
    expect(personSchema.safeParse({ ...PERSON, id: "acc-01" }).success).toBe(false);
    expect(findingSchema.safeParse({ ...FINDING, assignee: { id: "557058:0e7d3f6c", name: "Ada Brooks" } }).success).toBe(false);
  });

  it("give every finding an assignee, null for an unassigned issue and for every sprint finding", () => {
    const { assignee: _assignee, ...without } = FINDING;
    expect(findingSchema.safeParse(without).success).toBe(false);
    expect(findingSchema.safeParse({ ...FINDING, assignee: null }).success).toBe(true);
    const sprint = { ...FINDING, scope: "sprint", issue_key: null, issue_summary: null, sprint: { sprint_id: 4426, name: "Sprint 26" } };
    expect(findingSchema.safeParse({ ...sprint, assignee: null }).success).toBe(true);
    expect(findingSchema.safeParse(sprint).success).toBe(false);
  });

  it("give the issue page its assignee, a person or null, never left out", () => {
    expect(issueTimelineSchema.safeParse(issueSample).success).toBe(true);
    expect(issueTimelineSchema.safeParse({ ...issueSample, issue: { ...issueSample.issue, assignee: null } }).success).toBe(true);
    const { assignee: _assignee, ...without } = issueSample.issue;
    expect(issueTimelineSchema.safeParse({ ...issueSample, issue: without }).success).toBe(false);
  });

  it("offer only values the person filter takes in the people facet, which every page must carry", () => {
    expect(findingsPageSchema.safeParse(findingsSample).success).toBe(true);
    const withPeople = (people: unknown) => ({ ...findingsSample, facets: { ...findingsSample.facets, people } });
    const { people: _people, ...facets } = findingsSample.facets;
    expect(findingsPageSchema.safeParse({ ...findingsSample, facets }).success).toBe(false);
    expect(findingsPageSchema.safeParse(withPeople([{ value: "unassigned", label: "Unassigned", count: 0, avatar: null }])).success).toBe(true);
    expect(findingsPageSchema.safeParse(withPeople([{ value: "acc-01", label: "Ada Brooks", count: 3, avatar: null }])).success).toBe(false);
    expect(findingsPageSchema.safeParse(withPeople([{ value: "Unassigned", label: "Unassigned", count: 3, avatar: null }])).success).toBe(false);
  });

  it("give each person in the people facet their picture's version, and the unassigned tickets none", () => {
    const entry = { value: PICTURED.id, label: PICTURED.name, count: 4, avatar: PICTURED.avatar };
    expect(personFacetEntrySchema.parse(entry)).toStrictEqual(entry);
    expect(personFacetEntrySchema.safeParse({ ...entry, avatar: null }).success).toBe(true);
    const { avatar: _avatar, ...without } = entry;
    expect(personFacetEntrySchema.safeParse(without).success).toBe(false);
    expect(personFacetEntrySchema.safeParse({ ...entry, avatar: "https://secure.gravatar.com/avatar/x" }).success).toBe(false);
    expect(personFacetEntrySchema.safeParse({ value: "unassigned", label: "Unassigned", count: 2, avatar: null }).success).toBe(true);
    expect(personFacetEntrySchema.safeParse({ value: "unassigned", label: "Unassigned", count: 2, avatar: "0a1b2c3d4e5f" }).success).toBe(false);
    // Every entry of the documented page carries one: the sample's people with a picture and without.
    const avatars = findingsSample.facets.people.map((person) => person.avatar);
    expect(avatars.at(-1)).toBeNull();
    expect(avatars.filter((avatar) => avatar !== null)).toHaveLength(2);
  });

  it("hold each row of the people list to its own arithmetic", () => {
    const row = { person: PERSON, tickets: 40, open_tickets: 12, open_breaches: 7, open_warnings: 3, tickets_with_findings: 5 };
    const body = (people: unknown[]) => ({ meta: peopleSample.meta, people });
    expect(peopleSchema.safeParse(body([row, { ...row, person: null, tickets: 3, open_tickets: 1, open_breaches: 1, open_warnings: 0, tickets_with_findings: 1 }])).success).toBe(true);
    expect(peopleSchema.safeParse(body([])).success).toBe(true);
    // Findings follow the assignee and tickets the credit setting: findings on more tickets than count for them, or on none that do.
    expect(peopleSchema.safeParse(body([{ ...row, tickets: 4, open_tickets: 4 }])).success).toBe(true);
    expect(peopleSchema.safeParse(body([{ ...row, tickets: 0, open_tickets: 0 }])).success).toBe(true);
    for (const broken of [
      { ...row, tickets: 0, open_tickets: 0, tickets_with_findings: 0, open_breaches: 0, open_warnings: 0 },
      { ...row, open_tickets: 41 },
      { ...row, tickets_with_findings: 11 },
      { ...row, tickets_with_findings: 0 },
      { ...row, open_breaches: -1 },
    ]) {
      expect(peopleSchema.safeParse(body([broken])).success, JSON.stringify(broken)).toBe(false);
    }
  });

  it("list each person once, and the unassigned once", () => {
    const row = { person: PERSON, tickets: 2, open_tickets: 1, open_breaches: 0, open_warnings: 0, tickets_with_findings: 0 };
    const body = (people: unknown[]) => ({ meta: peopleSample.meta, people });
    expect(peopleSchema.safeParse(body([row, { ...row, person: { ...PERSON, name: "Ada B." } }])).success).toBe(false);
    expect(peopleSchema.safeParse(body([{ ...row, person: null }, { ...row, person: null }])).success).toBe(false);
  });
});

describe("the board's directory in the contract (GET /people/directory)", () => {
  const body = (people: unknown[]) => ({ meta: directorySample.meta, people });

  it("lists everyone on the board with their tickets now, a member with none at 0, and no one unassigned", () => {
    const parsed = peopleDirectorySchema.parse(directorySample);
    expect(parsed).toEqual(directorySample);
    expect(parsed.people.filter((entry) => entry.tickets === 0).map((entry) => entry.person.name)).toEqual(["Noor Haddad", "Tomás Ferreira", "Yuki Tanabe"]);
    expect(peopleDirectorySchema.safeParse(body([])).success).toBe(true);
    expect(peopleDirectorySchema.safeParse(body([{ person: PERSON, tickets: 0 }, { person: PICTURED, tickets: 12 }])).success).toBe(true);
    for (const broken of [
      { person: null, tickets: 3 },
      { person: PERSON, tickets: -1 },
      { person: PERSON, tickets: 1.5 },
      { person: PERSON },
      { person: { ...PERSON, id: "acc-01" }, tickets: 2 },
      { person: { id: PERSON.id, name: PERSON.name }, tickets: 2 },
    ]) {
      expect(peopleDirectorySchema.safeParse(body([broken])).success, JSON.stringify(broken)).toBe(false);
    }
  });

  it("lists each person once, and keeps a person to an id, a name and a picture's version", () => {
    expect(peopleDirectorySchema.safeParse(body([{ person: PERSON, tickets: 1 }, { person: { ...PERSON, name: "Ada B." }, tickets: 0 }])).success).toBe(false);
    const parsed = peopleDirectorySchema.parse(
      body([{ person: { ...PERSON, accountId: "acc-09", emailAddress: "someone@example.com", timeZone: "Pacific/Chatham" }, tickets: 0, active: true }]),
    );
    expect(parsed.people).toEqual([{ person: PERSON, tickets: 0 }]);
  });
});

describe("Ask in the contract", () => {
  const ids = Array.from({ length: ASK_MAX_MENTIONS + 1 }, (_, index) => `p${String(index).padStart(12, "0")}`);

  it("take a question, and the people it mentions by person id, each once, ten at most", () => {
    expect(askRequestSchema.parse({ question: "Where do tickets get stuck most?" })).toEqual({ question: "Where do tickets get stuck most?" });
    expect(askRequestSchema.safeParse({ question: "x", mentions: [] }).success).toBe(true);
    expect(askRequestSchema.safeParse({ question: "x", mentions: ids.slice(0, ASK_MAX_MENTIONS) }).success).toBe(true);
    for (const mentions of [ids, [ids[0], ids[0]], ["acc-01"], [PERSON.id.toUpperCase()], "p3f9a2c41b0de", [{ id: PERSON.id }], [null]]) {
      expect(askRequestSchema.safeParse({ question: "x", mentions }).success, JSON.stringify(mentions)).toBe(false);
    }
  });

  it("never take a level, or anything else, from the browser", () => {
    for (const extra of [{ level: "people" }, { level: "team" }, { user: "someone" }, { people: [PERSON] }]) {
      expect(askRequestSchema.safeParse({ question: "x", ...extra }).success, JSON.stringify(extra)).toBe(false);
    }
    expect(askLevelSchema.options).toEqual(["team", "people"]);
  });

  it("give every answer its people, never left out, each a person and nothing more", () => {
    const { people: _people, ...without } = askPersonSample;
    expect(askResponseSchema.safeParse(without).success).toBe(false);
    const parsed = askResponseSchema.parse({
      ...askPersonSample,
      people: askPersonSample.people.map((person) => ({ ...person, accountId: "acc-03", emailAddress: "someone@example.com" })),
    });
    expect(parsed.people).toEqual(askPersonSample.people);
    expect(parsed.people[0]).toEqual({ id: expect.stringMatching(PERSON_ID_PATTERN), name: "Carmen Ruiz", avatar: expect.stringMatching(AVATAR_VERSION_PATTERN) });
    expect(askResponseSchema.safeParse({ ...askPersonSample, people: [{ ...PERSON, id: "acc-03" }] }).success).toBe(false);
  });

  it("say that mentioned members hold no tickets in exactly the contract's words, with no Oxford comma", () => {
    expect(noTicketsSentence(["Noor Haddad"])).toBe("Noor Haddad has no tickets on this board.");
    expect(noTicketsSentence(["Noor Haddad", "Yuki Tanabe"])).toBe("Noor Haddad and Yuki Tanabe have no tickets on this board.");
    expect(noTicketsSentence(["Noor Haddad", "Tomás Ferreira", "Yuki Tanabe"])).toBe("Noor Haddad, Tomás Ferreira and Yuki Tanabe have no tickets on this board.");
    // As the service sends it: no_data, the sentence as the answer, nothing looked up, the people it names.
    const parsed = askResponseSchema.parse(askNoTicketsSample);
    expect([parsed.outcome, parsed.answer, parsed.facts, parsed.plan, parsed.citations]).toEqual(["no_data", noTicketsSentence(["Noor Haddad"]), [], [], []]);
    expect(parsed.people.map((person) => person.name)).toEqual(["Noor Haddad"]);
  });

  it("name the error a team-level reader's mentions get", () => {
    expect(API_ERROR_CODES).toContain("people_not_allowed");
  });
});

