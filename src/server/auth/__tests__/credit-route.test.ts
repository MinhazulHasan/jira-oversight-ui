// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GET, PUT } from "@/app/api/oversight/[...path]/route";
import { apiErrorBodySchema, peopleCreditSchema } from "@/lib/api/schemas";

import { resetSampleClock } from "../../sample/clock";
import { creditRevisionOf, resetSampleCredit } from "../../sample/credit-store";
import { sealSession } from "../cookies";
import { emailHash } from "../roles";

import { APP, SECRET, SESSION_KEYS, stubAuthEnv } from "./fixtures";

const NOW = "2026-11-04T14:30:00Z";
const IDENTITY = { sub: "557058:account", dom: "stellainternational.com", site: "cloud-id", eh: "hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh", boards: ["DEMO"] };
const LEAD = "lead@stellainternational.com";
const CHANGE = { source: "assignee", field: null, revision: 0 };

const params = (url: URL) => ({ params: Promise.resolve({ path: url.pathname.replace(/^\/api\/oversight\//, "").split("/") }) });

function read(cookie?: string) {
  const url = new URL(`${APP}/api/oversight/people/credit`);
  return GET(new NextRequest(url, { headers: cookie ? { cookie } : {} }), params(url));
}

function put(body: unknown, { origin = APP, cookie, base = APP }: { origin?: string; cookie?: string; base?: string } = {}) {
  const url = new URL(`${base}/api/oversight/people/credit`);
  const headers: Record<string, string> = { "content-type": "application/json", origin };
  if (cookie) headers.cookie = cookie;
  return PUT(new NextRequest(url, { method: "PUT", body: JSON.stringify(body), headers }), params(url));
}

async function expectProblem(response: Response, status: number, error: string) {
  expect(response.status).toBe(status);
  const body = apiErrorBodySchema.parse(await response.json());
  expect(body.error).toBe(error);
  return body;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetSampleClock();
  resetSampleCredit();
});

describe("the credit setting with sign-in on", () => {
  beforeEach(() => stubAuthEnv({ OVERSIGHT_DATA: "sample", SAMPLE_NOW: NOW, SAMPLE_LATENCY: "0" }));

  it("refuses a user (team level) the setting and every change, before the sample is asked anything", async () => {
    const session = `jo-session=${await sealSession(IDENTITY, SESSION_KEYS)}`;
    expect((await expectProblem(await read(session), 403, "people_not_allowed")).message).toBe("Only admins can see how finished work is counted.");
    expect((await expectProblem(await put(CHANGE, { cookie: session }), 403, "people_not_allowed")).message).toBe(
      "Only admins can change how finished work is counted.",
    );
    expect(creditRevisionOf("DEMO")).toBe(0);
  });

  it("refuses anyone without a session", async () => {
    await expectProblem(await read(), 401, "unauthenticated");
    await expectProblem(await put(CHANGE), 401, "unauthenticated");
  });

  it("lets an admin read and change it from APP_URL's origin and no other, recorded under their name", async () => {
    vi.stubEnv("ADMIN_EMAILS", LEAD);
    const session = `jo-session=${await sealSession({ ...IDENTITY, name: "Morgan Ellis", eh: emailHash(LEAD, SECRET) }, SESSION_KEYS)}`;
    expect((await read(session)).status).toBe(200);
    await expectProblem(await put(CHANGE, { base: "http://127.0.0.1:3400", origin: "http://127.0.0.1:3400", cookie: session }), 403, "forbidden");
    const saved = peopleCreditSchema.parse(await (await put(CHANGE, { cookie: session })).json());
    expect(saved.setting).toMatchObject({ source: "assignee", revision: 1, changed_by: "Morgan Ellis" });
  });

  it("refuses a user in live mode without asking the service anything", async () => {
    stubAuthEnv({ OVERSIGHT_DATA: "live", OVERSIGHT_API_URL: "http://oversight.internal:3300", OVERSIGHT_SERVICE_KEY: "svc-key" });
    const upstream = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", upstream);
    const session = `jo-session=${await sealSession(IDENTITY, SESSION_KEYS)}`;
    await expectProblem(await read(session), 403, "people_not_allowed");
    await expectProblem(await put(CHANGE, { cookie: session }), 403, "people_not_allowed");
    expect(upstream).not.toHaveBeenCalled();
  });
});
