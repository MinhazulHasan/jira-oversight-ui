// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GET, POST } from "@/app/api/oversight/[...path]/route";
import { apiErrorBodySchema, ruleSettingsPreviewSchema, ruleSettingsSchema } from "@/lib/api/schemas";

import { resetSampleClock } from "../../sample/clock";
import { boardSettings, resetSampleRuleSettings, revisionOf } from "../../sample/settings-store";
import { sealSession } from "../cookies";
import { emailHash } from "../roles";

import { APP, SECRET, SESSION_KEYS, stubAuthEnv } from "./fixtures";

/*
 * Rule settings (JO-15) at the oversight route: an admin's alone (a reader Ask
 * answers at team level is refused before the sample or the service is asked
 * anything), and a change only from this dashboard's own pages, as JSON (its
 * Origin is held to APP_URL with sign-in on, to the host the browser addressed
 * with it off), so a page on another site can change nothing in an admin's
 * name.
 */

const NOW = "2026-11-04T14:30:00Z";
const SAMPLE = { OVERSIGHT_DATA: "sample", SAMPLE_NOW: NOW, SAMPLE_LATENCY: "0", AUTH_MODE: "off" };
const IDENTITY = { sub: "557058:account", dom: "stellainternational.com", site: "cloud-id", eh: "hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh", boards: ["DEMO"] };
const LEAD = "lead@stellainternational.com";
const CHANGE = { revision: 0, changes: [{ rule_id: "R-EFF-01", params: { threshold: 2 } }] };
const PREVIEW = { changes: CHANGE.changes };

const params = (url: URL) => ({ params: Promise.resolve({ path: url.pathname.replace(/^\/api\/oversight\//, "").split("/") }) });

function read(path: string, { cookie, base = "http://localhost:3400" }: { cookie?: string; base?: string } = {}) {
  const url = new URL(`${base}/api/oversight/${path}`);
  return GET(new NextRequest(url, { headers: cookie ? { cookie } : {} }), params(url));
}

interface Sent {
  origin?: string | null;
  type?: string;
  cookie?: string;
  /** The address the request's URL names: as Next.js builds it, the one the server is bound to. */
  base?: string;
  /** More headers, such as the Host the browser addressed, or a proxy's X-Forwarded-Host. */
  headers?: Record<string, string>;
  raw?: string;
}

/** A change as the page sends it (JSON, from the dashboard's own origin), or as anything else might. */
function change(path: string, body: unknown, { origin = "http://localhost:3400", type = "application/json", cookie, base = "http://localhost:3400", headers: more, raw }: Sent = {}) {
  const url = new URL(`${base}/api/oversight/${path}`);
  const headers: Record<string, string> = { "content-type": type, ...more };
  if (origin !== null) headers.origin = origin;
  if (cookie) headers.cookie = cookie;
  return POST(new NextRequest(url, { method: "POST", body: raw ?? JSON.stringify(body), headers }), params(url));
}

async function expectProblem(response: Response, status: number, error: string) {
  expect(response.status).toBe(status);
  const body = apiErrorBodySchema.parse(await response.json());
  expect(body.error).toBe(error);
  return body;
}

function stub(env: Record<string, string>) {
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetSampleClock();
  resetSampleRuleSettings();
});

describe("rule settings with sign-in off (people level), on the sample", () => {
  beforeEach(() => stub(SAMPLE));

  it("reads the board's settings, previews a change without saving it, and saves it as the next revision", async () => {
    const shown = await read("rules/settings");
    expect(shown.status).toBe(200);
    expect(shown.headers.get("cache-control")).toBe("no-store");
    expect(ruleSettingsSchema.parse(await shown.json()).revision).toBe(0);

    const previewed = await change("rules/settings/preview", PREVIEW);
    expect(previewed.status).toBe(200);
    expect(ruleSettingsPreviewSchema.parse(await previewed.json()).impact.map((impact) => impact.rule_id)).toEqual(["R-EFF-01"]);
    expect(revisionOf(boardSettings())).toBe(0);

    const saved = ruleSettingsSchema.parse(await (await change("rules/settings", { ...CHANGE, reason: "Agreed with the team" })).json());
    expect(saved.revision).toBe(1);
    expect(saved.history[0]).toMatchObject({ revision: 1, by: { hash: "local", name: "Local (sign-in off)" }, reason: "Agreed with the team" });
    expect(saved.history[0].changes).toEqual([{ rule_id: "R-EFF-01", field: "params.threshold", from: 1.5, to: 2 }]);
  });

  it("refuses a change from anywhere but this dashboard's own pages, before anything is read or saved", async () => {
    const elsewhere = [{ origin: null }, { origin: "https://evil.example" }, { origin: "null" }, { origin: "http://localhost:3401" }, { origin: "http://localhost:3400/governance/rules" }];
    for (const sent of elsewhere) {
      const body = await expectProblem(await change("rules/settings", CHANGE, sent), 403, "forbidden");
      expect(body.message, JSON.stringify(sent)).toBe("Rule settings can be changed only from this dashboard's own pages, so nothing was changed.");
      await expectProblem(await change("rules/settings/preview", PREVIEW, sent), 403, "forbidden");
    }
    for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", ""]) {
      const body = await expectProblem(await change("rules/settings", CHANGE, { type }), 403, "forbidden");
      expect(body.message).toBe("Rule settings are changed with a JSON body, so nothing was changed.");
    }
    expect(revisionOf(boardSettings())).toBe(0);
  });

  it("holds the Origin to the host the browser addressed, never the address the server is bound to", async () => {
    // As Next.js builds the request's URL behind `next start -H 0.0.0.0` (the container's HOSTNAME), whatever the
    // browser used: only the Host header (or a proxy's X-Forwarded-Host) says what that was.
    const bound = (origin: string, headers: Record<string, string>) =>
      change("rules/settings/preview", PREVIEW, { base: "http://0.0.0.0:3400", origin, headers });
    expect((await bound("http://localhost:3400", { host: "localhost:3400" })).status).toBe(200);
    expect((await bound("http://127.0.0.1:3400", { host: "127.0.0.1:3400" })).status).toBe(200);
    expect((await bound("http://OVERSIGHT-MAC.local:3400", { host: "oversight-mac.local:3400" })).status).toBe(403);
    expect((await bound("http://oversight-mac.local:3400", { host: "Oversight-Mac.local:3400" })).status).toBe(200);
    // Behind a proxy that ends TLS: the first X-Forwarded-Host it names is what the browser addressed, by https.
    const proxied = { host: "0.0.0.0:3400", "x-forwarded-host": "oversight.example.com, 10.0.0.5:3400" };
    expect((await bound("https://oversight.example.com", proxied)).status).toBe(200);
    expect((await bound("https://oversight.example.com:443", proxied)).status).toBe(403);
    // A page on another site, the bind address itself, a proxy naming another host: never this dashboard's pages.
    for (const [origin, headers] of [
      ["https://evil.example", { host: "localhost:3400" }],
      ["http://0.0.0.0:3400", { host: "localhost:3400" }],
      ["http://localhost:3400", { host: "localhost:3400", "x-forwarded-host": "evil.example" }],
    ] as const) {
      const refused = await expectProblem(await bound(origin, headers), 403, "forbidden");
      expect(refused.message, origin).toBe("Rule settings can be changed only from this dashboard's own pages, so nothing was changed.");
    }
    expect(revisionOf(boardSettings())).toBe(0);
  });

  it("takes the request's own host by either scheme, as a proxy that ends TLS in front of it forwards it", async () => {
    const saved = await change("rules/settings", CHANGE, { origin: "https://localhost:3400" });
    expect(saved.status).toBe(200);
    const next = { changes: [{ rule_id: "W-AGE-01", enabled: false }] };
    expect((await change("rules/settings/preview", next, { type: "application/json; charset=utf-8" })).status).toBe(200);
  });

  it("refuses a body it cannot read: far too large, not JSON, or with query parameters", async () => {
    await expectProblem(await change("rules/settings", null, { raw: JSON.stringify({ ...CHANGE, reason: "x".repeat(17 * 1024) }) }), 413, "bad_request");
    await expectProblem(await change("rules/settings", null, { raw: "{changes:" }), 400, "bad_request");
    await expectProblem(await change("rules/settings?project=DEMO", CHANGE), 400, "bad_request");
    await expectProblem(await read("rules/settings?level=people"), 400, "bad_request");
    expect(revisionOf(boardSettings())).toBe(0);
  });

  it("says each problem with a change at its setting, and refuses a save made against a revision the board has left", async () => {
    const invalid = await expectProblem(await change("rules/settings", { revision: 0, changes: [{ rule_id: "W-EFF-01", params: { threshold: 1.6 } }] }), 422, "rule_settings_invalid");
    expect(invalid.issues?.map((issue) => issue.path)).toEqual(["W-EFF-01.params.threshold"]);
    const conflict = await expectProblem(await change("rules/settings", { ...CHANGE, revision: 7 }), 409, "rule_settings_conflict");
    expect(conflict.message).toMatch(/^Someone else changed this board's rule settings/);
    expect(revisionOf(boardSettings())).toBe(0);
  });
});

describe("rule settings with sign-in on", () => {
  beforeEach(() => stubAuthEnv({ OVERSIGHT_DATA: "sample", SAMPLE_NOW: NOW, SAMPLE_LATENCY: "0" }));

  it("refuses a user (team level) the settings and every change, before the sample is asked anything", async () => {
    const session = `jo-session=${await sealSession(IDENTITY, SESSION_KEYS)}`;
    const shown = await expectProblem(await read("rules/settings", { cookie: session }), 403, "people_not_allowed");
    expect(shown.message).toBe("Only admins can see rule settings.");
    for (const [path, body] of [["rules/settings", CHANGE], ["rules/settings/preview", PREVIEW]] as const) {
      const refused = await expectProblem(await change(path, body, { origin: APP, cookie: session }), 403, "people_not_allowed");
      expect(refused.message).toBe("Only admins can change rule settings.");
    }
    expect(revisionOf(boardSettings())).toBe(0);
  });

  it("refuses anyone without a session", async () => {
    await expectProblem(await read("rules/settings"), 401, "unauthenticated");
    await expectProblem(await change("rules/settings", CHANGE, { origin: APP }), 401, "unauthenticated");
  });

  it("lets an admin read and change them, from APP_URL's origin and no other", async () => {
    vi.stubEnv("ADMIN_EMAILS", LEAD);
    const session = `jo-session=${await sealSession({ ...IDENTITY, name: "Morgan Ellis", eh: emailHash(LEAD, SECRET) }, SESSION_KEYS)}`;
    expect((await read("rules/settings", { cookie: session })).status).toBe(200);
    // The request's own origin is not enough with sign-in on: only APP_URL's is this dashboard's.
    await expectProblem(await change("rules/settings", CHANGE, { base: "http://127.0.0.1:3400", origin: "http://127.0.0.1:3400", cookie: session }), 403, "forbidden");
    const saved = ruleSettingsSchema.parse(await (await change("rules/settings", CHANGE, { origin: APP, cookie: session })).json());
    expect(saved.history[0].by.name).toBe("Morgan Ellis");
    expect(saved.history[0].by.hash).toMatch(/^[0-9a-f]{32}$/);
  });

  it("refuses a user in live mode without asking the service anything", async () => {
    stubAuthEnv({ OVERSIGHT_DATA: "live", OVERSIGHT_API_URL: "http://oversight.internal:3300", OVERSIGHT_SERVICE_KEY: "svc-key" });
    const upstream = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", upstream);
    const session = `jo-session=${await sealSession(IDENTITY, SESSION_KEYS)}`;
    await expectProblem(await read("rules/settings", { cookie: session }), 403, "people_not_allowed");
    await expectProblem(await change("rules/settings", CHANGE, { origin: APP, cookie: session }), 403, "people_not_allowed");
    await expectProblem(await change("rules/settings/preview", PREVIEW, { origin: APP, cookie: session }), 403, "people_not_allowed");
    expect(upstream).not.toHaveBeenCalled();
  });
});
