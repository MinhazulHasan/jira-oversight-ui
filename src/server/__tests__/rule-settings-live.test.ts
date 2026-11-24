// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GET, POST } from "@/app/api/oversight/[...path]/route";
import { apiErrorBodySchema, RULE_SETTINGS_CONFLICT, ruleSettingsPreviewSchema, ruleSettingsSchema, type RuleSettings } from "@/lib/api/schemas";

import previewJson from "../../../docs/sample-responses/rule-settings-preview.json";
import settingsJson from "../../../docs/sample-responses/rule-settings.json";
import { RULE_SETTINGS_MISSING, SETTINGS_BUSY, SETTINGS_REFUSED } from "../live";

const LIVE = { OVERSIGHT_DATA: "live", OVERSIGHT_API_URL: "http://oversight.internal:3300", OVERSIGHT_SERVICE_KEY: "svc-key", AUTH_MODE: "off" };
const ORIGIN = "http://localhost:3400";
const BOARD = "jo-board=DEMO";
const settings = { ...(settingsJson as RuleSettings), meta: { ...(settingsJson as RuleSettings).meta, data_mode: "live" as const } };
const previewBody = { ...previewJson, meta: { ...previewJson.meta, data_mode: "live" } };

const params = (url: URL) => ({ params: Promise.resolve({ path: url.pathname.replace(/^\/api\/oversight\//, "").split("/") }) });

function read(path: string, cookie = BOARD) {
  const url = new URL(`${ORIGIN}/api/oversight/${path}`);
  return GET(new NextRequest(url, { headers: { cookie } }), params(url));
}

function change(path: string, body: unknown) {
  const url = new URL(`${ORIGIN}/api/oversight/${path}`);
  const headers = { "content-type": "application/json", origin: ORIGIN, cookie: BOARD };
  return POST(new NextRequest(url, { method: "POST", body: JSON.stringify(body), headers }), params(url));
}

/** The service, answering as `answer` says; every call it gets is kept. */
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

describe("forwarding rule settings to the service", () => {
  it("reads the picked board's settings at people level, naming the reader, and passes on only what the contract names", async () => {
    const upstream = service(() => Response.json({ ...settings, internal: "never passed on" }));
    const response = await read("rules/settings");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(ruleSettingsSchema.parse(body)).toStrictEqual(body);
    expect(body).not.toHaveProperty("internal");
    const [url, init] = upstream.mock.calls[0];
    expect(String(url)).toBe("http://oversight.internal:3300/api/v1/rules/settings?project=DEMO&level=people");
    expect(init?.method).toBe("GET");
    const headers = new Headers(init?.headers);
    expect(headers.get("x-service-key")).toBe("svc-key");
    expect(headers.get("x-oversight-viewer")).toBe("local");
    expect(headers.get("x-oversight-viewer-name")).toBe(encodeURIComponent("Local (sign-in off)"));
    expect(init?.redirect).toBe("error");
  });

  it("posts a preview's checked changes as JSON, and a save's with its revision and reason, never the browser's own body", async () => {
    const upstream = service((url) => Response.json(url.pathname.endsWith("/preview") ? previewBody : settings));
    const previewed = await change("rules/settings/preview", { changes: [{ rule_id: "R-EFF-01", params: { threshold: 2 }, reset: false }, { rule_id: "W-AGE-01", enabled: false }] });
    expect(ruleSettingsPreviewSchema.parse(await previewed.json()).impact).toHaveLength(2);
    const [previewUrl, previewInit] = upstream.mock.calls[0];
    expect(String(previewUrl)).toBe("http://oversight.internal:3300/api/v1/rules/settings/preview?project=DEMO&level=people");
    expect(previewInit?.method).toBe("POST");
    expect(new Headers(previewInit?.headers).get("content-type")).toBe("application/json");
    expect(JSON.parse(String(previewInit?.body))).toEqual({ changes: [{ rule_id: "R-EFF-01", params: { threshold: 2 } }, { rule_id: "W-AGE-01", enabled: false }] });

    await change("rules/settings", { revision: 0, changes: [{ rule_id: "W-AGE-01", enabled: false }], reason: "  Too noisy on this board  " });
    const [saveUrl, saveInit] = upstream.mock.calls[1];
    expect(String(saveUrl)).toBe("http://oversight.internal:3300/api/v1/rules/settings?project=DEMO&level=people");
    expect(saveInit?.method).toBe("POST");
    expect(String(saveInit?.body)).toBe('{"revision":0,"changes":[{"rule_id":"W-AGE-01","enabled":false}],"reason":"Too noisy on this board"}');
  });

  it("never forwards a body that is not the contract's", async () => {
    const upstream = service(() => Response.json(settings));
    await expectProblem(await change("rules/settings", { revision: 0, changes: [{ rule_id: "R-EFF-01", params: { threshold: 50 } }] }), 422, "rule_settings_invalid");
    expect(upstream).not.toHaveBeenCalled();
  });

  it("refuses settings for another board than the one picked, and a body that breaks the contract", async () => {
    service(() => Response.json({ ...settings, project: "AIL" }));
    expect((await expectProblem(await read("rules/settings"), 502, "upstream_invalid")).message).toMatch(/another board/);
    service(() => Response.json({ ...settings, revision: 2 }));
    const invalid = await expectProblem(await read("rules/settings"), 502, "upstream_invalid");
    expect(invalid.issues?.map((issue) => issue.path)).toContain("updated_at");
  });

  it("says a save someone else's overtook in its own words (409 rule_settings_conflict), whatever the service said", async () => {
    service(() => Response.json({ detail: "the board is at revision 4 <b>now</b>", code: "rule_settings_conflict" }, { status: 409 }));
    const conflict = await expectProblem(await change("rules/settings", { revision: 3, changes: [{ rule_id: "W-AGE-01", enabled: false }] }), 409, "rule_settings_conflict");
    expect(conflict.message).toBe(RULE_SETTINGS_CONFLICT);
    expect(JSON.stringify(conflict)).not.toContain("revision 4");
    // A 409 without the code is not one this interface knows: an upstream error, as any other.
    service(() => Response.json({ detail: "conflict" }, { status: 409 }));
    await expectProblem(await change("rules/settings", { revision: 3, changes: [{ rule_id: "W-AGE-01", enabled: false }] }), 502, "upstream_error");
  });

  it("passes on the service's refusal of settings problem by problem, each at its setting, only in plain words", async () => {
    const errors = [
      { rule_id: "W-EFF-01", field: "params.threshold", message: "W-EFF-01's effort ratio (1.6) must stay below R-EFF-01's (1.5) while both are on." },
      { rule_id: "R-EST-02", field: null, message: "R-EST-02 already has these settings on this board." },
      { rule_id: null, field: "reason", message: "The reason cannot hold an email address or an account id." },
      { rule_id: null, field: "undo_of", message: "The change to undo is not one of this board's." },
      { rule_id: null, field: null, message: "The request body must be a JSON object." },
      { rule_id: "R-EFF-01", field: "params.threshold", message: "See https://internal.example/rules for the bounds." },
      { rule_id: "R-EFF-01", field: "params.threshold", message: "Ask lead@example.org about it." },
      { rule_id: "R-EFF-01", field: "params.threshold", message: "<script>alert(1)</script>" },
      { rule_id: "R-EFF-01", field: "params.threshold", message: "x".repeat(301) },
    ];
    service(() => Response.json({ detail: "W-EFF-01: ...", code: "rule_settings_invalid", errors }, { status: 422 }));
    const refused = await expectProblem(
      await change("rules/settings", { revision: 0, changes: [{ rule_id: "W-EFF-01", params: { threshold: 1.6 } }, { rule_id: "R-EST-02", enabled: true }] }),
      422,
      "rule_settings_invalid",
    );
    expect(refused.message).toBe(SETTINGS_REFUSED);
    expect(refused.issues).toEqual([
      { path: "W-EFF-01.params.threshold", message: errors[0].message },
      { path: "R-EST-02", message: errors[1].message },
      { path: "reason", message: errors[2].message },
      { path: "undo_of", message: errors[3].message },
      { path: "(settings)", message: errors[4].message },
    ]);
  });

  it("places the fields the service names beyond the usual: a change naming no rule, thresholds as a whole, a key not taken", async () => {
    const errors = [
      { rule_id: null, field: "rule_id", message: "Change 1 must name its rule by id, such as R-EFF-01." },
      { rule_id: "R-EFF-01", field: "params", message: "Its thresholds must be an object of numbers, by name." },
      { rule_id: "R-EFF-01", field: "title", message: "A change cannot set title." },
      { rule_id: null, field: "extra", message: "extra is not something this request takes." },
    ];
    service(() => Response.json({ detail: errors.map((error) => error.message).join(" "), code: "rule_settings_invalid", errors }, { status: 422 }));
    const refused = await expectProblem(await change("rules/settings", { revision: 0, changes: [{ rule_id: "R-EFF-01", enabled: false }] }), 422, "rule_settings_invalid");
    // A title is a field a change may set since (a custom rule's edit): said at it, beside the rule all the same.
    expect(refused.issues?.map((issue) => issue.path)).toEqual(["(settings)", "R-EFF-01.params", "R-EFF-01.title", "(settings)"]);
    expect(refused.issues?.map((issue) => issue.message)).toEqual(errors.map((error) => error.message));
  });

  it("asks for no board when none is picked, and takes the service's answer for its default board", async () => {
    const upstream = service((url) => Response.json(url.pathname.endsWith("/preview") ? previewBody : settings));
    const shown = await read("rules/settings", "other=1");
    expect(shown.status).toBe(200);
    expect(String(upstream.mock.calls[0][0])).toBe("http://oversight.internal:3300/api/v1/rules/settings?level=people");
    const url = new URL(`${ORIGIN}/api/oversight/rules/settings/preview`);
    const headers = { "content-type": "application/json", origin: ORIGIN };
    const previewed = await POST(new NextRequest(url, { method: "POST", body: JSON.stringify({ changes: [{ rule_id: "W-AGE-01", enabled: false }] }), headers }), params(url));
    expect(previewed.status).toBe(200);
    expect(String(upstream.mock.calls[1][0])).toBe("http://oversight.internal:3300/api/v1/rules/settings/preview?level=people");
  });

  it("reads FastAPI's own shape too, placing a change by its rule; and says the whole refusal when it names no problem", async () => {
    const detail = [{ loc: ["body", "changes", 1, "params", "days_left"], msg: "Days left must be from 0 to 14.", type: "value_error" }];
    service(() => Response.json({ detail: { code: "rule_settings_invalid", errors: detail } }, { status: 422 }));
    const located = await expectProblem(
      await change("rules/settings/preview", { changes: [{ rule_id: "R-EFF-01", enabled: false }, { rule_id: "W-SPR-01", params: { days_left: 3 } }] }),
      422,
      "rule_settings_invalid",
    );
    expect(located.issues).toEqual([{ path: "W-SPR-01.params.days_left", message: "Days left must be from 0 to 14." }]);

    service(() => Response.json({ detail: "Nothing to change.", code: "rule_settings_invalid" }, { status: 422 }));
    const whole = await expectProblem(await change("rules/settings/preview", { changes: [{ rule_id: "R-EFF-01", enabled: false }] }), 422, "rule_settings_invalid");
    expect(whole.issues).toEqual([{ path: "(settings)", message: "Nothing to change." }]);

    // A 422 without the code is FastAPI refusing the request itself: this interface's fault, said as an upstream error.
    service(() => Response.json({ detail: [{ loc: ["query", "level"], msg: "bad" }] }, { status: 422 }));
    await expectProblem(await change("rules/settings/preview", { changes: [{ rule_id: "R-EFF-01", enabled: false }] }), 502, "upstream_error");
  });

  it("says a save the rules held up plainly, and nothing was written; any other 503 is the service being busy", async () => {
    service(() => Response.json({ detail: "busy", code: "rule_settings_busy" }, { status: 503 }));
    const busy = await expectProblem(await change("rules/settings", { revision: 0, changes: [{ rule_id: "W-AGE-01", enabled: false }] }), 503, "upstream_unavailable");
    expect(busy.message).toBe(SETTINGS_BUSY);
    service(() => Response.json({ detail: "starting" }, { status: 503 }));
    const starting = await expectProblem(await change("rules/settings", { revision: 0, changes: [{ rule_id: "W-AGE-01", enabled: false }] }), 503, "upstream_unavailable");
    expect(starting.message).not.toBe(SETTINGS_BUSY);
  });

  it("refuses the service's 403 at team level as its credentials' problem, and a board it does not serve by its code", async () => {
    service(() => Response.json({ detail: "people level only", code: "people_level_only" }, { status: 403 }));
    await expectProblem(await read("rules/settings"), 502, "upstream_refused");
    service(() => Response.json({ detail: "no such board", code: "unknown_board" }, { status: 404 }));
    await expectProblem(await read("rules/settings"), 404, "unknown_board");
    // A service from before rule settings has no such route: said as that, never as the board.
    service(() => Response.json({ detail: "Not Found" }, { status: 404 }));
    expect((await expectProblem(await read("rules/settings"), 502, "upstream_error")).message).toBe(RULE_SETTINGS_MISSING);
    await expectProblem(await change("rules/settings/preview", { changes: [{ rule_id: "W-AGE-01", enabled: false }] }), 502, "upstream_error");
  });

  it("opens the settings of a board that has never synced: its meta has no sync time yet", async () => {
    service(() => Response.json({ ...settings, meta: { ...settings.meta, last_synced_at: null } }));
    const response = await read("rules/settings");
    expect(response.status).toBe(200);
    expect(ruleSettingsSchema.parse(await response.json()).meta.last_synced_at).toBeNull();
  });
});
