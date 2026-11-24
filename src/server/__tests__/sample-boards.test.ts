// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GET, POST } from "@/app/api/oversight/[...path]/route";
import { normalizeAccessLogQuery, normalizeFindingsQuery, normalizePersonCardQuery, normalizeScorecardQuery } from "@/lib/api/params";
import { apiErrorBodySchema, healthSchema, projectsSchema, refreshSchema, TREND_METRICS, type Refresh } from "@/lib/api/schemas";

import { RESPONSE_SCHEMAS, type JsonRoute } from "../endpoints";
import { sampleResponse } from "../sample";
import { SUGGESTED_QUESTIONS } from "../sample/ask/scripts";
import { DEFAULT_BOARD, SAMPLE_BOARDS, sampleBoard } from "../sample/boards";
import { resetSampleClock } from "../sample/clock";
import { buildDataset, CATALOGUE_SETTINGS } from "../sample/dataset";
import { boardsAround } from "../sample/served";
import { resetSampleRuleSettings } from "../sample/settings-store";
import { resetSampleSync, SAMPLE_SYNC_COOLDOWN_MS, SAMPLE_SYNC_MIN_MS } from "../sample/sync";
import { personIdFor } from "../sample/team";

const NOW = "2026-11-04T14:30:00Z";
const MOB = sampleBoard("MOB")!;
const HELP = sampleBoard("HELP")!;

function call(method: "GET" | "POST", path: string, board?: string) {
  const url = new URL(`http://localhost:3400/api/oversight/${path}`);
  const headers: Record<string, string> = board ? { cookie: `jo-board=${board}` } : {};
  if (method === "POST") headers.origin = url.origin;
  const request = new NextRequest(url, { method, headers });
  const context = { params: Promise.resolve({ path: url.pathname.replace(/^\/api\/oversight\//, "").split("/") }) };
  return method === "GET" ? GET(request, context) : POST(request, context);
}

async function sync(method: "GET" | "POST", board: string): Promise<Refresh> {
  const response = await call(method, "refresh", board);
  expect(response.status).toBe(200);
  return refreshSchema.parse(await response.json());
}

beforeEach(() => {
  for (const [name, value] of Object.entries({ OVERSIGHT_DATA: "sample", SAMPLE_NOW: NOW, SAMPLE_LATENCY: "0", AUTH_MODE: "off" })) vi.stubEnv(name, value);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  resetSampleClock();
  resetSampleSync();
  resetSampleRuleSettings();
});

describe("the sample's boards", () => {
  it("are three made-up boards, each with its own seed, sprints and changelog, DEMO the default", () => {
    expect(SAMPLE_BOARDS.map((board) => [board.key, board.syncedAtStart])).toEqual([
      ["DEMO", true],
      ["MOB", true],
      ["HELP", false],
    ]);
    expect(DEFAULT_BOARD.key).toBe("DEMO");
    expect(new Set(SAMPLE_BOARDS.map((board) => board.seed)).size).toBe(3);
    expect(new Set(SAMPLE_BOARDS.map((board) => board.sprintBase)).size).toBe(3);
  });

  it("are listed in the service's order: the default, the synced boards by name, then those not synced yet", async () => {
    const projects = projectsSchema.parse(await (await call("GET", "projects")).json());
    expect(projects.default).toBe("DEMO");
    expect(projects.projects.map(({ key, synced, type }) => ({ key, synced, type }))).toEqual([
      { key: "DEMO", synced: true, type: "software" },
      { key: "MOB", synced: true, type: "software" },
      { key: "HELP", synced: false, type: "service_desk" },
    ]);
    const [, mob, help] = projects.projects;
    expect(mob).toMatchObject({ name: "Mobile app", issues: MOB.issues });
    expect(mob.last_synced_at).not.toBeNull();
    expect(help).toEqual({ key: "HELP", name: "Help desk", issues: 0, last_synced_at: null, synced: false, type: "service_desk" });
  });

  it("serve the board picked: MOB's own figures, keys and meta", async () => {
    const overview = (await (await call("GET", "overview", "MOB")).json()) as { meta: { projects: string[] } };
    expect(overview.meta.projects).toEqual(["MOB"]);
    const findings = (await (await call("GET", "findings?page_size=5", "MOB")).json()) as { items: { issue_key: string | null }[] };
    for (const item of findings.items) if (item.issue_key) expect(item.issue_key).toMatch(/^MOB-\d+$/);
    const health = healthSchema.parse(await (await call("GET", "health", "MOB")).json());
    expect(health.projects).toEqual(["MOB"]);
  });

  it("answer a board the sample does not serve 404 unknown_board, as the service does", async () => {
    const response = await call("GET", "overview", "NOPE");
    expect(response.status).toBe(404);
    expect(apiErrorBodySchema.parse(await response.json()).error).toBe("unknown_board");
  });
});

describe("MOB's responses fit the contract exactly, as DEMO's do", () => {
  const dataset = buildDataset(Date.parse(NOW), CATALOGUE_SETTINGS, MOB);
  const boards = boardsAround(dataset);

  function expectExact(route: JsonRoute): unknown {
    const answer = sampleResponse(dataset, route, 0, { peopleComparison: "on", boards });
    if (!answer.found) throw new Error(`${route.name}: ${answer.message}`);
    const parsed = RESPONSE_SCHEMAS[route.name].safeParse(answer.body);
    expect(parsed.success ? [] : parsed.error.issues.slice(0, 3), route.name).toEqual([]);
    expect(parsed.data, route.name).toStrictEqual(answer.body);
    return answer.body;
  }

  it("for every read a page makes", () => {
    for (const name of ["health", "projects", "overview", "people", "people_directory", "insights", "rules", "baseline", "portfolio"] as const) {
      expectExact({ name });
    }
    expectExact({ name: "usage", level: "people" });
    for (const metric of TREND_METRICS) expectExact({ name: "trend", query: { metric, period: "week", last_n: 12 } });
    for (const state of ["open", "all", "resolved"] as const) expectExact({ name: "findings", query: normalizeFindingsQuery({ state }) });
    const page = expectExact({ name: "findings", query: normalizeFindingsQuery({ state: "all" }) }) as { items: { finding_id: string }[] };
    for (const item of page.items.slice(0, 5)) expectExact({ name: "finding", findingId: item.finding_id });
    for (const num of [1, 2, 3, 40]) expectExact({ name: "issue_timeline", issueKey: `MOB-${num}` });
    expectExact({ name: "people_scorecard", query: normalizeScorecardQuery(), level: "people" });
    expectExact({ name: "person_card", personId: personIdFor("acc-01"), query: normalizePersonCardQuery(), level: "people" });
    expectExact({ name: "access_log", query: normalizeAccessLogQuery(), level: "people" });
    expectExact({ name: "rule_settings", level: "people" });
  });

  it("for every suggested question, at either level, naming MOB's own keys", () => {
    for (const question of [...SUGGESTED_QUESTIONS, "What happened to MOB-1?", "Who has the most open breaches?"]) {
      for (const level of ["team", "people"] as const) {
        const body = expectExact({ name: "ask", question, mentions: [], level }) as { meta: { projects: string[] } };
        expect(body.meta.projects, question).toEqual(["MOB"]);
      }
    }
  });
});

describe("a board that has never synced (HELP)", () => {
  it("answers every board-scoped route 409 board_not_synced, and says nothing of DEMO's", async () => {
    for (const path of ["overview", "findings", "people", "people/directory", "rules", "insights/latest", "baseline/latest", "trends?metric=open_breaches", "rules/settings", "issues/HELP-1/timeline"]) {
      const response = await call("GET", path, "HELP");
      expect(response.status, path).toBe(409);
      const body = apiErrorBodySchema.parse(await response.json());
      expect(body.error, path).toBe("board_not_synced");
    }
  });

  it("is healthy, named, and has no sync time; its sync is idle until asked for", async () => {
    const health = healthSchema.parse(await (await call("GET", "health", "HELP")).json());
    expect(health).toMatchObject({ status: "ok", projects: ["HELP"], last_synced_at: null, data_mode: "sample" });
    expect(await sync("GET", "HELP")).toEqual({ project: "HELP", state: "idle", started_at: null, finished_at: null, message: null });
  });

  it("is counted on the Portfolio, never listed", async () => {
    const portfolio = (await (await call("GET", "portfolio")).json()) as { boards: { project: { key: string } }[]; boards_not_synced: number };
    expect(portfolio.boards.map((board) => board.project.key)).toEqual(["DEMO", "MOB"]);
    expect(portfolio.boards_not_synced).toBe(1);
  });
});

describe("Sync, one board at a time (JO-18)", () => {
  it("runs the board asked for, queues another board's behind it, and HELP serves its own world once its first sync ends", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = Date.parse("2026-11-18T09:00:00Z");
    vi.setSystemTime(start);

    const mob = await sync("POST", "MOB");
    expect(mob).toMatchObject({ project: "MOB", state: "running", finished_at: null });
    // Pressed again while it runs: the same sync, reported.
    expect(await sync("POST", "MOB")).toEqual(mob);
    // Another board: queued behind it, never run beside it.
    expect(await sync("POST", "HELP")).toMatchObject({ project: "HELP", state: "queued", started_at: null });

    vi.setSystemTime(start + SAMPLE_SYNC_MIN_MS);
    expect(await sync("GET", "MOB")).toMatchObject({ project: "MOB", state: "succeeded" });
    const running = await sync("GET", "HELP");
    expect(running).toMatchObject({ project: "HELP", state: "running" });
    expect((await call("GET", "overview", "HELP")).status).toBe(409);

    // A first sync takes longer than another; once it has ended, HELP is a synced board like the others.
    vi.setSystemTime(start + 3 * SAMPLE_SYNC_MIN_MS);
    const done = await sync("GET", "HELP");
    expect(done).toMatchObject({ project: "HELP", state: "succeeded", message: null });
    expect(Date.parse(done.finished_at!)).toBeGreaterThan(Date.parse(done.started_at!));
    const overview = (await (await call("GET", "overview", "HELP")).json()) as { meta: { projects: string[] } };
    expect(overview.meta.projects).toEqual(["HELP"]);
    const projects = projectsSchema.parse(await (await call("GET", "projects")).json());
    expect(projects.projects.map((board) => [board.key, board.synced])).toEqual([
      ["DEMO", true],
      ["HELP", true],
      ["MOB", true],
    ]);
    expect(healthSchema.parse(await (await call("GET", "health", "HELP")).json()).last_synced_at).not.toBeNull();
  });

  it("reports a sync that has just ended, rather than starting another, within the cooldown", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = Date.parse("2026-11-18T09:00:00Z");
    vi.setSystemTime(start);
    await sync("POST", "DEMO");
    vi.setSystemTime(start + SAMPLE_SYNC_MIN_MS + 1_000);
    const ended = await sync("POST", "DEMO");
    expect(ended.state).toBe("succeeded");
    vi.setSystemTime(start + SAMPLE_SYNC_MIN_MS + SAMPLE_SYNC_COOLDOWN_MS + 1_000);
    expect((await sync("POST", "DEMO")).state).toBe("running");
  });

  it("is started only from the dashboard's own pages", async () => {
    const url = new URL("http://localhost:3400/api/oversight/refresh");
    const request = new NextRequest(url, { method: "POST", headers: { origin: "https://evil.example", cookie: "jo-board=HELP" } });
    const response = await POST(request, { params: Promise.resolve({ path: ["refresh"] }) });
    expect(response.status).toBe(403);
    expect((await sync("GET", "HELP")).state).toBe("idle");
  });
});

describe("the sample's boards when a dataset is built on its own", () => {
  it("leave DEMO's story exactly as it was", () => {
    const demo = buildDataset(Date.parse(NOW));
    expect(demo.board.key).toBe("DEMO");
    expect(demo.world.issues).toHaveLength(1150);
    expect(demo.world.issues[0].key).toBe("DEMO-1");
    expect(demo.world.activeSprint.id).toBe(4426);
  });

  it("build MOB and HELP small, from their own seeds", () => {
    for (const board of [MOB, HELP]) {
      const dataset = buildDataset(Date.parse(NOW), CATALOGUE_SETTINGS, board);
      expect(dataset.world.issues).toHaveLength(board.issues);
      expect(dataset.world.issues.every((issue) => issue.key.startsWith(`${board.key}-`))).toBe(true);
      expect(dataset.engine.findings.length).toBeGreaterThan(0);
    }
  });
});
