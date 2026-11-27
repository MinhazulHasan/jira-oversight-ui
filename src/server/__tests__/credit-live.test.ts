// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GET, PUT } from "@/app/api/oversight/[...path]/route";
import { apiErrorBodySchema, peopleCreditSchema } from "@/lib/api/schemas";

import { CREDIT_MISSING, CREDIT_REFUSED, CREDIT_STALE } from "../live";

const LIVE = { OVERSIGHT_DATA: "live", OVERSIGHT_API_URL: "http://oversight.internal:3300", OVERSIGHT_SERVICE_KEY: "svc-key", AUTH_MODE: "off" };
const ORIGIN = "http://localhost:3400";
const BOARD = "jo-board=MJHDASH";

/** The service's answer as 2.4 of the team spec gives it. */
const SERVICE_BODY = {
  meta: {
    data_mode: "live",
    last_synced_at: "2026-11-25T23:00:00Z",
    projects: ["MJHDASH"],
    rules_version: "0.1.0",
    process_version: "0.1.0",
    generated_at: "2026-11-26T09:00:00Z",
    report_timezone: "Europe/London",
  },
  period: { days: 180, from: "2026-05-29T23:00:00Z", to: "2026-11-25T23:00:00Z" },
  setting: { source: "field", field: { key: "programmer", name: "Programmer" }, revision: 2, changed_by: "Morgan Ellis", changed_at: "2026-11-26T08:10:00Z" },
  effective_field: { key: "programmer", name: "Programmer" },
  finished: 475,
  options: [
    { source: "auto", field: null, source_filled: 124, credited: 471 },
    { source: "assignee", field: null, source_filled: 34, credited: 471 },
    { source: "field", field: { key: "code_reviewers", name: "Code Reviewers" }, source_filled: 52, credited: 471 },
    { source: "field", field: { key: "programmer", name: "Programmer" }, source_filled: 124, credited: 471 },
    { source: "field", field: { key: "testers", name: "Testers" }, source_filled: 88, credited: 471 },
  ],
  internal: "never passed on",
};

const params = (url: URL) => ({ params: Promise.resolve({ path: url.pathname.replace(/^\/api\/oversight\//, "").split("/") }) });

function read(path: string) {
  const url = new URL(`${ORIGIN}/api/oversight/${path}`);
  return GET(new NextRequest(url, { headers: { cookie: BOARD } }), params(url));
}

function put(body: unknown) {
  const url = new URL(`${ORIGIN}/api/oversight/people/credit`);
  const headers = { "content-type": "application/json", origin: ORIGIN, cookie: BOARD };
  return PUT(new NextRequest(url, { method: "PUT", body: JSON.stringify(body), headers }), params(url));
}

function service(answer: (url: URL, init: RequestInit | undefined) => Response) {
  const upstream = vi.fn<typeof fetch>(async (input, init) => answer(new URL(String(input)), init));
  vi.stubGlobal("fetch", upstream);
  return upstream;
}

async function expectProblem(response: Response, status: number, error: string) {
  expect(response.status).toBe(status);
  const body = apiErrorBodySchema.parse(await response.json());
  expect(body.error).toBe(error);
  return body;
}

beforeEach(() => {
  for (const [name, value] of Object.entries(LIVE)) vi.stubEnv(name, value);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the credit setting, forwarded to the service", () => {
  it("reads the picked board's setting at people level over the period, naming the reader", async () => {
    const upstream = service(() => Response.json(SERVICE_BODY));
    const response = await read("people/credit?days=180");
    expect(response.status).toBe(200);
    const body = peopleCreditSchema.parse(await response.json());
    expect(body).not.toHaveProperty("internal");
    expect(body.setting).toMatchObject({ source: "field", field: { key: "programmer", name: "Programmer" }, revision: 2 });
    const [url, init] = upstream.mock.calls[0];
    expect(String(url)).toBe("http://oversight.internal:3300/api/v1/people/credit?days=180&project=MJHDASH&level=people");
    expect(init?.method).toBe("GET");
    const headers = new Headers(init?.headers);
    expect([headers.get("x-service-key"), headers.get("x-oversight-viewer")]).toEqual(["svc-key", "local"]);
  });

  it("sends a change as a PUT of the checked choice and revision, never the browser's own body", async () => {
    const upstream = service(() => Response.json(SERVICE_BODY));
    const saved = await put({ source: "field", field: "programmer", revision: 1 });
    expect(saved.status).toBe(200);
    const [url, init] = upstream.mock.calls[0];
    expect(String(url)).toBe("http://oversight.internal:3300/api/v1/people/credit?project=MJHDASH&level=people");
    expect(init?.method).toBe("PUT");
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(init?.body))).toEqual({ source: "field", field: "programmer", revision: 1 });
    // A missing field reads as none: the rebuilt body always names it.
    await put({ source: "assignee", revision: 2 });
    expect(JSON.parse(String(upstream.mock.calls[1][1]?.body))).toEqual({ source: "assignee", field: null, revision: 2 });
  });

  it("says the service's stale revision and refusals in this interface's words, and a service without the setting plainly", async () => {
    service(() => Response.json({ detail: "the board's credit setting is at revision 4", code: "stale_revision" }, { status: 409 }));
    expect((await expectProblem(await put({ source: "assignee", field: null, revision: 1 }), 409, "stale_revision")).message).toBe(CREDIT_STALE);
    service(() => Response.json({ detail: "Testers is not filled on any of the board's tickets." }, { status: 422 }));
    expect((await expectProblem(await put({ source: "field", field: "testers", revision: 4 }), 422, "credit_invalid")).message).toBe(
      "Testers is not filled on any of the board's tickets.",
    );
    service(() => Response.json({ detail: "<b>no</b>" }, { status: 422 }));
    expect((await expectProblem(await put({ source: "field", field: "testers", revision: 4 }), 422, "credit_invalid")).message).toBe(CREDIT_REFUSED);
    service(() => Response.json({ detail: "Not Found" }, { status: 404 }));
    expect((await expectProblem(await read("people/credit"), 502, "upstream_error")).message).toBe(CREDIT_MISSING);
    service(() => Response.json({ detail: "x", code: "unknown_board" }, { status: 404 }));
    await expectProblem(await read("people/credit"), 404, "unknown_board");
  });

  it("refuses a body that does not add up, or another board's, or another period's", async () => {
    service(() => Response.json({ ...SERVICE_BODY, options: [...SERVICE_BODY.options].reverse() }));
    await expectProblem(await read("people/credit?days=180"), 502, "upstream_invalid");
    service(() => Response.json({ ...SERVICE_BODY, setting: { ...SERVICE_BODY.setting, field: null } }));
    await expectProblem(await read("people/credit?days=180"), 502, "upstream_invalid");
    service(() => Response.json({ ...SERVICE_BODY, meta: { ...SERVICE_BODY.meta, projects: ["AIL"] } }));
    await expectProblem(await read("people/credit?days=180"), 502, "upstream_invalid");
    service(() => Response.json(SERVICE_BODY));
    await expectProblem(await read("people/credit?days=30"), 502, "upstream_invalid");
  });

  it("refuses a body it cannot take before the service is asked anything", async () => {
    const upstream = service(() => Response.json(SERVICE_BODY));
    await expectProblem(await put({ source: "field", field: "Programmer", revision: 1 }), 422, "credit_invalid");
    await expectProblem(await put({ source: "auto", field: null, revision: -1 }), 422, "credit_invalid");
    expect(upstream).not.toHaveBeenCalled();
  });
});
