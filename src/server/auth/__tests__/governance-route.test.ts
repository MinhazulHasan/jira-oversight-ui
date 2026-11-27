// @vitest-environment node
import { createHmac } from "node:crypto";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GET, POST } from "@/app/api/oversight/[...path]/route";
import {
  ACCESS_ACTIONS,
  accessLogSchema,
  apiErrorBodySchema,
  askRateLimitMessage,
  FORMER_MEMBER,
  overviewSchema,
  portfolioSchema,
  usageSchema,
  type AccessLog,
  type Portfolio,
} from "@/lib/api/schemas";

import portfolioJson from "../../../../docs/sample-responses/portfolio.json";
import { resetSampleClock } from "../../sample/clock";
import { personIdFor } from "../../sample/team";
import { sealSession } from "../cookies";
import { emailHash } from "../roles";
import { LOCAL_READER, readerHeaders, viewerHash, viewerOf } from "../viewer";

import { SECRET, SESSION_KEYS, stubAuthEnv } from "./fixtures";

const NOW = "2026-11-04T14:30:00Z";
const ADA = personIdFor("acc-01");
const IDENTITY = { sub: "557058:account", dom: "stellainternational.com", site: "cloud-id", eh: "hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh", boards: ["DEMO"] };
const LEAD = "lead@stellainternational.com";
const SAMPLE = { OVERSIGHT_DATA: "sample", SAMPLE_NOW: NOW, SAMPLE_LATENCY: "0", AUTH_MODE: "off" };
const LIVE = { OVERSIGHT_DATA: "live", OVERSIGHT_API_URL: "http://oversight.internal:3300", OVERSIGHT_SERVICE_KEY: "svc-key", AUTH_MODE: "off" };

const params = (url: URL) => ({ params: Promise.resolve({ path: url.pathname.replace(/^\/api\/oversight\//, "").split("/") }) });

function call(path: string, cookie?: string) {
  const url = new URL(`http://localhost:3400/api/oversight/${path}`);
  return GET(new NextRequest(url, { headers: cookie ? { cookie } : {} }), params(url));
}

function ask(question: string, cookie?: string) {
  const url = new URL("http://localhost:3400/api/oversight/ask");
  // As the Ask page sends it: JSON, from the dashboard's own origin (APP_URL's, when a test turns sign-in on).
  const headers: Record<string, string> = { "content-type": "application/json", origin: url.origin, ...(cookie ? { cookie } : {}) };
  return POST(new NextRequest(url, { method: "POST", body: JSON.stringify({ question }), headers }), params(url));
}

async function expectProblem(response: Response, status: number, error: string) {
  expect(response.status).toBe(status);
  const body = apiErrorBodySchema.parse(await response.json());
  expect(body.error).toBe(error);
  return body;
}

async function read<T>(response: Response, schema: { parse: (value: unknown) => T }): Promise<T> {
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  return schema.parse(await response.json());
}

function stub(env: Record<string, string>) {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetSampleClock();
});

/* ------------------------------------------------------------ sample --- */

describe("governance in sample mode, sign-in off (people level)", () => {
  beforeEach(() => stub(SAMPLE));

  it("the Portfolio holds the Overview's own figures for each synced board, and its oldest open breaches, oldest first", async () => {
    const portfolio = await read(await call("portfolio"), portfolioSchema);
    const overview = await read(await call("overview"), overviewSchema);
    // The sample's synced boards, DEMO and MOB; HELP, which has never synced, is counted, not listed.
    expect(portfolio.boards.map((each) => each.project.key)).toEqual(["DEMO", "MOB"]);
    expect(portfolio.boards_not_synced).toBe(1);
    const [board] = portfolio.boards;
    expect(board.open_breaches).toBe(overview.totals.open_breaches.current);
    expect(board.open_warnings).toBe(overview.totals.open_warnings.current);
    expect(board.new_findings_7d).toBe(overview.totals.new_7d.current);
    expect(board.resolved_findings_7d).toBe(overview.totals.resolved_7d.current);
    const open = overview.status_mix.filter((status) => status.status_category !== "done");
    expect(board.open_tickets).toBe(open.reduce((sum, status) => sum + status.count, 0));
    expect(board.open_findings_trend).toHaveLength(8);
    expect(board.open_findings_trend.at(-1)).toBe(board.open_breaches + board.open_warnings);
    const top = [...overview.by_rule].sort((a, b) => b.open - a.open)[0];
    expect(board.top_rule).toEqual({ id: top.rule_id, title: top.title, open: top.open });
    // Stale as the service says it, by the clock at the time of reading: the sample pinned to NOW and read days later is.
    expect(board.stale).toBe(Date.now() - Date.parse(board.last_sync_at!) > 24 * 3_600_000);

    expect(portfolio.attention.length).toBeGreaterThan(0);
    expect(portfolio.attention.length).toBeLessThanOrEqual(10);
    for (const item of portfolio.attention) {
      expect(item.severity).toBe("breach");
      expect(["DEMO", "MOB"]).toContain(item.project);
      expect(item.issue_key.startsWith(`${item.project}-`)).toBe(true);
      expect(item.age_days).toBe(Math.floor((Date.parse(NOW) - Date.parse(item.opened_at)) / 86_400_000));
    }
    const opened = portfolio.attention.map((item) => Date.parse(item.opened_at));
    expect(opened).toEqual([...opened].sort((a, b) => a - b));
  });

  it("the Portfolio takes no parameters", async () => {
    await expectProblem(await call("portfolio?project=DEMO"), 400, "bad_request");
  });

  it("the access log reads a page at a time, newest first, and its cursor walks the whole log without a repeat", async () => {
    const first = await read(await call("access-log"), accessLogSchema);
    expect(first.entries).toHaveLength(50);
    expect(first.next_cursor).not.toBeNull();
    const seen: AccessLog["entries"] = [...first.entries];
    let cursor = first.next_cursor;
    for (let pages = 0; cursor !== null && pages < 20; pages += 1) {
      const page = await read(await call(`access-log?cursor=${encodeURIComponent(cursor)}&limit=200`), accessLogSchema);
      seen.push(...page.entries);
      cursor = page.next_cursor;
    }
    expect(cursor).toBeNull();
    expect(new Set(seen.map((entry) => entry.id)).size).toBe(seen.length);
    const times = seen.map((entry) => Date.parse(entry.at));
    expect(times).toEqual([...times].sort((a, b) => b - a));
    // Every action, a former member, a user's read, and the local reader are in the sample's history.
    expect(new Set(seen.map((entry) => entry.action))).toEqual(new Set(ACCESS_ACTIONS));
    expect(seen.some((entry) => entry.subjects.some((person) => person.name === FORMER_MEMBER && person.avatar === null))).toBe(true);
    expect(seen.some((entry) => entry.level === "team")).toBe(true);
    expect(seen.some((entry) => entry.viewer.hash === "local")).toBe(true);
  });

  it("the access log's filters each keep only what they say", async () => {
    const byAction = await read(await call("access-log?action=scorecard_view&action=person_ask&limit=200"), accessLogSchema);
    expect(byAction.entries.length).toBeGreaterThan(0);
    expect(byAction.entries.every((entry) => entry.action === "scorecard_view" || entry.action === "person_ask")).toBe(true);

    const byPerson = await read(await call(`access-log?person=${ADA}&limit=200`), accessLogSchema);
    expect(byPerson.entries.length).toBeGreaterThan(0);
    expect(byPerson.entries.every((entry) => entry.subjects.some((person) => person.id === ADA))).toBe(true);

    const viewer = byPerson.entries[0].viewer.hash;
    const byViewer = await read(await call(`access-log?viewer=${viewer}&limit=200`), accessLogSchema);
    expect(byViewer.entries.every((entry) => entry.viewer.hash === viewer)).toBe(true);

    // Calendar days in the report zone (Europe/London: GMT in November), both included.
    const oneDay = await read(await call("access-log?from=2026-11-03&to=2026-11-03&limit=200"), accessLogSchema);
    for (const entry of oneDay.entries) expect(entry.at.slice(0, 10)).toBe("2026-11-03");
  });

  it("the access log refuses what it cannot read: a bad cursor, a range that ends before it starts, too big a page, a level", async () => {
    await expectProblem(await call("access-log?cursor=abc"), 400, "bad_request");
    await expectProblem(await call("access-log?from=2026-11-04&to=2026-11-01"), 400, "bad_request");
    await expectProblem(await call("access-log?limit=201"), 400, "bad_request");
    await expectProblem(await call("access-log?level=people"), 400, "bad_request");
    await expectProblem(await call("access-log?action=everything"), 400, "bad_request");
    // An export may carry up to the service's 10,000.
    const exported = await read(await call("access-log?export=true&limit=10000"), accessLogSchema);
    expect(exported.next_cursor).toBeNull();
    await expectProblem(await call("access-log?export=true&limit=10001"), 400, "bad_request");
  });

  it("usage: today (UTC, to now) and the last 7 days, oldest first, no budget set", async () => {
    const usage = await read(await call("usage"), usageSchema);
    expect(usage.last_7_days).toHaveLength(7);
    expect(usage.last_7_days.at(-1)?.date).toBe("2026-11-04");
    expect(usage.today.budget_tokens).toBeNull();
    expect(usage.today.budget_used_pct).toBeNull();
    expect(usage.last_7_days.at(-1)?.questions).toBe(usage.today.questions);
    expect(usage.last_7_days.at(-1)?.tokens).toBe(usage.today.input_tokens + usage.today.output_tokens);
    await expectProblem(await call("usage?days=30"), 400, "bad_request");
  });
});

describe("governance with sign-in on", () => {
  beforeEach(() => stubAuthEnv({ OVERSIGHT_DATA: "sample", SAMPLE_NOW: NOW, SAMPLE_LATENCY: "0" }));

  it("a user (team level) is refused the access log and usage before anything is asked; the Portfolio is theirs", async () => {
    const upstream = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", upstream);
    const session = `jo-session=${await sealSession(IDENTITY, SESSION_KEYS)}`;
    expect((await expectProblem(await call("access-log", session), 403, "people_not_allowed")).message).toBe("Only admins can see the access log.");
    expect((await expectProblem(await call("usage", session), 403, "people_not_allowed")).message).toBe("Only admins can see Ask's usage.");
    await expectProblem(await call("access-log"), 401, "unauthenticated");
    const portfolio = await read(await call("portfolio", session), portfolioSchema);
    expect(portfolio.boards.map((board) => board.project.key)).toEqual(["DEMO"]);
    stub({ OVERSIGHT_DATA: "live", OVERSIGHT_API_URL: "http://oversight.internal:3300", OVERSIGHT_SERVICE_KEY: "svc-key" });
    await expectProblem(await call("access-log?export=true", session), 403, "people_not_allowed");
    await expectProblem(await call("usage", session), 403, "people_not_allowed");
    expect(upstream).not.toHaveBeenCalled();
  });

  it("an admin reads both", async () => {
    vi.stubEnv("ADMIN_EMAILS", LEAD);
    const session = `jo-session=${await sealSession({ ...IDENTITY, eh: emailHash(LEAD, SECRET) }, SESSION_KEYS)}`;
    expect((await read(await call("access-log", session), accessLogSchema)).entries.length).toBe(50);
    expect((await read(await call("usage", session), usageSchema)).last_7_days).toHaveLength(7);
  });
});

/* -------------------------------------------------------------- live --- */

describe("governance in live mode", () => {
  function liveService(answer: (url: URL, init: RequestInit | undefined) => Response, env: Record<string, string> = LIVE) {
    stub(env);
    const upstream = vi.fn<typeof fetch>(async (input, init) => answer(new URL(String(input)), init));
    vi.stubGlobal("fetch", upstream);
    return upstream;
  }

  const sample = portfolioJson as unknown as Portfolio;
  /** The service's Portfolio over three boards, its oldest breaches across all three. */
  const threeBoards: Portfolio = {
    meta: { ...sample.meta, data_mode: "live", projects: ["ALPHA", "BRAVO", "DEMO"] },
    boards: ["ALPHA", "BRAVO", "DEMO"].map((key) => ({ ...sample.boards[0], project: { key, name: `${key} board` } })),
    attention: sample.attention.slice(0, 9).map((item, index) => {
      const key = ["ALPHA", "BRAVO", "DEMO"][index % 3];
      return { ...item, project: key, issue_key: item.issue_key.replace(/^[A-Z][A-Z0-9_]*-/, `${key}-`) };
    }),
    boards_not_synced: 0,
  };

  it("names the reader to the service: with sign-in off, the one local reader, and the level as the contract has it", async () => {
    const upstream = liveService(() => Response.json({ ...sample, meta: { ...sample.meta, data_mode: "live" } }));
    await read(await call("portfolio"), portfolioSchema);
    const [url, init] = upstream.mock.calls[0];
    expect(String(url)).toBe("http://oversight.internal:3300/api/v1/portfolio");
    const headers = new Headers(init?.headers);
    expect(headers.get("x-oversight-viewer")).toBe("local");
    expect(headers.get("x-oversight-viewer-name")).toBe(encodeURIComponent("Local (sign-in off)"));
    expect(headers.get("x-oversight-level")).toBeNull();
  });

  it("holds the Portfolio to a user's boards: their rows and their breaches only", async () => {
    liveService(() => Response.json(threeBoards), { ...LIVE, AUTH_MODE: "atlassian" });
    stubAuthEnv({ ...LIVE, AUTH_MODE: "atlassian" });
    const session = `jo-session=${await sealSession(IDENTITY, SESSION_KEYS)}`;
    const mine = await read(await call("portfolio", session), portfolioSchema);
    expect(mine.boards.map((board) => board.project.key)).toEqual(["DEMO"]);
    expect(mine.meta.projects).toEqual(["DEMO"]);
    expect(mine.attention.length).toBe(3);
    expect(mine.attention.every((item) => item.project === "DEMO")).toBe(true);

    vi.stubEnv("ADMIN_EMAILS", LEAD);
    const admin = `jo-session=${await sealSession({ ...IDENTITY, eh: emailHash(LEAD, SECRET) }, SESSION_KEYS)}`;
    const every = await read(await call("portfolio", admin), portfolioSchema);
    expect(every.boards.map((board) => board.project.key)).toEqual(["ALPHA", "BRAVO", "DEMO"]);
    expect(every.attention).toHaveLength(9);
  });

  it("holds the count of boards not synced yet to a user's boards: at most their boards with no row (JO-17)", async () => {
    liveService(() => Response.json({ ...threeBoards, boards_not_synced: 7 }), { ...LIVE, AUTH_MODE: "atlassian" });
    stubAuthEnv({ ...LIVE, AUTH_MODE: "atlassian" });
    // Their boards: DEMO, which has a row, and LATE, which has none.
    const session = `jo-session=${await sealSession({ ...IDENTITY, boards: ["DEMO", "LATE"] }, SESSION_KEYS)}`;
    expect((await read(await call("portfolio", session), portfolioSchema)).boards_not_synced).toBe(1);
    const own = `jo-session=${await sealSession({ ...IDENTITY, boards: ["DEMO"] }, SESSION_KEYS)}`;
    expect((await read(await call("portfolio", own), portfolioSchema)).boards_not_synced).toBe(0);
    // An admin reads every board: the service's own count.
    vi.stubEnv("ADMIN_EMAILS", LEAD);
    const admin = `jo-session=${await sealSession({ ...IDENTITY, eh: emailHash(LEAD, SECRET) }, SESSION_KEYS)}`;
    expect((await read(await call("portfolio", admin), portfolioSchema)).boards_not_synced).toBe(7);
  });

  it("reads the not-synced count under the service's first name for it, not_synced, and passes it on under the contract's (SQA)", async () => {
    const { boards_not_synced: _contract, ...withoutCount } = threeBoards;
    liveService(() => Response.json({ ...withoutCount, not_synced: 17 }));
    const portfolio = await (await call("portfolio")).json();
    expect(portfolio.boards_not_synced).toBe(17);
    expect(portfolio).not.toHaveProperty("not_synced");
    expect(portfolioSchema.parse(portfolio).boards).toHaveLength(3);
    // Both names: the contract's wins.
    liveService(() => Response.json({ ...threeBoards, boards_not_synced: 2, not_synced: 17 }));
    expect((await read(await call("portfolio"), portfolioSchema)).boards_not_synced).toBe(2);
    // Neither is still a body this interface does not understand.
    liveService(() => Response.json(withoutCount));
    await expectProblem(await call("portfolio"), 502, "upstream_invalid");
  });

  it("asks the service for a user's own boards, so 'Needs attention' is their ten oldest, not the service's cut short", async () => {
    // The service's ten oldest across every board are all on ALPHA: cut to DEMO they would leave nothing.
    const demoOwn = threeBoards.attention.filter((item) => item.project === "DEMO");
    const upstream = liveService(
      (url) => Response.json(url.searchParams.getAll("board").join() === "DEMO" ? { ...threeBoards, boards: [threeBoards.boards[2]], attention: demoOwn } : threeBoards),
      { ...LIVE, AUTH_MODE: "atlassian" },
    );
    stubAuthEnv({ ...LIVE, AUTH_MODE: "atlassian" });
    const session = `jo-session=${await sealSession(IDENTITY, SESSION_KEYS)}`;
    const mine = await read(await call("portfolio", session), portfolioSchema);
    expect(String(upstream.mock.calls[0][0])).toBe("http://oversight.internal:3300/api/v1/portfolio?board=DEMO");
    expect(mine.attention).toEqual(demoOwn);

    vi.stubEnv("ADMIN_EMAILS", LEAD);
    const admin = `jo-session=${await sealSession({ ...IDENTITY, eh: emailHash(LEAD, SECRET) }, SESSION_KEYS)}`;
    await read(await call("portfolio", admin), portfolioSchema);
    expect(String(upstream.mock.calls[1][0])).toBe("http://oversight.internal:3300/api/v1/portfolio"); // an admin: every board
    // The browser cannot name boards itself.
    await expectProblem(await call("portfolio?board=ALPHA", session), 400, "bad_request");
  });

  it("opens the Portfolio, the access log and usage before any board has synced", async () => {
    const unsynced = { ...sample.meta, data_mode: "live" as const, last_synced_at: null };
    const usage = (await import("../../../../docs/sample-responses/usage.json")).default;
    liveService((url) =>
      Response.json(
        url.pathname.endsWith("/usage")
          ? { ...usage, meta: unsynced }
          : url.pathname.endsWith("/access-log")
            ? { meta: unsynced, entries: [], next_cursor: null, facets: { viewers: [], subjects: [] } }
            : { ...threeBoards, meta: unsynced },
      ),
    );
    expect((await read(await call("portfolio"), portfolioSchema)).meta.last_synced_at).toBeNull();
    expect((await read(await call("access-log"), accessLogSchema)).meta.last_synced_at).toBeNull();
    expect((await call("usage")).status).toBe(200);
  });

  it("tells the service the level for the access log, with every filter rebuilt and the limit always given", async () => {
    const page: AccessLog = { meta: { ...sample.meta, data_mode: "live" }, entries: [], next_cursor: null, facets: null };
    const usage = (await import("../../../../docs/sample-responses/usage.json")).default;
    const upstream = liveService((url) => Response.json(url.pathname.endsWith("/usage") ? { ...usage, meta: page.meta } : page));
    await read(await call(`access-log?person=${ADA}&action=person_ask&action=scorecard_view&from=2026-11-01`), accessLogSchema);
    expect(String(upstream.mock.calls[0][0])).toBe(
      `http://oversight.internal:3300/api/v1/access-log?from=2026-11-01&action=scorecard_view&action=person_ask&person=${ADA}&limit=50&level=people`,
    );
    await read(await call("access-log?export=true&limit=10000"), accessLogSchema);
    expect(String(upstream.mock.calls[1][0])).toBe("http://oversight.internal:3300/api/v1/access-log?limit=10000&export=true&level=people");
    await read(await call("usage"), { parse: (value: unknown) => value });
    expect(String(upstream.mock.calls[2][0])).toBe("http://oversight.internal:3300/api/v1/usage?level=people");
  });

  it("never passes on access log entries the filters leave out", async () => {
    const sampleLog = (await import("../../../../docs/sample-responses/access-log.json")).default as unknown as AccessLog;
    liveService(() => Response.json({ ...sampleLog, meta: { ...sampleLog.meta, data_mode: "live" } }));
    const body = await expectProblem(await call("access-log?action=person_ask"), 502, "upstream_invalid");
    expect(body.message).toMatch(/other than the ones asked for/);
  });

  it("says plainly when the service could not write its access log, and served nothing", async () => {
    liveService(() => Response.json({ detail: "the access log could not be written", code: "access_log_unavailable" }, { status: 500 }));
    const body = await expectProblem(await call("people/scorecard"), 503, "access_log_unavailable");
    expect(body.message).toBe("The access log could not record this read, so the figures were not shown. Nothing was lost; try again in a moment.");
    liveService(() => Response.json({ detail: "boom" }, { status: 500 }));
    await expectProblem(await call("people/scorecard"), 502, "upstream_error");
  });

  it("says Ask's limit on questions in the contract's words, with the wait rounded up to whole minutes", async () => {
    liveService(() => Response.json({ detail: "too many", code: "ask_rate_limited" }, { status: 429, headers: { "retry-after": "61" } }));
    const response = await ask("Where do tickets get stuck most?");
    const body = await expectProblem(response, 429, "ask_rate_limited");
    expect(body.message).toBe("You've asked a lot of questions in a short time. Try again in 2 minutes.");
    expect(response.headers.get("retry-after")).toBe("61");
    // A 429 without the code is the service being busy, as before.
    liveService(() => Response.json({ detail: "busy" }, { status: 429 }));
    await expectProblem(await ask("Where do tickets get stuck most?"), 503, "upstream_unavailable");
  });

  it("tells the service the level with every findings read: the access log's when filtered by a person, and who ignored a finding", async () => {
    const findings = (await import("../../../../docs/sample-responses/findings.json")).default;
    const upstream = liveService(() => Response.json({ ...findings, meta: { ...findings.meta, data_mode: "live" } }));
    await call(`findings?person=${ADA}`);
    expect(new URL(String(upstream.mock.calls[0][0])).searchParams.get("level")).toBe("people");
    await call("findings?severity=breach");
    expect(new URL(String(upstream.mock.calls[1][0])).searchParams.get("level")).toBe("people");
  });
});

/* ------------------------------------------------------------ viewer --- */

describe("the viewer", () => {
  it("is a keyed hash of the account: HMAC-SHA-256 under AUTH_SECRET, hex, its first 32 characters", () => {
    const expected = createHmac("sha256", SECRET).update(IDENTITY.sub).digest("hex").slice(0, 32);
    expect(viewerHash(IDENTITY.sub, SECRET)).toBe(expected);
    expect(viewerHash(IDENTITY.sub, SECRET)).toMatch(/^[0-9a-f]{32}$/);
    expect(viewerHash(IDENTITY.sub, `${SECRET}x`)).not.toBe(expected);
    expect(viewerHash("557058:other", SECRET)).not.toBe(expected);
  });

  it("is the local reader with sign-in off, and names no one with sign-in on and no session", () => {
    stub(SAMPLE);
    expect(viewerOf(null)).toEqual(LOCAL_READER);
    stubAuthEnv({ OVERSIGHT_DATA: "sample" });
    expect(viewerOf(null)).toBeNull();
  });

  it("reads as a signed-in user when the session holds no name, and its headers never carry the account id", () => {
    stubAuthEnv({ OVERSIGHT_DATA: "sample" });
    const session = { v: 2 as const, ...IDENTITY, iat: 0, exp: 1 };
    const viewer = viewerOf(session);
    expect(viewer).toEqual({ hash: viewerHash(IDENTITY.sub, SECRET), name: "Signed-in user" });
    const headers = readerHeaders({ viewer, level: "people" });
    expect(Object.keys(headers).sort()).toEqual(["x-oversight-viewer", "x-oversight-viewer-name"]);
    expect(JSON.stringify(headers)).not.toContain(IDENTITY.sub);
    expect(readerHeaders({ viewer: null, level: "team" })).toEqual({});
  });

  it("the wait in the limit's sentence: whole minutes, rounded up, one minute at least", () => {
    expect(askRateLimitMessage(1)).toBe("You've asked a lot of questions in a short time. Try again in 1 minute.");
    expect(askRateLimitMessage(60)).toBe("You've asked a lot of questions in a short time. Try again in 1 minute.");
    expect(askRateLimitMessage(300)).toBe("You've asked a lot of questions in a short time. Try again in 5 minutes.");
    expect(askRateLimitMessage(Number.NaN)).toBe("You've asked a lot of questions in a short time. Try again in 1 minute.");
  });
});
