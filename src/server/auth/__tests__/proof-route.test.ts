// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GET } from "@/app/api/oversight/[...path]/route";
import { apiErrorBodySchema, peopleProofSchema, type PeopleProof } from "@/lib/api/schemas";

import { resetSampleClock } from "../../sample/clock";
import { buildDataset } from "../../sample/dataset";
import { proofView } from "../../sample/proof";
import { personIdFor } from "../../sample/team";
import { sealSession } from "../cookies";
import { emailHash } from "../roles";

import { SECRET, SESSION_KEYS, stubAuthEnv } from "./fixtures";

const NOW = "2026-11-04T14:30:00Z";
const ADA = personIdFor("acc-01");
const CARMEN = personIdFor("acc-03");
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

async function proof(response: Response): Promise<PeopleProof> {
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body: unknown = await response.json();
  const parsed = peopleProofSchema.parse(body);
  expect(parsed).toStrictEqual(body);
  return parsed;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetSampleClock();
});

describe("the tickets behind a figure in sample mode, sign-in off (people level)", () => {
  beforeEach(() => {
    for (const [name, value] of Object.entries({ OVERSIGHT_DATA: "sample", SAMPLE_NOW: NOW, SAMPLE_LATENCY: "0", AUTH_MODE: "off" })) vi.stubEnv(name, value);
  });

  it("serves a person's figure and the whole board's, as the sample works them out, never cached", async () => {
    const body = await proof(await call(`people/scorecard/tickets?measure=reopened&person=${CARMEN}&days=180`));
    const expected = proofView(buildDataset(Date.parse(NOW)), { days: 180, measure: "reopened", person: CARMEN });
    expect(expected.found && body).toStrictEqual(expected.found && peopleProofSchema.parse(expected.body));
    const board = await proof(await call("people/scorecard/tickets?measure=tickets"));
    expect([board.person, board.total, board.period.days]).toEqual([null, 1136, 90]);
    // No Jira address in sample mode: every link is null, as the issue page's is.
    expect(board.tickets.every((ticket) => ticket.url === null)).toBe(true);
  });

  it("serves one person or the board with comparison off, as the scorecard does", async () => {
    vi.stubEnv("SAMPLE_PEOPLE_COMPARISON", "off");
    expect((await proof(await call(`people/scorecard/tickets?measure=open_tickets&person=${ADA}`))).person?.id).toBe(ADA);
    expect((await proof(await call("people/scorecard/tickets?measure=open_tickets"))).person).toBeNull();
  });

  it("refuses what the contract refuses, before anything is computed", async () => {
    await expectProblem(await call("people/scorecard/tickets"), 400, "bad_request");
    await expectProblem(await call("people/scorecard/tickets?measure=velocity"), 400, "bad_request");
    await expectProblem(await call("people/scorecard/tickets?measure=reopened&days=45"), 400, "bad_request");
    await expectProblem(await call("people/scorecard/tickets?measure=reopened&measure=stuck_now"), 400, "bad_request");
    await expectProblem(await call("people/scorecard/tickets?measure=reopened&person=ada"), 400, "bad_request");
    await expectProblem(await call(`people/scorecard/tickets?measure=reopened&person=${ADA}&person=${CARMEN}`), 400, "bad_request");
    await expectProblem(await call("people/scorecard/tickets?measure=reopened&project=DEMO"), 400, "bad_request");
    await expectProblem(await call("people/scorecard/tickets?measure=reopened&level=people"), 400, "bad_request");
    await expectProblem(await call("people/scorecard/tickets/more?measure=reopened"), 404, "not_found");
    const nobody = await expectProblem(await call("people/scorecard/tickets?measure=reopened&person=p000000000000"), 404, "not_found");
    expect(nobody.message).toBe("This person is not on this board.");
    // DEMO records no code review: there is no figure, so no tickets behind one.
    await expectProblem(await call("people/scorecard/tickets?measure=code_review"), 409, "not_measurable");
  });
});

describe("the tickets behind a figure with sign-in on", () => {
  beforeEach(() => {
    stubAuthEnv({ OVERSIGHT_DATA: "sample", SAMPLE_NOW: NOW, SAMPLE_LATENCY: "0" });
  });

  it("are never served to a reader at team level, whatever the browser sends, and ask nothing of anyone", async () => {
    const upstream = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", upstream);
    const session = await sealSession(IDENTITY, SESSION_KEYS);
    const refused = await expectProblem(await call("people/scorecard/tickets?measure=tickets", `jo-session=${session}`), 403, "people_not_allowed");
    expect(refused.message).toBe("Only admins can see the tickets behind people's figures.");
    await expectProblem(await call(`people/scorecard/tickets?measure=stuck_now&person=${ADA}`, `jo-session=${session}`), 403, "people_not_allowed");
    await expectProblem(await call("people/scorecard/tickets?measure=tickets"), 401, "unauthenticated");
    vi.stubEnv("OVERSIGHT_DATA", "live");
    vi.stubEnv("OVERSIGHT_API_URL", "http://oversight.internal:3300");
    vi.stubEnv("OVERSIGHT_SERVICE_KEY", "svc-key");
    await expectProblem(await call("people/scorecard/tickets?measure=tickets", `jo-session=${session}`), 403, "people_not_allowed");
    expect(upstream).not.toHaveBeenCalled();
  });

  it("are served to an admin", async () => {
    vi.stubEnv("ADMIN_EMAILS", LEAD);
    const session = await sealSession({ ...IDENTITY, eh: emailHash(LEAD, SECRET) }, SESSION_KEYS);
    const body = await proof(await call(`people/scorecard/tickets?measure=stuck_now&person=${ADA}`, `jo-session=${session}`));
    expect(body.person?.id).toBe(ADA);
  });
});

describe("the tickets behind a figure in live mode", () => {
  const dataset = buildDataset(Date.parse(NOW));
  /** The service's body, as the sample works it out, labelled live on a made-up board, links null as the service sends them. */
  const serviceBody = (measure: Parameters<typeof proofView>[1]["measure"] = "stuck_now", person: string | null = CARMEN, days: 30 | 90 | 180 = 90) => {
    const answer = proofView(dataset, { days, measure, person });
    if (!answer.found) throw new Error(answer.message);
    return { ...answer.body, meta: { ...answer.body.meta, data_mode: "live", projects: ["ALPHA"] } };
  };

  function liveService(answer: (url: URL) => Response, jira = "https://example.atlassian.net") {
    for (const [name, value] of Object.entries({
      OVERSIGHT_DATA: "live",
      OVERSIGHT_API_URL: "http://oversight.internal:3300",
      OVERSIGHT_SERVICE_KEY: "svc-key",
      OVERSIGHT_JIRA_BASE_URL: jira,
      AUTH_MODE: "off",
    })) {
      vi.stubEnv(name, value);
    }
    const upstream = vi.fn<typeof fetch>(async (input) => answer(new URL(String(input))));
    vi.stubGlobal("fetch", upstream);
    return upstream;
  }

  it("tells the service the level this route decided, with the figure it checked, and links every ticket to Jira", async () => {
    const withLeftOut = serviceBody();
    const ignored = { ...withLeftOut.tickets.at(-1)!, key: "DEMO-99998", counted: false, ignore: { scope: "ticket" as const, rule_id: null, reason: "Closed before the change", by: "Morgan Ellis", at: NOW } };
    withLeftOut.left_out = [ignored];
    const upstream = liveService(() => Response.json(withLeftOut));
    const body = await proof(await call(`people/scorecard/tickets?person=${CARMEN}&measure=stuck_now`, "jo-board=ALPHA"));
    const [url] = upstream.mock.calls.map(([input]) => new URL(String(input)));
    expect(url.pathname).toBe("/api/v1/people/scorecard/tickets");
    expect(url.searchParams.get("level")).toBe("people");
    expect(url.searchParams.get("project")).toBe("ALPHA");
    expect(url.searchParams.get("measure")).toBe("stuck_now");
    expect(url.searchParams.get("person")).toBe(CARMEN);
    expect(url.searchParams.has("days")).toBe(false);
    expect(new Headers(upstream.mock.calls[0][1]?.headers).get("x-service-key")).toBe("svc-key");
    for (const ticket of [...body.tickets, ...body.left_out]) expect(ticket.url).toBe(`https://example.atlassian.net/browse/${ticket.key}`);
  });

  it("decides the links itself: whatever the service says, and none without a Jira address", async () => {
    const said = serviceBody();
    said.tickets[0] = { ...said.tickets[0], url: "https://somewhere-else.example/x" };
    liveService(() => Response.json(said));
    expect((await proof(await call(`people/scorecard/tickets?measure=stuck_now&person=${CARMEN}`))).tickets[0].url).toBe(
      `https://example.atlassian.net/browse/${said.tickets[0].key}`,
    );
    liveService(() => Response.json(serviceBody()), "");
    expect((await proof(await call(`people/scorecard/tickets?measure=stuck_now&person=${CARMEN}`))).tickets.every((ticket) => ticket.url === null)).toBe(true);
  });

  it("refuses the tickets behind another figure, and a list that does not add up to its figure", async () => {
    liveService(() => Response.json(serviceBody("reopened")));
    await expectProblem(await call(`people/scorecard/tickets?measure=stuck_now&person=${CARMEN}`), 502, "upstream_invalid");
    liveService(() => Response.json(serviceBody("stuck_now", ADA)));
    await expectProblem(await call(`people/scorecard/tickets?measure=stuck_now&person=${CARMEN}`), 502, "upstream_invalid");
    liveService(() => Response.json(serviceBody("stuck_now", CARMEN, 30)));
    await expectProblem(await call(`people/scorecard/tickets?measure=stuck_now&person=${CARMEN}`), 502, "upstream_invalid");
    liveService(() => Response.json(serviceBody("stuck_now", null)));
    await expectProblem(await call(`people/scorecard/tickets?measure=stuck_now&person=${CARMEN}`), 502, "upstream_invalid");
    const broken = serviceBody();
    broken.tickets.pop();
    liveService(() => Response.json(broken));
    const invalid = await expectProblem(await call(`people/scorecard/tickets?measure=stuck_now&person=${CARMEN}`), 502, "upstream_invalid");
    expect(invalid.issues?.map((issue) => issue.path)).toContain("total");
  });

  it("says who is not on the board, a figure it cannot show, and a service from before the route, each in its own words", async () => {
    liveService(() => Response.json({ detail: "not found" }, { status: 404 }));
    expect((await expectProblem(await call(`people/scorecard/tickets?measure=stuck_now&person=${ADA}`), 404, "not_found")).message).toBe(
      "This person is not on this board.",
    );
    await expectProblem(await call("people/scorecard/tickets?measure=stuck_now"), 502, "upstream_error");
    liveService(() => Response.json({ detail: { code: "unknown_board" } }, { status: 404 }));
    await expectProblem(await call("people/scorecard/tickets?measure=stuck_now"), 404, "unknown_board");
    liveService(() => Response.json({ detail: { code: "not_measurable", message: "no" } }, { status: 409 }));
    await expectProblem(await call("people/scorecard/tickets?measure=code_review"), 409, "not_measurable");
    liveService(() => Response.json({ detail: { code: "board_not_synced" } }, { status: 409 }));
    await expectProblem(await call("people/scorecard/tickets?measure=tickets"), 409, "board_not_synced");
    liveService(() => Response.json({ detail: { code: "people_level_only" } }, { status: 403 }));
    await expectProblem(await call("people/scorecard/tickets?measure=tickets"), 502, "upstream_refused");
  });
});
