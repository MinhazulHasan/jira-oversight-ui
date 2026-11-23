// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GET, POST } from "@/app/api/oversight/[...path]/route";
import { ASK_DECLINES, apiErrorBodySchema, askResponseSchema, type AskLevel } from "@/lib/api/schemas";

import answered from "../../../../docs/sample-responses/ask-answered.json";
import { sampleResponse } from "../../sample";
import { resetSampleClock } from "../../sample/clock";
import { buildDataset } from "../../sample/dataset";
import { pictureOf } from "../../sample/pictures";
import { personIdFor } from "../../sample/team";
import { sealSession } from "../cookies";
import { emailHash } from "../roles";
import { viewerHash } from "../viewer";

import { APP, SECRET, SESSION_KEYS, stubAuthEnv } from "./fixtures";

/*
 * /api/oversight/* checks the session again behind the proxy (defence in
 * depth): called directly, as if the proxy were missing or misconfigured, it
 * still serves no one without a session.
 */

const IDENTITY = { sub: "557058:account", dom: "stellainternational.com", site: "cloud-id", eh: "hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh", boards: ["DEMO"] };

function call(method: "GET" | "POST", path: string, init: { cookie?: string; body?: string } = {}) {
  const url = new URL(`http://localhost:3400/api/oversight/${path}`);
  // A POST as the dashboard's own pages send it: from APP_URL's origin, a body as JSON (section 6 of the contract).
  const own = method === "POST" ? { origin: APP, ...(init.body !== undefined ? { "content-type": "application/json" } : {}) } : {};
  const request = new NextRequest(url, { method, body: init.body, headers: { ...own, ...(init.cookie ? { cookie: init.cookie } : {}) } });
  const context = { params: Promise.resolve({ path: url.pathname.replace(/^\/api\/oversight\//, "").split("/") }) };
  return method === "GET" ? GET(request, context) : POST(request, context);
}

async function expectProblem(response: Response, status: number, error: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = apiErrorBodySchema.parse(await response.json());
  expect(body.error).toBe(error);
  return body;
}

beforeEach(() => {
  stubAuthEnv({ OVERSIGHT_DATA: "sample", SAMPLE_NOW: "2026-11-04T14:30:00Z", SAMPLE_LATENCY: "0" });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetSampleClock();
});

describe("the oversight route's own check", () => {
  it("serves no one without a session", async () => {
    await expectProblem(await call("GET", "health"), 401, "unauthenticated");
    await expectProblem(await call("GET", "findings?severity=breach"), 401, "unauthenticated");
    await expectProblem(await call("POST", "ask", { body: JSON.stringify({ question: "Where do tickets get stuck most?" }) }), 401, "unauthenticated");
    await expectProblem(await call("POST", "refresh"), 401, "unauthenticated");
  });

  it("takes a question or a sync only from APP_URL's origin: a sibling site's is refused, the session cookie and all", async () => {
    const session = await sealSession(IDENTITY, SESSION_KEYS);
    const post = (path: string, origin: string, body?: string) =>
      POST(
        new NextRequest(new URL(`${APP}/api/oversight/${path}`), {
          method: "POST",
          body,
          headers: { cookie: `jo-session=${session}`, origin, ...(body ? { "content-type": "application/json" } : {}) },
        }),
        { params: Promise.resolve({ path: [path] }) },
      );
    const question = JSON.stringify({ question: "Where do tickets get stuck most?" });
    // The request's own host is not enough with sign-in on: only APP_URL's origin is this dashboard's.
    for (const origin of ["https://reports.stellainternational.com", "http://127.0.0.1:3400"]) {
      await expectProblem(await post("refresh", origin), 403, "forbidden");
      await expectProblem(await post("ask", origin, question), 403, "forbidden");
    }
    expect((await post("refresh", APP)).status).toBe(200);
    expect((await post("ask", APP, question)).status).toBe(200);
  });

  it("serves a valid session, among other cookies", async () => {
    const session = await sealSession(IDENTITY, SESSION_KEYS);
    const response = await call("GET", "health", { cookie: `jo-board=DEMO; jo-session=${session}; jo-theme=dark` });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok", data_mode: "sample" });
  });

  it("serves no one with a tampered, expired or foreign cookie", async () => {
    const good = await sealSession(IDENTITY, SESSION_KEYS);
    // One character inside the IV, always changed (the last characters can carry spare bits, which decode alike).
    const tampered = good.slice(0, 10) + (good[10] === "A" ? "B" : "A") + good.slice(11);
    for (const session of [
      tampered,
      await sealSession(IDENTITY, SESSION_KEYS, Date.now() - 13 * 60 * 60 * 1000),
      await sealSession(IDENTITY, { ...SESSION_KEYS, secret: "another-secret-of-forty-eight-characters-987654" }),
      await sealSession(IDENTITY, { ...SESSION_KEYS, jiraSite: "https://a-different-site.atlassian.net" }),
      await sealSession({ ...IDENTITY, dom: "outsider.example" }, SESSION_KEYS),
    ]) {
      await expectProblem(await call("GET", "overview", { cookie: `jo-session=${session}` }), 401, "unauthenticated");
    }
  });

  it("reads two cookies of the same name as the proxy and the pages do: the last one counts", async () => {
    // A stray jo-session (another path, or a parent domain) comes first in the header; Next.js's parser keeps
    // the last. The route must decide as the proxy did, or a page and its API calls would disagree and loop.
    const session = await sealSession(IDENTITY, SESSION_KEYS);
    expect((await call("GET", "health", { cookie: `jo-session=garbage; jo-session=${session}` })).status).toBe(200);
    await expectProblem(await call("GET", "health", { cookie: `jo-session=${session}; jo-session=garbage` }), 401, "unauthenticated");
  });

  it("signs everyone out when the dashboard is pointed at another Jira site", async () => {
    const session = await sealSession(IDENTITY, SESSION_KEYS);
    expect((await call("GET", "overview", { cookie: `jo-session=${session}` })).status).toBe(200);
    stubAuthEnv({ OVERSIGHT_JIRA_BASE_URL: "https://a-different-site.atlassian.net" });
    await expectProblem(await call("GET", "overview", { cookie: `jo-session=${session}` }), 401, "unauthenticated");
  });

  it("fails closed, naming the variable, when sign-in is on but not set up", async () => {
    const session = await sealSession(IDENTITY, SESSION_KEYS);
    stubAuthEnv({ AUTH_SECRET: "far-too-short" });
    const body = await expectProblem(await call("GET", "health", { cookie: `jo-session=${session}` }), 500, "not_configured");
    expect(body.message).toBe("AUTH_SECRET must be at least 32 characters of random.");
    expect(JSON.stringify(body)).not.toContain("far-too-short");
  });

  it("never asks the live service anything for a request without a session", async () => {
    const upstream = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", upstream);
    vi.stubEnv("OVERSIGHT_DATA", "live");
    vi.stubEnv("OVERSIGHT_API_URL", "http://oversight.internal:3300");
    vi.stubEnv("OVERSIGHT_SERVICE_KEY", "svc-key");
    await expectProblem(await call("GET", "overview"), 401, "unauthenticated");
    await expectProblem(await call("POST", "refresh"), 401, "unauthenticated");
    // Live data with sign-in left unset is on by default, and closed until it is set up.
    for (const name of ["AUTH_MODE", "APP_URL", "AUTH_SECRET"]) vi.stubEnv(name, "");
    await expectProblem(await call("GET", "overview"), 500, "not_configured");
    expect(upstream).not.toHaveBeenCalled();
  });

  it("forwards a signed-in request without the session cookie", async () => {
    const idle = { project: "DEMO", state: "idle", started_at: null, finished_at: null, message: null };
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(idle)));
    vi.stubGlobal("fetch", upstream);
    vi.stubEnv("OVERSIGHT_DATA", "live");
    vi.stubEnv("OVERSIGHT_API_URL", "http://oversight.internal:3300");
    vi.stubEnv("OVERSIGHT_SERVICE_KEY", "svc-key");
    const session = await sealSession(IDENTITY, SESSION_KEYS);
    const response = await call("GET", "refresh", { cookie: `jo-session=${session}` });
    expect(response.status).toBe(200);
    const headers = new Headers(upstream.mock.calls[0][1]?.headers);
    // Who is reading, for the service's access log (JO-12): a keyed hash of the account, never the account id, and
    // (a session from before the name was kept) "Signed-in user".
    expect([...headers.keys()].sort()).toEqual(["accept", "x-oversight-viewer", "x-oversight-viewer-name", "x-service-key"]);
    expect(headers.get("x-oversight-viewer")).toBe(viewerHash(IDENTITY.sub, SECRET));
    expect(headers.get("x-oversight-viewer")).toMatch(/^[0-9a-f]{32}$/);
    expect(decodeURIComponent(headers.get("x-oversight-viewer-name") ?? "")).toBe("Signed-in user");
    expect([...headers.values()].join(" ")).not.toContain(IDENTITY.sub);
  });

  it("names the reader by the display name their session holds, percent-encoded", async () => {
    const idle = { project: "DEMO", state: "idle", started_at: null, finished_at: null, message: null };
    const upstream = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(idle)));
    vi.stubGlobal("fetch", upstream);
    vi.stubEnv("OVERSIGHT_DATA", "live");
    vi.stubEnv("OVERSIGHT_API_URL", "http://oversight.internal:3300");
    vi.stubEnv("OVERSIGHT_SERVICE_KEY", "svc-key");
    const session = await sealSession({ ...IDENTITY, name: "Tomás Ferreira-Ōno" }, SESSION_KEYS);
    await call("GET", "refresh", { cookie: `jo-session=${session}` });
    const headers = new Headers(upstream.mock.calls[0][1]?.headers);
    expect(headers.get("x-oversight-viewer-name")).toBe(encodeURIComponent("Tomás Ferreira-Ōno"));
    expect(decodeURIComponent(headers.get("x-oversight-viewer-name") ?? "")).toBe("Tomás Ferreira-Ōno");
  });

  it("serves everyone when sign-in is off", async () => {
    vi.stubEnv("AUTH_MODE", "off");
    expect((await call("GET", "health")).status).toBe(200);
  });
});

describe("the boards a person may read (JO-03)", () => {
  /** Three boards on the live service. Made-up keys: no client's boards. */
  const BOARDS = {
    default: "ALPHA",
    projects: [
      { key: "ALPHA", name: "Alpha", issues: 120, last_synced_at: "2026-11-10T10:00:00Z", synced: true, type: "software" },
      { key: "BRAVO", name: "Bravo", issues: 640, last_synced_at: "2026-11-10T10:00:00Z", synced: true, type: "software" },
      { key: "CHARLIE", name: "Charlie", issues: 35, last_synced_at: "2026-11-10T10:00:00Z", synced: true, type: "business" },
    ],
  };
  const health = (board: string) => ({
    status: "ok",
    message: null,
    data_mode: "live",
    read_only: true,
    api_version: "0.1.0",
    last_synced_at: "2026-11-10T10:00:00Z",
    projects: [board],
    report_timezone: "Europe/London",
  });

  /** A board's people as the service would send them: one made-up person, and the unassigned tickets. */
  const people = (board: string) => ({
    meta: {
      data_mode: "live",
      last_synced_at: "2026-11-10T10:00:00Z",
      projects: [board],
      rules_version: "0.1.0",
      process_version: "0.1.0",
      generated_at: "2026-11-10T10:01:00Z",
      report_timezone: "Europe/London",
    },
    people: [
      { person: { id: "p3f9a2c41b0de", name: "Ada Brooks", avatar: "0a1b2c3d4e5f" }, tickets: 40, open_tickets: 12, open_breaches: 7, open_warnings: 3, tickets_with_findings: 5 },
      { person: null, tickets: 3, open_tickets: 1, open_breaches: 1, open_warnings: 0, tickets_with_findings: 1 },
    ],
  });

  /** A board's directory as the service would send it: the made-up person, and a member with no tickets. */
  const directory = (board: string) => ({
    meta: people(board).meta,
    people: [
      { person: { id: "p3f9a2c41b0de", name: "Ada Brooks", avatar: "0a1b2c3d4e5f" }, tickets: 40 },
      { person: { id: "p9876543210fe", name: "Noor Haddad", avatar: null }, tickets: 0 },
    ],
  });

  /** A made-up person's picture, as the service keeps one: the sample's own PNG, drawn in code. */
  const PICTURE = pictureOf("acc-03")!.bytes;

  /** The live service, stubbed: the board list, sync now, people, a person's picture, and health for whichever board is asked for. */
  function liveService() {
    vi.stubEnv("OVERSIGHT_DATA", "live");
    vi.stubEnv("OVERSIGHT_API_URL", "http://oversight.internal:3300");
    vi.stubEnv("OVERSIGHT_SERVICE_KEY", "svc-key");
    const upstream = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/v1/projects") return Response.json(BOARDS);
      if (url.pathname === "/api/v1/refresh") {
        return Response.json({ project: url.searchParams.get("project") ?? "ALPHA", state: "idle", started_at: null, finished_at: null, message: null });
      }
      if (url.pathname === "/api/v1/people") return Response.json(people(url.searchParams.get("project") ?? "ALPHA"));
      if (url.pathname === "/api/v1/people/directory") return Response.json(directory(url.searchParams.get("project") ?? "ALPHA"));
      if (url.pathname === "/api/v1/people/p3f9a2c41b0de/avatar") return new Response(PICTURE, { headers: { "content-type": "image/png" } });
      return Response.json(health(url.searchParams.get("project") ?? "ALPHA"));
    });
    vi.stubGlobal("fetch", upstream);
    return upstream;
  }
  const asked = (upstream: ReturnType<typeof liveService>) => upstream.mock.calls.map(([input]) => new URL(String(input)));
  const signedIn = (boards: string[]) => sealSession({ ...IDENTITY, boards }, SESSION_KEYS);

  it("reads the board picked in the top bar when it is one of theirs", async () => {
    const upstream = liveService();
    const session = await signedIn(["ALPHA", "BRAVO"]);
    const response = await call("GET", "health", { cookie: `jo-session=${session}; jo-board=BRAVO` });
    expect(response.status).toBe(200);
    expect(asked(upstream)[0].searchParams.get("project")).toBe("BRAVO");
  });

  it("refuses a board that is not theirs, without asking the service", async () => {
    const upstream = liveService();
    const session = await signedIn(["ALPHA", "BRAVO"]);
    for (const path of ["health", "overview", "people", "people/directory", "findings?severity=breach", "findings?person=unassigned", "issues/CHARLIE-1/timeline", "insights/latest"]) {
      await expectProblem(await call("GET", path, { cookie: `jo-session=${session}; jo-board=CHARLIE` }), 403, "board_not_allowed");
    }
    await expectProblem(
      await call("POST", "ask", { cookie: `jo-session=${session}; jo-board=CHARLIE`, body: JSON.stringify({ question: "Where do tickets get stuck most?" }) }),
      403,
      "board_not_allowed",
    );
    expect(upstream).not.toHaveBeenCalled();
  });

  it("with no board picked, reads their first board, never the service's default", async () => {
    const upstream = liveService();
    const session = await signedIn(["CHARLIE", "BRAVO"]);
    const response = await call("GET", "health", { cookie: `jo-session=${session}` });
    expect(await response.json()).toMatchObject({ projects: ["CHARLIE"] });
    expect(asked(upstream)[0].searchParams.get("project")).toBe("CHARLIE");
  });

  it("reads the people of their board, whole, as the overview is: the picked one, else their first", async () => {
    const upstream = liveService();
    const session = await signedIn(["CHARLIE", "BRAVO"]);
    const picked = await call("GET", "people", { cookie: `jo-session=${session}; jo-board=BRAVO` });
    expect(picked.status).toBe(200);
    expect(await picked.json()).toEqual(people("BRAVO"));
    expect((await call("GET", "people", { cookie: `jo-session=${session}` })).status).toBe(200);
    expect(asked(upstream).map((url) => [url.pathname, url.searchParams.get("project")])).toEqual([
      ["/api/v1/people", "BRAVO"],
      ["/api/v1/people", "CHARLIE"],
    ]);
  });

  it("never gives a user the directory: the @ list is people level's, and asks nothing of anyone", async () => {
    const upstream = liveService();
    const session = await signedIn(["CHARLIE", "BRAVO"]);
    const refused = await expectProblem(await call("GET", "people/directory", { cookie: `jo-session=${session}; jo-board=BRAVO` }), 403, "people_not_allowed");
    expect(refused.message).toBe("Only admins can pick people to ask about.");
    await expectProblem(await call("GET", "people/directory", { cookie: `jo-session=${session}` }), 403, "people_not_allowed");
    await expectProblem(await call("GET", "people/directory"), 401, "unauthenticated");
    expect(upstream).not.toHaveBeenCalled();
    vi.stubEnv("OVERSIGHT_DATA", "sample");
    await expectProblem(await call("GET", "people/directory", { cookie: `jo-session=${session}` }), 403, "people_not_allowed");
  });

  it("reads the picked board's directory for an admin's @ list, as it reads the people", async () => {
    const upstream = liveService();
    const LEAD = "lead@stellainternational.com";
    vi.stubEnv("ADMIN_EMAILS", LEAD);
    const session = await sealSession({ ...IDENTITY, eh: emailHash(LEAD, SECRET), boards: ["CHARLIE"] }, SESSION_KEYS);
    const picked = await call("GET", "people/directory", { cookie: `jo-session=${session}; jo-board=BRAVO` });
    expect(picked.status).toBe(200);
    expect(await picked.json()).toEqual(directory("BRAVO"));
    expect(asked(upstream).map((url) => [url.pathname, url.searchParams.get("project")])).toEqual([["/api/v1/people/directory", "BRAVO"]]);
  });

  it("holds a person's picture to their boards as well: the picked one, else their first, and never another", async () => {
    const upstream = liveService();
    const session = await signedIn(["CHARLIE", "BRAVO"]);
    const picture = "people/p3f9a2c41b0de/avatar?v=0a1b2c3d4e5f";
    await expectProblem(await call("GET", picture, { cookie: `jo-session=${session}; jo-board=ALPHA` }), 403, "board_not_allowed");
    expect(upstream).not.toHaveBeenCalled();

    const picked = await call("GET", picture, { cookie: `jo-session=${session}; jo-board=BRAVO` });
    expect(picked.status).toBe(200);
    expect(picked.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await picked.arrayBuffer())).toEqual(PICTURE);
    expect((await call("GET", picture, { cookie: `jo-session=${session}` })).status).toBe(200);
    expect(asked(upstream).map((url) => [url.pathname, url.search])).toEqual([
      ["/api/v1/people/p3f9a2c41b0de/avatar", "?project=BRAVO"],
      ["/api/v1/people/p3f9a2c41b0de/avatar", "?project=CHARLIE"],
    ]);
    // Without a session, no picture: the browser shows initials, and the service is never asked.
    await expectProblem(await call("GET", picture), 401, "unauthenticated");
    expect(upstream).toHaveBeenCalledTimes(2);
  });

  it("lists only their boards, keeping the service's default when it is one of them", async () => {
    liveService();
    const both = await (await call("GET", "projects", { cookie: `jo-session=${await signedIn(["CHARLIE", "ALPHA"])}` })).json();
    expect(both).toEqual({ default: "ALPHA", projects: [BOARDS.projects[0], BOARDS.projects[2]] });
    const one = await (await call("GET", "projects", { cookie: `jo-session=${await signedIn(["BRAVO"])}` })).json();
    expect(one).toEqual({ default: "BRAVO", projects: [BOARDS.projects[1]] });
  });

  it("says so when none of their boards is served any more", async () => {
    liveService();
    await expectProblem(await call("GET", "projects", { cookie: `jo-session=${await signedIn(["GONE"])}` }), 403, "board_not_allowed");
  });

  it("reads the board cookie as sign-in does: of two, the last, and a value it cannot decode is no pick", async () => {
    const upstream = liveService();
    const session = await signedIn(["ALPHA", "BRAVO"]);
    expect((await call("GET", "health", { cookie: `jo-board=CHARLIE; jo-session=${session}; jo-board=BRAVO` })).status).toBe(200);
    expect((await call("GET", "health", { cookie: `jo-session=${session}; jo-board=%E0%A4%A` })).status).toBe(200);
    expect(asked(upstream).map((url) => url.searchParams.get("project"))).toEqual(["BRAVO", "ALPHA"]);
  });

  describe("Ask, held to the board as well", () => {
    /** The live service answering Ask with the contract's sample answer, set on `board`, its facts' params changed. */
    function askService(board: string, params: Record<string, unknown> = {}) {
      vi.stubEnv("OVERSIGHT_DATA", "live");
      vi.stubEnv("OVERSIGHT_API_URL", "http://oversight.internal:3300");
      vi.stubEnv("OVERSIGHT_SERVICE_KEY", "svc-key");
      const body = {
        ...answered,
        meta: { ...answered.meta, projects: [board] },
        facts: answered.facts.map((set) => ({ ...set, params: { ...set.params, ...params } })),
      };
      vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => Response.json(body)));
    }
    const ask = async (session: string, board: string) =>
      call("POST", "ask", { cookie: `jo-session=${session}; jo-board=${board}`, body: JSON.stringify({ question: "Which epics have the most open breaches?" }) });

    it("passes an answer read from the person's board", async () => {
      askService("BRAVO");
      expect((await ask(await signedIn(["ALPHA", "BRAVO"]), "BRAVO")).status).toBe(200);
    });

    it("refuses an answer that read another board, by its project or by an issue key", async () => {
      const session = await signedIn(["ALPHA", "BRAVO"]);
      for (const params of [{ project: "CHARLIE" }, { issue_key: "CHARLIE-12" }]) {
        askService("BRAVO", params);
        await expectProblem(await ask(session, "BRAVO"), 403, "board_not_allowed");
      }
      askService("CHARLIE");
      await expectProblem(await ask(session, "BRAVO"), 403, "board_not_allowed");
    });
  });

  it("syncs a user's own board only, as every board-scoped request reads it (JO-18)", async () => {
    const upstream = liveService();
    const session = await signedIn(["ALPHA", "BRAVO"]);
    await expectProblem(await call("GET", "refresh", { cookie: `jo-session=${session}; jo-board=CHARLIE` }), 403, "board_not_allowed");
    await expectProblem(await call("POST", "refresh", { cookie: `jo-session=${session}; jo-board=CHARLIE` }), 403, "board_not_allowed");
    expect(upstream).not.toHaveBeenCalled();
    expect((await call("POST", "refresh", { cookie: `jo-session=${session}; jo-board=BRAVO` })).status).toBe(200);
    // No pick: their first board, never the service's default.
    expect((await call("GET", "refresh", { cookie: `jo-session=${session}` })).status).toBe(200);
    expect(asked(upstream).map((url) => url.searchParams.get("project"))).toEqual(["BRAVO", "ALPHA"]);
  });

  it("holds the sample to the session as well", async () => {
    const session = await signedIn(["DEMO"]);
    expect((await call("GET", "overview", { cookie: `jo-session=${session}` })).status).toBe(200);
    await expectProblem(await call("GET", "overview", { cookie: `jo-session=${session}; jo-board=OTHER` }), 403, "board_not_allowed");
    // The sample's pictures too.
    const picture = `people/${personIdFor("acc-03")}/avatar`;
    expect((await call("GET", picture, { cookie: `jo-session=${session}` })).status).toBe(200);
    await expectProblem(await call("GET", picture, { cookie: `jo-session=${session}; jo-board=OTHER` }), 403, "board_not_allowed");
  });

  describe("an admin (ADMIN_EMAILS)", () => {
    const LEAD = "lead@stellainternational.com";
    const lead = (boards: string[]) => sealSession({ ...IDENTITY, eh: emailHash(LEAD, SECRET), boards }, SESSION_KEYS);

    it("reads every board, whatever their Jira opens", async () => {
      const upstream = liveService();
      vi.stubEnv("ADMIN_EMAILS", LEAD);
      const session = await lead(["ALPHA"]);
      expect((await call("GET", "health", { cookie: `jo-session=${session}; jo-board=CHARLIE` })).status).toBe(200);
      expect(asked(upstream)[0].searchParams.get("project")).toBe("CHARLIE");
      expect((await call("GET", "people/p3f9a2c41b0de/avatar", { cookie: `jo-session=${session}; jo-board=CHARLIE` })).status).toBe(200);
      expect(asked(upstream)[1].searchParams.get("project")).toBe("CHARLIE");
      expect(await (await call("GET", "projects", { cookie: `jo-session=${session}` })).json()).toEqual(BOARDS);
    });

    it("reads every board even when their Jira opens none", async () => {
      liveService();
      vi.stubEnv("ADMIN_EMAILS", LEAD);
      expect((await call("GET", "health", { cookie: `jo-session=${await lead([])}; jo-board=BRAVO` })).status).toBe(200);
    });

    it("is a user again the moment the address comes off ADMIN_EMAILS, and an admin the moment it goes on", async () => {
      liveService();
      vi.stubEnv("ADMIN_EMAILS", LEAD);
      const session = await lead(["ALPHA"]);
      expect((await call("GET", "health", { cookie: `jo-session=${session}; jo-board=CHARLIE` })).status).toBe(200);
      vi.stubEnv("ADMIN_EMAILS", "");
      await expectProblem(await call("GET", "health", { cookie: `jo-session=${session}; jo-board=CHARLIE` }), 403, "board_not_allowed");
      expect((await call("GET", "health", { cookie: `jo-session=${session}; jo-board=ALPHA` })).status).toBe(200);
      // With no boards of their own, nothing is left to read.
      const none = await lead([]);
      await expectProblem(await call("GET", "health", { cookie: `jo-session=${none}` }), 403, "board_not_allowed");
      await expectProblem(await call("GET", "projects", { cookie: `jo-session=${none}` }), 403, "board_not_allowed");
      vi.stubEnv("ADMIN_EMAILS", LEAD);
      expect((await call("GET", "health", { cookie: `jo-session=${none}` })).status).toBe(200);
    });
  });

  it("leaves every board open when sign-in is off", async () => {
    const upstream = liveService();
    vi.stubEnv("AUTH_MODE", "off");
    expect((await call("GET", "health", { cookie: "jo-board=CHARLIE" })).status).toBe(200);
    expect(asked(upstream)[0].searchParams.get("project")).toBe("CHARLIE");
    expect(await (await call("GET", "projects")).json()).toEqual(BOARDS);
  });
});

describe("Ask's level, decided by this route on every question (11 Nov 2026)", () => {
  const LEAD = "lead@stellainternational.com";
  const CARMEN = personIdFor("acc-03");
  const user = () => sealSession({ ...IDENTITY, boards: ["DEMO"] }, SESSION_KEYS);
  const admin = () => sealSession({ ...IDENTITY, eh: emailHash(LEAD, SECRET), boards: ["DEMO"] }, SESSION_KEYS);
  const ask = (session: string, body: unknown) => call("POST", "ask", { cookie: `jo-session=${session}`, body: JSON.stringify(body) });
  const dataset = buildDataset(Date.parse("2026-11-04T14:30:00Z"));

  /** The live service answering as the sample answers, at the level it is told, and what it was sent. */
  function liveAsk(answerAs?: AskLevel) {
    vi.stubEnv("OVERSIGHT_DATA", "live");
    vi.stubEnv("OVERSIGHT_API_URL", "http://oversight.internal:3300");
    vi.stubEnv("OVERSIGHT_SERVICE_KEY", "svc-key");
    const sent: { question: string; level: AskLevel; mentions: string[] }[] = [];
    const upstream = vi.fn<typeof fetch>(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { question: string; level: AskLevel; mentions: string[] };
      sent.push(body);
      const answer = sampleResponse(dataset, { name: "ask", ...body, level: answerAs ?? body.level }, 0);
      return Response.json(answer.found ? answer.body : null);
    });
    vi.stubGlobal("fetch", upstream);
    return { upstream, sent };
  }

  beforeEach(() => {
    vi.stubEnv("ADMIN_EMAILS", LEAD);
  });

  it("refuses a user's question that mentions anyone, 403 people_not_allowed, and asks nothing of anyone", async () => {
    const body = await expectProblem(await ask(await user(), { question: "What are @Carmen Ruiz's open findings?", mentions: [CARMEN] }), 403, "people_not_allowed");
    expect(body.message).toMatch(/^Only admins can ask about a person\./);
    const { upstream } = liveAsk();
    await expectProblem(await ask(await user(), { question: "x", mentions: [CARMEN] }), 403, "people_not_allowed");
    expect(upstream).not.toHaveBeenCalled();
  });

  it("asks the service at team level for a user and at people level for an admin, whatever the browser sends", async () => {
    const { sent } = liveAsk();
    const team = askResponseSchema.parse(await (await ask(await user(), { question: "Who has the most open breaches?" })).json());
    expect([team.outcome, team.message, team.people]).toEqual(["not_understood", ASK_DECLINES.teamLevel, []]);
    const people = askResponseSchema.parse(await (await ask(await admin(), { question: "What are @Carmen Ruiz's open findings?", mentions: [CARMEN] })).json());
    expect(people.people.map((person) => person.id)).toEqual([CARMEN]);
    expect(sent).toEqual([
      { question: "Who has the most open breaches?", level: "team", mentions: [] },
      { question: "What are @Carmen Ruiz's open findings?", level: "people", mentions: [CARMEN] },
    ]);
    // The browser can never choose the level: a body that tries is refused before anything is sent.
    for (const level of ["people", "team"]) {
      await expectProblem(await ask(await user(), { question: "Who has the most open breaches?", level }), 400, "bad_request");
    }
    expect(sent).toHaveLength(2);
  });

  it("answers a user at team level and an admin at people level from the sample too", async () => {
    const team = askResponseSchema.parse(await (await ask(await user(), { question: "Who has the most open breaches?" })).json());
    expect([team.message, team.people]).toEqual([ASK_DECLINES.teamLevel, []]);
    const people = askResponseSchema.parse(await (await ask(await admin(), { question: "Who has the most open breaches?" })).json());
    expect(people.outcome).toBe("answered");
    expect(people.people.length).toBeGreaterThan(0);
  });

  it("never passes a user an answer that names people: 502, and nothing of anyone in it", async () => {
    liveAsk("people");
    const response = await ask(await user(), { question: "Who has the most open breaches?" });
    await expectProblem(response, 502, "upstream_invalid");
  });

  it("moves a reader between levels the moment ADMIN_EMAILS changes", async () => {
    const session = await admin();
    const question = { question: "What are @Carmen Ruiz's open findings?", mentions: [CARMEN] };
    expect((await ask(session, question)).status).toBe(200);
    vi.stubEnv("ADMIN_EMAILS", "");
    await expectProblem(await ask(session, question), 403, "people_not_allowed");
    vi.stubEnv("ADMIN_EMAILS", LEAD);
    expect((await ask(session, question)).status).toBe(200);
  });

  it("answers about people for everyone when sign-in is off, as the sample and local runs do", async () => {
    vi.stubEnv("AUTH_MODE", "off");
    const response = askResponseSchema.parse(await (await call("POST", "ask", { body: JSON.stringify({ question: "Who has the most open breaches?" }) })).json());
    expect(response.people.length).toBeGreaterThan(0);
  });
});
