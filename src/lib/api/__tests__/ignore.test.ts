import { afterEach, describe, expect, it, vi } from "vitest";

import findingsJson from "../../../../docs/sample-responses/findings.json";
import { getIgnored, postIgnore, postIgnorePreview, postRestore } from "../client";
import {
  canonicalIgnoreQuery,
  ignoredPageSchema,
  ignorePreviewRequestSchema,
  ignorePreviewSchema,
  ignoreRequestSchema,
  ignoreResultSchema,
  ignoreTargetSchema,
  recheckUnderWay,
  restoreRecheckSchema,
  restoreRequestSchema,
  restoreResultSchema,
} from "../ignores";
import { findingsSearchParams, ignoredSearchParams, normalizeFindingsQuery, parseFindingsQuery, parseIgnoredQuery } from "../params";

afterEach(() => {
  vi.unstubAllGlobals();
});

const META = findingsJson.meta;
const ID = "0b7b3b0f61c477e61699982f24892735";

describe("an ignore's target", () => {
  it("names exactly one of findings, tickets or the filters, each once and in order", () => {
    expect(ignoreTargetSchema.parse({ finding_ids: ["f".repeat(32), ID, ID] })).toEqual({ finding_ids: [ID, "f".repeat(32)] });
    expect(ignoreTargetSchema.parse({ issue_keys: ["DEMO-12", "DEMO-3"] })).toEqual({ issue_keys: ["DEMO-12", "DEMO-3"] });
    for (const target of [{}, { finding_ids: [ID], issue_keys: ["DEMO-1"] }, { finding_ids: [] }, { issue_keys: ["demo-1"] }, null, "all", [ID]]) {
      expect(ignoreTargetSchema.safeParse(target).success, JSON.stringify(target)).toBe(false);
    }
    expect(ignoreTargetSchema.safeParse({ finding_ids: Array.from({ length: 10_001 }, () => ID) }).success).toBe(false);
  });

  it("reads the findings filters, drops what does not narrow, and refuses a state or a page", () => {
    const target = ignoreTargetSchema.parse({
      query: { rule: ["R-EST-01", "R-EST-01"], epic: [], person: ["unassigned"], q: "  ", first_seen: "all", ticket: "finished", severity: "breach" },
    });
    expect(target).toEqual({ query: { rule: ["R-EST-01"], person: ["unassigned"], ticket: "finished", severity: "breach" } });
    expect(canonicalIgnoreQuery({})).toEqual({});
    for (const query of [{ state: "open" }, { page: 2 }, { ticket: "closed" }, { rule: ["R-NOPE"] }]) {
      expect(ignoreTargetSchema.safeParse({ query }).success, JSON.stringify(query)).toBe(false);
    }
  });
});

describe("the requests", () => {
  it("take tickets by key only at a ticket's scope", () => {
    expect(ignorePreviewRequestSchema.safeParse({ target: { issue_keys: ["DEMO-1"] }, scope: "finding" }).success).toBe(false);
    expect(ignorePreviewRequestSchema.parse({ target: { issue_keys: ["DEMO-1"] }, scope: "ticket" })).toEqual({ target: { issue_keys: ["DEMO-1"] }, scope: "ticket" });
    expect(ignorePreviewRequestSchema.safeParse({ target: { finding_ids: [ID] }, scope: "epic" }).success).toBe(false);
  });

  it("keep a reason as plain words on one line, at most 500 characters, never an email address; blank is none", () => {
    const body = (reason: unknown) => ignoreRequestSchema.safeParse({ target: { finding_ids: [ID] }, scope: "finding", reason });
    expect(body("  Closed\n\tlong ago  ").data?.reason).toBe("Closed long ago");
    expect(body("   ").data?.reason).toBeNull();
    expect(body(null).data?.reason).toBeNull();
    expect(ignoreRequestSchema.parse({ target: { finding_ids: [ID] }, scope: "finding" }).reason).toBeNull();
    expect(body("📈".repeat(500)).success).toBe(true);
    expect(body("x".repeat(501)).success).toBe(false);
    expect(body("Asked by jane.doe@example.org").success).toBe(false);
    expect(ignoreRequestSchema.safeParse({ target: { finding_ids: [ID] }, scope: "finding", level: "people" }).success).toBe(false);
  });

  it("restore ignores by id, each once", () => {
    expect(restoreRequestSchema.parse({ ignore_ids: ["b", "a", "b"] })).toEqual({ ignore_ids: ["a", "b"] });
    for (const body of [{ ignore_ids: [] }, { ignore_ids: "all" }, { ignore_ids: ["has space"] }, {}]) {
      expect(restoreRequestSchema.safeParse(body).success, JSON.stringify(body)).toBe(false);
    }
  });
});

describe("the answers", () => {
  it("a preview adds up by rule, each rule once", () => {
    const preview = { meta: META, findings: 3, tickets: 2, by_rule: [{ rule_id: "R-EST-01", rule_title: "A", findings: 2 }, { rule_id: "R-FLOW-02", rule_title: "B", findings: 1 }], already_ignored: 4 };
    expect(ignorePreviewSchema.parse(preview).findings).toBe(3);
    expect(ignorePreviewSchema.safeParse({ ...preview, findings: 4 }).success).toBe(false);
    expect(ignorePreviewSchema.safeParse({ ...preview, by_rule: [preview.by_rule[0], { ...preview.by_rule[0], findings: 1 }] }).success).toBe(false);
  });

  it("an ignore names each ignore once; a restore's re-check reads as the Refresher or the settings' apply state says it", () => {
    expect(ignoreResultSchema.safeParse({ meta: META, ignored: { findings: 1, tickets: 1 }, ignore_ids: ["a", "a"] }).success).toBe(false);
    const job = restoreRecheckSchema.parse({ state: "queued" });
    expect(job).toEqual({ state: "queued", started_at: null, finished_at: null, message: null });
    expect(recheckUnderWay(job)).toBe(true);
    const applied = restoreRecheckSchema.parse({ state: "applied", applied_revision: 0, started_at: null, finished_at: null, message: null, result: null });
    expect(recheckUnderWay(applied)).toBe(false);
    expect(restoreResultSchema.parse({ meta: META, restored: 0, recheck: null }).recheck).toBeNull();
  });

  it("an ignored list names each ignore once, a whole ticket's with no rule, never more than its page", () => {
    const item = {
      ignore_id: "c".repeat(32),
      scope: "finding",
      issue_key: "DEMO-12",
      issue_summary: "Add saved searches",
      issue_type: "Task",
      status: "Done",
      status_category: "done",
      rule_id: "R-EST-01",
      rule_title: "Work started without an estimate",
      findings: 1,
      reason: "Old work, ask jane.doe@example.org",
      by: "Morgan Ellis",
      at: "2026-11-04T14:30:00.000Z",
    };
    const page = ignoredPageSchema.parse({ meta: META, items: [item], total: 1, page: 1, page_size: 25 });
    expect(page.items[0].reason).toBe("Old work, ask (email address removed)");
    expect(ignoredPageSchema.safeParse({ meta: META, items: [item, item], total: 2, page: 1, page_size: 25 }).success).toBe(false);
    expect(ignoredPageSchema.safeParse({ meta: META, items: [{ ...item, scope: "ticket" }], total: 1, page: 1, page_size: 25 }).success).toBe(false);
    expect(ignoredPageSchema.safeParse({ meta: META, items: [item], total: 1, page: 1, page_size: 0 }).success).toBe(false);
  });
});

describe("the parameters", () => {
  it("a findings read takes the ticket filter and the ignored state, in canonical form", () => {
    expect(findingsSearchParams({ state: "ignored", ticket: "finished", rule: ["R-EST-01"] }).toString()).toBe("rule=R-EST-01&state=ignored&ticket=finished");
    expect(normalizeFindingsQuery({}).ticket).toBeUndefined();
    const refused = parseFindingsQuery(new URLSearchParams("ticket=done"));
    expect(refused.ok).toBe(false);
  });

  it("the ignored list takes its paging, sort and filters, and nothing else", () => {
    const parsed = parseIgnoredQuery(new URLSearchParams("rule=R-FLOW-02&rule=R-EST-01&q=DEMO-12&sort=issue_key&order=asc&page=2&page_size=100"));
    expect(parsed.ok && ignoredSearchParams(parsed.value).toString()).toBe("rule=R-EST-01&rule=R-FLOW-02&q=DEMO-12&sort=issue_key&order=asc&page=2&page_size=100");
    expect(ignoredSearchParams({}).toString()).toBe("");
    for (const bad of ["sort=severity", "page_size=101", "project=DEMO", "q=a&q=b"]) expect(parseIgnoredQuery(new URLSearchParams(bad)).ok, bad).toBe(false);
  });
});

describe("the client", () => {
  function answering(body: unknown) {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("posts the preview, the ignore and the restore as JSON from the page's origin, and reads the ignored list", async () => {
    const preview = answering({ meta: META, findings: 0, tickets: 0, by_rule: [], already_ignored: 0 });
    await postIgnorePreview({ target: { query: { ticket: "finished" } }, scope: "finding" });
    expect(preview.mock.calls[0]).toEqual([
      "/api/oversight/findings/ignore/preview",
      expect.objectContaining({ method: "POST", referrerPolicy: "same-origin", body: JSON.stringify({ target: { query: { ticket: "finished" } }, scope: "finding" }) }),
    ]);

    const ignore = answering({ meta: META, ignored: { findings: 1, tickets: 1 }, ignore_ids: ["a"] });
    expect((await postIgnore({ target: { finding_ids: [ID] }, scope: "finding", reason: null })).ignore_ids).toEqual(["a"]);
    expect(ignore.mock.calls[0][0]).toBe("/api/oversight/findings/ignore");

    const restore = answering({ meta: META, restored: 1, recheck: { state: "succeeded" } });
    expect((await postRestore(["a"])).restored).toBe(1);
    expect(restore.mock.calls[0]).toEqual(["/api/oversight/findings/restore", expect.objectContaining({ body: JSON.stringify({ ignore_ids: ["a"] }) })]);

    const list = answering({ meta: META, items: [], total: 0, page: 1, page_size: 100 });
    await getIgnored({ q: "DEMO-12", page_size: 100 });
    expect(list.mock.calls[0][0]).toBe("/api/oversight/findings/ignored?q=DEMO-12&page_size=100");
  });
});
