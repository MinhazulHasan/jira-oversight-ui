// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { Projects } from "@/lib/api/schemas";

import { MAX_KEYS_PER_SEARCH, fetchBoardAccess } from "../auth/atlassian";
import { projectsFor, servedBoards } from "../boards";
import { readConfig } from "../env";
import { resetSampleClock } from "../sample/clock";

const BOARDS: Projects = {
  default: "BRAVO",
  projects: [
    { key: "ALPHA", name: "Alpha", issues: 120, last_synced_at: "2026-11-10T10:00:00Z", synced: true, type: "software" },
    { key: "BRAVO", name: "Bravo", issues: 640, last_synced_at: "2026-11-10T10:00:00Z", synced: true, type: "business" },
    { key: "CHARLIE", name: "Charlie", issues: 0, last_synced_at: null, synced: false, type: null },
  ],
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetSampleClock();
});

describe("the boards the dashboard serves", () => {
  it("is the sample's boards on sample data, its default first, the one not synced yet too (JO-17)", async () => {
    expect(await servedBoards(readConfig({ OVERSIGHT_DATA: "sample", SAMPLE_NOW: "2026-11-04T14:30:00Z" }))).toEqual(["DEMO", "MOB", "HELP"]);
  });

  it("comes from the live service, its default first", async () => {
    const upstream = vi.fn<typeof fetch>(async () => Response.json(BOARDS));
    vi.stubGlobal("fetch", upstream);
    const config = readConfig({ OVERSIGHT_DATA: "live", OVERSIGHT_API_URL: "http://oversight.internal:3300", OVERSIGHT_SERVICE_KEY: "svc-key" });
    expect(await servedBoards(config)).toEqual(["BRAVO", "ALPHA", "CHARLIE"]);
    expect(String(upstream.mock.calls[0][0])).toBe("http://oversight.internal:3300/api/v1/projects");
  });

  it("lists each board once, even when the service repeats one", async () => {
    const repeated = { ...BOARDS, projects: [...BOARDS.projects, BOARDS.projects[0], BOARDS.projects[1]] };
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => Response.json(repeated)));
    const config = readConfig({ OVERSIGHT_DATA: "live", OVERSIGHT_API_URL: "http://oversight.internal:3300", OVERSIGHT_SERVICE_KEY: "svc-key" });
    expect(await servedBoards(config)).toEqual(["BRAVO", "ALPHA", "CHARLIE"]);
  });

  it("is unknown when the live service cannot say", async () => {
    const config = readConfig({ OVERSIGHT_DATA: "live", OVERSIGHT_API_URL: "http://oversight.internal:3300", OVERSIGHT_SERVICE_KEY: "svc-key" });
    for (const answer of [new TypeError("fetch failed"), new Response("{}", { status: 500 }), Response.json({ default: "BRAVO", projects: [] })]) {
      vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => (answer instanceof Error ? Promise.reject(answer) : answer)));
      expect(await servedBoards(config)).toBeNull();
    }
  });
});

describe("the board list cut down to one person's boards", () => {
  it("keeps their boards in the service's order, and the service's default when it is one of them", () => {
    expect(projectsFor(BOARDS, ["CHARLIE", "BRAVO"])).toEqual({ default: "BRAVO", projects: [BOARDS.projects[1], BOARDS.projects[2]] });
  });

  it("otherwise defaults to their first board", () => {
    expect(projectsFor(BOARDS, ["CHARLIE", "ALPHA"])).toEqual({ default: "CHARLIE", projects: [BOARDS.projects[0], BOARDS.projects[2]] });
  });

  it("skips boards of theirs the service no longer serves, and has nothing when none is left", () => {
    expect(projectsFor(BOARDS, ["GONE", "ALPHA"])).toEqual({ default: "ALPHA", projects: [BOARDS.projects[0]] });
    expect(projectsFor(BOARDS, ["GONE"])).toBeNull();
  });
});

describe("which boards Jira opens for the person", () => {
  const CONFIG = { apiBase: new URL("https://api.atlassian.com/") };

  it("asks Jira's project search on the person's site, as the person, and reads the keys back", async () => {
    const upstream = vi.fn<typeof fetch>(async () => Response.json({ isLast: true, values: [{ key: "ALPHA" }, { key: "bravo" }] }));
    vi.stubGlobal("fetch", upstream);
    const result = await fetchBoardAccess(CONFIG, "token-1", "cloud/id", ["ALPHA", "BRAVO", "CHARLIE"]);
    expect(result).toEqual({ ok: true, keys: new Set(["ALPHA", "BRAVO"]) });
    const [input, init] = upstream.mock.calls[0];
    const url = new URL(String(input));
    expect(url.origin + url.pathname).toBe("https://api.atlassian.com/ex/jira/cloud%2Fid/rest/api/3/project/search");
    expect(url.searchParams.getAll("keys")).toEqual(["ALPHA", "BRAVO", "CHARLIE"]);
    // Projects whose issues the account can see, not merely administer.
    expect(url.searchParams.get("action")).toBe("browse");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer token-1");
    expect(init?.redirect).toBe("manual");
  });

  it("asks fifty keys at a time, Jira's limit", async () => {
    const upstream = vi.fn<typeof fetch>(async (input) => {
      const keys = new URL(String(input)).searchParams.getAll("keys");
      return Response.json({ isLast: true, values: keys.map((key) => ({ key })) });
    });
    vi.stubGlobal("fetch", upstream);
    const keys = Array.from({ length: 120 }, (_, i) => `K${i + 10}`);
    const result = await fetchBoardAccess(CONFIG, "token-1", "cloud-1", keys);
    expect(upstream).toHaveBeenCalledTimes(3);
    expect(upstream.mock.calls.map(([input]) => new URL(String(input)).searchParams.getAll("keys").length)).toEqual([MAX_KEYS_PER_SEARCH, MAX_KEYS_PER_SEARCH, 20]);
    expect(result.ok && result.keys.size).toBe(120);
  });

  it("says which step failed, and nothing Jira said", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => new Response("secret detail", { status: 401 })));
    expect(await fetchBoardAccess(CONFIG, "token-1", "cloud-1", ["ALPHA"])).toEqual({ ok: false, reason: "atlassian", step: "projects", status: 401 });
  });
});
