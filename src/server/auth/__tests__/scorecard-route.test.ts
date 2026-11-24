// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GET } from "@/app/api/oversight/[...path]/route";
import { apiErrorBodySchema, peopleScorecardSchema, SCORECARD_SENTENCES, type PeopleScorecard } from "@/lib/api/schemas";

import { resetSampleClock } from "../../sample/clock";
import { buildDataset } from "../../sample/dataset";
import { scorecardView } from "../../sample/scorecard";
import { EVERYONE, MEMBERS, personIdFor, TEAM } from "../../sample/team";
import { sealSession } from "../cookies";
import { emailHash } from "../roles";

import { SECRET, SESSION_KEYS, stubAuthEnv } from "./fixtures";

const NOW = "2026-11-04T14:30:00Z";
const ADA = personIdFor("acc-01");
const CARMEN = personIdFor("acc-03");
const HANA = personIdFor("acc-08");
const NOOR = personIdFor(MEMBERS[0].accountId);
const IDENTITY = { sub: "557058:account", dom: "stellainternational.com", site: "cloud-id", eh: "hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh", boards: ["DEMO"] };
const LEAD = "lead@stellainternational.com";

function call(path: string, cookie?: string) {
  const url = new URL(`http://localhost:3400/api/oversight/${path}`);
  const request = new NextRequest(url, { headers: cookie ? { cookie } : {} });
  return GET(request, { params: Promise.resolve({ path: url.pathname.replace(/^\/api\/oversight\//, "").split("/") }) });
}

async function expectProblem(response: Response, status: number, error: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = apiErrorBodySchema.parse(await response.json());
  expect(body.error).toBe(error);
  return body;
}

async function card(response: Response): Promise<PeopleScorecard> {
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body: unknown = await response.json();
  const parsed = peopleScorecardSchema.parse(body);
  expect(parsed).toStrictEqual(body);
  return parsed;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetSampleClock();
});

describe("the scorecard in sample mode, sign-in off (people level)", () => {
  beforeEach(() => {
    for (const [name, value] of Object.entries({ OVERSIGHT_DATA: "sample", SAMPLE_NOW: NOW, SAMPLE_LATENCY: "0", AUTH_MODE: "off" })) vi.stubEnv(name, value);
  });

  it("with comparison on (the default): everyone who holds a ticket, by folded name, every measure, the board", async () => {
    const body = await card(await call("people/scorecard"));
    expect(body.comparison).toBe("on");
    expect(body.period.days).toBe(90);
    expect(Date.parse(body.period.to) - Date.parse(body.period.from)).toBe(90 * 24 * 3600 * 1000);
    expect(body.people.map((row) => row.person.name)).toEqual([...TEAM.map((member) => member.name)].sort((a, b) => a.localeCompare(b, "en")));
    expect(body.measures.map((measure) => measure.key)).toHaveLength(11);
    // The board's work: 1,150 issues less its 14 Epics.
    expect(body.board.tickets).toBe(1136);
  });

  it("with comparison off: the board's figures alone, one person at a time, and two refused in the contract's words", async () => {
    vi.stubEnv("SAMPLE_PEOPLE_COMPARISON", "off");
    const none = await card(await call("people/scorecard"));
    expect([none.comparison, none.people]).toEqual(["off", []]);
    expect(none.board.values.open_tickets.value).toBeGreaterThan(0);
    const one = await card(await call(`people/scorecard?person=${CARMEN}&days=30`));
    expect(one.people.map((row) => row.person.id)).toEqual([CARMEN]);
    const two = await expectProblem(await call(`people/scorecard?person=${ADA}&person=${CARMEN}`), 403, "comparison_off");
    expect(two.message).toBe(SCORECARD_SENTENCES.comparisonOff);
    vi.stubEnv("SAMPLE_PEOPLE_COMPARISON", "sometimes");
    await expectProblem(await call("people/scorecard"), 500, "not_configured");
  });

  it("several people side by side, and a member with no tickets as all nothing", async () => {
    const body = await card(await call(`people/scorecard?person=${HANA}&person=${NOOR}&person=${ADA}`));
    expect(body.people.map((row) => row.person.id)).toEqual([ADA, HANA, NOOR]);
    const noor = body.people[2];
    expect(noor.tickets).toBe(0);
    expect(Object.values(noor.values).every((value) => value.value === null && !value.enough && value.vs_board === null)).toBe(true);
  });

  it("refuses what the contract refuses, before anything is computed", async () => {
    await expectProblem(await call("people/scorecard?days=45"), 400, "bad_request");
    await expectProblem(await call("people/scorecard?days=90&days=30"), 400, "bad_request");
    await expectProblem(await call(`people/scorecard?person=${ADA}&person=${ADA}`), 400, "bad_request");
    const eleven = EVERYONE.map((member) => `person=${personIdFor(member.accountId)}`).join("&");
    expect(EVERYONE).toHaveLength(11);
    const refused = await expectProblem(await call(`people/scorecard?${eleven}`), 400, "bad_request");
    expect(refused.issues?.[0]?.path).toBe("person");
    await expectProblem(await call("people/scorecard?person=ada"), 400, "bad_request");
    await expectProblem(await call("people/scorecard?level=people"), 400, "bad_request");
    await expectProblem(await call("people/scorecard?project=DEMO"), 400, "bad_request");
    await expectProblem(await call("people/scorecard?person=p000000000000"), 404, "not_found");
  });
});

describe("the scorecard with sign-in on", () => {
  beforeEach(() => {
    stubAuthEnv({ OVERSIGHT_DATA: "sample", SAMPLE_NOW: NOW, SAMPLE_LATENCY: "0" });
  });

  it("is never served to a reader at team level, whatever the browser sends, and asks nothing of anyone", async () => {
    const upstream = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", upstream);
    const session = await sealSession(IDENTITY, SESSION_KEYS);
    const refused = await expectProblem(await call("people/scorecard", `jo-session=${session}`), 403, "people_not_allowed");
    expect(refused.message).toBe("Only admins can see people's scorecards.");
    await expectProblem(await call(`people/scorecard?person=${ADA}`, `jo-session=${session}`), 403, "people_not_allowed");
    await expectProblem(await call("people/scorecard"), 401, "unauthenticated");
    vi.stubEnv("OVERSIGHT_DATA", "live");
    vi.stubEnv("OVERSIGHT_API_URL", "http://oversight.internal:3300");
    vi.stubEnv("OVERSIGHT_SERVICE_KEY", "svc-key");
    await expectProblem(await call("people/scorecard", `jo-session=${session}`), 403, "people_not_allowed");
    expect(upstream).not.toHaveBeenCalled();
  });

  it("is served to an admin", async () => {
    vi.stubEnv("ADMIN_EMAILS", LEAD);
    const session = await sealSession({ ...IDENTITY, eh: emailHash(LEAD, SECRET) }, SESSION_KEYS);
    const body = await card(await call("people/scorecard", `jo-session=${session}`));
    expect(body.people.length).toBe(TEAM.length);
  });
});

describe("the scorecard in live mode", () => {
  const dataset = buildDataset(Date.parse(NOW));
  /** The service's body for a query, as the sample computes it, labelled live on a made-up board. */
  const serviceBody = (person: string[] = [], days: 30 | 90 | 180 = 90, comparison: "on" | "off" = "on") => {
    const answer = scorecardView(dataset, { days, person }, comparison);
    if (!answer.found) throw new Error(answer.message);
    return { ...answer.body, meta: { ...answer.body.meta, data_mode: "live", projects: ["ALPHA"] } };
  };

  function liveService(answer: (url: URL) => Response) {
    for (const [name, value] of Object.entries({ OVERSIGHT_DATA: "live", OVERSIGHT_API_URL: "http://oversight.internal:3300", OVERSIGHT_SERVICE_KEY: "svc-key", AUTH_MODE: "off" })) {
      vi.stubEnv(name, value);
    }
    const upstream = vi.fn<typeof fetch>(async (input) => answer(new URL(String(input))));
    vi.stubGlobal("fetch", upstream);
    return upstream;
  }

  it("tells the service the level this route decided, with the period and the people it checked, and passes the body on", async () => {
    const upstream = liveService(() => Response.json(serviceBody([ADA, CARMEN], 30)));
    const body = await card(await call(`people/scorecard?days=30&person=${CARMEN}&person=${ADA}`, "jo-board=ALPHA"));
    expect(body.people.map((row) => row.person.id)).toEqual([ADA, CARMEN]);
    const [url] = upstream.mock.calls.map(([input]) => new URL(String(input)));
    expect(url.pathname).toBe("/api/v1/people/scorecard");
    expect(url.searchParams.get("level")).toBe("people");
    expect(url.searchParams.get("project")).toBe("ALPHA");
    expect(url.searchParams.get("days")).toBe("30");
    expect(url.searchParams.getAll("person")).toEqual([ADA, CARMEN].sort());
    expect(new Headers(upstream.mock.calls[0][1]?.headers).get("x-service-key")).toBe("svc-key");
  });

  it("says comparison is off where the service refuses two people for it, and nothing else for any other refusal", async () => {
    liveService(() => Response.json({ detail: { code: "comparison_off", message: "off" } }, { status: 403 }));
    const off = await expectProblem(await call(`people/scorecard?person=${ADA}&person=${CARMEN}`), 403, "comparison_off");
    expect(off.message).toBe(SCORECARD_SENTENCES.comparisonOff);
    liveService(() => Response.json({ error: "comparison_off" }, { status: 403 }));
    await expectProblem(await call(`people/scorecard?person=${ADA}&person=${CARMEN}`), 403, "comparison_off");
    liveService(() => Response.json({ detail: "Not authenticated" }, { status: 403 }));
    await expectProblem(await call(`people/scorecard?person=${ADA}&person=${CARMEN}`), 502, "upstream_refused");
    liveService(() => Response.json({ detail: { code: "people_level_only" } }, { status: 403 }));
    await expectProblem(await call("people/scorecard"), 502, "upstream_refused");
  });

  it("reads a 404 as someone not on the board when people were asked for, and as the board otherwise", async () => {
    liveService(() => Response.json({ detail: "not found" }, { status: 404 }));
    await expectProblem(await call(`people/scorecard?person=${ADA}`), 404, "not_found");
    await expectProblem(await call("people/scorecard"), 404, "unknown_board");
    liveService(() => Response.json({ detail: [{ loc: ["query", "days"] }] }, { status: 422 }));
    await expectProblem(await call("people/scorecard"), 502, "upstream_error");
  });

  it("refuses figures for someone not asked about, another period, or arithmetic that does not hold", async () => {
    liveService(() => Response.json(serviceBody([ADA, CARMEN])));
    await expectProblem(await call(`people/scorecard?person=${ADA}`), 502, "upstream_invalid");
    liveService(() => Response.json(serviceBody([], 30)));
    await expectProblem(await call("people/scorecard"), 502, "upstream_invalid");
    const broken = serviceBody();
    broken.people[0].values.reopened = { value: 40, numerator: 1, denominator: 50, enough: true, vs_board: "further" };
    liveService(() => Response.json(broken));
    const invalid = await expectProblem(await call("people/scorecard"), 502, "upstream_invalid");
    expect(invalid.issues?.map((issue) => issue.path)).toContain("people.0.values.reopened");
  });
});
