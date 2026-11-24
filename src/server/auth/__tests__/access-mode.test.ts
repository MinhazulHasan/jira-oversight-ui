// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GET, POST } from "@/app/api/oversight/[...path]/route";
import { apiErrorBodySchema, askResponseSchema, portfolioSchema, projectsSchema } from "@/lib/api/schemas";

import { resetSampleClock } from "../../sample/clock";
import { resetSampleRuleSettings } from "../../sample/settings-store";
import { resetSampleSync } from "../../sample/sync";
import { personIdFor } from "../../sample/team";
import { sealSession } from "../cookies";
import { viewerHash } from "../viewer";

import { APP, SECRET, SESSION_KEYS, stubAuthEnv } from "./fixtures";

const NOW = "2026-11-04T14:30:00Z";
const SAMPLE = { OVERSIGHT_DATA: "sample", SAMPLE_NOW: NOW, SAMPLE_LATENCY: "0" };
/** Someone not on ADMIN_EMAILS, whose Jira opens DEMO alone. */
const READER = { sub: "557058:reader", dom: "stellainternational.com", site: "cloud-id", eh: "x".repeat(43), boards: ["DEMO"], name: "Robin Okafor" };
const ADA = personIdFor("acc-01");

function call(method: "GET" | "POST", path: string, cookie: string, body?: unknown) {
  const url = new URL(`http://localhost:3400/api/oversight/${path}`);
  const headers: Record<string, string> = { cookie };
  if (method === "POST") headers.origin = APP;
  if (body !== undefined) headers["content-type"] = "application/json";
  const request = new NextRequest(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const context = { params: Promise.resolve({ path: url.pathname.replace(/^\/api\/oversight\//, "").split("/") }) };
  return method === "GET" ? GET(request, context) : POST(request, context);
}

async function signedIn(): Promise<string> {
  return `jo-session=${await sealSession(READER, SESSION_KEYS)}`;
}

/** The people-level reads an admin has: the @ list, scorecards, a person card, Governance and rule settings. */
const PEOPLE_LEVEL = ["people/directory", "people/scorecard", `people/${ADA}/card`, "access-log", "usage", "rules/settings"];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetSampleClock();
  resetSampleSync();
  resetSampleRuleSettings();
});

describe("everyone-admin, the default: everyone who signs in is an admin", () => {
  it("reads every board, whatever their Jira opens, and the board list holds them all", async () => {
    stubAuthEnv({ ...SAMPLE, ACCESS_MODE: "" });
    const cookie = await signedIn();
    expect((await call("GET", "overview", `${cookie}; jo-board=MOB`)).status).toBe(200);
    const projects = projectsSchema.parse(await (await call("GET", "projects", cookie)).json());
    expect(projects.projects.map((board) => board.key)).toEqual(["DEMO", "MOB", "HELP"]);
    const portfolio = portfolioSchema.parse(await (await call("GET", "portfolio", cookie)).json());
    expect(portfolio.boards.map((board) => board.project.key)).toEqual(["DEMO", "MOB"]);
    expect(portfolio.boards_not_synced).toBe(1);
  });

  it("reads at people level: the @ list, scorecards, person cards, Governance and rule settings", async () => {
    stubAuthEnv({ ...SAMPLE, ACCESS_MODE: "everyone-admin" });
    const cookie = await signedIn();
    for (const path of PEOPLE_LEVEL) expect((await call("GET", path, cookie)).status, path).toBe(200);
    const answer = askResponseSchema.parse(
      await (await call("POST", "ask", cookie, { question: "What are @Ada Brooks's open findings?", mentions: [ADA] })).json(),
    );
    expect(answer.people.map((person) => person.id)).toContain(ADA);
  });

  it("still names the reader to the service's access log, at people level", async () => {
    stubAuthEnv({ OVERSIGHT_DATA: "live", OVERSIGHT_API_URL: "http://oversight.internal:3300", OVERSIGHT_SERVICE_KEY: "svc-key", ACCESS_MODE: "" });
    const upstream = vi.fn<typeof fetch>(async () => new Response("{}", { status: 503 }));
    vi.stubGlobal("fetch", upstream);
    await call("GET", `findings?person=${ADA}`, `${await signedIn()}; jo-board=MOB`);
    const [input, init] = upstream.mock.calls[0];
    const url = new URL(String(input));
    expect(url.searchParams.get("project")).toBe("MOB");
    expect(url.searchParams.get("level")).toBe("people");
    const headers = new Headers(init?.headers);
    expect(headers.get("x-oversight-viewer")).toBe(viewerHash(READER.sub, SECRET));
    expect(decodeURIComponent(headers.get("x-oversight-viewer-name") ?? "")).toBe("Robin Okafor");
  });
});

describe("admin-list: admins are ADMIN_EMAILS, everyone else a user, as before", () => {
  it("holds a user to their own boards, at team level, with no Governance", async () => {
    stubAuthEnv({ ...SAMPLE, ACCESS_MODE: "admin-list" });
    const cookie = await signedIn();
    const refused = apiErrorBodySchema.parse(await (await call("GET", "overview", `${cookie}; jo-board=MOB`)).json());
    expect(refused.error).toBe("board_not_allowed");
    const projects = projectsSchema.parse(await (await call("GET", "projects", cookie)).json());
    expect(projects.projects.map((board) => board.key)).toEqual(["DEMO"]);
    for (const path of PEOPLE_LEVEL) {
      const response = await call("GET", path, cookie);
      expect(response.status, path).toBe(403);
      expect(apiErrorBodySchema.parse(await response.json()).error, path).toBe("people_not_allowed");
    }
  });
});
