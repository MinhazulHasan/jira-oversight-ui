import { afterEach, describe, expect, it, vi } from "vitest";

import directorySample from "../../../../docs/sample-responses/people-directory.json";
import peopleSample from "../../../../docs/sample-responses/people.json";
import { getFindings, getHealth, getIssueTimeline, getPeople, getPeopleDirectory, getTrend, isApiError, postAsk, type ApiError } from "../client";

const HEALTH = {
  status: "ok",
  message: null,
  data_mode: "sample",
  read_only: true,
  api_version: "0.1.0",
  last_synced_at: "2026-11-04T14:28:00.000Z",
  projects: ["DEMO"],
  report_timezone: "Europe/London",
};

function respond(body: unknown, status = 200) {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(isApiError(error)).toBe(true);
  return error as ApiError;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the API client", () => {
  it("asks its own server route, never the service, and parses what comes back", async () => {
    const fetchMock = respond(HEALTH);
    await expect(getHealth()).resolves.toEqual(HEALTH);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/oversight/health");
    expect(init?.cache).toBe("no-store");
    expect(new Headers(init?.headers).get("accept")).toBe("application/json");
  });

  it("writes the canonical query string for findings and trends", async () => {
    const fetchMock = respond({});
    await getFindings({ rule: ["R-FLOW-02", "R-EST-01"], page: 2 }).catch(() => undefined);
    await getFindings({ person: ["unassigned", "p3f9a2c41b0de", "unassigned"], epic: ["DEMO-704"] }).catch(() => undefined);
    await getTrend({ metric: "open_breaches", last_n: 4 }).catch(() => undefined);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/oversight/findings?rule=R-EST-01&rule=R-FLOW-02&page=2",
      "/api/oversight/findings?epic=DEMO-704&person=p3f9a2c41b0de&person=unassigned",
      "/api/oversight/trends?metric=open_breaches&period=week&last_n=4",
    ]);
  });

  it("asks for the board's people, and keeps nothing of a person but the id, the name and the picture's version", async () => {
    const leaky = structuredClone(peopleSample) as { people: { person: Record<string, unknown> | null }[] };
    const first = leaky.people[0].person!;
    Object.assign(first, { accountId: "acc-01", emailAddress: "someone@example.com", avatarUrls: { "48x48": "https://example.com/a.png" }, timeZone: "Europe/London" });
    const fetchMock = respond(leaky);
    const people = await getPeople();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/oversight/people");
    expect(Object.keys(people.people[0].person ?? {}).sort()).toEqual(["avatar", "id", "name"]);
    expect(people).toEqual(peopleSample);
  });

  it("asks for the board's directory, and keeps nothing of a person but the id, the name and the picture's version", async () => {
    const leaky = structuredClone(directorySample) as { people: { person: Record<string, unknown> }[] };
    Object.assign(leaky.people[0].person, { accountId: "acc-01", emailAddress: "someone@example.com", timeZone: "Europe/London" });
    const fetchMock = respond(leaky);
    const directory = await getPeopleDirectory();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/oversight/people/directory");
    expect(Object.keys(directory.people[0].person).sort()).toEqual(["avatar", "id", "name"]);
    expect(directory).toEqual(directorySample);
  });

  it("escapes what goes into a path", async () => {
    const fetchMock = respond({});
    await getIssueTimeline("DEMO-1/../../admin").catch(() => undefined);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/oversight/issues/DEMO-1%2F..%2F..%2Fadmin/timeline");
  });

  it("posts a question as JSON", async () => {
    const fetchMock = respond({});
    await postAsk("Where do tickets get stuck most?").catch(() => undefined);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/oversight/ask");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ question: "Where do tickets get stuck most?" }));
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
  });

  it("posts the people a question mentions by id, and never a level: the server decides that", async () => {
    const fetchMock = respond({});
    await postAsk("What are @Carmen Ruiz's open findings?", ["p599114b761a6"]).catch(() => undefined);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body)) as Record<string, unknown>;
    expect(body).toEqual({ question: "What are @Carmen Ruiz's open findings?", mentions: ["p599114b761a6"] });
    expect(body).not.toHaveProperty("level");
  });

  it("turns an error body into an ApiError carrying its status and code", async () => {
    respond({ error: "not_found", message: "DEMO-9 is not in the synced data." }, 404);
    const error = await failure(getIssueTimeline("DEMO-9"));
    expect(error).toMatchObject({ status: 404, code: "not_found", message: "DEMO-9 is not in the synced data." });
    expect(error.notFound).toBe(true);
    expect(error.retryable).toBe(false);
  });

  it("keeps the problems a 400 lists", async () => {
    respond({ error: "bad_request", message: "The findings filters are not valid.", issues: [{ path: "page", message: "Too small" }] }, 400);
    expect((await failure(getFindings())).issues).toEqual([{ path: "page", message: "Too small" }]);
  });

  it("copes with an error that is not JSON", async () => {
    respond("<html>Gateway Timeout</html>", 504);
    const error = await failure(getHealth());
    expect(error).toMatchObject({ status: 504, code: "http_error" });
    expect(error.retryable).toBe(true);
  });

  it("refuses data that breaks the contract rather than rendering it", async () => {
    respond({ ...HEALTH, read_only: false });
    const error = await failure(getHealth());
    expect(error).toMatchObject({ status: 502, code: "invalid_response" });
    expect(error.issues.map((issue) => issue.path)).toContain("read_only");
  });

  it("reports a lost connection as status 0, worth retrying", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch")));
    const error = await failure(getHealth());
    expect(error).toMatchObject({ status: 0, code: "network_error" });
    expect(error.retryable).toBe(true);
  });

  it("lets a cancelled request stay cancelled", async () => {
    const abort = new DOMException("The user aborted a request.", "AbortError");
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(abort));
    await expect(getHealth({ signal: AbortSignal.abort() })).rejects.toBe(abort);
  });
});
