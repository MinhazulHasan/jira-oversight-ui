// @vitest-environment node
import { describe, expect, it } from "vitest";

import { healthy } from "../../../scripts/healthcheck.mjs";

/** The dashboard container's health check (scripts/healthcheck.mjs, the */

const KEY = "k".repeat(64);
const LIVE = { PORT: "3400", OVERSIGHT_DATA: "live", OVERSIGHT_API_URL: "http://api:3300", OVERSIGHT_SERVICE_KEY: KEY };

type Answer = { status: number; body: string };

/** A fake network: the dashboard's own route answers `own`; the API answers `api` when the key matches, 401 otherwise. */
function network(own: number, api: Answer | null) {
  const asked: { url: string; headers: Record<string, string> }[] = [];
  const ask = async (url: URL, headers: Record<string, string> = {}): Promise<Answer> => {
    asked.push({ url: url.href, headers });
    if (url.pathname === "/api/oversight/health") return { status: own, body: "" };
    if (api === null) return { status: 0, body: "" }; // nothing listening
    return headers["x-service-key"] === KEY ? api : { status: 401, body: '{"detail":"missing or wrong service key"}' };
  };
  return { ask, asked };
}

const OK = { status: 200, body: '{"status":"ok"}' };

describe("the dashboard's health check", () => {
  it("is healthy with sign-in on (401) when the API answers the dashboard's own key", async () => {
    const { ask, asked } = network(401, OK);
    expect(await healthy(LIVE, ask)).toBe(true);
    expect(asked.map((call) => call.url)).toEqual(["http://127.0.0.1:3400/api/oversight/health", "http://api:3300/api/v1/health"]);
    expect(asked[1].headers["x-service-key"]).toBe(KEY);
    expect(await healthy(LIVE, network(401, { status: 200, body: '{"status":"degraded"}' }).ask)).toBe(true);
  });

  it("is unhealthy when the API is down, refuses the key, or answers anything else", async () => {
    expect(await healthy(LIVE, network(401, null).ask)).toBe(false); // stopped, or unreachable
    expect(await healthy({ ...LIVE, OVERSIGHT_SERVICE_KEY: "w".repeat(64) }, network(401, OK).ask)).toBe(false); // a key that does not match
    expect(await healthy(LIVE, network(401, { status: 503, body: "" }).ask)).toBe(false);
    expect(await healthy(LIVE, network(401, { status: 200, body: "<html>" }).ask)).toBe(false);
    expect(await healthy({ ...LIVE, OVERSIGHT_SERVICE_KEY: "" }, network(401, OK).ask)).toBe(false);
  });

  it("is unhealthy when sign-in is on but not configured (500), or the server does not answer", async () => {
    expect(await healthy(LIVE, network(500, OK).ask)).toBe(false);
    expect(await healthy(LIVE, network(0, OK).ask)).toBe(false);
  });

  it("asks no API for the bundled sample, and keeps a base URL's path", async () => {
    const sample = network(200, null);
    expect(await healthy({ PORT: "3400", OVERSIGHT_DATA: "sample" }, sample.ask)).toBe(true);
    expect(sample.asked).toHaveLength(1);
    const prefixed = network(401, OK);
    expect(await healthy({ ...LIVE, OVERSIGHT_API_URL: "http://api:3300/oversight" }, prefixed.ask)).toBe(true);
    expect(prefixed.asked[1].url).toBe("http://api:3300/oversight/api/v1/health");
  });
});
