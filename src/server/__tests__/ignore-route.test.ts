// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GET, POST } from "@/app/api/oversight/[...path]/route";
import { apiErrorBodySchema } from "@/lib/api/schemas";

import findingJson from "../../../docs/sample-responses/finding.json";
import findingsJson from "../../../docs/sample-responses/findings.json";
import issueJson from "../../../docs/sample-responses/issue-DEMO-1.json";
import { sealSession } from "../auth/cookies";
import { SESSION_KEYS, stubAuthEnv } from "../auth/__tests__/fixtures";
import { ignorePost, resolveGet, resolvePost, type Resolution } from "../endpoints";
import { IGNORE_MISSING } from "../live";
import { resetSampleIgnores } from "../sample/ignores";

const ORIGIN = "http://localhost:3400";
const LIVE = { OVERSIGHT_DATA: "live", OVERSIGHT_API_URL: "http://oversight.internal:3300", OVERSIGHT_SERVICE_KEY: "svc-key", AUTH_MODE: "off" };
const SAMPLE = { OVERSIGHT_DATA: "sample", SAMPLE_NOW: "2026-11-04T14:30:00Z", SAMPLE_LATENCY: "0" };
const none = new URLSearchParams();
const META = { ...findingsJson.meta, data_mode: "live" };
const IGNORED_AT = "2026-11-04T14:30:00.000Z";
const IGNORE = { scope: "finding", rule_id: "R-EST-01", reason: "Old work", by: "Morgan Ellis", at: IGNORED_AT, ignore_id: "a".repeat(32) };

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetSampleIgnores();
});

function accepted(resolution: Resolution) {
  if (!resolution.ok) throw new Error(`refused: ${resolution.status} ${resolution.message}`);
  return resolution.value;
}

const params = (url: URL) => ({ params: Promise.resolve({ path: url.pathname.replace(/^\/api\/oversight\//, "").split("/") }) });

function read(path: string, cookie?: string) {
  const url = new URL(`${ORIGIN}/api/oversight/${path}`);
  return GET(new NextRequest(url, { headers: cookie ? { cookie } : {} }), params(url));
}

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const url = new URL(`${ORIGIN}/api/oversight/${path}`);
  return POST(new NextRequest(url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", origin: ORIGIN, ...headers } }), params(url));
}

describe("the allowlist", () => {
  it("tells the ignore POSTs apart by their path, and no other path under findings takes a body", () => {
    expect(ignorePost(["findings", "ignore"])).toBe("ignore");
    expect(ignorePost(["findings", "ignore", "preview"])).toBe("ignore_preview");
    expect(ignorePost(["findings", "restore"])).toBe("restore");
    for (const path of [["findings"], ["findings", "ignored"], ["findings", "ignore", "all"], ["ignore"], ["findings", "restore", "x"]]) expect(ignorePost(path)).toBeNull();
    expect(resolvePost(["findings", "ignored"], none, {}).ok).toBe(false);
  });

  it("reads the ignored list as its own route, never as a finding's id, its query rebuilt", () => {
    expect(accepted(resolveGet(["findings", "ignored"], new URLSearchParams("q=DEMO-12&rule=R-FLOW-02&rule=R-EST-01&page=1")))).toEqual({
      route: { name: "ignored", query: { rule: ["R-EST-01", "R-FLOW-02"], q: "DEMO-12", sort: "at", order: "desc", page: 1, page_size: 25 }, level: "team" },
      upstream: "findings/ignored?rule=R-EST-01&rule=R-FLOW-02&q=DEMO-12",
    });
    expect(accepted(resolveGet(["findings", findingJson.finding.finding_id], none)).route.name).toBe("finding");
  });

  it("rebuilds each body from what it checked: ids once and in order, the filters canonical, the reason plain", () => {
    expect(accepted(resolvePost(["findings", "ignore"], none, { target: { query: { epic: [], ticket: "finished", first_seen: "all" } }, scope: "ticket", reason: "  Old\nwork " })).route).toEqual({
      name: "ignore",
      level: "team",
      body: { target: { query: { ticket: "finished" } }, scope: "ticket", reason: "Old work" },
    });
    expect(accepted(resolvePost(["findings", "restore"], none, { ignore_ids: ["b", "a", "a"] })).route).toEqual({ name: "restore", level: "team", body: { ignore_ids: ["a", "b"] } });
    const refused = resolvePost(["findings", "ignore", "preview"], none, { target: { issue_keys: ["DEMO-1"] }, scope: "finding" });
    expect(refused.ok ? null : [refused.status, refused.error, refused.issues?.[0]?.path]).toEqual([400, "bad_request", "scope"]);
  });
});

describe("who ignored a finding, below the people level", () => {
  it("is never named to a user with sign-in on, on the list, the finding or the ticket", async () => {
    // Ignored with sign-in off, read by the local reader (people level), then by a user once sign-in is on.
    for (const [name, value] of Object.entries({ ...SAMPLE, AUTH_MODE: "off" })) vi.stubEnv(name, value);
    expect((await post("findings/ignore", { target: { query: { ticket: "finished", rule: ["R-EST-01"] } }, scope: "finding", reason: "Old" })).status).toBe(200);
    const named = (await (await read("findings?state=ignored")).json()) as { items: { finding_id: string; issue_key: string; ignore: { by: string | null } }[] };
    expect(named.items.length).toBeGreaterThan(0);
    expect(named.items.every((finding) => finding.ignore.by === "Local (sign-in off)")).toBe(true);

    vi.unstubAllEnvs();
    stubAuthEnv(SAMPLE);
    const user = `jo-session=${await sealSession({ sub: "557058:account", dom: "stellainternational.com", site: "cloud-id", eh: "h".repeat(43), boards: ["DEMO"] }, SESSION_KEYS)}`;
    const list = (await (await read("findings?state=ignored", user)).json()) as typeof named;
    expect(list.items.length).toBe(named.items.length);
    expect(list.items.every((finding) => finding.ignore.by === null)).toBe(true);
    const [first] = list.items;
    const detail = (await (await read(`findings/${first.finding_id}`, user)).json()) as { finding: { ignore: { by: string | null; reason: string } } };
    expect(detail.finding.ignore).toMatchObject({ by: null, reason: "Old" });
    const ticket = (await (await read(`issues/${first.issue_key}/timeline`, user)).json()) as { findings: { ignore: { by: string | null } | null }[] };
    expect(ticket.findings.filter((finding) => finding.ignore !== null).every((finding) => finding.ignore?.by === null)).toBe(true);
  });
});

describe("live mode", () => {
  beforeEach(() => {
    for (const [name, value] of Object.entries(LIVE)) vi.stubEnv(name, value);
  });

  function service(answer: (url: URL, init: RequestInit | undefined) => Response) {
    const upstream = vi.fn<typeof fetch>(async (input, init) => answer(new URL(String(input)), init));
    vi.stubGlobal("fetch", upstream);
    return upstream;
  }

  it("asks the finding and the ticket at the reader's level, so the service names who ignored only for an admin", async () => {
    const upstream = service((url) => Response.json(url.pathname.includes("/issues/") ? { ...issueJson, meta: META } : { ...findingJson, meta: META }));
    await read(`findings/${findingJson.finding.finding_id}`);
    await read("issues/DEMO-1/timeline");
    for (const [input] of upstream.mock.calls) expect(new URL(String(input)).searchParams.get("level")).toBe("people");
  });

  it("forwards the ignored list's query rebuilt, with the level, and checks what comes back", async () => {
    const item = {
      ignore_id: "b".repeat(32), scope: "ticket", issue_key: "DEMO-12", issue_summary: null, issue_type: null, status: null,
      status_category: null, rule_id: null, rule_title: null, findings: 3, reason: null, by: "Morgan Ellis", at: IGNORED_AT,
    };
    const upstream = service(() => Response.json({ meta: META, items: [item], total: 1, page: 1, page_size: 25 }));
    const response = await read("findings/ignored?order=asc&q=DEMO-12");
    expect(response.status).toBe(200);
    expect(String(upstream.mock.calls[0][0])).toBe("http://oversight.internal:3300/api/v1/findings/ignored?q=DEMO-12&order=asc&level=people");
    service(() => Response.json({ meta: META, items: [{ ...item, rule_id: "R-EST-01" }], total: 1, page: 1, page_size: 25 }));
    expect((await read("findings/ignored")).status).toBe(502);
  });

  it("says a service from before ignoring is one, and passes a refusal on in plain words", async () => {
    service(() => Response.json({ detail: "Not Found" }, { status: 404 }));
    const missing = apiErrorBodySchema.parse(await (await post("findings/ignore/preview", { target: { finding_ids: ["a".repeat(32)] }, scope: "finding" })).json());
    expect(missing).toMatchObject({ error: "upstream_error", message: IGNORE_MISSING });

    service(() => Response.json({ detail: [{ loc: ["body", "target"], msg: "Too many findings at once." }] }, { status: 422 }));
    const refused = await post("findings/ignore", { target: { finding_ids: ["a".repeat(32)] }, scope: "finding" });
    expect(refused.status).toBe(400);
    expect(apiErrorBodySchema.parse(await refused.json())).toMatchObject({ error: "bad_request", message: "Too many findings at once." });
  });

  it("takes a finding ignored with the service's own words for who and why, never an email address", async () => {
    const finding = { ...findingJson.finding, state: "ignored", resolved_at: IGNORED_AT, resolved_why: "ignored", ignore: { ...IGNORE, by: "jane.doe@example.org", reason: "Asked by jane.doe@example.org" } };
    service(() => Response.json({ ...findingJson, meta: META, finding }));
    const body = (await (await read(`findings/${findingJson.finding.finding_id}`)).json()) as { finding: { ignore: { by: string; reason: string } } };
    expect(JSON.stringify(body)).not.toContain("jane.doe@example.org");
    expect(body.finding.ignore).toMatchObject({ by: "Signed-in user", reason: "Asked by (email address removed)" });
  });
});
