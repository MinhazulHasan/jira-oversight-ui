// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import accessLogJson from "../../../../docs/sample-responses/access-log.json";
import { GET, POST } from "@/app/api/oversight/[...path]/route";
import {
  ACCESS_ACTION_LABELS,
  accessLogSchema,
  apiErrorBodySchema,
  peopleProofSchema,
  peopleScorecardSchema,
  SCORECARD_MEASURES,
  type PeopleScorecard,
} from "@/lib/api/schemas";
import { sealSession } from "@/server/auth/cookies";
import { emailHash } from "@/server/auth/roles";
import { SECRET, SESSION_KEYS, stubAuthEnv } from "@/server/auth/__tests__/fixtures";
import { resetSampleClock } from "@/server/sample/clock";
import { EVERYONE, MEMBERS, personIdFor, TEAM } from "@/server/sample/team";

/** The tickets behind every figure on the People page (contract 4.25), checked from the outside: the interface's own route, sample and live. */

const NOW = "2026-11-04T14:30:00Z";
const API = "http://oversight.internal:3300";
const SITE = "https://example.atlassian.net";
const PERIODS = [30, 90, 180] as const;
const EVERY_KEY = [...SCORECARD_MEASURES.map((measure) => measure.key), "tickets"] as const;
const TICKETS_MEASURE = { key: "tickets", label: "Tickets", kind: "count", direction: "neutral", rule_ids: [], measurable: true, reason: null };
const BODY_KEYS = ["counted", "left_out", "measure", "meta", "period", "person", "tickets", "total", "value"];
const TICKET_KEYS = ["at", "counted", "credit", "detail", "ignore", "issue_type", "key", "status", "status_category", "summary", "url"];
const DETAIL_KEYS: Record<string, string[] | null> = {
  open_tickets: null,
  in_progress: null,
  done_in_period: null,
  tickets: null,
  estimated_before_start: ["estimate_set_at", "grace_hours", "started_at"],
  time_logged: ["subtask_time_spent_s", "time_spent_s"],
  within_estimate: ["estimate_s", "limit", "logged_s", "ratio"],
  stuck_now: ["hours", "since", "status", "threshold"],
  reopened: ["times"],
  skipped_stage: ["stages"],
  code_review: ["breach"],
  open_findings_per_10: ["findings", "rule_ids"],
};
const DONE_BASED = new Set(["done_in_period", "time_logged", "within_estimate", "reopened", "skipped_stage", "code_review"]);
const NOW_MEASURES = new Set(["open_tickets", "in_progress", "stuck_now", "open_findings_per_10"]);
const BASES = new Set(["assignee_now", "field"]);
const CARMEN = personIdFor("acc-03");
const NOOR = personIdFor(MEMBERS[0].accountId);
const LEAD = "lead@stellainternational.com";
const IDENTITY = { sub: "557058:account", dom: "stellainternational.com", site: "cloud-id", eh: "h".repeat(43), boards: ["DEMO"] };

interface Person {
  id: string;
  name: string;
  avatar: string | null;
}
interface Value {
  value: number | null;
  numerator: number | null;
  denominator: number | null;
  enough: boolean;
  vs_board: string | null;
}
interface Ticket {
  key: string;
  summary: string | null;
  issue_type: string | null;
  status: string | null;
  status_category: string | null;
  counted: boolean;
  credit: { person: Person | null; basis: string | null; field: string | null };
  at: string | null;
  detail: Record<string, unknown> | null;
  ignore: Record<string, unknown> | null;
  url: string | null;
}
interface Proof {
  meta: Record<string, unknown>;
  period: { days: number; from: string; to: string };
  measure: { key: string; kind: string; measurable: boolean };
  person: Person | null;
  value: Value;
  total: number;
  counted: number;
  tickets: Ticket[];
  left_out: Ticket[];
}

function call(method: "GET" | "POST", path: string, init: { body?: unknown; cookie?: string } = {}) {
  const url = new URL(`http://localhost:3400/api/oversight/${path}`);
  const headers: Record<string, string> = init.cookie ? { cookie: init.cookie } : {};
  // A POST as the dashboard's own pages send one: from its origin, with a JSON body.
  if (method === "POST") Object.assign(headers, { origin: url.origin, "content-type": "application/json" });
  const request = new NextRequest(url, { method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  const context = { params: Promise.resolve({ path: url.pathname.replace(/^\/api\/oversight\//, "").split("/").map(decodeURIComponent) }) };
  return method === "GET" ? GET(request, context) : POST(request, context);
}

const proofPath = (measure: string, person: string | null = null, days = 90) =>
  `people/scorecard/tickets?${new URLSearchParams({ days: String(days), measure, ...(person ? { person } : {}) }).toString()}`;

async function expectProblem(response: Response, status: number, error: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = apiErrorBodySchema.parse(await response.json());
  expect(body.error).toBe(error);
  expect(body.message.length).toBeGreaterThan(0);
  return body;
}

async function proofOf(path: string, cookie?: string): Promise<Proof> {
  const response = await call("GET", path, { cookie });
  expect(response.status, path).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body: unknown = await response.json();
  const parsed = peopleProofSchema.safeParse(body);
  expect(parsed.success, `${path}: ${parsed.success ? "" : JSON.stringify(parsed.error.issues.slice(0, 3))}`).toBe(true);
  return body as Proof;
}

async function cardOf(person: string | null, days: number): Promise<PeopleScorecard> {
  const response = await call("GET", `people/scorecard?days=${days}${person ? `&person=${person}` : ""}`);
  expect(response.status).toBe(200);
  return peopleScorecardSchema.parse(await response.json());
}

function cellOf(card: PeopleScorecard, measure: string, person: string | null): Value {
  const row = person === null ? null : card.people.find((candidate) => candidate.person.id === person);
  if (person !== null && !row) throw new Error(`${person} is not on the scorecard`);
  const tickets = row ? row.tickets : card.board.tickets;
  if (measure === "tickets") return { value: tickets, numerator: null, denominator: null, enough: true, vs_board: null };
  return (row ? row.values : card.board.values)[measure as keyof PeopleScorecard["board"]["values"]];
}

const number = (key: string) => Number(key.slice(key.lastIndexOf("-") + 1));

/** The contract's order: counted first, then `at` newest first (none last), then the key by its number. */
function contractOrder(tickets: readonly Ticket[]): string[] {
  return [...tickets]
    .sort(
      (a, b) =>
        Number(b.counted) - Number(a.counted) ||
        Number(a.at === null) - Number(b.at === null) ||
        (a.at !== null && b.at !== null ? Date.parse(b.at) - Date.parse(a.at) : 0) ||
        number(a.key) - number(b.key),
    )
    .map((ticket) => ticket.key);
}

const whole = (value: number | null) => value ?? 0;

function expectTicket(ticket: Ticket, measure: string, person: string | null, period: Proof["period"]) {
  expect(Object.keys(ticket).sort()).toEqual(TICKET_KEYS);
  const { credit } = ticket;
  expect(credit.basis === null || BASES.has(credit.basis), ticket.key).toBe(true);
  expect(credit.person === null, ticket.key).toBe(credit.basis === null);
  expect(credit.field !== null, ticket.key).toBe(credit.basis === "field");
  if (person !== null) {
    expect(credit.person?.id, `${measure} ${ticket.key}`).toBe(person);
    if (NOW_MEASURES.has(measure)) expect(credit.basis, `${measure} ${ticket.key}`).toBe("assignee_now");
  }
  const inPeriod = (at: string | null) => at !== null && Date.parse(at) >= Date.parse(period.from) && Date.parse(at) <= Date.parse(period.to);
  if (DONE_BASED.has(measure) || measure === "estimated_before_start") expect(inPeriod(ticket.at), `${measure} ${ticket.key}`).toBe(true);
  else expect(ticket.at, `${measure} ${ticket.key}`).toBeNull();
  const keys = DETAIL_KEYS[measure];
  if (keys === null) {
    expect(ticket.detail, `${measure} ${ticket.key}`).toBeNull();
    return;
  }
  const detail = ticket.detail ?? {};
  expect(Object.keys(detail).sort(), `${measure} ${ticket.key}`).toEqual(keys);
  const why = `${measure} ${ticket.key} ${JSON.stringify(detail)}`;
  const amount = (name: string) => Number(detail[name]);
  switch (measure) {
    case "estimated_before_start": {
      expect(detail.started_at).toBe(ticket.at);
      const setAt = detail.estimate_set_at;
      const late = typeof setAt === "string" ? (Date.parse(setAt) - Date.parse(String(detail.started_at))) / 3_600_000 : Infinity;
      expect(ticket.counted, why).toBe(late <= amount("grace_hours"));
      break;
    }
    case "time_logged":
      expect(ticket.counted, why).toBe(amount("time_spent_s") > 0 || amount("subtask_time_spent_s") > 0);
      break;
    case "within_estimate":
      expect(ticket.counted, why).toBe(amount("ratio") < amount("limit"));
      break;
    case "stuck_now": {
      const threshold = detail.threshold;
      if (ticket.counted) expect(typeof threshold === "string" && threshold.length > 0, why).toBe(true);
      else expect(threshold, why).toBeNull();
      break;
    }
    case "reopened":
      expect(ticket.counted, why).toBe(amount("times") > 0);
      break;
    case "skipped_stage":
      expect(ticket.counted, why).toBe((detail.stages as string[]).length > 0);
      break;
    case "code_review":
      expect(ticket.counted, why).toBe(detail.breach === false);
      break;
    case "open_findings_per_10":
      expect(ticket.counted, why).toBe(amount("findings") > 0);
      break;
  }
}

/** Everything the contract holds a proof to, against the scorecard cell it stands behind. */
function expectAddsUp(body: Proof, card: PeopleScorecard, measure: string, person: string | null) {
  expect(Object.keys(body).sort()).toEqual(BODY_KEYS);
  expect(body.period).toEqual(card.period);
  expect(body.measure).toEqual(measure === "tickets" ? TICKETS_MEASURE : card.measures.find((candidate) => candidate.key === measure));
  expect(body.person).toEqual(person === null ? null : card.people.find((row) => row.person.id === person)?.person);
  // To the byte: the value the scorecard shows in that cell.
  expect(JSON.stringify(body.value), `${measure} ${person}`).toBe(JSON.stringify(cellOf(card, measure, person)));
  const { tickets, left_out: leftOut, value } = body;
  expect(body.total).toBe(tickets.length);
  expect(body.counted).toBe(tickets.filter((ticket) => ticket.counted).length);
  if (body.measure.kind === "count") {
    expect([body.total, body.counted], `${measure} ${person}`).toEqual([whole(value.value), whole(value.value)]);
  } else if (body.measure.kind === "rate") {
    expect([body.counted, body.total], `${measure} ${person}`).toEqual([whole(value.numerator), whole(value.denominator)]);
  } else {
    expect(body.total).toBe(whole(value.denominator));
    expect(tickets.reduce((sum, ticket) => sum + Number(ticket.detail?.findings ?? 0), 0)).toBe(whole(value.numerator));
  }
  const keys = [...tickets, ...leftOut].map((ticket) => ticket.key);
  expect(new Set(keys).size, `${measure} ${person}: a key twice`).toBe(keys.length);
  expect(tickets.map((ticket) => ticket.key), `${measure} ${person}: order`).toEqual(contractOrder(tickets));
  for (const ticket of tickets) expectTicket(ticket, measure, person, body.period);
  for (const ticket of leftOut) expect(ticket.ignore, ticket.key).not.toBeNull();
  if (body.measure.kind === "count" || measure === "time_logged") expect(leftOut).toEqual([]);
}

const SAMPLE_ENV = { OVERSIGHT_DATA: "sample", SAMPLE_NOW: NOW, SAMPLE_LATENCY: "0", AUTH_MODE: "off" };

beforeEach(() => {
  for (const [name, value] of Object.entries(SAMPLE_ENV)) vi.stubEnv(name, value);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetSampleClock();
});

describe("the tickets behind every figure, in sample mode", () => {
  for (const days of PERIODS) {
    it(`add up to their cell for the whole board and everyone on it, every measure, last ${days} days`, async () => {
      const everyone = [null, ...EVERYONE.map((member) => personIdFor(member.accountId))];
      for (const person of everyone) {
        const card = await cardOf(person, days);
        for (const measure of EVERY_KEY) {
          const shown = measure === "tickets" || card.measures.find((candidate) => candidate.key === measure)?.measurable;
          if (!shown) {
            await expectProblem(await call("GET", proofPath(measure, person, days)), 409, "not_measurable");
            continue;
          }
          const body = await proofOf(proofPath(measure, person, days));
          expectAddsUp(body, card, measure, person);
          // Links to Jira come only from OVERSIGHT_JIRA_BASE_URL, which sample mode has none of.
          expect([...body.tickets, ...body.left_out].every((ticket) => ticket.url === null)).toBe(true);
        }
      }
    });
  }

  it("names each open ticket's assignee now, as the ticket page does, and nobody for an unassigned one", async () => {
    const board = await proofOf(proofPath("open_tickets"));
    const unassigned = board.tickets.filter((ticket) => ticket.credit.person === null);
    expect(unassigned.length).toBeGreaterThan(0);
    for (const ticket of [...board.tickets.slice(0, 12), ...unassigned.slice(0, 6)]) {
      const timeline = (await (await call("GET", `issues/${ticket.key}/timeline`)).json()) as { issue: { assignee: Person | null } };
      expect(ticket.credit.person, ticket.key).toEqual(timeline.issue.assignee);
      expect(ticket.credit.basis, ticket.key).toBe(timeline.issue.assignee ? "assignee_now" : null);
    }
  });

  it("lists each person's tickets as the People list counts them, and the board's as the scorecard does", async () => {
    const response = await call("GET", "people");
    const rows = ((await response.json()) as { people: { person: Person | null; tickets: number; open_tickets: number }[] }).people;
    for (const row of rows.filter((candidate) => candidate.person !== null)) {
      const id = row.person!.id;
      expect((await proofOf(proofPath("tickets", id))).total, row.person!.name).toBe(row.tickets);
      expect((await proofOf(proofPath("open_tickets", id))).total, row.person!.name).toBe(row.open_tickets);
    }
    expect((await proofOf(proofPath("tickets"))).total).toBe((await cardOf(null, 90)).board.tickets);
  });

  it("gives a member with no tickets an empty list behind every figure, never an error", async () => {
    const card = await cardOf(NOOR, 90);
    for (const measure of EVERY_KEY.filter((key) => key !== "code_review")) {
      const body = await proofOf(proofPath(measure, NOOR));
      expectAddsUp(body, card, measure, NOOR);
      expect([body.total, body.counted, body.tickets, body.left_out]).toEqual([0, 0, [], []]);
    }
  });

  it("refuses what the People page never asks for, before anything is read", async () => {
    for (const query of [
      "measure=open_tickets&days=45",
      "measure=open_tickets&days=90&days=30",
      "days=90",
      "measure=",
      "measure=nope",
      "measure=Open_tickets",
      "measure=open_tickets&measure=stuck_now",
      "measure=open_tickets&person=ada",
      `measure=open_tickets&person=${CARMEN}&person=${CARMEN}`,
      `measure=open_tickets&person=${CARMEN}&person=${NOOR}`,
      "measure=open_tickets&person=unassigned",
      "measure=open_tickets&person=board",
      "measure=open_tickets&level=people",
      "measure=open_tickets&project=DEMO",
      "measure=open_tickets&colour=red",
    ]) {
      await expectProblem(await call("GET", `people/scorecard/tickets?${query}`), 400, "bad_request");
    }
    await expectProblem(await call("GET", proofPath("open_tickets", "p000000000000")), 404, "not_found");
  });

  it("with comparison off, still shows one person's tickets and the whole board's", async () => {
    vi.stubEnv("SAMPLE_PEOPLE_COMPARISON", "off");
    expectAddsUp(await proofOf(proofPath("stuck_now", CARMEN)), await cardOf(CARMEN, 90), "stuck_now", CARMEN);
    const board = await proofOf(proofPath("stuck_now"));
    expect(board.person).toBeNull();
    expect(board.total).toBe((await cardOf(null, 90)).board.values.stuck_now.denominator);
  });

  it("moves an ignored ticket to its own group with who and why, leaves the counts alone, and puts it back on restore", async () => {
    const before = await proofOf(proofPath("stuck_now", CARMEN));
    const stuck = before.tickets.find((ticket) => ticket.counted);
    if (!stuck) throw new Error("Carmen Ruiz should have a stuck ticket in the sample");
    const opened = await proofOf(proofPath("open_tickets", CARMEN));
    const ignored = await call("POST", "findings/ignore", {
      body: { target: { issue_keys: [stuck.key] }, scope: "ticket", reason: "Handled outside Jira" },
    });
    expect(ignored.status).toBe(200);
    const { ignore_ids: ids } = (await ignored.json()) as { ignore_ids: string[] };
    try {
      const card = await cardOf(CARMEN, 90);
      const after = await proofOf(proofPath("stuck_now", CARMEN));
      expectAddsUp(after, card, "stuck_now", CARMEN);
      expect([after.value.numerator, after.value.denominator]).toEqual([before.value.numerator! - 1, before.value.denominator! - 1]);
      expect(after.left_out.map((ticket) => ticket.key)).toEqual([stuck.key]);
      const why = after.left_out[0].ignore as { scope: string; rule_id: string | null; reason: string | null; by: string | null; at: string };
      expect([why.scope, why.rule_id, why.reason]).toEqual(["ticket", null, "Handled outside Jira"]);
      expect(typeof why.by === "string" && why.by.length > 0 && !why.by.includes("@")).toBe(true);
      const stillOpen = await proofOf(proofPath("open_tickets", CARMEN));
      expect(stillOpen.tickets.map((ticket) => ticket.key)).toEqual(opened.tickets.map((ticket) => ticket.key));
      expect(stillOpen.left_out).toEqual([]);
    } finally {
      expect((await call("POST", "findings/restore", { body: { ignore_ids: ids } })).status).toBe(200);
    }
    const restored = await proofOf(proofPath("stuck_now", CARMEN));
    expect(restored.left_out).toEqual([]);
    expect(restored.tickets.some((ticket) => ticket.key === stuck.key)).toBe(true);
  });
});

describe("the tickets behind a figure with sign-in on", () => {
  beforeEach(() => {
    stubAuthEnv({ OVERSIGHT_DATA: "sample", SAMPLE_NOW: NOW, SAMPLE_LATENCY: "0" });
  });

  it("are never shown below the people level, whatever the browser asks, and the service is never asked", async () => {
    const upstream = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", upstream);
    const reader = `jo-session=${await sealSession(IDENTITY, SESSION_KEYS)}`;
    await expectProblem(await call("GET", proofPath("open_tickets"), { cookie: reader }), 403, "people_not_allowed");
    await expectProblem(await call("GET", proofPath("stuck_now", CARMEN), { cookie: reader }), 403, "people_not_allowed");
    await expectProblem(await call("GET", proofPath("open_tickets")), 401, "unauthenticated");
    for (const [name, value] of Object.entries({ OVERSIGHT_DATA: "live", OVERSIGHT_API_URL: API, OVERSIGHT_SERVICE_KEY: "svc-key" })) vi.stubEnv(name, value);
    await expectProblem(await call("GET", proofPath("tickets", CARMEN), { cookie: reader }), 403, "people_not_allowed");
    expect(upstream).not.toHaveBeenCalled();
  });

  it("are shown to an admin", async () => {
    vi.stubEnv("ADMIN_EMAILS", LEAD);
    const admin = `jo-session=${await sealSession({ ...IDENTITY, eh: emailHash(LEAD, SECRET) }, SESSION_KEYS)}`;
    const body = await proofOf(proofPath("tickets", CARMEN), admin);
    expect(body.person?.id).toBe(CARMEN);
    expect(body.total).toBeGreaterThan(0);
  });
});

describe("the tickets behind a figure in live mode", () => {
  /** What the service sends for a figure: the sample's own proof, labelled live, every link left to this interface. */
  async function serviceBody(measure: string, person: string | null = null, days = 90): Promise<Proof> {
    for (const [name, value] of Object.entries(SAMPLE_ENV)) vi.stubEnv(name, value);
    const body = structuredClone(await proofOf(proofPath(measure, person, days)));
    body.meta = { ...body.meta, data_mode: "live", projects: ["ALPHA"] };
    return body;
  }

  function liveService(answer: () => Response) {
    for (const [name, value] of Object.entries({ OVERSIGHT_DATA: "live", OVERSIGHT_API_URL: API, OVERSIGHT_SERVICE_KEY: "svc-key", OVERSIGHT_JIRA_BASE_URL: SITE })) {
      vi.stubEnv(name, value);
    }
    const upstream = vi.fn<typeof fetch>(async () => answer());
    vi.stubGlobal("fetch", upstream);
    return upstream;
  }

  const read = (measure: string, person: string | null = null, days = 90) => call("GET", proofPath(measure, person, days), { cookie: "jo-board=ALPHA" });

  it("asks the service at the level this interface decided, for the board picked, with the figure rebuilt", async () => {
    const body = await serviceBody("stuck_now", CARMEN, 30);
    const upstream = liveService(() => Response.json(body));
    expect((await read("stuck_now", CARMEN, 30)).status).toBe(200);
    const url = new URL(String(upstream.mock.calls[0][0]));
    expect(url.pathname).toBe("/api/v1/people/scorecard/tickets");
    expect(Object.fromEntries(url.searchParams)).toEqual({ days: "30", measure: "stuck_now", person: CARMEN, project: "ALPHA", level: "people" });
    expect(new Headers(upstream.mock.calls[0][1]?.headers).get("x-service-key")).toBe("svc-key");
  });

  it("links every ticket, the left-out ones too, to the configured Jira site, whatever the service says", async () => {
    const body = await serviceBody("stuck_now");
    const moved = body.tickets.findIndex((ticket) => ticket.counted);
    const [gone] = body.tickets.splice(moved, 1);
    body.left_out = [{ ...gone, counted: false, ignore: { scope: "ticket", rule_id: null, reason: "Out of scope", by: "Morgan Reyes", at: NOW.replace("Z", ".000Z") } }];
    body.total -= 1;
    body.counted -= 1;
    const numerator = body.value.numerator! - 1;
    const denominator = body.value.denominator! - 1;
    body.value = { value: Math.round((100 * numerator) / denominator), numerator, denominator, enough: denominator >= 5, vs_board: null };
    body.tickets[0].url = "https://somewhere-else.example/browse/X-1";
    liveService(() => Response.json(body));
    const linked = await proofOf(proofPath("stuck_now"), "jo-board=ALPHA");
    for (const ticket of [...linked.tickets, ...linked.left_out]) expect(ticket.url).toBe(`${SITE}/browse/${ticket.key}`);
    expect(linked.left_out.map((ticket) => ticket.key)).toEqual([gone.key]);
    vi.stubEnv("OVERSIGHT_JIRA_BASE_URL", "");
    const unlinked = await proofOf(proofPath("stuck_now"), "jo-board=ALPHA");
    expect([...unlinked.tickets, ...unlinked.left_out].every((ticket) => ticket.url === null)).toBe(true);
  });

  it("refuses with 502 a list that does not add up to its figure", async () => {
    const cases: [string, string | null, (body: Proof) => void][] = [
      ["open_tickets", CARMEN, (body) => void (body.value.value = whole(body.value.value) + 1)],
      ["open_tickets", CARMEN, (body) => void (body.total += 1)],
      ["open_tickets", CARMEN, (body) => void ((body.tickets[0].counted = false), (body.counted -= 1))],
      ["stuck_now", null, (body) => void ((body.tickets[body.tickets.length - 1].counted = true), (body.counted += 1))],
      ["stuck_now", null, (body) => void (body.tickets.pop(), (body.total -= 1))],
      ["stuck_now", null, (body) => void (body.value = { ...body.value, value: whole(body.value.value) + 10 })],
      ["open_findings_per_10", null, (body) => void (body.tickets[0].detail = { ...body.tickets[0].detail, findings: Number(body.tickets[0].detail?.findings) + 1 })],
      ["open_findings_per_10", null, (body) => void (body.value = { ...body.value, denominator: whole(body.value.denominator) + 1 })],
      ["open_findings_per_10", null, (body) => {
        const empty = body.tickets.find((ticket) => Number(ticket.detail?.findings) === 0);
        if (!empty) throw new Error("the board should hold an open ticket with no open findings");
        empty.counted = true;
        body.counted += 1;
      }],
      ["stuck_now", CARMEN, (body) => void body.left_out.push({ ...body.tickets[0], ignore: { scope: "ticket", rule_id: null, reason: null, by: "Morgan Reyes", at: "2026-11-04T14:00:00.000Z" } })],
      ["stuck_now", CARMEN, (body) => void body.left_out.push({ ...body.tickets[0], key: "DEMO-99999", ignore: null })],
    ];
    for (const [measure, person, breakIt] of cases) {
      const body = await serviceBody(measure, person);
      liveService(() => Response.json(body));
      expect((await read(measure, person)).status, `${measure}: the body as sent`).toBe(200);
      breakIt(body);
      liveService(() => Response.json(body));
      await expectProblem(await read(measure, person), 502, "upstream_invalid");
    }
  });

  it("refuses with 502 the tickets behind another figure than the one asked for", async () => {
    const carmens = await serviceBody("stuck_now", CARMEN);
    liveService(() => Response.json(carmens));
    await expectProblem(await read("reopened", CARMEN), 502, "upstream_invalid");
    await expectProblem(await read("stuck_now", CARMEN, 30), 502, "upstream_invalid");
    await expectProblem(await read("stuck_now", personIdFor(TEAM[0].accountId)), 502, "upstream_invalid");
    await expectProblem(await read("stuck_now"), 502, "upstream_invalid");
  });

  it("passes on a figure the board cannot show as 409 not_measurable, and someone not on the board as 404", async () => {
    liveService(() => Response.json({ detail: "This board doesn't record code review in Jira.", code: "not_measurable" }, { status: 409 }));
    await expectProblem(await read("code_review", CARMEN), 409, "not_measurable");
    liveService(() => Response.json({ detail: "nobody by that id is on this board" }, { status: 404 }));
    await expectProblem(await read("stuck_now", CARMEN), 404, "not_found");
  });

  it("never passes on an account id where a person belongs", async () => {
    const body = await serviceBody("open_tickets");
    const named = body.tickets.find((ticket) => ticket.credit.person !== null)!;
    named.credit.person = { ...named.credit.person!, id: "557058:0e7d3f6c-1d2b-4c5e-9f00-123456789abc" };
    liveService(() => Response.json(body));
    const refused = await expectProblem(await read("open_tickets"), 502, "upstream_invalid");
    expect(JSON.stringify(refused)).not.toContain("557058");
  });
});

describe("the access log of these reads", () => {
  it("knows the read of the tickets behind a figure, in plain words, for a person and for the whole board", () => {
    expect(ACCESS_ACTION_LABELS.scorecard_tickets_view).toMatch(/^[A-Z][a-z ]+$/);
    const log = structuredClone(accessLogJson) as { entries: Record<string, unknown>[] };
    const [first] = log.entries;
    log.entries = [
      { ...first, level: "people", project: "DEMO", action: "scorecard_tickets_view", subjects: [{ id: CARMEN, name: "Carmen Ruiz", avatar: null }], detail: { days: 90, measure: "stuck_now" } },
      { ...first, id: "b".repeat(32), level: "people", project: "DEMO", action: "scorecard_tickets_view", subjects: [], detail: { days: 30, measure: "tickets" } },
    ];
    const parsed = accessLogSchema.safeParse(log);
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues.slice(0, 3))).toBe(true);
  });
});
