// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GET, POST } from "@/app/api/oversight/[...path]/route";
import { apiErrorBodySchema, RULE_DRAFT_PERSONAL, ruleDraftSchema, ruleSettingsSchema } from "@/lib/api/schemas";

import draftJson from "../../../../docs/sample-responses/rule-settings-draft.json";
import { DRAFT_BODY_FORM, resolvePost, ruleSettingsPost, settingsProblemPath } from "../../endpoints";
import { DRAFT_REFUSED, DRAFT_TIMEOUT_MS, RULE_DRAFT_MISSING } from "../../live";
import { resetSampleClock } from "../../sample/clock";
import { boardSettings, resetSampleRuleSettings, revisionOf } from "../../sample/settings-store";
import { sealSession } from "../cookies";
import { emailHash } from "../roles";

import { APP, SECRET, SESSION_KEYS, stubAuthEnv } from "./fixtures";

const NOW = "2026-11-04T14:30:00Z";
const SAMPLE = { OVERSIGHT_DATA: "sample", SAMPLE_NOW: NOW, SAMPLE_LATENCY: "0", AUTH_MODE: "off" };
const LIVE = { OVERSIGHT_DATA: "live", OVERSIGHT_API_URL: "http://oversight.internal:3300", OVERSIGHT_SERVICE_KEY: "svc-key", AUTH_MODE: "off" };
const IDENTITY = { sub: "557058:account", dom: "stellainternational.com", site: "cloud-id", eh: "hhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhhh", boards: ["DEMO"] };
const LEAD = "lead@stellainternational.com";
const DRAFT = { text: "Bugs in progress for more than 3 days" };
const NEW_RULE = {
  op: "create",
  rule: {
    title: "Bugs in progress over 3 days",
    check: "time_in_status_over",
    params: { statuses: ["In Progress"], hours: 72 },
    applies_to: { status_category: ["indeterminate"], issue_type: ["Bug"] },
    severity: "breach",
  },
};

const params = (url: URL) => ({ params: Promise.resolve({ path: url.pathname.replace(/^\/api\/oversight\//, "").split("/") }) });

interface Sent {
  origin?: string | null;
  type?: string;
  cookie?: string;
  /** The address the request's URL names: as Next.js builds it, the one the server is bound to. */
  base?: string;
  raw?: string;
}

function post(path: string, body: unknown, { origin = "http://localhost:3400", type = "application/json", cookie, base = "http://localhost:3400", raw }: Sent = {}) {
  const url = new URL(`${base}/api/oversight/${path}`);
  const headers: Record<string, string> = { "content-type": type };
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

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetSampleClock();
  resetSampleRuleSettings();
});

describe("the allowlist", () => {
  it("knows the draft by its path, and takes its text alone, as plain text", () => {
    expect(ruleSettingsPost(["rules", "settings", "draft"])).toBe("rule_settings_draft");
    expect(ruleSettingsPost(["rules", "settings", "drafts"])).toBeNull();
    const accepted = resolvePost(["rules", "settings", "draft"], new URLSearchParams(), { text: "  Bugs in\nreview for 3 days " });
    expect(accepted).toEqual({ ok: true, value: { route: { name: "rule_settings_draft", body: { text: "Bugs in review for 3 days" }, level: "team" }, upstream: "rules/settings/draft" } });
    for (const body of [{ text: "ab" }, { text: "x".repeat(501) }, { text: 3 }, { text: "Bugs over 3 days", level: "people" }, null, "text"]) {
      const refused = resolvePost(["rules", "settings", "draft"], new URLSearchParams(), body);
      expect(refused, JSON.stringify(body)).toMatchObject({ ok: false, status: 400, error: "bad_request", message: DRAFT_BODY_FORM });
    }
    expect(resolvePost(["rules", "settings", "draft"], new URLSearchParams("project=DEMO"), DRAFT)).toMatchObject({ ok: false, status: 400 });
    // Words that name someone are never forwarded to the AI: refused in the page's own words, as the service refuses them.
    for (const text of ["Bugs of sam@example.com open for 3 days", "Work of 5b10ac8d82e05b22cc7d4ef5 in review", "Tickets of 557058:f58131cb-b67d-43c7-b30d-6b58d40bd077"]) {
      const refused = resolvePost(["rules", "settings", "draft"], new URLSearchParams(), { text });
      expect(refused, text).toMatchObject({ ok: false, status: 400, error: "bad_request", message: RULE_DRAFT_PERSONAL });
    }
    // A long word of hexadecimal letters that is not an account id on its own, or a ticket key, is no one's.
    for (const text of ["Bugs open for 3 days in DEMO-552", "Work tagged deadbeefdeadbeefdeadbeef99 over 3 days"]) {
      expect(resolvePost(["rules", "settings", "draft"], new URLSearchParams(), { text }), text).toMatchObject({ ok: true });
    }
  });

  it("names a new rule's problem by the new rule's place among the request's new rules", () => {
    const body = { changes: [{ rule_id: "R-EFF-01", enabled: false }, NEW_RULE, { op: "delete", rule_id: "R-CUS-01" }, NEW_RULE] };
    expect(settingsProblemPath(body, ["changes", 1, "rule", "title"])).toBe("new-0.title");
    expect(settingsProblemPath(body, ["changes", 3, "rule", "params", "hours"])).toBe("new-1.params.hours");
    expect(settingsProblemPath(body, ["changes", 3])).toBe("new-1");
    expect(settingsProblemPath(body, ["changes", 2, "rule_id"])).toBe("R-CUS-01.rule_id");
  });
});

describe("the draft with sign-in off (people level), on the sample", () => {
  beforeEach(() => {
    for (const [name, value] of Object.entries(SAMPLE)) vi.stubEnv(name, value);
  });

  it("drafts from the board's own names and saves nothing", async () => {
    const response = await post("rules/settings/draft", DRAFT);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(ruleDraftSchema.parse(await response.json())).toEqual(ruleDraftSchema.parse(draftJson));
    expect(revisionOf(boardSettings())).toBe(0);
  });

  it("is refused from anywhere but this dashboard's own pages, or as anything but JSON, before anything is drafted", async () => {
    for (const origin of [null, "https://evil.example", "null"]) {
      const refused = await expectProblem(await post("rules/settings/draft", DRAFT, { origin }), 403, "forbidden");
      expect(refused.message).toBe("A rule can be drafted only from this dashboard's own pages, so nothing was drafted.");
    }
    const notJson = await expectProblem(await post("rules/settings/draft", DRAFT, { type: "text/plain" }), 403, "forbidden");
    expect(notJson.message).toBe("A rule is drafted from a JSON body, so nothing was drafted.");
  });

  it("waits Ask's time (SAMPLE_LATENCY's second figure) before it answers, as a model call takes its time; a read waits a read's", async () => {
    vi.stubEnv("SAMPLE_LATENCY", "0,1500");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      // A read takes the reads' latency, none here: answered without the clock moving.
      const url = new URL("http://localhost:3400/api/oversight/rules/settings");
      expect((await GET(new NextRequest(url), params(url))).status).toBe(200);
      let answered = false;
      const pending = post("rules/settings/draft", DRAFT).then((response) => {
        answered = true;
        return response;
      });
      // The route reads the body first, then waits: the clock moves once its wait is set.
      for (let tries = 0; vi.getTimerCount() === 0 && tries < 200; tries += 1) await new Promise((resolve) => setImmediate(resolve));
      expect(vi.getTimerCount()).toBe(1);
      await vi.advanceTimersByTimeAsync(1_499);
      expect(answered).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const response = await pending;
      expect(response.status).toBe(200);
      expect(ruleDraftSchema.parse(await response.json()).outcome).toBe("drafted");
    } finally {
      vi.useRealTimers();
    }
  });

  it("takes a body of at most 16 KB, and JSON only", async () => {
    await expectProblem(await post("rules/settings/draft", null, { raw: JSON.stringify({ text: "x".repeat(17 * 1024) }) }), 413, "bad_request");
    await expectProblem(await post("rules/settings/draft", null, { raw: "{text:" }), 400, "bad_request");
    // A GET of the draft is no route at all.
    const url = new URL("http://localhost:3400/api/oversight/rules/settings/draft");
    expect((await GET(new NextRequest(url), params(url))).status).toBe(404);
  });

  it("adds a rule through a save, refused at the new rule's field when the board cannot take it", async () => {
    const refused = await expectProblem(
      await post("rules/settings", { revision: 0, changes: [{ ...NEW_RULE, rule: { ...NEW_RULE.rule, params: { statuses: ["Code Review"], hours: 72 } } }] }),
      422,
      "rule_settings_invalid",
    );
    expect(refused.issues).toEqual([{ path: "new-0.params.statuses", message: 'This board has no status called "Code Review".' }]);
    const saved = ruleSettingsSchema.parse(await (await post("rules/settings", { revision: 0, changes: [NEW_RULE] })).json());
    expect(saved.rules.at(-1)).toMatchObject({ rule_id: "R-CUS-01", custom: true, created_by: "Local (sign-in off)" });
  });
});

describe("the draft with sign-in on", () => {
  beforeEach(() => stubAuthEnv({ OVERSIGHT_DATA: "sample", SAMPLE_NOW: NOW, SAMPLE_LATENCY: "0" }));

  it("is refused to a user (team level) before the sample or the service is asked anything", async () => {
    const session = `jo-session=${await sealSession(IDENTITY, SESSION_KEYS)}`;
    const refused = await expectProblem(await post("rules/settings/draft", DRAFT, { origin: APP, cookie: session }), 403, "people_not_allowed");
    expect(refused.message).toBe("Only admins can change rule settings.");
  });

  it("is an admin's, from APP_URL's origin and no other", async () => {
    vi.stubEnv("ADMIN_EMAILS", LEAD);
    const session = `jo-session=${await sealSession({ ...IDENTITY, name: "Morgan Ellis", eh: emailHash(LEAD, SECRET) }, SESSION_KEYS)}`;
    // The request's own origin is not enough with sign-in on: only APP_URL's is this dashboard's.
    await expectProblem(await post("rules/settings/draft", DRAFT, { base: "http://127.0.0.1:3400", origin: "http://127.0.0.1:3400", cookie: session }), 403, "forbidden");
    const drafted = await post("rules/settings/draft", DRAFT, { origin: APP, cookie: session });
    expect(drafted.status).toBe(200);
    expect(ruleDraftSchema.parse(await drafted.json()).outcome).toBe("drafted");
  });

  it("refuses anyone without a session", async () => {
    await expectProblem(await post("rules/settings/draft", DRAFT, { origin: APP }), 401, "unauthenticated");
  });
});

describe("the draft forwarded to the live service", () => {
  const live = { ...draftJson, meta: { ...draftJson.meta, data_mode: "live" } };

  beforeEach(() => {
    for (const [name, value] of Object.entries(LIVE)) vi.stubEnv(name, value);
  });

  function service(answer: (url: URL, init: RequestInit | undefined) => Response) {
    const upstream = vi.fn<typeof fetch>(async (input, init) => answer(new URL(String(input)), init));
    vi.stubGlobal("fetch", upstream);
    return upstream;
  }

  const draft = (cookie = "jo-board=DEMO") => post("rules/settings/draft", { text: "  Bugs in progress\tfor more than 3 days " }, { cookie });

  it("posts the checked text as JSON for the picked board at people level, naming the reader, and waits a model call's time", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");
    const upstream = service(() => Response.json({ ...live, internal: "never passed on" }));
    const response = await draft();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).not.toHaveProperty("internal");
    expect(ruleDraftSchema.parse(body)).toStrictEqual(body);
    const [url, init] = upstream.mock.calls[0];
    expect(String(url)).toBe("http://oversight.internal:3300/api/v1/rules/settings/draft?project=DEMO&level=people");
    expect(init?.method).toBe("POST");
    expect(String(init?.body)).toBe('{"text":"Bugs in progress for more than 3 days"}');
    const headers = new Headers(init?.headers);
    expect([headers.get("content-type"), headers.get("x-service-key"), headers.get("x-oversight-viewer")]).toEqual(["application/json", "svc-key", "local"]);
    expect(init?.redirect).toBe("error");
    expect(timeout).toHaveBeenCalledWith(DRAFT_TIMEOUT_MS);
    expect(DRAFT_TIMEOUT_MS).toBe(60_000);
  });

  it("passes on every outcome, and refuses a draft for another board or one that breaks the contract", async () => {
    for (const outcome of ["not_supported", "not_understood", "unavailable"] as const) {
      service(() => Response.json({ ...live, outcome, draft: null, explanation: null, note: "Today's AI budget is used up. You can still add a rule by hand.", problems: [] }));
      expect(ruleDraftSchema.parse(await (await draft()).json()).outcome, outcome).toBe(outcome);
    }
    service(() => Response.json({ ...live, project: "AIL" }));
    expect((await expectProblem(await draft(), 502, "upstream_invalid")).message).toMatch(/another board/);
    service(() => Response.json({ ...live, draft: null }));
    await expectProblem(await draft(), 502, "upstream_invalid");
  });

  it("says a service from before JO-20, a reader over the limit on questions, and a slow model plainly", async () => {
    service(() => Response.json({ detail: "Not Found" }, { status: 404 }));
    expect((await expectProblem(await draft(), 502, "upstream_error")).message).toBe(RULE_DRAFT_MISSING);
    service(() => Response.json({ detail: "slow down", code: "ask_rate_limited" }, { status: 429, headers: { "retry-after": "120" } }));
    const limited = await draft();
    await expectProblem(limited, 429, "ask_rate_limited");
    service(() => {
      throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    });
    await expectProblem(await draft(), 503, "upstream_timeout");
  });

  it("says the service's refusal of the words as the request's, in the service's words where they can be shown", async () => {
    const refusal = (message: string) =>
      Response.json(
        { detail: message, code: "rule_settings_invalid", errors: [{ rule_id: null, field: "text", message }] },
        { status: 422 },
      );
    service(() => refusal("The description cannot hold an email address or an account id."));
    const refused = await expectProblem(await draft(), 400, "bad_request");
    expect(refused.message).toBe("The description cannot hold an email address or an account id.");
    // Words that are not fit to show (an address among them) are never passed on.
    service(() => refusal("Refused: someone@example.com"));
    expect((await expectProblem(await draft(), 400, "bad_request")).message).toBe(DRAFT_REFUSED);
    service(() => new Response("not json", { status: 422 }));
    expect((await expectProblem(await draft(), 400, "bad_request")).message).toBe(DRAFT_REFUSED);
  });
});

describe("a custom rule's change forwarded to the live service", () => {
  beforeEach(() => {
    for (const [name, value] of Object.entries(LIVE)) vi.stubEnv(name, value);
  });

  it("is sent with its name as plain text: nothing unseen in it, a look-alike letter as its plain one", async () => {
    const upstream = vi.fn<typeof fetch>(async () => Response.json({ code: "rule_settings_invalid", errors: [] }, { status: 422 }));
    vi.stubGlobal("fetch", upstream);
    const sent = { changes: [{ ...NEW_RULE, rule: { ...NEW_RULE.rule, title: "Ｂugs in​ progress­ over 3 days" } }] };
    await post("rules/settings/preview", sent, { cookie: "jo-board=DEMO" });
    expect(JSON.parse(String(upstream.mock.calls[0][1]?.body))).toEqual({ changes: [NEW_RULE] });
    // A name that is blank once the unseen is taken out never reaches the service.
    upstream.mockClear();
    const blank = { changes: [{ ...NEW_RULE, rule: { ...NEW_RULE.rule, title: "​​​" } }] };
    const refused = await expectProblem(await post("rules/settings/preview", blank, { cookie: "jo-board=DEMO" }), 422, "rule_settings_invalid");
    expect(refused.issues).toEqual([{ path: "new-0.title", message: "Give it a name of 3 to 80 characters." }]);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("is sent as it was checked and rebuilt, and the service's refusal of a new rule is placed at the new rule", async () => {
    const upstream = vi.fn<typeof fetch>(async () =>
      Response.json(
        {
          code: "rule_settings_invalid",
          errors: [
            { rule_id: null, field: "changes.1.rule.title", message: "Another rule on this board has this name." },
            { rule_id: "R-CUS-04", field: "applies_to", message: "This check looks only at In progress work." },
          ],
        },
        { status: 422 },
      ),
    );
    vi.stubGlobal("fetch", upstream);
    const sent = { revision: 3, changes: [{ op: "delete", rule_id: "R-CUS-02" }, { ...NEW_RULE, rule: { ...NEW_RULE.rule, title: "  Bugs  in progress over 3 days " } }] };
    const refused = await expectProblem(await post("rules/settings", sent, { cookie: "jo-board=DEMO" }), 422, "rule_settings_invalid");
    expect(JSON.parse(String(upstream.mock.calls[0][1]?.body))).toEqual({ revision: 3, changes: [{ op: "delete", rule_id: "R-CUS-02" }, NEW_RULE] });
    expect(refused.issues).toEqual([
      { path: "new-0.title", message: "Another rule on this board has this name." },
      { path: "R-CUS-04.applies_to", message: "This check looks only at In progress work." },
    ]);
  });

  it("places a problem the service names by its change's place at that change: the second of two new rules is new-1", async () => {
    const second = { ...NEW_RULE, rule: { ...NEW_RULE.rule, title: "Bugs in progress over 4 days" } };
    const sent = { changes: [NEW_RULE, { rule_id: "R-EFF-01", enabled: false }, second] };
    const words = "Hours must be from 1 to 8760.";
    // Named by its place in the request (4.22), or by its field with the change's index beside it, as FastAPI's loc.
    for (const error of [
      { rule_id: null, field: "changes.2.rule.params.hours", message: words },
      { rule_id: null, field: "params.hours", index: 2, message: words },
    ]) {
      vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => Response.json({ code: "rule_settings_invalid", errors: [error] }, { status: 422 })));
      const refused = await expectProblem(await post("rules/settings/preview", sent, { cookie: "jo-board=DEMO" }), 422, "rule_settings_invalid");
      expect(refused.issues, JSON.stringify(error)).toEqual([{ path: "new-1.params.hours", message: words }]);
    }
    const limit = "A board can have at most 50 custom rules: delete one first.";
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () =>
        Response.json(
          {
            code: "rule_settings_invalid",
            errors: [
              { rule_id: null, field: null, index: 2, message: limit },
              { rule_id: null, field: "title", index: 1, message: "Only a rule added to this board can be edited." },
              { rule_id: null, field: "title", index: 7, message: "Two new rules have this name." },
            ],
          },
          { status: 422 },
        ),
      ),
    );
    const refused = await expectProblem(await post("rules/settings/preview", sent, { cookie: "jo-board=DEMO" }), 422, "rule_settings_invalid");
    expect(refused.issues).toEqual([
      { path: "new-1", message: limit },
      { path: "R-EFF-01.title", message: "Only a rule added to this board can be edited." },
      { path: "(settings)", message: "Two new rules have this name." },
    ]);
  });

  it("places a new rule's problem the service names at a field and no rule at the request's one new rule, and nowhere when it adds two without saying which", async () => {
    const answer = () =>
      Response.json({ code: "rule_settings_invalid", errors: [{ rule_id: null, field: "params.statuses", message: 'This board has no status called "Code Review".' }] }, { status: 422 });
    vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => answer()));
    const one = await expectProblem(await post("rules/settings/preview", { changes: [{ rule_id: "R-EFF-01", enabled: false }, NEW_RULE] }, { cookie: "jo-board=DEMO" }), 422, "rule_settings_invalid");
    expect(one.issues).toEqual([{ path: "new-0.params.statuses", message: 'This board has no status called "Code Review".' }]);
    const second = { ...NEW_RULE, rule: { ...NEW_RULE.rule, title: "Bugs in progress over 4 days" } };
    const two = await expectProblem(await post("rules/settings/preview", { changes: [NEW_RULE, second] }, { cookie: "jo-board=DEMO" }), 422, "rule_settings_invalid");
    expect(two.issues).toEqual([{ path: "(settings)", message: 'This board has no status called "Code Review".' }]);
  });

  it("reads FastAPI's own shape for a new rule too", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => Response.json({ detail: { code: "rule_settings_invalid", errors: [{ loc: ["body", "changes", 0, "rule", "params", "hours"], msg: "Hours must be from 1 to 8760." }] } }, { status: 422 })),
    );
    const refused = await expectProblem(await post("rules/settings/preview", { changes: [NEW_RULE] }, { cookie: "jo-board=DEMO" }), 422, "rule_settings_invalid");
    expect(refused.issues).toEqual([{ path: "new-0.params.hours", message: "Hours must be from 1 to 8760." }]);
  });
});
