// @vitest-environment node
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GET, POST } from "@/app/api/oversight/[...path]/route";
import { FINDINGS_SORTS, FIRST_SEEN_WINDOWS, normalizeFindingsQuery, NO_EPIC, type FindingsQueryInput } from "@/lib/api/params";
import {
  apiErrorBodySchema,
  FORMER_MEMBER,
  PERSON_ID_PATTERN,
  SCORECARD_DAYS,
  TREND_METRICS,
  UNASSIGNED,
  UNASSIGNED_LABEL,
  type AskLevel,
  type RuleSettingsPreviewRequest,
} from "@/lib/api/schemas";

import { RESPONSE_SCHEMAS, type JsonRoute, type JsonRouteName } from "../endpoints";
import { sampleResponse } from "../sample";
import { FORMER, SAMPLE_VIEWERS } from "../sample/access-log";
import { BOARD_NAME } from "../sample/ask/scorecard";
import { SUGGESTED_QUESTIONS } from "../sample/ask/scripts";
import { RULES } from "../sample/catalogue";
import { resetSampleClock } from "../sample/clock";
import { buildDataset } from "../sample/dataset";
import { resetSampleRuleSettings } from "../sample/settings-store";
import { pictureOf } from "../sample/pictures";
import { EVERYONE, MEMBERS, personIdFor, TEAM } from "../sample/team";

const dataset = buildDataset(Date.parse("2026-11-04T14:30:00Z"));

function body(route: JsonRoute): unknown {
  const answer = sampleResponse(dataset, route, 0);
  if (!answer.found) throw new Error(`${route.name}: ${answer.message}`);
  return answer.body;
}

function expectExact(route: JsonRoute): unknown {
  const value = body(route);
  const parsed = RESPONSE_SCHEMAS[route.name].safeParse(value);
  expect(parsed.success ? [] : parsed.error.issues.slice(0, 3), route.name).toEqual([]);
  expect(parsed.data).toStrictEqual(value);
  expect(JSON.parse(JSON.stringify(value))).toStrictEqual(value);
  return value;
}

const findings = (query: FindingsQueryInput): JsonRoute => ({ name: "findings", query: normalizeFindingsQuery(query) });
const TEAM_IDS = TEAM.map((member) => personIdFor(member.accountId));
const ask = (question: string, level: AskLevel, mentions: string[] = []): JsonRoute => ({ name: "ask", question, mentions, level });
/** Carmen Ruiz (a picture) and Ada Brooks (none), by id: the sample's people the questions below mention. */
const CARMEN = personIdFor("acc-03");
const ADA = personIdFor("acc-01");
/** Members of the board who hold none of its tickets: Noor Haddad, Tomás Ferreira and Yuki Tanabe. */
const [NOOR, TOMAS, YUKI] = MEMBERS.map((member) => personIdFor(member.accountId));
/** Questions about people, as a people-level reader asks them, with the people they mention. */
const PEOPLE_QUESTIONS: [question: string, mentions: string[]][] = [
  ["Who has the most open breaches?", []],
  ["Who has the most open warnings?", []],
  ["What are @Carmen Ruiz's open findings?", [CARMEN]],
  ["@Carmen Ruiz's open breaches", [CARMEN]],
  ["@Ada Brooks's open warnings", [ADA]],
  ["What is @Carmen Ruiz working on?", [CARMEN]],
  ["How do @Carmen Ruiz and @Ada Brooks compare?", [CARMEN, ADA]],
  ["Who is the slowest developer?", []],
  ["Is @Ada Brooks lazy?", [ADA]],
  ["What is @Someone working on?", ["p000000000000"]],
  ["Which engineer closes the most tickets on time?", []],
  ["What is @Noor Haddad working on?", [NOOR]],
  ["Compare @Tomás Ferreira and @Yuki Tanabe", [TOMAS, YUKI]],
  ["@Noor Haddad, @Tomás Ferreira and @Yuki Tanabe: open findings?", [NOOR, TOMAS, YUKI]],
  ["What are @Carmen Ruiz's and @Yuki Tanabe's open findings?", [CARMEN, YUKI]],
  ["How do @Ada Brooks, @Noor Haddad and @Carmen Ruiz compare?", [ADA, NOOR, CARMEN]],
  // questions that evaluate someone, answered with figures; personnel questions; the backlog; typed names.
  ["Is @Carmen Ruiz doing well?", [CARMEN]],
  ["How are @Ada Brooks and @Carmen Ruiz doing?", [ADA, CARMEN]],
  ["Who is best on the board? Rank the others", []],
  ["Rank everyone by open findings", []],
  ["Who follows the process most closely over the last 30 days?", []],
  ["Should we promote @Carmen Ruiz?", [CARMEN]],
  ["Who deserves a reward?", []],
  ["What is @Carmen Ruiz's backlog?", [CARMEN]],
  ["Is Ada Brooks doing well?", []],
];
/** The scorecards: everyone, each person on the board (members with no tickets too), each period. */
const SCORECARDS: JsonRoute[] = SCORECARD_DAYS.flatMap((days) => [
  { name: "people_scorecard", query: { days, person: [] }, level: "people" } as JsonRoute,
  ...EVERYONE.map((member): JsonRoute => ({ name: "people_scorecard", query: { days, person: [personIdFor(member.accountId)] }, level: "people" })),
  { name: "people_scorecard", query: { days, person: [ADA, CARMEN, NOOR].sort() }, level: "people" } as JsonRoute,
]);
/** Every scripted question, as either level would ask it. */
const SCRIPTED = [...SUGGESTED_QUESTIONS, "Who is the slowest developer?", "Who has the most open breaches?", "Which tickets were reopened this week?", "What happened to DEMO-1?", "", "What is the weather?"];

describe("sample responses fit the contract exactly", () => {
  it("for health, overview, people, the people directory, insights, rules and baseline", () => {
    for (const name of ["health", "overview", "people", "people_directory", "insights", "rules", "baseline"] as const) expectExact({ name });
  });

  it("for a board's rule settings, a preview of changes to them, a save and its refusals (JO-15)", () => {
    try {
      expectExact({ name: "rule_settings", level: "people" });
      const preview = expectExact({ name: "rule_settings_preview", body: SETTINGS_PREVIEW, level: "people" }) as { impact: unknown[] };
      expect(preview.impact).toHaveLength(2);
      expectExact({ name: "rule_settings_save", body: { revision: 0, ...SETTINGS_PREVIEW, reason: "Agreed with the team" }, level: "people" });
      const refused = sampleResponse(dataset, { name: "rule_settings_preview", body: SETTINGS_REFUSED, level: "people" });
      expect(refused).toMatchObject({ found: false, status: 422, error: "rule_settings_invalid" });
    } finally {
      resetSampleRuleSettings();
    }
  });

  it("for a custom rule (JO-20): its preview, the save that adds it, the settings and catalogue holding it, and an AI draft of each outcome", () => {
    try {
      const preview = expectExact({ name: "rule_settings_preview", body: SETTINGS_NEW_RULE, level: "people" }) as { impact: { rule_id: string }[] };
      expect(preview.impact.map((impact) => impact.rule_id)).toEqual(["R-CUS-01"]);
      const saved = expectExact({ name: "rule_settings_save", body: { revision: 0, ...SETTINGS_NEW_RULE }, level: "people" }) as { rules: { custom: boolean }[] };
      expect(saved.rules.filter((rule) => rule.custom)).toHaveLength(1);
      for (const text of ["Bugs in progress for more than 3 days", "Tickets with no epic", "Bugs in Code Review for more than 3 days", "What is the weather?"]) {
        expectExact({ name: "rule_settings_draft", body: { text }, level: "people" });
      }
    } finally {
      resetSampleRuleSettings();
    }
  });

  it("for every trend metric and length", () => {
    for (const metric of TREND_METRICS) {
      for (let lastN = 1; lastN <= 12; lastN += 1) {
        const value = expectExact({ name: "trend", query: { metric, period: "week", last_n: lastN } }) as { series: unknown[] };
        expect(value.series).toHaveLength(lastN);
      }
    }
  });

  it("for findings under every filter, sort and page", () => {
    const queries: FindingsQueryInput[] = [
      {},
      { state: "all" },
      { state: "resolved" },
      { severity: "breach" },
      { severity: "warning", state: "all" },
      { epic: [NO_EPIC] },
      { epic: ["DEMO-704", "DEMO-763"] },
      { person: [UNASSIGNED] },
      { person: [UNASSIGNED], state: "all", epic: [NO_EPIC] },
      // An id nobody on the board has: an empty page, not an error.
      { person: ["p000000000000"] },
      { person: TEAM_IDS.slice(0, 3), severity: "breach", sort: "issue_key" },
      ...TEAM_IDS.map((id) => ({ person: [id], state: "all" as const })),
      { q: "DEMO-1" },
      { q: "import" },
      { q: "#142", state: "all" },
      { q: "no such words anywhere" },
      { page: 3, page_size: 10 },
      { page: 999 },
      { page_size: 100, state: "all" },
      ...RULES.map((rule) => ({ rule: [rule.id], state: "all" as const })),
      ...FIRST_SEEN_WINDOWS.map((first_seen) => ({ first_seen, state: "all" as const })),
      ...FINDINGS_SORTS.flatMap((sort) => (["asc", "desc"] as const).map((order) => ({ sort, order, state: "all" as const }))),
    ];
    for (const query of queries) expectExact(findings(query));
  });

  it("for every finding's detail", () => {
    for (const finding of dataset.engine.findings) expectExact({ name: "finding", findingId: finding.id });
  });

  it("for every issue's timeline", () => {
    for (const issue of dataset.world.issues) expectExact({ name: "issue_timeline", issueKey: issue.key });
  });

  it("for every scripted question and outcome, at either level", () => {
    for (const question of SCRIPTED) {
      for (const level of ["team", "people"] as const) expectExact(ask(question, level));
    }
  });

  it("for every question about people a people-level reader may ask, mentions and all", () => {
    for (const [question, mentions] of PEOPLE_QUESTIONS) expectExact(ask(question, "people", mentions));
  });

  it("for every scorecard: everyone, each person on the board, several at once, in each period", () => {
    for (const route of SCORECARDS) expectExact(route);
  });

  it("answers unknown findings and issues with not found, never an empty body", () => {
    expect(sampleResponse(dataset, { name: "finding", findingId: "0".repeat(32) }, 0)).toEqual({
      found: false,
      message: expect.stringMatching(/No finding/),
    });
    expect(sampleResponse(dataset, { name: "issue_timeline", issueKey: "DEMO-99999" }, 0)).toEqual({
      found: false,
      message: "DEMO-99999 is not in the sample data.",
    });
  });
});

/* ------------------------------------------------------------------ privacy -- */

/** Keys that would carry a person, or something about one. A person appears */
const PERSON_KEYS =
  /^(assignee|reporter|author|creator|owner|user|username|user_name|person|people|email|email_?address|avatar|avatar_?urls|display_?name|account_?id|account_?type|time_?zone|active|full_?name|first_?name|last_?name|name)$/i;
/** Where the contract puts a person: a finding's and an issue's assignee, a row of /people or of the directory, the people facet. */
const PERSON_PLACES = [
  /(\.items\[\d+\]|\.finding|\.findings\[\d+\]|\.issue)\.assignee$/,
  /^(people|people_directory|people_scorecard)\.people\[\d+\]\.person$/,
  /^(people|people_directory|people_scorecard)\.people$/,
  /\.facets\.people$/,
  /\.(sprint|assignee|person)\.name$/,
  /(\.(assignee|person)|\.facets\.people\[\d+\])\.avatar$/,
  /^ask\.people$/,
  /^ask\.people\[\d+\]\.(name|avatar)$/,
  /^portfolio\.boards\[\d+\]\.project\.name$/,
  /^access_log\.entries\[\d+\]\.viewer\.name$/,
  /^access_log\.entries\[\d+\]\.subjects\[\d+\]\.(name|avatar)$/,
  // The access log's facets: every viewer and every person read that the log holds, for its filters.
  /^access_log\.facets\.viewers\[\d+\]\.name$/,
  /^access_log\.facets\.subjects\[\d+\]\.(name|avatar)$/,
  // The person card: whose card it is, as a person object, and the boards it names by their names (no person).
  /^person_card\.person$/,
  /^person_card\.(board|other_boards\[\d+\])\.name$/,
  /^rule_settings(_save)?\.rules\[\d+\]\.params\[\d+\]\.name$/,
  /^rule_settings(_save)?\.history\[\d+\]\.by\.name$/,
  // Custom rules: a check and its params by their names (no person).
  /^rule_settings(_save)?\.checks\[\d+\]\.name$/,
  /^rule_settings(_save)?\.checks\[\d+\]\.params\[\d+\]\.name$/,
];
/** At people level only: a fact row's name and assignee columns (the analyst's people, findings and issues views). */
const PEOPLE_LEVEL_FIELDS = /^ask\.facts\[\d+\]\.rows\[\d+\]\.(name|assignee)$/;
/** At people level only: a person tool's parameter, a person id (oversight_person_tickets' `person`). */
const PEOPLE_LEVEL_IDS = /^ask\.(facts|plan)\[\d+\]\.params\.person$/;
/** At people level only: where a sample person's name may stand in Ask's text, its answer. */
const PEOPLE_LEVEL_TEXT = /^ask\.answer$/;
/** At either level: the question, as the reader typed it, which may name someone (a team-level answer still names no one). */
const ASKED = /^ask\.question$/;
const TEAM_NAMES = new Set(EVERYONE.map((member) => member.name));
/** Their names, whole or by surname, as they would appear in text that should name no one. */
const TEAM_IN_TEXT = new RegExp(`\\b(${EVERYONE.flatMap((member) => [member.name, member.name.split(" ")[1]]).join("|")})\\b`);
/** A picture's address, Jira's or Gravatar's or this interface's own: a response carries a version, never an address. */
const AVATAR = /avatar|gravatar|atl-paas\.net|\/secure\/useravatar/i;
/** Common first names, as they would appear before a surname in a ticket or a message. */
const FIRST_NAMES =
  "James|John|Robert|Michael|William|David|Richard|Joseph|Thomas|Charles|Daniel|Matthew|Anthony|Steven|Paul|Andrew|Joshua|Kevin|Brian|George|Edward|Ronald|Timothy|Jason|Jeffrey|Ryan|Jacob|Gary|Nicholas|Eric|Jonathan|Stephen|Larry|Justin|Scott|Brandon|Benjamin|Samuel|Gregory|Frank|Alexander|Raymond|Patrick|Jack|Dennis|Jerry|Tyler|Aaron|Henry|Adam|Peter|Nathan|Zachary|Walter|Kyle|Harold|Carl|Jeremy|Keith|Roger|Gerald|Ethan|Arthur|Terry|Christian|Sean|Lawrence|Austin|Joe|Noah|Jesse|Albert|Bryan|Billy|Bruce|Willie|Jordan|Dylan|Alan|Ralph|Gabriel|Roy|Juan|Wayne|Eugene|Logan|Randy|Louis|Russell|Vincent|Philip|Bobby|Johnny|Bradley|Mary|Patricia|Jennifer|Linda|Elizabeth|Barbara|Susan|Jessica|Sarah|Karen|Lisa|Nancy|Betty|Margaret|Sandra|Ashley|Kimberly|Emily|Donna|Michelle|Carol|Amanda|Dorothy|Melissa|Deborah|Stephanie|Rebecca|Sharon|Laura|Cynthia|Kathleen|Amy|Angela|Shirley|Anna|Brenda|Pamela|Emma|Nicole|Helen|Samantha|Katherine|Christine|Debra|Rachel|Carolyn|Janet|Catherine|Maria|Heather|Diane|Ruth|Julie|Olivia|Joyce|Virginia|Victoria|Kelly|Lauren|Christina|Joan|Evelyn|Judith|Megan|Andrea|Cheryl|Hannah|Jacqueline|Martha|Gloria|Teresa|Ann|Sara|Madison|Frances|Kathryn|Janice|Jean|Abigail|Alice|Judy|Sophia|Grace|Denise|Amber|Doris|Marilyn|Danielle|Beverly|Isabella|Theresa|Diana|Natalie|Brittany|Charlotte|Marie|Kayla|Alexis|Lori|Minhazul|Tazbir|Andy|Hudson";
const PERSON = new RegExp(`\\b(${FIRST_NAMES})\\b(\\s+[A-Z][a-z]+)?`);
const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;
const ATLASSIAN_ACCOUNT = /\b\d{6}:[0-9a-f-]{20,}\b|\bacc-\d+\b|\bapp-tempo\b/i;

function walk(value: unknown, path: string, visit: (path: string, key: string | null, value: unknown) => void): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`, visit));
  } else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      visit(`${path}.${key}`, key, item);
      walk(item, `${path}.${key}`, visit);
    }
  } else {
    visit(path, null, value);
  }
}

/** A string where the contract names a person: an assignee's or a row's name, a people facet's label, or one of Ask's people. */
const NAMED =
  /(\.(assignee|person)\.name|\.facets\.people\[\d+\]\.label|^ask\.people\[\d+\]\.name|^access_log\.entries\[\d+\]\.(viewer|subjects\[\d+\])\.name|^access_log\.facets\.(viewers|subjects)\[\d+\]\.name)$/;
/** The access log's viewers: the sample's own fictional readers, the local reader, and a session from before names were kept. */
const VIEWER_NAMES = new Set(SAMPLE_VIEWERS.map((viewer) => viewer.name));
const VIEWER_NAME = /^access_log\.(entries\[\d+\]\.viewer|facets\.viewers\[\d+\])\.name$/;
const SUBJECT_NAME = /^access_log\.(entries\[\d+\]\.subjects|facets\.subjects)\[\d+\]\.name$/;
/** The sample's people's names, longest first, to take out of text that may hold them. */
const TEAM_NAME_PATTERN = new RegExp(`\\b(${[...TEAM_NAMES].sort((a, b) => b.length - a.length).join("|")})\\b`, "g");

function nameProblems(value: unknown, root: string, peopleLevel = false): string[] {
  const problems: string[] = [];
  walk(value, root, (path, key, item) => {
    const id = peopleLevel && PEOPLE_LEVEL_IDS.test(path);
    const allowed = PERSON_PLACES.some((place) => place.test(path)) || (peopleLevel && PEOPLE_LEVEL_FIELDS.test(path)) || id;
    if (key !== null && PERSON_KEYS.test(key) && !allowed) {
      problems.push(`a person-like field at ${path}`);
    }
    // A person tool's parameter holds a person id, and nothing else: never a name or an account.
    if (id && (typeof item !== "string" || !PERSON_ID_PATTERN.test(item))) problems.push(`not a person id at ${path}`);
    if (typeof item !== "string") return;
    if (NAMED.test(path) || (peopleLevel && PEOPLE_LEVEL_FIELDS.test(path))) {
      const board = peopleLevel && PEOPLE_LEVEL_FIELDS.test(path) && (item === BOARD_NAME || item === UNASSIGNED_LABEL);
      const known = VIEWER_NAME.test(path) ? VIEWER_NAMES.has(item) : TEAM_NAMES.has(item) || (SUBJECT_NAME.test(path) && item === FORMER_MEMBER);
      if (!known && !(path.endsWith(".label") && item === UNASSIGNED_LABEL) && !board) problems.push(`${path}: ${item}`);
    } else if ((peopleLevel && PEOPLE_LEVEL_TEXT.test(path)) || ASKED.test(path)) {
      // The sample's people by their whole names, and no one else, by any part of a name.
      const rest = item.replace(TEAM_NAME_PATTERN, "");
      if (PERSON.test(rest) || TEAM_IN_TEXT.test(rest)) problems.push(`a name at ${path}: ${item}`);
    } else if (PERSON.test(item) || TEAM_IN_TEXT.test(item)) {
      problems.push(`a name at ${path}: ${item}`);
    }
    if (EMAIL.test(item) || ATLASSIAN_ACCOUNT.test(item) || AVATAR.test(item)) problems.push(`${path}: ${item}`);
  });
  return problems;
}

/** The version a team member's picture goes by, or null for the six without one. */
const versionOf = (accountId: string) => pictureOf(accountId)?.version ?? null;

function personProblems(value: unknown, root: string): { problems: string[]; people: number } {
  const problems: string[] = [];
  let people = 0;
  walk(value, root, (path, key, item) => {
    if (key === "people" && path === "ask.people" && Array.isArray(item)) {
      // The people an answer names: each exactly as a person goes everywhere else.
      for (const person of item as { id: string; name: string; avatar: string | null }[]) {
        people += 1;
        const { id, name, avatar, ...rest } = person;
        const member = EVERYONE.find((candidate) => candidate.name === name);
        if (Object.keys(rest).length > 0 || !member || id !== personIdFor(member.accountId) || avatar !== versionOf(member.accountId)) {
          problems.push(`${path}: ${JSON.stringify(person)}`);
        }
      }
      return;
    }
    if (key === "people" && path.endsWith(".facets.people") && Array.isArray(item)) {
      for (const entry of item as { value: string; label: string; avatar: string | null }[]) {
        const member = TEAM.find((candidate) => personIdFor(candidate.accountId) === entry.value);
        if (entry.avatar !== (member ? versionOf(member.accountId) : null)) problems.push(`${path}: ${JSON.stringify(entry)}`);
      }
      return;
    }
    if (key === "subjects" && /^access_log\.(entries\[\d+\]|facets)\.subjects$/.test(path) && Array.isArray(item)) {
      // Whose figures an entry read: each exactly as a person goes everywhere else, or the one former member.
      for (const person of item as { id: string; name: string; avatar: string | null }[]) {
        people += 1;
        const { id, name, avatar, ...rest } = person;
        const member = EVERYONE.find((candidate) => candidate.name === name);
        const former = name === FORMER_MEMBER && id === FORMER.id && avatar === null;
        const current = member !== undefined && id === personIdFor(member.accountId) && avatar === versionOf(member.accountId);
        if (Object.keys(rest).length > 0 || !(former || current)) problems.push(`${path}: ${JSON.stringify(person)}`);
      }
      return;
    }
    // A person object only: a fact row's assignee column is a name (checked as text above), a tool's person parameter an id.
    if ((key !== "assignee" && key !== "person") || item === null || typeof item !== "object") return;
    people += 1;
    const { id, name, avatar, ...rest } = item as { id: string; name: string; avatar: string | null };
    const member = EVERYONE.find((candidate) => candidate.name === name);
    if (Object.keys(rest).length > 0 || !member || id !== personIdFor(member.accountId) || avatar !== versionOf(member.accountId)) {
      problems.push(`${path}: ${JSON.stringify(item)}`);
    }
  });
  return { problems, people };
}

/** An account id, or a field of Jira's user object, anywhere in a body's text. */
function accountProblems(value: unknown, label: string): string[] {
  const text = JSON.stringify(value);
  const problems = EVERYONE.filter((member) => text.includes(member.accountId)).map((member) => `${label} carries ${member.accountId}`);
  if (/accountId|emailAddress|avatarUrls|timeZone/.test(text)) problems.push(`${label} carries a field of Jira's user object`);
  if (/atl-paas\.net|gravatar\.com|useravatar/.test(text)) problems.push(`${label} carries a picture's address`);
  return problems;
}

describe("sample responses name people only as the contract names them", () => {
  const routes: JsonRoute[] = [
    { name: "health" },
    { name: "overview" },
    { name: "people" },
    { name: "people_directory" },
    { name: "insights" },
    { name: "rules" },
    { name: "baseline" },
    findings({ state: "all", page_size: 100 }),
    // A member with no tickets is on the board, and owns no finding: an empty page.
    ...MEMBERS.map((member) => findings({ person: [personIdFor(member.accountId)], state: "all" })),
    findings({ person: [UNASSIGNED], state: "all", page_size: 100 }),
    ...dataset.world.issues.map((issue): JsonRoute => ({ name: "issue_timeline", issueKey: issue.key })),
    ...dataset.engine.findings.map((finding): JsonRoute => ({ name: "finding", findingId: finding.id })),
    ...SCRIPTED.flatMap((question) => [ask(question, "team"), ask(question, "people")]),
    ...PEOPLE_QUESTIONS.flatMap(([question, mentions]) => [ask(question, "team"), ask(question, "people", mentions)]),
    ...SCORECARDS,
    // Everyone's card on the board, over each period: ticket holders and the members who hold none.
    ...EVERYONE.flatMap((member) =>
      SCORECARD_DAYS.map((days): JsonRoute => ({ name: "person_card", personId: personIdFor(member.accountId), query: { days }, level: "people" })),
    ),
  ];
  /** Each body once, for every check below. */
  let answered: { route: JsonRoute; value: unknown }[] | undefined;
  const responses = () => (answered ??= routes.map((route) => ({ route, value: body(route) })));
  const atPeopleLevel = (route: JsonRoute) => route.name === "ask" && route.level === "people";

  it("in any field name or any text", () => {
    expect(responses().flatMap(({ route, value }) => nameProblems(value, route.name, atPeopleLevel(route)))).toEqual([]);
  });

  it("and at team level, Ask names no one and carries no person column, whatever is asked", () => {
    const team = responses().filter(({ route }) => route.name === "ask" && route.level === "team");
    expect(team.length).toBeGreaterThan(PEOPLE_QUESTIONS.length);
    for (const { route, value } of team) {
      const answer = value as { people: unknown[]; question: string; facts: { columns: { key: string }[] }[] };
      expect(answer.people, answer.question).toEqual([]);
      const columns = answer.facts.flatMap((fact) => fact.columns.map((column) => column.key));
      expect(columns.filter((column) => /person|assignee|^name$/.test(column)), answer.question).toEqual([]);
      // Not even the people the question names (what a reader types is theirs; the answer adds no one).
      const { question: _question, ...rest } = answer;
      expect(nameProblems(rest, route.name), answer.question).toEqual([]);
    }
  });

  it("and at people level, Ask lists exactly the people its words name, verified, in the order it names them", () => {
    // Every answer with words: those answered, and the no_data that says mentioned members hold no tickets.
    const named = responses().filter(({ route, value }) => atPeopleLevel(route) && (value as { answer: string | null }).answer !== null);
    const withPeople = named.filter(({ value }) => (value as { people: unknown[] }).people.length > 0);
    expect(withPeople.length).toBeGreaterThanOrEqual(8);
    expect(named.filter(({ value }) => (value as { outcome: string }).outcome === "no_data")).toHaveLength(3);
    for (const { value } of named) {
      const answer = value as { answer: string; people: { name: string }[] };
      const order = EVERYONE.map((member) => ({ name: member.name, at: answer.answer.search(new RegExp(`(?<![\\p{L}\\p{N}_])${member.name}(?![\\p{L}\\p{N}_])`, "u")) }))
        .filter((member) => member.at >= 0)
        .sort((a, b) => a.at - b.at)
        .map((member) => member.name);
      expect(answer.people.map((person) => person.name), answer.answer).toEqual(order);
    }
  });

  it("as an id, a display name and their picture's version, and nothing else about anyone", () => {
    const checked = responses().map(({ route, value }) => personProblems(value, route.name));
    expect(checked.flatMap((result) => result.problems)).toEqual([]);
    expect(checked.reduce((sum, result) => sum + result.people, 0)).toBeGreaterThan(1000);
  });

  it("never with an account id, whatever field it might hide in", () => {
    expect(responses().flatMap(({ route, value }) => accountProblems(value, route.name))).toEqual([]);
  });

  it("with ids that are the contract's one-way hash of the account id, never the account id itself", () => {
    // sha256("acc-01"), first 12 hex characters: the value the service derives for the same made-up account.
    expect(personIdFor("acc-01")).toBe("pbc7fe62842ca");
    for (const member of TEAM) {
      const id = personIdFor(member.accountId);
      expect(id).toBe(`p${createHash("sha256").update(member.accountId, "utf8").digest("hex").slice(0, 12)}`);
      expect(id).toMatch(PERSON_ID_PATTERN);
      expect(id).not.toContain(member.accountId);
    }
    expect(new Set(TEAM_IDS).size).toBe(TEAM.length);
    // The members with no tickets too: every person on the board has an id of their own.
    expect(new Set(EVERYONE.map((member) => personIdFor(member.accountId))).size).toBe(EVERYONE.length);
  });

  it("in any issue summary or epic title of the whole project", () => {
    for (const issue of dataset.world.issues) {
      expect(PERSON.exec(issue.summary)?.[0] ?? null, issue.summary).toBeNull();
      expect(TEAM_IN_TEXT.exec(issue.summary)?.[0] ?? null, issue.summary).toBeNull();
    }
  });

  it("and every response says it is sample data", () => {
    const unlabelled = responses().filter(({ value }) => {
      const meta = (value as { meta?: { data_mode: string; projects: string[] } }).meta;
      return meta?.data_mode !== "sample" || meta.projects.join() !== "DEMO";
    });
    expect(unlabelled.map(({ route }) => route.name)).toEqual([]);
  });
});

/* ------------------------------------------------------ the documented ones -- */

/** docs/sample-responses is what the Python team builds against and what the */

const SAMPLE_DIR = fileURLToPath(new URL("../../../docs/sample-responses/", import.meta.url));
const SAMPLE_ENV = { OVERSIGHT_DATA: "sample", SAMPLE_NOW: "2026-11-04T14:30:00Z", SAMPLE_LATENCY: "0", AUTH_MODE: "off" };

/** The rule settings changes the documented preview, refusal and conflict were asked for. */
const SETTINGS_PREVIEW = { changes: [{ rule_id: "R-EFF-01", params: { threshold: 2 } }, { rule_id: "W-AGE-01", enabled: false }] };
const SETTINGS_REFUSED = { changes: [{ rule_id: "W-EFF-01", params: { threshold: 1.6 } }] };
const SETTINGS_CONFLICT = { revision: 7, changes: [{ rule_id: "R-EFF-01", params: { threshold: 2 } }] };
/** A new rule, as the page sends one for its preview: bugs in progress for over three days. */
const SETTINGS_NEW_RULE: RuleSettingsPreviewRequest = {
  changes: [
    {
      op: "create",
      rule: {
        title: "Bugs in progress over 3 days",
        check: "time_in_status_over",
        params: { statuses: ["In Progress"], hours: 72 },
        applies_to: { status_category: ["indeterminate"], issue_type: ["Bug"] },
        severity: "breach",
      },
    },
  ],
};
/** What an admin asked the AI to draft. */
const RULE_DRAFT = { text: "Bugs in progress for more than 3 days" };

/** Each file and the request that answers it, as docs/sample-responses/README.md lists them. */
const DOCUMENTED: Record<
  string,
  { route: JsonRouteName | "error"; path: string; question?: string; mentions?: string[]; env?: Record<string, string>; body?: unknown }
> = {
  "health.json": { route: "health", path: "health" },
  "overview.json": { route: "overview", path: "overview" },
  "people.json": { route: "people", path: "people" },
  "people-directory.json": { route: "people_directory", path: "people/directory" },
  "findings.json": { route: "findings", path: "findings" },
  "findings-filtered.json": { route: "findings", path: "findings?severity=breach&epic=DEMO-704&sort=issue_key&order=asc&page_size=5" },
  "finding.json": { route: "finding", path: "findings/0b7b3b0f61c477e61699982f24892735" },
  "finding-sprint.json": { route: "finding", path: "findings/4f4dea9b42b76d4882fbb2db662287c3" },
  "issue-DEMO-1.json": { route: "issue_timeline", path: "issues/DEMO-1/timeline" },
  "ask-answered.json": { route: "ask", path: "ask", question: "Which epics have the most open breaches?" },
  "ask-answered-trend.json": { route: "ask", path: "ask", question: "How is effort against estimate trending?" },
  "ask-not-understood.json": { route: "ask", path: "ask", question: "What is the weather?" },
  "ask-no-data.json": { route: "ask", path: "ask", question: "Which tickets were reopened this week?" },
  "ask-not-measurable.json": { route: "ask", path: "ask", question: "Which tickets reached testing without code review?" },
  "ask-not-verified.json": { route: "ask", path: "ask", question: "What is the median cycle time this quarter?" },
  "ask-people.json": { route: "ask", path: "ask", question: "Who has the most open breaches?" },
  "ask-person.json": { route: "ask", path: "ask", question: "What are @Carmen Ruiz's open findings?", mentions: [personIdFor("acc-03")] },
  "ask-person-no-tickets.json": { route: "ask", path: "ask", question: "What is @Noor Haddad working on?", mentions: [personIdFor("acc-09")] },
  "people-scorecard.json": { route: "people_scorecard", path: "people/scorecard" },
  "people-scorecard-person.json": { route: "people_scorecard", path: `people/scorecard?days=30&person=${personIdFor("acc-08")}` },
  "people-scorecard-off.json": { route: "people_scorecard", path: "people/scorecard", env: { SAMPLE_PEOPLE_COMPARISON: "off" } },
  "error-comparison-off.json": {
    route: "error",
    path: `people/scorecard?person=${personIdFor("acc-01")}&person=${personIdFor("acc-03")}`,
    env: { SAMPLE_PEOPLE_COMPARISON: "off" },
  },
  "ask-scorecard.json": { route: "ask", path: "ask", question: "Is @Carmen Ruiz doing well?", mentions: [personIdFor("acc-03")] },
  "ask-scorecards.json": { route: "ask", path: "ask", question: "How are @Ada Brooks and @Carmen Ruiz doing?", mentions: [personIdFor("acc-01"), personIdFor("acc-03")] },
  "ask-comparison.json": { route: "ask", path: "ask", question: "Who is best on the board? Rank the others" },
  "ask-comparison-off.json": { route: "ask", path: "ask", question: "Who is best on the board? Rank the others", env: { SAMPLE_PEOPLE_COMPARISON: "off" } },
  "ask-personnel.json": { route: "ask", path: "ask", question: "Should we promote @Carmen Ruiz?", mentions: [personIdFor("acc-03")] },
  "ask-backlog.json": { route: "ask", path: "ask", question: "What is @Carmen Ruiz's backlog?", mentions: [personIdFor("acc-03")] },
  "insights.json": { route: "insights", path: "insights/latest" },
  "trend-median_effort_ratio.json": { route: "trend", path: "trends?metric=median_effort_ratio" },
  "rules.json": { route: "rules", path: "rules" },
  "baseline.json": { route: "baseline", path: "baseline/latest" },
  "portfolio.json": { route: "portfolio", path: "portfolio" },
  "access-log.json": { route: "access_log", path: "access-log?limit=6" },
  "access-log-filtered.json": {
    route: "access_log",
    path: `access-log?action=scorecard_view&action=people_compare_view&person=${personIdFor("acc-01")}&limit=3`,
  },
  "usage.json": { route: "usage", path: "usage" },
  "person-card.json": { route: "person_card", path: `people/${personIdFor("acc-01")}/card` },
  "person-card-member.json": { route: "person_card", path: `people/${personIdFor("acc-09")}/card?days=30` },
  "rule-settings.json": { route: "rule_settings", path: "rules/settings" },
  "rule-settings-preview.json": { route: "rule_settings_preview", path: "rules/settings/preview", body: SETTINGS_PREVIEW },
  "rule-settings-preview-new-rule.json": { route: "rule_settings_preview", path: "rules/settings/preview", body: SETTINGS_NEW_RULE },
  "rule-settings-draft.json": { route: "rule_settings_draft", path: "rules/settings/draft", body: RULE_DRAFT },
  "error-rule-settings-invalid.json": { route: "error", path: "rules/settings/preview", body: SETTINGS_REFUSED },
  "error-rule-settings-conflict.json": { route: "error", path: "rules/settings", body: SETTINGS_CONFLICT },
  "error-not-found.json": { route: "error", path: "issues/DEMO-99999/timeline" },
  "error-bad-request.json": { route: "error", path: "findings?colour=red" },
};

function request(path: string, question?: string, mentions?: string[], settings?: unknown): Promise<Response> {
  const url = new URL(`http://localhost:3400/api/oversight/${path}`);
  const context = { params: Promise.resolve({ path: url.pathname.replace(/^\/api\/oversight\//, "").split("/") }) };
  if (settings !== undefined) {
    // A change to rule settings, as the page sends it: JSON, from the dashboard's own origin.
    const headers = { "content-type": "application/json", origin: "http://localhost:3400" };
    return POST(new NextRequest(url, { method: "POST", body: JSON.stringify(settings), headers }), context);
  }
  if (question === undefined) return GET(new NextRequest(url), context);
  const body = JSON.stringify(mentions ? { question, mentions } : { question });
  // A question as the Ask page sends it: JSON, from the dashboard's own origin.
  const init = { method: "POST", body, headers: { "content-type": "application/json", origin: "http://localhost:3400" } };
  return POST(new NextRequest(url, init), context);
}

const documented = (file: string): unknown => JSON.parse(readFileSync(`${SAMPLE_DIR}${file}`, "utf8"));

describe("the documented sample responses", () => {
  beforeEach(() => {
    for (const [name, value] of Object.entries(SAMPLE_ENV)) vi.stubEnv(name, value);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetSampleClock();
  });

  it("are every file there, each listed in the folder's README", () => {
    const files = readdirSync(SAMPLE_DIR).filter((file) => file.endsWith(".json"));
    expect(files.sort()).toEqual(Object.keys(DOCUMENTED).sort());
    const readme = readFileSync(`${SAMPLE_DIR}README.md`, "utf8");
    for (const file of files) expect(readme, file).toContain(`\`${file}\``);
  });

  it("are, to the byte, what the route answers now", async () => {
    for (const [file, { path, question, mentions, env, body }] of Object.entries(DOCUMENTED)) {
      for (const [name, value] of Object.entries(env ?? { SAMPLE_PEOPLE_COMPARISON: "on" })) vi.stubEnv(name, value);
      const answer: unknown = await (await request(path, question, mentions, body)).json();
      expect(readFileSync(`${SAMPLE_DIR}${file}`, "utf8"), file).toBe(`${JSON.stringify(answer, null, 2)}\n`);
    }
  });

  it("fit the contract exactly", () => {
    for (const [file, { route }] of Object.entries(DOCUMENTED)) {
      const value = documented(file);
      const parsed = (route === "error" ? apiErrorBodySchema : RESPONSE_SCHEMAS[route]).safeParse(value);
      expect(parsed.success ? [] : parsed.error.issues.slice(0, 3), file).toEqual([]);
      expect(parsed.data, file).toStrictEqual(value);
    }
  });

  it("name people only as the contract does, and never carry an account id, an email address or a picture's address", () => {
    const checked = Object.entries(DOCUMENTED).map(([file, { route }]) => {
      const value = documented(file);
      return {
        file,
        names: nameProblems(value, route, route === "ask"),
        persons: personProblems(value, route),
        accounts: accountProblems(value, file),
      };
    });
    expect(checked.flatMap((entry) => [...entry.names, ...entry.persons.problems, ...entry.accounts])).toEqual([]);
    expect(checked.find((entry) => entry.file === "people.json")?.persons.people).toBe(TEAM.length);
    expect(checked.find((entry) => entry.file === "people-directory.json")?.persons.people).toBe(EVERYONE.length);
  });

  it("say they are sample data, wherever they carry meta", () => {
    for (const file of Object.keys(DOCUMENTED)) {
      const meta = (documented(file) as { meta?: { data_mode: string; projects: string[] } }).meta;
      if (file.startsWith("error-")) expect(meta, file).toBeUndefined();
      // The Portfolio belongs to no one board: its meta names every synced board it lists.
      else if (file === "portfolio.json") expect([meta?.data_mode, meta?.projects], file).toEqual(["sample", ["DEMO", "MOB"]]);
      else expect([meta?.data_mode, meta?.projects], file).toEqual(["sample", ["DEMO"]]);
    }
  });
});

/* --------------------------------------------- the service's own answers --- */

const SERVICE_DIR = fileURLToPath(new URL("./fixtures/service/", import.meta.url));
const service = (file: string): unknown => JSON.parse(readFileSync(`${SERVICE_DIR}${file}`, "utf8"));
const SERVICE_SETTINGS = [
  "rule-settings-applied.json",
  "rule-settings-running.json",
  "rule-settings-failed.json",
  "rule-settings-pending.json",
  "rule-settings-applied-by-cycle.json",
  "rule-settings-saved.json",
  "rule-settings-undone.json",
  "rule-settings-custom.json",
];
const SERVICE_PREVIEWS = [
  "rule-settings-preview.json",
  "rule-settings-preview-not-measurable.json",
  "rule-settings-preview-custom.json",
  "rule-settings-preview-custom-changes.json",
];
const LIVE_ENV = { OVERSIGHT_DATA: "live", OVERSIGHT_API_URL: "http://oversight.internal:3300", OVERSIGHT_SERVICE_KEY: "svc-key", AUTH_MODE: "off" };
const SERVICE_HEADERS = { "content-type": "application/json", origin: "http://localhost:3400", cookie: "jo-board=DEMO" };
/** The new rule the refusals of custom rules were captured for, as the page would send it. */
const CAPTURED_RULE = {
  title: "Bugs in review over 3 days",
  check: "time_in_status_over",
  params: { statuses: ["Code Review"], hours: 72 },
  applies_to: { status_category: ["indeterminate"], issue_type: ["Bug"] },
  severity: "breach",
};

/** A POST to the oversight route as the page sends it, with the service answering `answer`. */
async function postThrough(path: string, sent: unknown, answer: { status: number; body: unknown }): Promise<Response> {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => Response.json(answer.body, { status: answer.status })));
  const url = new URL(`http://localhost:3400/api/oversight/${path}`);
  return POST(new NextRequest(url, { method: "POST", body: JSON.stringify(sent), headers: SERVICE_HEADERS }), {
    params: Promise.resolve({ path: path.split("/") }),
  });
}

describe("the oversight service's own rule settings answers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("are every file there, each named here", () => {
    const files = readdirSync(SERVICE_DIR).filter((file) => file.endsWith(".json"));
    expect(files.sort()).toEqual(
      [...SERVICE_SETTINGS, ...SERVICE_PREVIEWS, "rule-settings-drafts.json", "rule-settings-refusals.json", "rules-custom.json"].sort(),
    );
  });

  it("fit the contract: the settings in every apply state, a save and an undo, and custom rules added, edited and deleted", () => {
    const states = new Set<string>();
    for (const file of SERVICE_SETTINGS) {
      const parsed = RESPONSE_SCHEMAS.rule_settings.safeParse(service(file));
      expect(parsed.success ? [] : parsed.error.issues.slice(0, 3), file).toEqual([]);
      if (parsed.success) states.add(parsed.data.apply.state);
    }
    expect([...states].sort()).toEqual(["applied", "failed", "pending", "running"]);
    const custom = RESPONSE_SCHEMAS.rule_settings.parse(service("rule-settings-custom.json"));
    expect(custom.rules.filter((rule) => rule.custom).map((rule) => [rule.rule_id, rule.check_label])).toEqual([
      ["R-CUS-01", "Time in a status"],
      ["W-CUS-01", "Open too long"],
    ]);
    expect(custom.history[0].changes.map((change) => `${change.rule_id}.${change.field}`)).toEqual([
      "R-CUS-01.title",
      "R-CUS-01.params.hours",
      "R-CUS-02.rule",
      "W-CUS-01.applies_to",
    ]);
    // Every check the board may use, with its options from the board: its statuses with their categories.
    const statuses = custom.checks.find((check) => check.name === "time_in_status_over")?.params.find((param) => param.name === "statuses");
    expect(statuses?.options?.map((option) => [option.value, option.category])).toEqual([
      ["To Do", "new"],
      ["In Progress", "indeterminate"],
      ["Done", "done"],
    ]);
  });

  it("fit the contract: the previews (new rules under the ids a save would give them), and the catalogue holding custom rules", () => {
    for (const file of SERVICE_PREVIEWS) {
      const parsed = RESPONSE_SCHEMAS.rule_settings_preview.safeParse(service(file));
      expect(parsed.success ? [] : parsed.error.issues.slice(0, 3), file).toEqual([]);
    }
    const added = RESPONSE_SCHEMAS.rule_settings_preview.parse(service("rule-settings-preview-custom.json"));
    expect(added.impact.map((impact) => impact.rule_id)).toEqual(["R-CUS-01", "R-CUS-02", "W-CUS-01"]);
    expect(added.impact.every((impact) => impact.open_now === 0 && impact.would_close === 0)).toBe(true);
    const rules = RESPONSE_SCHEMAS.rules.safeParse(service("rules-custom.json"));
    expect(rules.success ? [] : rules.error.issues.slice(0, 3)).toEqual([]);
    expect(rules.data?.rules.filter((rule) => rule.custom).map((rule) => rule.check_label)).toEqual(["Time in a status", "Open too long"]);
  });

  it("fit the contract: an AI draft of every outcome the scripted drafter gives", () => {
    const drafts = service("rule-settings-drafts.json") as Record<string, unknown>;
    const outcomes = Object.entries(drafts).map(([name, body]) => {
      const parsed = RESPONSE_SCHEMAS.rule_settings_draft.safeParse(body);
      expect(parsed.success ? [] : parsed.error.issues.slice(0, 3), name).toEqual([]);
      return [name, parsed.data?.outcome, parsed.data?.problems.map((problem) => problem.field)];
    });
    expect(outcomes).toEqual([
      ["drafted", "drafted", []],
      ["not_supported", "not_supported", []],
      ["not_understood", "not_understood", []],
      ["problems", "drafted", ["params.days"]],
    ]);
  });

  it("pass through the live route as they are: the settings of the board asked for, and a draft", async () => {
    for (const [name, value] of Object.entries(LIVE_ENV)) vi.stubEnv(name, value);
    for (const file of ["rule-settings-running.json", "rule-settings-custom.json"]) {
      const answer = service(file) as { project: string };
      vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => Response.json(answer)));
      const url = new URL("http://localhost:3400/api/oversight/rules/settings");
      const response = await GET(new NextRequest(url, { headers: { cookie: `jo-board=${answer.project}` } }), { params: Promise.resolve({ path: ["rules", "settings"] }) });
      expect(response.status, file).toBe(200);
      expect(await response.json(), file).toEqual(RESPONSE_SCHEMAS.rule_settings.parse(answer));
    }
    const drafted = (service("rule-settings-drafts.json") as Record<string, unknown>).drafted;
    const response = await postThrough("rules/settings/draft", { text: "Bugs in progress for more than 3 days" }, { status: 200, body: drafted });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(RESPONSE_SCHEMAS.rule_settings_draft.parse(drafted));
  });

  it("reach the browser as this interface's own refusals, each problem the service names at its setting, in its words", async () => {
    for (const [name, value] of Object.entries(LIVE_ENV)) vi.stubEnv(name, value);
    const refusals = service("rule-settings-refusals.json") as Record<string, { status: number; body: { errors?: { message: string }[] } }>;
    // The custom rules' refusals were captured for these changes: sent as the page sends them.
    const inProgress = { statuses: ["In Progress"], hours: 72 };
    const sentFor: Record<string, unknown[]> = {
      save422_custom_bad_status: [{ op: "create", rule: CAPTURED_RULE }],
      save422_custom_title_taken: [{ op: "create", rule: { ...CAPTURED_RULE, title: "open over 30 DAYS", params: inProgress } }],
      save422_custom_issue_type: [
        { op: "create", rule: { ...CAPTURED_RULE, params: inProgress, applies_to: { status_category: ["indeterminate"], issue_type: ["Epic"] } } },
      ],
      save422_custom_reset: [{ rule_id: "R-CUS-01", reset: true }],
      save422_custom_restore_live: [{ op: "restore", rule_id: "R-CUS-01" }],
    };
    const paths: Record<string, string[]> = {};
    for (const [name, answer] of Object.entries(refusals)) {
      if (name.startsWith("draft") || name.endsWith("board_not_synced")) continue;
      const preview = name.startsWith("preview");
      const changes = sentFor[name] ?? [{ rule_id: "R-EFF-01", enabled: false }];
      const response = await postThrough(preview ? "rules/settings/preview" : "rules/settings", preview ? { changes } : { revision: 2, changes }, answer);
      const refused = apiErrorBodySchema.parse(await response.json());
      const { status, body } = answer;
      if (status === 409) {
        expect([response.status, refused.error], name).toEqual([409, "rule_settings_conflict"]);
      } else if (status === 503) {
        expect([response.status, refused.error], name).toEqual([503, "upstream_unavailable"]);
      } else {
        expect([response.status, refused.error], name).toEqual([422, "rule_settings_invalid"]);
        // Every problem passed on, in the service's own words (they are plain), each at a place the page reads.
        expect(refused.issues?.map((issue) => issue.message), name).toEqual(body.errors?.map((error) => error.message));
        for (const issue of refused.issues ?? []) {
          expect(issue.path, name).toMatch(
            /^(?:[RW]-[A-Z]+-\d{2,3}(?:\.(?:enabled|severity|reset|title|description|applies_to(?:\.[a-z_]+)?|params(?:\.[a-z_]+)?))?|new-\d+(?:\.[a-z_.]+)?|reason|revision|changes|undo_of|\(settings\))$/,
          );
        }
        paths[name] = refused.issues?.map((issue) => issue.path) ?? [];
      }
    }
    expect(paths.save422_bad_rule_id).toEqual(["(settings)"]);
    expect(paths.save422_params_not_object).toEqual(["R-EFF-01.params"]);
    expect(paths.save422_unknown_key).toEqual(["(settings)"]);
    // A title is a field a change may set since (a custom rule's edit): said at it, beside the rule all the same.
    expect(paths.save422_unknown_change_key).toEqual(["R-EFF-01.title"]);
    expect(paths.save422_cross_rule_warning).toEqual(["W-EFF-01.params.threshold"]);
    expect(paths.save422_reset_and_more).toEqual(["R-EFF-01.reset"]);
    expect([paths.save422_reason_email, paths.save422_undo_unknown, paths.save422_revision_missing, paths.save422_empty]).toEqual([
      ["reason"],
      ["undo_of"],
      ["revision"],
      ["changes"],
    ]);
    // A new rule has no id: the service names its field alone, and the page's one new rule is where it stands.
    expect([paths.save422_custom_bad_status, paths.save422_custom_title_taken, paths.save422_custom_issue_type]).toEqual([
      ["new-0.params.statuses"],
      ["new-0.title"],
      ["new-0.applies_to.issue_type"],
    ]);
    expect([paths.save422_custom_reset, paths.save422_custom_restore_live]).toEqual([["R-CUS-01.reset"], ["R-CUS-01"]]);
  });

  it("say a draft's refused words, and a board never synced, as this interface does", async () => {
    for (const [name, value] of Object.entries(LIVE_ENV)) vi.stubEnv(name, value);
    const refusals = service("rule-settings-refusals.json") as Record<string, { status: number; body: { detail: string } }>;
    const words = await postThrough("rules/settings/draft", { text: "Bugs open for 3 days" }, refusals.draft422_email);
    expect([words.status, apiErrorBodySchema.parse(await words.json()).message]).toEqual([400, refusals.draft422_email.body.detail]);
    const neverSynced = refusals.settings_board_not_synced;
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => Response.json(neverSynced.body, { status: neverSynced.status })));
    for (const path of [["rules", "settings"], ["rules"]]) {
      const url = new URL(`http://localhost:3400/api/oversight/${path.join("/")}`);
      const response = await GET(new NextRequest(url, { headers: { cookie: "jo-board=AIL" } }), { params: Promise.resolve({ path }) });
      expect([response.status, apiErrorBodySchema.parse(await response.json()).error], path.join("/")).toEqual([409, "board_not_synced"]);
    }
    expect(refusals.rules_board_not_synced.body).toEqual(neverSynced.body);
  });
});
