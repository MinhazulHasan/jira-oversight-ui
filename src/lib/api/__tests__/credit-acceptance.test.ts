// @vitest-environment node
import { readFileSync } from "node:fs";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GET, PUT } from "@/app/api/oversight/[...path]/route";
import { APP, SECRET, SESSION_KEYS, stubAuthEnv } from "@/server/auth/__tests__/fixtures";
import { sealSession } from "@/server/auth/cookies";
import { emailHash } from "@/server/auth/roles";
import { sampleBoard } from "@/server/sample/boards";
import { STATUS } from "@/server/sample/catalogue";
import { resetSampleClock } from "@/server/sample/clock";
import { peopleFields } from "@/server/sample/credit";
import { buildDataset } from "@/server/sample/dataset";
import { personOf } from "@/server/sample/team";
import { DAY } from "@/server/sample/time";
import type { Issue } from "@/server/sample/world";

const NOW = "2026-11-04T14:30:00Z";
const SAMPLE = { OVERSIGHT_DATA: "sample", SAMPLE_NOW: NOW, SAMPLE_LATENCY: "0", AUTH_MODE: "off" };
const LIVE = { OVERSIGHT_DATA: "live", OVERSIGHT_API_URL: "http://oversight.internal:3300", OVERSIGHT_SERVICE_KEY: "svc-key", AUTH_MODE: "off" };
const ORIGIN = "http://localhost:3400";
const BOARD = "jo-board=DEMO";
const IDENTITY = { sub: "557058:account", dom: "stellainternational.com", site: "cloud-id", eh: "h".repeat(43), boards: ["DEMO"] };
const LEAD = "lead@stellainternational.com";
const PEOPLE_FIELDS = ["programmer", "code_reviewers", "testers", "test_reviewers"];
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

interface Field {
  key: string;
  name: string;
}
interface Option {
  source: "auto" | "assignee" | "field";
  field: Field | null;
  source_filled: number;
  credited: number;
}
interface CreditBody {
  meta: { data_mode: string; projects: string[] };
  period: { days: number; from: string; to: string };
  setting: { source: string; field: Field | null; revision: number; changed_by: string | null; changed_at: string | null };
  effective_field: Field | null;
  finished: number;
  options: Option[];
}
interface Value {
  value: number | null;
  numerator: number | null;
  denominator: number | null;
}
interface ScorecardBody {
  basis: string;
  period: { days: number; from: string; to: string };
  board: { tickets: number; values: Record<string, Value> };
  people: { person: { id: string; name: string }; tickets: number; values: Record<string, Value> }[];
}
interface Problem {
  error: string;
  message: string;
}

const params = (url: URL) => ({ params: Promise.resolve({ path: url.pathname.replace(/^\/api\/oversight\//, "").split("/") }) });

function read(path: string, cookie?: string) {
  const url = new URL(`${ORIGIN}/api/oversight/${path}`);
  return GET(new NextRequest(url, { headers: cookie ? { cookie } : {} }), params(url));
}

interface Sent {
  origin?: string | null;
  type?: string;
  cookie?: string;
  raw?: string;
  search?: string;
}

/** A change of the setting as the page sends it: JSON, from the dashboard's own origin. */
function save(body: unknown, { origin = ORIGIN, type = "application/json", cookie, raw, search = "" }: Sent = {}) {
  const url = new URL(`${ORIGIN}/api/oversight/people/credit${search}`);
  const headers: Record<string, string> = { "content-type": type };
  if (origin !== null) headers.origin = origin;
  if (cookie) headers.cookie = cookie;
  return PUT(new NextRequest(url, { method: "PUT", body: raw ?? JSON.stringify(body), headers }), params(url));
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function credit(query = "", cookie?: string): Promise<CreditBody> {
  const response = await read(`people/credit${query}`, cookie);
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  return json<CreditBody>(response);
}

async function expectProblem(response: Response, status: number, error?: string) {
  expect(response.status).toBe(status);
  const body = await json<Problem>(response);
  if (error !== undefined) expect(body.error).toBe(error);
  expect(body.message.length).toBeGreaterThan(0);
  return body;
}

/** The board's choice set to this one, from whatever it is now. */
async function choose(source: string, field: string | null, cookie?: string) {
  const now = await credit("", cookie);
  if (now.setting.source === source && (now.setting.field?.key ?? null) === field) return;
  const response = await save({ source, field, revision: now.setting.revision }, { cookie });
  expect(response.status).toBe(200);
}

/** Back to Automatic, whatever a test left. */
async function restoreAutomatic(cookie?: string) {
  await choose("auto", null, cookie);
}

const dataset = buildDataset(Date.parse(NOW));
const work = dataset.world.issues.filter((issue) => issue.type !== "Epic");
const within = (at: number | null, from: string, to: string) => at !== null && at >= Date.parse(from) && at <= Date.parse(to);

describe("the credit setting in sample mode, sign-in off (people level)", () => {
  beforeEach(() => {
    for (const [name, value] of Object.entries(SAMPLE)) vi.stubEnv(name, value);
  });
  afterEach(async () => {
    await restoreAutomatic();
    vi.unstubAllEnvs();
    resetSampleClock();
  });

  it("answers each choice's coverage of the work finished in the period on screen, counted by hand", async () => {
    for (const [query, days] of [["", 90], ["?days=30", 30], ["?days=90", 90], ["?days=180", 180]] as const) {
      const body = await credit(query);
      const card = await json<ScorecardBody>(await read(`people/scorecard${query}`));
      expect([body.meta.data_mode, body.meta.projects], query).toEqual(["sample", ["DEMO"]]);
      expect(body.period, query).toEqual({ days, from: card.period.from, to: card.period.to });
      expect(Date.parse(body.period.to) - Date.parse(body.period.from)).toBe(days * DAY);
      const finished = work.filter((issue) => within(issue.doneAt, body.period.from, body.period.to));
      const assigned = finished.filter((issue) => issue.assigneeAccountId !== null);
      expect(body.finished, query).toBe(finished.length);
      expect(body.setting).toEqual({ source: "auto", field: null, revision: body.setting.revision, changed_by: null, changed_at: null });
      expect(Number.isInteger(body.setting.revision) && body.setting.revision >= 0).toBe(true);

      const [automatic, assignee, ...fields] = body.options;
      expect([automatic.source, automatic.field, assignee.source, assignee.field]).toEqual(["auto", null, "assignee", null]);
      expect([assignee.source_filled, assignee.credited], query).toEqual([assigned.length, assigned.length]);
      // DEMO fills no people field: Automatic falls back to the assignee, ticket for ticket.
      expect([automatic.source_filled, automatic.credited], query).toEqual([0, assignee.credited]);
      for (const option of fields) {
        expect(option.source).toBe("field");
        expect(PEOPLE_FIELDS).toContain(option.field?.key);
        expect(option.source_filled).toBeLessThanOrEqual(body.finished);
        expect(option.credited).toBeLessThanOrEqual(body.finished);
      }
      const names = fields.map((option) => option.field?.name ?? "");
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "en")));
      if (body.effective_field !== null) expect(PEOPLE_FIELDS).toContain(body.effective_field.key);
      const { meta: _meta, ...setting } = body;
      expect(JSON.stringify(setting)).not.toMatch(/@|acc-\d/);
    }
  });

  it("takes the period alone from the browser: anything else is refused, not guessed", async () => {
    for (const query of ["days=45", "days=ninety", "days=90&days=30", "project=DEMO", "level=people", "person=p000000000000", "colour=red"]) {
      await expectProblem(await read(`people/credit?${query}`), 400, "bad_request");
    }
  });

  it("saves a choice at once with who and when, the figures follow it on DEMO unchanged, and saving the earlier one puts it back", async () => {
    const before = await credit();
    const card = await json<ScorecardBody>(await read("people/scorecard"));
    const people = await json<{ people: unknown[] }>(await read("people"));

    const saved = await save({ source: "assignee", field: null, revision: before.setting.revision });
    expect(saved.status).toBe(200);
    expect(saved.headers.get("cache-control")).toBe("no-store");
    const body = await json<CreditBody>(saved);
    expect(body.setting.source).toBe("assignee");
    expect(body.setting.field).toBeNull();
    expect(body.setting.revision).toBeGreaterThan(before.setting.revision);
    expect(body.setting.changed_by).toBe("Local (sign-in off)");
    expect(body.setting.changed_at).toMatch(ISO);
    expect(body.effective_field).toBeNull();
    expect([body.finished, body.options]).toEqual([before.finished, before.options]);
    expect(body).not.toHaveProperty("history");
    expect((await credit()).setting).toEqual(body.setting);

    const after = await json<ScorecardBody>(await read("people/scorecard"));
    expect(after.basis).toBe("credit");
    expect([after.board, after.people]).toEqual([card.board, card.people]);
    expect((await json<{ people: unknown[] }>(await read("people"))).people).toEqual(people.people);

    const again = await save({ source: "auto", field: null, revision: body.setting.revision });
    expect(again.status).toBe(200);
    const back = await json<CreditBody>(again);
    expect([back.setting.source, back.setting.field, back.setting.revision]).toEqual(["auto", null, body.setting.revision + 1]);
  });

  it("refuses a save made against a revision the board has left, and changes nothing", async () => {
    const before = await credit();
    expect((await save({ source: "assignee", field: null, revision: before.setting.revision })).status).toBe(200);
    await expectProblem(await save({ source: "auto", field: null, revision: before.setting.revision }), 409, "stale_revision");
    await expectProblem(await save({ source: "auto", field: null, revision: before.setting.revision + 40 }), 409, "stale_revision");
    expect((await credit()).setting.source).toBe("assignee");
  });

  it("refuses a choice the board cannot take, and changes nothing", async () => {
    const before = await credit();
    const offered = before.options.flatMap((option) => (option.field ? [option.field.key] : []));
    const unfilled = PEOPLE_FIELDS.find((key) => !offered.includes(key));
    expect(unfilled, "DEMO leaves at least one people field empty").toBeDefined();
    const revision = before.setting.revision;
    for (const body of [
      { source: "programmer", field: null, revision },
      { source: "field", field: null, revision },
      { source: "field", field: unfilled, revision },
      { source: "field", field: "story_points", revision },
      { source: "assignee", field: "programmer", revision },
      { source: "auto", field: "programmer", revision },
      { source: "assignee", field: null },
      { source: "assignee", field: null, revision: String(revision) },
      { source: "assignee", field: null, revision: -1 },
      { source: "assignee", field: null, revision: 0.5 },
    ]) {
      const response = await save(body);
      expect(response.status, JSON.stringify(body)).toBe(422);
    }
    expect((await credit()).setting).toEqual(before.setting);
  });

  it("takes a change only from this dashboard's own pages, as a JSON body of a sane size, with no query", async () => {
    const before = await credit();
    const body = { source: "assignee", field: null, revision: before.setting.revision };
    for (const origin of [null, "https://evil.example", "null", "http://localhost:3401"]) {
      await expectProblem(await save(body, { origin }), 403, "forbidden");
    }
    for (const type of ["text/plain", "application/x-www-form-urlencoded", ""]) {
      await expectProblem(await save(body, { type }), 403, "forbidden");
    }
    await expectProblem(await save(body, { search: "?project=DEMO" }), 400, "bad_request");
    await expectProblem(await save(null, { raw: "{source:" }), 400, "bad_request");
    await expectProblem(await save(null, { raw: JSON.stringify({ ...body, padding: "x".repeat(1024 * 1024) }) }), 413);
    expect((await credit()).setting).toEqual(before.setting);
  });
});

describe("the credit setting with sign-in on", () => {
  beforeEach(() => stubAuthEnv({ OVERSIGHT_DATA: "sample", SAMPLE_NOW: NOW, SAMPLE_LATENCY: "0" }));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    resetSampleClock();
  });

  it("is refused to a user (team level) before the sample is asked anything, and to anyone without a session", async () => {
    const user = `jo-session=${await sealSession(IDENTITY, SESSION_KEYS)}`;
    await expectProblem(await read("people/credit", user), 403, "people_not_allowed");
    await expectProblem(await save({ source: "assignee", field: null, revision: 0 }, { origin: APP, cookie: user }), 403, "people_not_allowed");
    await expectProblem(await read("people/credit"), 401, "unauthenticated");
    await expectProblem(await save({ source: "assignee", field: null, revision: 0 }, { origin: APP }), 401, "unauthenticated");
  });

  it("lets an admin read it and change it, recorded under their display name", async () => {
    vi.stubEnv("ADMIN_EMAILS", LEAD);
    const admin = `jo-session=${await sealSession({ ...IDENTITY, name: "Morgan Ellis", eh: emailHash(LEAD, SECRET) }, SESSION_KEYS)}`;
    const before = await credit("", admin);
    const saved = await save({ source: "assignee", field: null, revision: before.setting.revision }, { origin: APP, cookie: admin });
    expect(saved.status).toBe(200);
    const body = await json<CreditBody>(saved);
    expect(body.setting.changed_by).toBe("Morgan Ellis");
    expect(JSON.stringify(body)).not.toContain(LEAD);
    expect((await save({ source: "auto", field: null, revision: body.setting.revision }, { origin: APP, cookie: admin })).status).toBe(200);
  });

  it("refuses a user in live mode without asking the service anything", async () => {
    stubAuthEnv({ OVERSIGHT_DATA: "live", OVERSIGHT_API_URL: "http://oversight.internal:3300", OVERSIGHT_SERVICE_KEY: "svc-key" });
    const upstream = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", upstream);
    const user = `jo-session=${await sealSession(IDENTITY, SESSION_KEYS)}`;
    await expectProblem(await read("people/credit", user), 403, "people_not_allowed");
    await expectProblem(await save({ source: "assignee", field: null, revision: 0 }, { origin: APP, cookie: user }), 403, "people_not_allowed");
    expect(upstream).not.toHaveBeenCalled();
  });
});

describe("the credit setting in live mode", () => {
  let answer: CreditBody;

  beforeEach(async () => {
    for (const [name, value] of Object.entries(SAMPLE)) vi.stubEnv(name, value);
    // The sample's own answer after one change: the contract's shape.
    const before = await credit();
    answer = await json<CreditBody>(await save({ source: "assignee", field: null, revision: before.setting.revision }));
    await restoreAutomatic();
    answer = { ...answer, meta: { ...answer.meta, data_mode: "live" } };
    vi.unstubAllEnvs();
    for (const [name, value] of Object.entries(LIVE)) vi.stubEnv(name, value);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    resetSampleClock();
  });

  function service(reply: (url: URL, init: RequestInit | undefined) => Response) {
    const upstream = vi.fn<typeof fetch>(async (input, init) => reply(new URL(String(input)), init));
    vi.stubGlobal("fetch", upstream);
    return upstream;
  }

  it("reads the picked board's setting at people level for the period asked, naming the reader", async () => {
    const to = Date.parse(answer.period.to);
    const thirty = { ...answer, period: { days: 30, from: new Date(to - 30 * DAY).toISOString(), to: new Date(to).toISOString() } };
    const upstream = service(() => Response.json(thirty));
    const response = await read("people/credit?days=30", BOARD);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(thirty);
    const [url, init] = upstream.mock.calls[0];
    const asked = new URL(String(url));
    expect(asked.origin + asked.pathname).toBe("http://oversight.internal:3300/api/v1/people/credit");
    expect([asked.searchParams.get("project"), asked.searchParams.get("level"), asked.searchParams.get("days")]).toEqual(["DEMO", "people", "30"]);
    expect(init?.method ?? "GET").toBe("GET");
    const headers = new Headers(init?.headers);
    expect(headers.get("x-service-key")).toBe("svc-key");
    expect(headers.get("x-oversight-viewer")).toBe("local");
    expect(headers.get("x-oversight-viewer-name")).toBe(encodeURIComponent("Local (sign-in off)"));
  });

  it("sends a change to the service as a PUT of the source, the field and the revision, and nothing else", async () => {
    const upstream = service(() => Response.json(answer));
    const response = await save({ source: "field", field: "programmer", revision: 7 }, { cookie: BOARD });
    expect(response.status).toBe(200);
    const [url, init] = upstream.mock.calls[0];
    const asked = new URL(String(url));
    expect(asked.origin + asked.pathname).toBe("http://oversight.internal:3300/api/v1/people/credit");
    expect([asked.searchParams.get("project"), asked.searchParams.get("level")]).toEqual(["DEMO", "people"]);
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(String(init?.body))).toEqual({ source: "field", field: "programmer", revision: 7 });
    expect(new Headers(init?.headers).get("x-oversight-viewer")).toBe("local");
  });

  it("refuses an answer that breaks the contract as 502 upstream_invalid", async () => {
    const broken: unknown[] = [
      { ...answer, setting: { ...answer.setting, source: "programmer" } },
      { ...answer, finished: -1 },
      { ...answer, options: "auto" },
      { ...answer, period: { ...answer.period, days: 45 } },
    ];
    for (const body of broken) {
      service(() => Response.json(body));
      await expectProblem(await read("people/credit", BOARD), 502, "upstream_invalid");
    }
  });

  it("passes on the service's stale revision as 409 stale_revision, and its refusal of a choice as 422", async () => {
    service(() => Response.json({ detail: "the board's credit setting is at another revision", code: "stale_revision" }, { status: 409 }));
    await expectProblem(await save({ source: "assignee", field: null, revision: 3 }, { cookie: BOARD }), 409, "stale_revision");
    service(() =>
      Response.json({ detail: [{ loc: ["body", "field"], msg: "Testers is filled on no ticket of this board", type: "value_error" }] }, { status: 422 }),
    );
    await expectProblem(await save({ source: "field", field: "testers", revision: 3 }, { cookie: BOARD }), 422);
  });
});

describe("the people on DEMO, as the credit rule counts them in sample mode", () => {
  beforeEach(() => {
    for (const [name, value] of Object.entries(SAMPLE)) vi.stubEnv(name, value);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetSampleClock();
  });

  it("are counted by the current assignee exactly as before: every person, every period, basis credit", async () => {
    for (const days of [30, 90, 180]) {
      const card = await json<ScorecardBody>(await read(`people/scorecard?days=${days}`));
      expect(card.basis).toBe("credit");
      const holders = new Set(work.map((issue) => personOf(issue)?.id).filter((id) => id !== undefined));
      expect(new Set(card.people.map((row) => row.person.id))).toEqual(holders);
      for (const row of card.people) {
        const theirs = work.filter((issue) => personOf(issue)?.id === row.person.id);
        const done = theirs.filter((issue) => within(issue.doneAt, card.period.from, card.period.to));
        expect(row.tickets, row.person.name).toBe(theirs.length);
        expect(row.values.open_tickets.value, row.person.name).toBe(theirs.filter((issue) => STATUS[issue.status].category !== "done").length);
        expect(row.values.done_in_period.value, row.person.name).toBe(done.length);
      }
      expect(card.board.tickets).toBe(work.length);
    }
  });

  it("agree everywhere: the people list, the directory, the scorecard and each person's card", async () => {
    const people = (await json<{ people: { person: { id: string } | null; tickets: number; open_tickets: number }[] }>(await read("people"))).people;
    const directory = new Map(
      (await json<{ people: { person: { id: string }; tickets: number }[] }>(await read("people/directory"))).people.map((entry) => [entry.person.id, entry.tickets]),
    );
    const card = new Map((await json<ScorecardBody>(await read("people/scorecard"))).people.map((row) => [row.person.id, row]));
    for (const row of people) {
      if (row.person === null) continue;
      const scored = card.get(row.person.id);
      expect(scored?.tickets).toBe(row.tickets);
      expect(directory.get(row.person.id)).toBe(row.tickets);
      expect(scored?.values.open_tickets.value).toBe(row.open_tickets);
      const shown = await json<{ work: { open_tickets: number; in_progress: number; done_in_period: number } }>(await read(`people/${row.person.id}/card`));
      expect(shown.work).toMatchObject({
        open_tickets: scored?.values.open_tickets.value,
        in_progress: scored?.values.in_progress.value,
        done_in_period: scored?.values.done_in_period.value,
      });
    }
  });
});

describe("a board whose tickets fill people fields (MOB, sample mode)", () => {
  const MOB = "jo-board=MOB";
  const mob = buildDataset(Date.parse(NOW), undefined, sampleBoard("MOB")!);
  const named = peopleFields(mob.world);
  const mobWork = mob.world.issues.filter((issue) => issue.type !== "Epic");
  const holder = (issue: Issue) => personOf(issue)?.id ?? null;
  const filled = (issue: Issue, key: string | null) => (key === null ? [] : (named.get(issue.key)?.[key] ?? []));
  /** Whom a ticket counts for, by hand: a chosen field's people alone; Automatic's Programmer where filled, else the assignee now; the assignee now. */
  const builders = (issue: Issue, source: "auto" | "assignee" | "field", key: string | null): readonly string[] => {
    const people = filled(issue, key);
    if (people.length > 0) return people;
    if (source === "field") return [];
    const now = holder(issue);
    return now === null ? [] : [now];
  };
  const tally = (issues: Issue[], test: (issue: Issue) => boolean) => issues.filter(test).length;

  beforeEach(() => {
    for (const [name, value] of Object.entries(SAMPLE)) vi.stubEnv(name, value);
  });
  afterEach(async () => {
    await choose("assignee", null, MOB);
    vi.unstubAllEnvs();
    resetSampleClock();
  });

  it("starts on its file's choice and offers Programmer and Testers, each choice's coverage counted by hand", async () => {
    expect(mobWork.some((issue) => filled(issue, "programmer").length > 1)).toBe(true);
    for (const days of [30, 90, 180]) {
      const body = await credit(`?days=${days}`, MOB);
      expect([body.setting.source, body.setting.changed_by, body.effective_field]).toEqual(["assignee", null, null]);
      const finished = mobWork.filter((issue) => within(issue.doneAt, body.period.from, body.period.to));
      expect(body.finished).toBe(finished.length);
      const option = (source: "auto" | "assignee" | "field", key: string | null, first: string | null) => ({
        source,
        field: key === null ? null : { key, name: key === "programmer" ? "Programmer" : "Testers" },
        source_filled: first === null ? tally(finished, (issue) => holder(issue) !== null) : tally(finished, (issue) => filled(issue, first).length > 0),
        credited: tally(finished, (issue) => builders(issue, source, first).length > 0),
      });
      expect(body.options, `${days} days`).toEqual([
        option("auto", null, "programmer"),
        option("assignee", null, null),
        option("field", "programmer", "programmer"),
        option("field", "testers", "testers"),
      ]);
    }
  });

  it("changes every person's figures at once to the choice saved, counted by hand, and leaves DEMO's choice alone", async () => {
    const demoBefore = (await credit()).setting;
    for (const [source, field, first] of [
      ["auto", null, "programmer"],
      ["field", "testers", "testers"],
      ["assignee", null, null],
    ] as const) {
      await choose(source, field, MOB);
      const card = await json<ScorecardBody>(await read("people/scorecard", MOB));
      expect(card.basis).toBe("credit");
      const everyone = new Set(mobWork.flatMap((issue) => builders(issue, source, first)));
      expect(new Set(card.people.map((row) => row.person.id)), source).toEqual(everyone);
      for (const row of card.people) {
        const id = row.person.id;
        const label = `${row.person.name}, ${source} ${field ?? ""}`;
        const theirs = mobWork.filter((issue) => builders(issue, source, first).includes(id));
        expect(row.tickets, label).toBe(theirs.length);
        expect(row.values.done_in_period.value, label).toBe(tally(theirs, (issue) => within(issue.doneAt, card.period.from, card.period.to)));
        expect(row.values.open_tickets.value ?? 0, label).toBe(tally(theirs, (issue) => STATUS[issue.status].category !== "done"));
      }
      expect(card.board.tickets).toBe(mobWork.length);
    }
    expect((await credit()).setting).toEqual(demoBefore);
  });
});

describe("the contract", () => {
  const contract = readFileSync(new URL("../../../../docs/API_CONTRACT.md", import.meta.url), "utf8");

  it("documents the credit setting in 4.29 and the scorecard's basis as credit", () => {
    const start = contract.search(/^### 4\.29 .*\/people\/credit/m);
    expect(start).toBeGreaterThan(-1);
    const end = contract.indexOf("\n### ", start + 1);
    const section = contract.slice(start, end === -1 ? undefined : end);
    expect(section).toMatch(/\bGET\b/);
    expect(section).toMatch(/\bPUT\b/);
    expect(section).toMatch(/stale_revision/);
    expect(contract).toMatch(/\| `basis` \| `"credit"` \|/);
    expect(contract).not.toMatch(/\| `basis` \| `"current_assignee"` \|/);
  });
});
