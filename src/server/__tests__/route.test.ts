// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GET, POST } from "@/app/api/oversight/[...path]/route";
import { normalizeFindingsQuery } from "@/lib/api/params";
import {
  ASK_DECLINES,
  apiErrorBodySchema,
  askResponseSchema,
  findingsPageSchema,
  healthSchema,
  issueTimelineSchema,
  noTicketsSentence,
  overviewSchema,
  peopleDirectorySchema,
  peopleSchema,
} from "@/lib/api/schemas";
import { foldText } from "@/lib/names";

import { sampleResponse } from "../sample";
import { resetSampleClock } from "../sample/clock";
import { buildDataset } from "../sample/dataset";
import { pictureOf } from "../sample/pictures";
import { resetSampleSync } from "../sample/sync";
import { MEMBERS, personIdFor, TEAM } from "../sample/team";

/** /api/oversight/*, the credential boundary: an allowlist of read endpoints */

const SAMPLE_NOW = "2026-11-04T14:30:00Z";
const KEY = "svc-key-that-must-never-leave-the-server";
const API = "http://oversight.internal:3300";

function call(method: "GET" | "POST", path: string, init: { body?: string; headers?: Record<string, string> } = {}) {
  const url = new URL(`http://localhost:3400/api/oversight/${path}`);
  // A POST as the dashboard's own pages send it: from its origin, a body as JSON (section 6 of the contract).
  const own = method === "POST" ? { origin: url.origin, ...(init.body !== undefined ? { "content-type": "application/json" } : {}) } : {};
  const request = new NextRequest(url, { method, body: init.body, headers: { ...own, ...init.headers } });
  const segments = url.pathname.replace(/^\/api\/oversight\//, "").split("/").map(decodeURIComponent);
  const context = { params: Promise.resolve({ path: segments }) };
  return method === "GET" ? GET(request, context) : POST(request, context);
}

async function json(response: Response): Promise<unknown> {
  return JSON.parse(await response.text());
}

/** The headers every picture is served with (src/server/pictures.ts). */
function expectPictureHeaders(response: Response, type: string) {
  expect(response.headers.get("content-type")).toBe(type);
  expect(response.headers.get("cache-control")).toBe("private, max-age=86400");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect(response.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
}

/** Carmen Ruiz and Grace Lindqvist have a picture in the sample; Ada Brooks none. */
const CARMEN = personIdFor("acc-03");
const GRACE = personIdFor("acc-07");
const ADA = personIdFor("acc-01");
/** Members of the sample's board who hold none of its tickets, and have no picture. */
const NOOR = personIdFor("acc-09");
const TOMAS = personIdFor("acc-10");
const YUKI = personIdFor("acc-11");

async function expectProblem(response: Response, status: number, error: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = apiErrorBodySchema.parse(await json(response));
  expect(body.error).toBe(error);
  expect(body.message.length).toBeGreaterThan(0);
  return body;
}

afterEach(() => {
  vi.unstubAllEnvs();
  resetSampleClock();
  resetSampleSync();
});

describe("sample mode", () => {
  beforeEach(() => {
    vi.stubEnv("OVERSIGHT_DATA", "sample");
    vi.stubEnv("SAMPLE_NOW", SAMPLE_NOW);
    vi.stubEnv("SAMPLE_LATENCY", "0");
  });

  it("answers health, never cached, labelled as sample data", async () => {
    const response = await call("GET", "health");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toMatch(/application\/json/);
    const health = healthSchema.parse(await json(response));
    expect(health).toMatchObject({ status: "ok", data_mode: "sample", read_only: true, projects: ["DEMO"] });
    expect(health.last_synced_at).toBe("2026-11-04T14:28:00.000Z");
  });

  it("serves every read endpoint on the allowlist", async () => {
    const dataset = buildDataset(Date.parse(SAMPLE_NOW));
    const finding = dataset.engine.findings[0].id;
    for (const path of [
      "health",
      "projects",
      "overview",
      "people",
      "people/directory",
      "findings",
      `findings/${finding}`,
      "issues/DEMO-1/timeline",
      "insights/latest",
      "trends?metric=open_breaches",
      "rules",
      "baseline/latest",
    ]) {
      const response = await call("GET", path);
      expect(response.status, path).toBe(200);
    }
    expect(overviewSchema.safeParse(await json(await call("GET", "overview"))).success).toBe(true);
  });

  it("filters, pages and sorts findings from validated parameters only", async () => {
    const response = await call("GET", "findings?rule=R-FLOW-02&rule=R-EST-01&state=all&page_size=10&sort=issue_key&order=asc");
    const page = findingsPageSchema.parse(await json(response));
    expect(page.page_size).toBe(10);
    expect(new Set(page.items.map((item) => item.rule_id))).toEqual(new Set(["R-FLOW-02", "R-EST-01"]));
    const expected = sampleResponse(
      buildDataset(Date.parse(SAMPLE_NOW)),
      { name: "findings", query: normalizeFindingsQuery({ rule: ["R-EST-01", "R-FLOW-02"], state: "all", page_size: 10, sort: "issue_key", order: "asc" }) },
      0,
    );
    expect(expected.found && page).toEqual(expected.found && expected.body);
  });

  it("answers the board's people, and takes no parameters for them, not even a board", async () => {
    const response = await call("GET", "people");
    expect(response.status).toBe(200);
    const people = peopleSchema.parse(await json(response));
    const expected = sampleResponse(buildDataset(Date.parse(SAMPLE_NOW)), { name: "people" }, 0);
    expect(expected.found && people).toEqual(expected.found && expected.body);
    for (const path of ["people?project=DEMO", "people?person=unassigned", "people?page=2"]) {
      await expectProblem(await call("GET", path), 400, "bad_request");
    }
    await expectProblem(await call("GET", "people/unassigned"), 404, "not_found");
  });

  it("answers everyone on the board for the @ list, the members with no tickets too, and takes no parameters for it", async () => {
    const response = await call("GET", "people/directory");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const directory = peopleDirectorySchema.parse(await json(response));
    const expected = sampleResponse(buildDataset(Date.parse(SAMPLE_NOW)), { name: "people_directory" }, 0);
    expect(expected.found && directory).toEqual(expected.found && expected.body);
    // Everyone who holds a ticket (exactly GET /people's people, with their tickets) and the three members with none.
    const people = peopleSchema.parse(await json(await call("GET", "people")));
    const tickets = new Map(people.people.flatMap((row) => (row.person ? [[row.person.id, row.tickets] as const] : [])));
    expect(directory.people.filter((entry) => entry.tickets > 0).map((entry) => [entry.person.id, entry.tickets]).sort()).toEqual([...tickets].sort());
    expect(directory.people.filter((entry) => entry.tickets === 0).map((entry) => entry.person)).toEqual(
      MEMBERS.map((member) => ({ id: personIdFor(member.accountId), name: member.name, avatar: null })),
    );
    expect(directory.people).toHaveLength(TEAM.length + MEMBERS.length);
    // By name, folded for case and accents as the @ list's filter folds it.
    const names = directory.people.map((entry) => foldText(entry.person.name));
    expect(names).toEqual([...names].sort());
    for (const path of ["people/directory?project=DEMO", "people/directory?q=ada", "people/directory?v=0a1b2c3d4e5f"]) {
      await expectProblem(await call("GET", path), 400, "bad_request");
    }
    await expectProblem(await call("GET", "people/directory/all"), 404, "not_found");
    await expectProblem(await call("POST", "people/directory", { body: "{}" }), 404, "not_found");
  });

  it("serves the sample's two pictures by person id, privately cached and sandboxed, and 404 for the six without one", async () => {
    for (const [id, accountId] of [
      [CARMEN, "acc-03"],
      [GRACE, "acc-07"],
    ] as const) {
      const picture = pictureOf(accountId)!;
      for (const path of [`people/${id}/avatar`, `people/${id}/avatar?v=${picture.version}`]) {
        const response = await call("GET", path);
        expect(response.status, path).toBe(200);
        expectPictureHeaders(response, "image/png");
        expect(response.headers.get("content-length")).toBe(String(picture.bytes.length));
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(picture.bytes);
      }
    }
    // A picture's address carries the version only to keep a cached copy honest: an old one still finds today's.
    expect((await call("GET", `people/${CARMEN}/avatar?v=000000000000`)).status).toBe(200);
    await expectProblem(await call("GET", `people/${ADA}/avatar`), 404, "not_found");
    // A member with no tickets is on the board, and has no picture either: initials.
    await expectProblem(await call("GET", `people/${NOOR}/avatar`), 404, "not_found");
    await expectProblem(await call("GET", "people/p000000000000/avatar"), 404, "not_found");
  });

  it("checks a picture's address: a person id as the contract writes it, and only the picture's version", async () => {
    for (const path of [
      `people/${CARMEN.toUpperCase()}/avatar`,
      "people/acc-03/avatar",
      "people/unassigned/avatar",
      "people/Carmen%20Ruiz/avatar",
      `people/${CARMEN}0/avatar`,
      `people/${CARMEN}/avatar/large`,
      `people/${CARMEN}/picture`,
    ]) {
      await expectProblem(await call("GET", path), 404, "not_found");
    }
    for (const query of ["v=ZZZZZZZZZZZZ", "v=0a1b2c3d4e5", "v=0a1b2c3d4e5f&v=0a1b2c3d4e5f", "project=DEMO", "size=48", "v=0a1b2c3d4e5f&s=48"]) {
      await expectProblem(await call("GET", `people/${CARMEN}/avatar?${query}`), 400, "bad_request");
    }
    await expectProblem(await call("POST", `people/${CARMEN}/avatar`, { body: "{}" }), 404, "not_found");
  });

  it("filters findings by person from validated values only", async () => {
    const [first, second] = TEAM.map((member) => personIdFor(member.accountId));
    const page = findingsPageSchema.parse(await json(await call("GET", `findings?person=${second}&person=unassigned&person=${first}&state=all&page_size=100`)));
    expect(page.total).toBeGreaterThan(0);
    for (const item of page.items) {
      expect(item.scope).toBe("issue");
      expect([first, second, null]).toContain(item.assignee?.id ?? null);
    }
    const nobody = findingsPageSchema.parse(await json(await call("GET", "findings?person=p000000000000")));
    expect([nobody.total, nobody.items]).toEqual([0, []]);
    for (const value of ["P3F9A2C41B0DE", "Unassigned", "acc-01", "Ada%20Brooks", "p3f9a2c41b0d"]) {
      const refused = await expectProblem(await call("GET", `findings?person=${value}`), 400, "bad_request");
      expect(refused.issues?.map((issue) => issue.path)).toEqual(["person.0"]);
    }
    const many = Array.from({ length: 51 }, (_, index) => `person=p${String(index).padStart(12, "0")}`).join("&");
    await expectProblem(await call("GET", `findings?${many}`), 400, "bad_request");
  });

  it("refuses unknown or repeated parameters instead of ignoring them", async () => {
    const unknown = await expectProblem(await call("GET", "findings?colour=red"), 400, "bad_request");
    expect(unknown.issues).toEqual([{ path: "colour", message: "is not a parameter of this endpoint" }]);
    await expectProblem(await call("GET", "findings?state=open&state=all"), 400, "bad_request");
    await expectProblem(await call("GET", "findings?page=0"), 400, "bad_request");
    await expectProblem(await call("GET", "findings?page_size=500"), 400, "bad_request");
    await expectProblem(await call("GET", "findings?rule=not-a-rule"), 400, "bad_request");
    await expectProblem(await call("GET", "overview?fresh=1"), 400, "bad_request");
    await expectProblem(await call("GET", "trends"), 400, "bad_request");
    await expectProblem(await call("GET", "trends?metric=open_breaches&last_n=13"), 400, "bad_request");
  });

  it("answers anything off the allowlist with 404", async () => {
    for (const path of ["nope", "insights", "baseline", "issues/DEMO-1", "issues/DEMO-1/timeline/extra", "findings/abc/def", "admin/users", "ask"]) {
      await expectProblem(await call("GET", path), 404, "not_found");
    }
    await expectProblem(await call("POST", "overview", { body: "{}" }), 404, "not_found");
    await expectProblem(await call("POST", "findings", { body: "{}" }), 404, "not_found");
  });

  it("answers unknown findings and issues with 404, and reads keys in any case", async () => {
    await expectProblem(await call("GET", `findings/${"0".repeat(32)}`), 404, "not_found");
    await expectProblem(await call("GET", "findings/not-an-id"), 404, "not_found");
    await expectProblem(await call("GET", "issues/DEMO-99999/timeline"), 404, "not_found");
    await expectProblem(await call("GET", "issues/not a key/timeline"), 404, "not_found");
    const lower = issueTimelineSchema.parse(await json(await call("GET", "issues/demo-1/timeline")));
    expect(lower.issue.key).toBe("DEMO-1");
    expect(lower.issue.url).toBeNull();
  });

  it("syncs the board picked on the sample, and says which board its state is about (JO-18)", async () => {
    const idle = await call("GET", "refresh", { headers: { cookie: "jo-board=MOB" } });
    expect(idle.status).toBe(200);
    expect(JSON.parse(await idle.text())).toEqual({ project: "MOB", state: "idle", started_at: null, finished_at: null, message: null });
    const started = await call("POST", "refresh", { headers: { cookie: "jo-board=MOB" } });
    expect(JSON.parse(await started.text())).toMatchObject({ project: "MOB", state: "running", finished_at: null, message: null });
  });

  it("answers a question posted to ask", async () => {
    const response = await call("POST", "ask", {
      body: JSON.stringify({ question: "Where do tickets get stuck most?" }),
      headers: { "content-type": "application/json" },
    });
    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({ outcome: "answered", question: "Where do tickets get stuck most?", latency_ms: 0 });
  });

  it("answers about people with sign-in off, where every board is read already: the people named, with their pictures' versions", async () => {
    const response = await call("POST", "ask", { body: JSON.stringify({ question: "Who has the most open breaches?" }) });
    expect(response.status).toBe(200);
    const answer = askResponseSchema.parse(await json(response));
    expect(answer.outcome).toBe("answered");
    expect(answer.answer).toMatch(/^Carmen Ruiz has the most open breaches/);
    expect(answer.people[0]).toEqual({ id: CARMEN, name: "Carmen Ruiz", avatar: pictureOf("acc-03")!.version });
  });

  it("answers about the person a question mentions, by id", async () => {
    const body = JSON.stringify({ question: "What are @Carmen Ruiz's open breaches?", mentions: [CARMEN] });
    const answer = askResponseSchema.parse(await json(await call("POST", "ask", { body })));
    expect(answer.outcome).toBe("answered");
    expect(answer.people.map((person) => person.id)).toEqual([CARMEN]);
    expect(answer.facts.map((fact) => fact.params.sql).join(" ")).toContain(`person_id = '${CARMEN}'`);
    // Someone with no ticket on the board: said in the contract's words, and nothing is looked up.
    const stranger = askResponseSchema.parse(
      await json(await call("POST", "ask", { body: JSON.stringify({ question: "What is @Someone working on?", mentions: ["p000000000000"] }) })),
    );
    expect([stranger.outcome, stranger.message, stranger.plan, stranger.people]).toEqual(["not_understood", ASK_DECLINES.unknownMention, [], []]);
  });

  it("says in code that members mentioned hold no tickets: the whole answer when all do, a paragraph of its own when some", async () => {
    const asked = async (question: string, mentions: string[]) =>
      askResponseSchema.parse(await json(await call("POST", "ask", { body: JSON.stringify({ question, mentions }) })));
    const one = await asked("What is @Noor Haddad working on?", [NOOR]);
    expect([one.outcome, one.answer, one.facts, one.plan, one.model]).toEqual(["no_data", "Noor Haddad has no tickets on this board.", [], [], null]);
    expect(one.people).toEqual([{ id: NOOR, name: "Noor Haddad", avatar: null }]);
    const two = await asked("Compare @Yuki Tanabe and @Noor Haddad", [YUKI, NOOR]);
    expect(two.answer).toBe("Yuki Tanabe and Noor Haddad have no tickets on this board.");
    expect(two.people.map((person) => person.id)).toEqual([YUKI, NOOR]);
    const three = await asked("@Noor Haddad @Tomás Ferreira @Yuki Tanabe", [NOOR, TOMAS, YUKI]);
    expect(three.answer).toBe("Noor Haddad, Tomás Ferreira and Yuki Tanabe have no tickets on this board.");
    expect(three.answer).toBe(noTicketsSentence(["Noor Haddad", "Tomás Ferreira", "Yuki Tanabe"]));

    const mixed = await asked("What are @Carmen Ruiz's and @Noor Haddad's open breaches?", [CARMEN, NOOR]);
    expect(mixed.outcome).toBe("answered");
    expect(mixed.answer).toMatch(/^Carmen Ruiz has \d+ open breaches\./);
    expect(mixed.answer?.endsWith("\n\nNoor Haddad has no tickets on this board.")).toBe(true);
    expect(mixed.people.map((person) => person.id)).toEqual([CARMEN, NOOR]);
    // Asked about Carmen alone: the facts hold her, and no one else.
    expect(mixed.facts.map((fact) => fact.params.sql).join(" ")).not.toContain(NOOR);

    // Someone not on the board at all, beside a member: still the contract's one sentence, nothing looked up.
    const stranger = await asked("What about @Noor Haddad and @Someone?", [NOOR, "p000000000000"]);
    expect([stranger.outcome, stranger.message, stranger.people]).toEqual(["not_understood", ASK_DECLINES.unknownMention, []]);
  });

  it("takes mentions only as person ids, each once, ten at most, and never a level from the browser", async () => {
    const ids = TEAM.map((member) => personIdFor(member.accountId));
    for (const body of [
      { question: "hi", mentions: ["acc-03"] },
      { question: "hi", mentions: [CARMEN.toUpperCase()] },
      { question: "hi", mentions: [CARMEN, CARMEN] },
      { question: "hi", mentions: [...ids, "p000000000001", "p000000000002", "p000000000003"] },
      { question: "hi", mentions: CARMEN },
      { question: "hi", mentions: [{ id: CARMEN }] },
      { question: "hi", level: "people" },
      { question: "hi", level: "team" },
    ]) {
      const refused = await expectProblem(await call("POST", "ask", { body: JSON.stringify(body) }), 400, "bad_request");
      expect(refused.issues?.length, JSON.stringify(body)).toBeGreaterThan(0);
    }
    expect((await call("POST", "ask", { body: JSON.stringify({ question: "hi", mentions: [] }) })).status).toBe(200);
    expect((await call("POST", "ask", { body: JSON.stringify({ question: "hi", mentions: ids.slice(0, 8) }) })).status).toBe(200);
  });

  it("refuses a body that is not one question", async () => {
    await expectProblem(await call("POST", "ask", { body: "not json" }), 400, "bad_request");
    await expectProblem(await call("POST", "ask", { body: "{}" }), 400, "bad_request");
    await expectProblem(await call("POST", "ask", { body: JSON.stringify({ question: 42 }) }), 400, "bad_request");
    await expectProblem(await call("POST", "ask", { body: JSON.stringify({ question: "hi", user: "someone" }) }), 400, "bad_request");
    await expectProblem(await call("POST", "ask", { body: JSON.stringify({ question: "x".repeat(2001) }) }), 400, "bad_request");
    await expectProblem(await call("POST", "ask", { body: JSON.stringify({ question: "x".repeat(20_000) }) }), 413, "bad_request");
    await expectProblem(await call("POST", "ask?debug=1", { body: JSON.stringify({ question: "hi" }) }), 400, "bad_request");
  });

  it("takes a question or a sync only from the dashboard's own pages, and a question only as JSON, with sign-in off too", async () => {
    const question = JSON.stringify({ question: "Where do tickets get stuck most?" });
    for (const origin of ["https://evil.example", "null", "http://localhost:3401", "http://localhost:3400/ask"]) {
      const asked = await expectProblem(await call("POST", "ask", { body: question, headers: { origin } }), 403, "forbidden");
      expect(asked.message, origin).toBe("Questions can be asked only from this dashboard's own pages, so nothing was asked.");
      const synced = await expectProblem(await call("POST", "refresh", { headers: { origin } }), 403, "forbidden");
      expect(synced.message, origin).toBe("A sync can be started only from this dashboard's own pages, so none was started.");
    }
    // A browser always sends an Origin with a POST: one without is no page's.
    const url = new URL("http://localhost:3400/api/oversight/ask");
    const bare = new NextRequest(url, { method: "POST", body: question, headers: { "content-type": "application/json" } });
    await expectProblem(await POST(bare, { params: Promise.resolve({ path: ["ask"] }) }), 403, "forbidden");
    // text/plain is what a page on another site may send without a preflight: never taken for a question.
    for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"]) {
      const plain = await expectProblem(await call("POST", "ask", { body: question, headers: { "content-type": type } }), 403, "forbidden");
      expect(plain.message, type).toBe("A question is sent as a JSON body, so nothing was asked.");
    }
    // Sync now has no body, so its type is not asked; from the pages' own origin it goes on as ever.
    expect((await call("POST", "refresh")).status).toBe(200);
    expect((await call("POST", "ask", { body: question, headers: { "content-type": "application/json; charset=utf-8" } })).status).toBe(200);
  });

  it("waits as long as SAMPLE_LATENCY says, so loading states can be seen", async () => {
    vi.stubEnv("SAMPLE_LATENCY", "120,0");
    const started = performance.now();
    await call("GET", "rules");
    expect(performance.now() - started).toBeGreaterThanOrEqual(100);
  });

  it("reports a broken configuration by name, never by value", async () => {
    vi.stubEnv("OVERSIGHT_DATA", "demo");
    expect((await expectProblem(await call("GET", "health"), 500, "not_configured")).message).toMatch(/OVERSIGHT_DATA/);
    vi.stubEnv("OVERSIGHT_DATA", "sample");
    vi.stubEnv("SAMPLE_NOW", "yesterday");
    expect((await expectProblem(await call("GET", "health"), 500, "not_configured")).message).toMatch(/SAMPLE_NOW/);
    vi.stubEnv("SAMPLE_NOW", SAMPLE_NOW);
    vi.stubEnv("SAMPLE_LATENCY", "slow");
    expect((await expectProblem(await call("GET", "health"), 500, "not_configured")).message).toMatch(/SAMPLE_LATENCY/);
  });
});

describe("live mode", () => {
  const dataset = buildDataset(Date.parse(SAMPLE_NOW));
  /** What the Python service would send: the sample's shape, labelled live. */
  const live = (route: Parameters<typeof sampleResponse>[1]): unknown => {
    const answer = sampleResponse(dataset, route, 0);
    if (!answer.found) throw new Error("fixture missing");
    const body = structuredClone(answer.body) as { meta: { data_mode: string } };
    body.meta.data_mode = "live";
    return body;
  };
  let upstream: ReturnType<typeof vi.fn<typeof fetch>>;

  beforeEach(() => {
    vi.stubEnv("OVERSIGHT_DATA", "live");
    vi.stubEnv("OVERSIGHT_API_URL", API);
    vi.stubEnv("OVERSIGHT_SERVICE_KEY", KEY);
    vi.stubEnv("OVERSIGHT_JIRA_BASE_URL", "https://example.atlassian.net");
    upstream = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", upstream);
  });

  function answerWith(body: unknown, status = 200) {
    upstream.mockResolvedValue(
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  }

  async function bodyText(response: Response): Promise<string> {
    const text = await response.text();
    expect(text).not.toContain(KEY);
    expect(text).not.toContain("oversight.internal");
    return text;
  }

  it("adds the service key, forwards only the validated query, and passes nothing else on", async () => {
    answerWith({ ...(live({ name: "findings", query: normalizeFindingsQuery({ rule: ["R-EST-01"] }) }) as object), debug_sql: "SELECT ..." });
    const response = await call("GET", "findings?rule=R-EST-01&state=open", {
      headers: { cookie: "session=abc", authorization: "Bearer browser-token", "x-forwarded-for": "10.0.0.1" },
    });
    expect(response.status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(1);
    const [url, init] = upstream.mock.calls[0];
    expect(String(url)).toBe(`${API}/api/v1/findings?rule=R-EST-01&level=people`);
    expect(init?.method).toBe("GET");
    expect(init?.redirect).toBe("error");
    expect(init?.cache).toBe("no-store");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const headers = new Headers(init?.headers);
    expect(headers.get("x-service-key")).toBe(KEY);
    expect([...headers.keys()].sort()).toEqual(["accept", "x-oversight-viewer", "x-oversight-viewer-name", "x-service-key"]);
    expect(headers.get("x-oversight-viewer")).toBe("local");
    expect(decodeURIComponent(headers.get("x-oversight-viewer-name") ?? "")).toBe("Local (sign-in off)");
    const text = await bodyText(response);
    expect(text).not.toContain("debug_sql");
    expect(findingsPageSchema.parse(JSON.parse(text)).meta.data_mode).toBe("live");
  });

  it("posts the question to ask as JSON, with the level this server decided and the mentions it checked", async () => {
    answerWith(live({ name: "ask", question: "Where do tickets get stuck most?", mentions: [], level: "people" }));
    const response = await call("POST", "ask", { body: JSON.stringify({ question: "Where do tickets get stuck most?" }) });
    expect(response.status).toBe(200);
    const [url, init] = upstream.mock.calls[0];
    expect(String(url)).toBe(`${API}/api/v1/ask`);
    expect(init?.method).toBe("POST");
    // Sign-in is off in these tests: every board is read already, so Ask answers about people too.
    expect(JSON.parse(String(init?.body))).toEqual({ question: "Where do tickets get stuck most?", level: "people", mentions: [] });
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
  });

  it("forwards the people a question mentions, as the ids it checked, and passes on the people the answer names", async () => {
    const question = "What are @Carmen Ruiz's open findings?";
    answerWith(live({ name: "ask", question, mentions: [CARMEN], level: "people" }));
    const response = await call("POST", "ask", { body: JSON.stringify({ question, mentions: [CARMEN] }) });
    expect(response.status).toBe(200);
    expect(JSON.parse(String(upstream.mock.calls[0][1]?.body))).toEqual({ question, level: "people", mentions: [CARMEN] });
    const answer = askResponseSchema.parse(JSON.parse(await bodyText(response)));
    expect(answer.people.map((person) => person.id)).toEqual([CARMEN]);
  });

  it("drops anything about a person in Ask's people but the id, the name and the picture's version", async () => {
    const question = "Who has the most open breaches?";
    const sent = live({ name: "ask", question, mentions: [], level: "people" }) as { people: Record<string, unknown>[] };
    expect(sent.people.length).toBeGreaterThan(0);
    for (const person of sent.people) {
      Object.assign(person, { accountId: "acc-03", emailAddress: "someone@example.com", timeZone: "Europe/London" });
    }
    answerWith(sent);
    const text = await bodyText(await call("POST", "ask", { body: JSON.stringify({ question }) }));
    expect(text).not.toMatch(/acc-03|someone@example\.com|accountId|emailAddress|timeZone/);
    for (const person of askResponseSchema.parse(JSON.parse(text)).people) expect(Object.keys(person).sort()).toEqual(["avatar", "id", "name"]);
  });

  it("asks for the picked board's people, and passes on nothing of a person but the id, the name and the picture's version", async () => {
    const people = live({ name: "people" }) as { people: { person: Record<string, unknown> | null }[] };
    const sent = structuredClone(people);
    for (const row of sent.people) {
      if (row.person) {
        Object.assign(row.person, {
          accountId: "acc-01",
          emailAddress: "someone@example.com",
          avatarUrls: { "48x48": "https://secure.gravatar.com/avatar/0123456789abcdef0123456789abcdef?d=identicon" },
          timeZone: "Pacific/Chatham",
        });
      }
    }
    answerWith(sent);
    const response = await call("GET", "people", { headers: { cookie: "jo-board=AIL" } });
    expect(response.status).toBe(200);
    expect(String(upstream.mock.calls[0][0])).toBe(`${API}/api/v1/people?project=AIL`);
    const text = await bodyText(response);
    for (const leak of ["acc-01", "someone@example.com", "avatarUrls", "gravatar", "timeZone", "Pacific/Chatham"]) expect(text).not.toContain(leak);
    expect(peopleSchema.parse(JSON.parse(text))).toEqual(people);
  });

  it("asks for the picked board's directory, passes on nothing of a person but the id, the name and the picture's version, and refuses one listed twice", async () => {
    const directory = live({ name: "people_directory" }) as { people: { person: Record<string, unknown>; tickets: number }[] };
    const sent = structuredClone(directory);
    for (const entry of sent.people) {
      Object.assign(entry.person, {
        accountId: "acc-09",
        emailAddress: "someone@example.com",
        avatarUrls: { "48x48": "https://secure.gravatar.com/avatar/0123456789abcdef0123456789abcdef?d=identicon" },
        timeZone: "Pacific/Chatham",
      });
      Object.assign(entry, { accountType: "atlassian", active: true });
    }
    answerWith(sent);
    const response = await call("GET", "people/directory", { headers: { cookie: "jo-board=AIL" } });
    expect(response.status).toBe(200);
    expect(String(upstream.mock.calls[0][0])).toBe(`${API}/api/v1/people/directory?project=AIL`);
    const text = await bodyText(response);
    for (const leak of ["acc-09", "someone@example.com", "avatarUrls", "gravatar", "timeZone", "Pacific/Chatham", "accountType", "active"]) {
      expect(text).not.toContain(leak);
    }
    expect(peopleDirectorySchema.parse(JSON.parse(text))).toEqual(directory);

    const twice = structuredClone(directory);
    twice.people.push(twice.people[0]);
    answerWith(twice);
    const refused = await expectProblem(await call("GET", "people/directory"), 502, "upstream_invalid");
    expect(refused.issues?.map((issue) => issue.message)).toContain("listed twice");
    // A board the service does not serve: the top bar forgets the pick.
    answerWith({ detail: "unknown project" }, 404);
    await expectProblem(await call("GET", "people/directory"), 404, "unknown_board");
  });

  describe("a person's picture", () => {
    const png = pictureOf("acc-03")!.bytes;
    /** The service answering with these bytes and this Content-Type (and a header that must never be passed on). */
    function pictureWith(bytes: Uint8Array<ArrayBuffer>, type: string | null, extra: Record<string, string> = {}) {
      const headers = new Headers({ "set-cookie": "upstream=1", etag: '"abc"', ...extra });
      if (type !== null) headers.set("content-type", type);
      upstream.mockResolvedValueOnce(new Response(bytes, { status: 200, headers }));
    }

    it("is asked of the service on the picked board, with the key, and passed on as bytes with the picture headers", async () => {
      pictureWith(png, "image/png");
      const response = await call("GET", `people/${CARMEN}/avatar?v=0a1b2c3d4e5f`, {
        headers: { cookie: "session=abc; jo-board=AIL", authorization: "Bearer browser-token" },
      });
      expect(response.status).toBe(200);
      const [url, init] = upstream.mock.calls[0];
      // The version is the browser's cache key, never forwarded; the board is the top bar's pick.
      expect(String(url)).toBe(`${API}/api/v1/people/${CARMEN}/avatar?project=AIL`);
      expect(init?.method).toBe("GET");
      expect(init?.redirect).toBe("error");
      expect(init?.cache).toBe("no-store");
      const headers = new Headers(init?.headers);
      expect([...headers.keys()].sort()).toEqual(["accept", "x-service-key"]);
      expect(headers.get("x-service-key")).toBe(KEY);
      expect(headers.get("accept")).toBe("image/png, image/jpeg, image/gif, image/webp");

      expectPictureHeaders(response, "image/png");
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(response.headers.get("etag")).toBeNull();
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
    });

    it("passes on JPEG, GIF and WebP as well, each as its own type", async () => {
      const cases: [string, Uint8Array<ArrayBuffer>][] = [
        ["image/jpeg", Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70])],
        ["image/gif", Uint8Array.from(Buffer.from("GIF89a\u0001\u0000\u0001\u0000", "latin1"))],
        ["image/webp", Uint8Array.from(Buffer.from("RIFF\u0000\u0000\u0000\u0000WEBPVP8 ", "latin1"))],
      ];
      for (const [type, bytes] of cases) {
        pictureWith(bytes, `${type}; charset=binary`);
        const response = await call("GET", `people/${CARMEN}/avatar`);
        expect(response.status, type).toBe(200);
        expectPictureHeaders(response, type);
      }
    });

    it("is refused with 502 as anything but one of the four image types, or as bytes that are not their type", async () => {
      const svg = Uint8Array.from(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"));
      const html = Uint8Array.from(Buffer.from("<!doctype html><title>x</title>"));
      const cases: [Uint8Array<ArrayBuffer>, string | null][] = [
        [svg, "image/svg+xml"],
        [html, "text/html"],
        [png, "application/octet-stream"],
        [png, "application/json"],
        [png, null],
        // Declared a PNG, but an SVG or a page.
        [svg, "image/png"],
        [html, "image/jpeg"],
        [new Uint8Array(0), "image/png"],
      ];
      for (const [bytes, type] of cases) {
        pictureWith(bytes, type);
        const response = await call("GET", `people/${CARMEN}/avatar`);
        const body = await expectProblem(response, 502, "upstream_invalid");
        expect(JSON.stringify(body)).not.toContain("<");
      }
    });

    it("is refused with 502 when larger than any picture the service keeps, declared or not", async () => {
      const large = new Uint8Array(256 * 1024 + 1);
      large.set(png.subarray(0, 8));
      pictureWith(large, "image/png");
      await expectProblem(await call("GET", `people/${CARMEN}/avatar`), 502, "upstream_invalid");
      // No length declared: read only as far as the limit, then given up.
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(png.subarray(0, 8));
          for (let index = 0; index < 5; index += 1) controller.enqueue(new Uint8Array(64 * 1024));
          controller.close();
        },
      });
      upstream.mockResolvedValueOnce(new Response(stream, { status: 200, headers: { "content-type": "image/png" } }));
      await expectProblem(await call("GET", `people/${CARMEN}/avatar`), 502, "upstream_invalid");
    });

    it("is not found when the service holds none, and its other failures are said in this interface's words", async () => {
      const cases: [number, number, string][] = [
        [404, 404, "not_found"],
        [401, 502, "upstream_refused"],
        [500, 502, "upstream_error"],
        [503, 503, "upstream_unavailable"],
      ];
      for (const [status, expected, error] of cases) {
        upstream.mockResolvedValueOnce(new Response(JSON.stringify({ detail: `Traceback at ${API}` }), { status }));
        const response = await call("GET", `people/${CARMEN}/avatar`);
        expect(response.status, String(status)).toBe(expected);
        expect(JSON.parse(await bodyText(response)).error).toBe(error);
      }
      upstream.mockRejectedValueOnce(new TypeError("fetch failed"));
      await expectProblem(await call("GET", `people/${CARMEN}/avatar`), 503, "upstream_unavailable");
    });

    it("is never asked for when the address is refused", async () => {
      await call("GET", "people/acc-03/avatar");
      await call("GET", `people/${CARMEN}/avatar?url=https://evil.example/x.png`);
      expect(upstream).not.toHaveBeenCalled();
    });
  });

  it("forwards the person filter in canonical form, with the board and the level the access log records", async () => {
    const id = personIdFor(TEAM[0].accountId);
    answerWith(live({ name: "findings", query: normalizeFindingsQuery({ person: [id, "unassigned"] }) }));
    await call("GET", `findings?person=unassigned&person=${id}&person=unassigned&level=team`, { headers: { cookie: "jo-board=AIL" } });
    // A level in the browser's query is refused, never forwarded: the level is this server's (sign-in off: people).
    expect(upstream).not.toHaveBeenCalled();
    await call("GET", `findings?person=unassigned&person=${id}&person=unassigned`, { headers: { cookie: "jo-board=AIL" } });
    expect(String(upstream.mock.calls[0][0])).toBe(`${API}/api/v1/findings?person=${id}&person=unassigned&project=AIL&level=people`);
  });

  it("sends the reader's level with findings that name no one but Unassigned: who ignored a finding is named at people level alone", async () => {
    answerWith(live({ name: "findings", query: normalizeFindingsQuery({ person: ["unassigned"] }) }));
    await call("GET", "findings?person=unassigned");
    expect(String(upstream.mock.calls[0][0])).toBe(`${API}/api/v1/findings?person=unassigned&level=people`);
  });

  it("answers a person sent with an account id for an id with 502, naming the field and never its value", async () => {
    const people = live({ name: "people" }) as { people: { person: { id: string } | null }[] };
    people.people[0].person!.id = "557058:0e7d3f6c-1d2b-4c5e-9f00-123456789abc";
    answerWith(people);
    const response = await call("GET", "people");
    const body = apiErrorBodySchema.parse(JSON.parse(await bodyText(response)));
    expect(response.status).toBe(502);
    expect(body.error).toBe("upstream_invalid");
    expect(body.issues?.map((issue) => issue.path)).toContain("people.0.person.id");
    expect(JSON.stringify(body)).not.toContain("557058");
  });

  it("links issues to the configured Jira site, whatever the service says", async () => {
    const timeline = live({ name: "issue_timeline", issueKey: "DEMO-1" }) as { issue: { url: string | null } };
    timeline.issue.url = "https://somewhere-else.example/DEMO-1";
    answerWith(timeline);
    const linked = issueTimelineSchema.parse(await json(await call("GET", "issues/DEMO-1/timeline")));
    expect(linked.issue.url).toBe("https://example.atlassian.net/browse/DEMO-1");
    vi.stubEnv("OVERSIGHT_JIRA_BASE_URL", "");
    answerWith(timeline);
    expect(issueTimelineSchema.parse(await json(await call("GET", "issues/DEMO-1/timeline"))).issue.url).toBeNull();
  });

  it("answers a body that is not JSON with 502", async () => {
    answerWith("<html>Bad gateway at oversight.internal</html>");
    const response = await call("GET", "overview");
    expect(response.status).toBe(502);
    expect(JSON.parse(await bodyText(response)).error).toBe("upstream_malformed");
  });

  it("answers a body that breaks the contract with 502, naming the fields and never their values", async () => {
    const broken = live({ name: "overview" }) as { totals: { open_breaches: { current: unknown } } };
    broken.totals.open_breaches.current = "a lot";
    answerWith(broken);
    const response = await call("GET", "overview");
    const body = apiErrorBodySchema.parse(JSON.parse(await bodyText(response)));
    expect(response.status).toBe(502);
    expect(body.error).toBe("upstream_invalid");
    expect(body.issues?.map((issue) => issue.path)).toContain("totals.open_breaches.current");
    expect(JSON.stringify(body)).not.toContain("a lot");
  });

  it("answers an unreachable service with 503", async () => {
    upstream.mockRejectedValue(new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED 10.1.2.3:3300") }));
    const response = await call("GET", "health");
    expect(response.status).toBe(503);
    const text = await bodyText(response);
    expect(JSON.parse(text).error).toBe("upstream_unavailable");
    expect(text).not.toContain("ECONNREFUSED");
  });

  it("answers a service that times out with 503", async () => {
    upstream.mockRejectedValue(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
    const response = await call("GET", "overview");
    expect(response.status).toBe(503);
    expect(JSON.parse(await bodyText(response)).error).toBe("upstream_timeout");
  });

  it("gives up after the timeout even when the service never answers", async () => {
    // Like fetch: settles only when its signal aborts (at once, if it already has).
    upstream.mockImplementation(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (signal?.aborted) reject(signal.reason);
          else signal?.addEventListener("abort", () => reject(signal.reason));
        }),
    );
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => AbortSignal.abort(new DOMException("timed out", "TimeoutError")));
    const response = await call("GET", "rules");
    expect(timeout).toHaveBeenCalledWith(15_000);
    expect(response.status).toBe(503);
    expect(JSON.parse(await bodyText(response)).error).toBe("upstream_timeout");
  });

  it("translates the service's failures into its own words", async () => {
    const cases: [number, string, number, string][] = [
      [401, "health", 502, "upstream_refused"],
      [403, "health", 502, "upstream_refused"],
      [500, "overview", 502, "upstream_error"],
      [422, "overview", 502, "upstream_error"],
      [503, "overview", 503, "upstream_unavailable"],
      [404, `findings/${"a".repeat(32)}`, 404, "not_found"],
      [404, "issues/DEMO-5/timeline", 404, "not_found"],
      [404, "insights/latest", 404, "not_found"],
      [404, "baseline/latest", 404, "not_found"],
      // Any other 404 is a board the service stopped serving: the top bar resets the pick.
      [404, "overview", 404, "unknown_board"],
      [404, "people", 404, "unknown_board"],
    ];
    for (const [status, path, expected, error] of cases) {
      upstream.mockResolvedValueOnce(new Response(JSON.stringify({ detail: `Traceback at ${API} with ${KEY}` }), { status }));
      const response = await call("GET", path);
      expect(response.status, `${status} ${path}`).toBe(expected);
      const text = await bodyText(response);
      expect(JSON.parse(text).error).toBe(error);
      expect(text).not.toContain("Traceback");
    }
  });

  it("refuses to run without a key or an address, naming the variable", async () => {
    vi.stubEnv("OVERSIGHT_SERVICE_KEY", "");
    const missingKey = await expectProblem(await call("GET", "health"), 500, "not_configured");
    expect(missingKey.message).toMatch(/OVERSIGHT_SERVICE_KEY/);
    vi.stubEnv("OVERSIGHT_SERVICE_KEY", KEY);
    vi.stubEnv("OVERSIGHT_API_URL", "ftp://oversight.internal");
    const badUrl = await expectProblem(await call("GET", "health"), 500, "not_configured");
    expect(badUrl.message).toMatch(/OVERSIGHT_API_URL/);
    expect(JSON.stringify(badUrl)).not.toContain("oversight.internal");
    expect(upstream).not.toHaveBeenCalled();
  });

  it("tells the service which board the top bar picked, on every route but the board list", async () => {
    const cookie = "session=abc; jo-board=AIL";
    answerWith(live({ name: "overview" }));
    await call("GET", "overview", { headers: { cookie } });
    expect(String(upstream.mock.calls[0][0])).toBe(`${API}/api/v1/overview?project=AIL`);

    answerWith(live({ name: "findings", query: normalizeFindingsQuery({ rule: ["R-EST-01"] }) }));
    await call("GET", "findings?rule=R-EST-01", { headers: { cookie } });
    expect(String(upstream.mock.calls[1][0])).toBe(`${API}/api/v1/findings?rule=R-EST-01&project=AIL&level=people`);

    answerWith(live({ name: "ask", question: "How many open breaches?", mentions: [], level: "people" }));
    await call("POST", "ask", { body: JSON.stringify({ question: "How many open breaches?" }), headers: { cookie } });
    expect(String(upstream.mock.calls[2][0])).toBe(`${API}/api/v1/ask?project=AIL`);

    answerWith({ project: "AIL", state: "idle", started_at: null, finished_at: null, message: null });
    await call("GET", "refresh", { headers: { cookie } });
    expect(String(upstream.mock.calls[3][0])).toBe(`${API}/api/v1/refresh?project=AIL`);

    answerWith({ default: "AIL", projects: [{ key: "AIL", name: "AILED", issues: 1148, last_synced_at: SAMPLE_NOW, synced: true, type: "software" }] });
    const projects = await call("GET", "projects", { headers: { cookie } });
    expect(projects.status).toBe(200);
    expect(String(upstream.mock.calls[4][0])).toBe(`${API}/api/v1/projects`);
  });

  it("forwards Sync as a POST with no body, for the board the top bar picked, and polls it with a GET (JO-18)", async () => {
    const running = { project: "AIL", state: "running", started_at: SAMPLE_NOW, finished_at: null, message: null };
    answerWith(running);
    const started = await call("POST", "refresh", { headers: { cookie: "jo-board=AIL" } });
    expect(started.status).toBe(200);
    expect(JSON.parse(await bodyText(started))).toEqual(running);
    const [url, init] = upstream.mock.calls[0];
    expect(String(url)).toBe(`${API}/api/v1/refresh?project=AIL`);
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeUndefined();
    expect(new Headers(init?.headers).get("x-service-key")).toBe(KEY);

    answerWith({ ...running, state: "succeeded", finished_at: SAMPLE_NOW });
    const polled = await call("GET", "refresh", { headers: { cookie: "jo-board=AIL" } });
    expect(String(upstream.mock.calls[1][0])).toBe(`${API}/api/v1/refresh?project=AIL`);
    expect(upstream.mock.calls[1][1]?.method).toBe("GET");
    expect(JSON.parse(await polled.text()).state).toBe("succeeded");

    // No pick: the service's default board, and whichever board it reports.
    answerWith({ ...running, project: "LEADRSCOMS", state: "queued", started_at: null });
    const queued = await call("POST", "refresh");
    expect(String(upstream.mock.calls[2][0])).toBe(`${API}/api/v1/refresh`);
    expect(JSON.parse(await bodyText(queued))).toMatchObject({ project: "LEADRSCOMS", state: "queued" });
  });

  it("refuses a sync the service reports for another board than the one picked", async () => {
    answerWith({ project: "OTHER", state: "running", started_at: SAMPLE_NOW, finished_at: null, message: null });
    const response = await expectProblem(await call("POST", "refresh", { headers: { cookie: "jo-board=AIL" } }), 502, "upstream_invalid");
    expect(response.message).toMatch(/another board/);
  });

  it("says a board that has never synced has nothing yet, by the service's code, on every board-scoped route (JO-17)", async () => {
    for (const path of ["overview", "findings", "people", "rules", "insights/latest", "baseline/latest", "issues/AIL-1/timeline", "rules/settings"]) {
      upstream.mockResolvedValueOnce(Response.json({ detail: "never synced", code: "board_not_synced" }, { status: 409 }));
      const body = await expectProblem(await call("GET", path, { headers: { cookie: "jo-board=AIL" } }), 409, "board_not_synced");
      expect(body.message, path).toBe("This board hasn't been synced yet.");
    }
    // Another 409 is not taken for it: a rule settings conflict is still a conflict.
    upstream.mockResolvedValueOnce(Response.json({ detail: "moved on", code: "rule_settings_conflict" }, { status: 409 }));
    const save = { revision: 1, changes: [{ rule_id: "R-EFF-01", enabled: false }] };
    await expectProblem(await call("POST", "rules/settings", { body: JSON.stringify(save) }), 409, "rule_settings_conflict");
    upstream.mockResolvedValueOnce(Response.json({ detail: "something else" }, { status: 409 }));
    await expectProblem(await call("GET", "overview", { headers: { cookie: "jo-board=AIL" } }), 502, "upstream_error");
  });

  it("answers health for a board that has never synced from the service's own, with the board named and no sync time", async () => {
    const service = live({ name: "health" }) as Record<string, unknown>;
    upstream.mockResolvedValueOnce(Response.json({ detail: "never synced", code: "board_not_synced" }, { status: 409 }));
    upstream.mockResolvedValueOnce(Response.json({ ...service, data_mode: "live" }));
    const response = await call("GET", "health", { headers: { cookie: "jo-board=AIL" } });
    expect(response.status).toBe(200);
    const health = healthSchema.parse(await json(response));
    expect(health).toMatchObject({ status: "ok", message: null, data_mode: "live", last_synced_at: null, projects: ["AIL"] });
    expect(String(upstream.mock.calls[0][0])).toBe(`${API}/api/v1/health?project=AIL`);
    expect(String(upstream.mock.calls[1][0])).toBe(`${API}/api/v1/health`);
    // A service whose health says no sync time itself is passed on as it is.
    const { meta: _meta, ...bare } = service;
    upstream.mockResolvedValueOnce(Response.json({ ...bare, data_mode: "live", status: "degraded", message: "Not synced yet.", last_synced_at: null }));
    expect(healthSchema.parse(await json(await call("GET", "health"))).last_synced_at).toBeNull();
  });

  it("never starts a sync, nor asks a question, for a page on another site", async () => {
    answerWith({ project: "AIL", state: "running", started_at: SAMPLE_NOW, finished_at: null, message: null });
    await expectProblem(await call("POST", "refresh", { headers: { origin: "https://evil.example" } }), 403, "forbidden");
    const question = JSON.stringify({ question: "How many open breaches?" });
    await expectProblem(await call("POST", "ask", { body: question, headers: { origin: "https://evil.example" } }), 403, "forbidden");
    await expectProblem(await call("POST", "ask", { body: question, headers: { "content-type": "text/plain" } }), 403, "forbidden");
    expect(upstream).not.toHaveBeenCalled();
  });

  it("refuses sync now with query parameters, and a refresh body that breaks the contract", async () => {
    await expectProblem(await call("POST", "refresh?project=AIL"), 400, "bad_request");
    expect(upstream).not.toHaveBeenCalled();
    answerWith({ state: "done" });
    await expectProblem(await call("POST", "refresh"), 502, "upstream_invalid");
  });

  it("sends no board when the cookie holds no project key", async () => {
    for (const cookie of ["jo-board=", "jo-board=AIL%26sql%3D1", "jo-board=a b", "other-board=AIL"]) {
      upstream.mockClear();
      answerWith(live({ name: "overview" }));
      await call("GET", "overview", { headers: { cookie } });
      expect(String(upstream.mock.calls[0][0]), cookie).toBe(`${API}/api/v1/overview`);
    }
  });

  it("never forwards a request the allowlist refused", async () => {
    await call("GET", "admin/users");
    await call("GET", "findings?sql=drop");
    await call("POST", "rules", { body: "{}" });
    expect(upstream).not.toHaveBeenCalled();
  });
});
